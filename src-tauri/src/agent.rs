use crate::platform::{canonical_directory, configure_tokio_command, grok_executable};
use serde::{Deserialize, Serialize};
use std::{
    path::PathBuf,
    process::Stdio,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
};
use tauri::{AppHandle, Emitter, State};
use tokio::{
    io::{AsyncBufRead, AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin, Command},
    sync::Mutex,
};

const MAX_ACP_LINE_BYTES: usize = 16 * 1024 * 1024;

pub struct AgentState {
    process: Mutex<Option<AgentProcess>>,
    generation: Arc<AtomicU64>,
}

impl Default for AgentState {
    fn default() -> Self {
        Self {
            process: Mutex::new(None),
            generation: Arc::new(AtomicU64::new(0)),
        }
    }
}

pub fn should_emit_agent_event(live_generation: u64, event_generation: u64) -> bool {
    live_generation == event_generation
}

struct AgentProcess {
    child: Child,
    stdin: ChildStdin,
    cwd: PathBuf,
    options: AgentStartOptions,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStartOptions {
    pub cwd: String,
    pub model: Option<String>,
    pub reasoning_effort: Option<String>,
    pub always_approve: Option<bool>,
    pub permission_mode: Option<String>,
    pub leader: Option<bool>,
    pub debug: Option<bool>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentEvent {
    kind: &'static str,
    payload: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStartResult {
    cwd: String,
    pid: Option<u32>,
    args: Vec<String>,
}

fn emit_event(app: &AppHandle, kind: &'static str, payload: impl Into<String>) {
    let _ = app.emit(
        "grok-agent-event",
        AgentEvent {
            kind,
            payload: payload.into(),
        },
    );
}

async fn next_bounded_line<R: AsyncBufRead + Unpin>(
    reader: &mut R,
    scratch: &mut Vec<u8>,
    limit: usize,
) -> Result<Option<String>, String> {
    loop {
        let available = reader
            .fill_buf()
            .await
            .map_err(|error| format!("读取进程输出失败：{error}"))?;
        if available.is_empty() {
            if scratch.is_empty() {
                return Ok(None);
            }
            return String::from_utf8(std::mem::take(scratch))
                .map(Some)
                .map_err(|_| "进程输出不是有效 UTF-8".to_string());
        }

        let newline = available.iter().position(|byte| *byte == b'\n');
        let payload_len = newline.unwrap_or(available.len());
        if scratch.len().saturating_add(payload_len) > limit {
            return Err(format!(
                "Grok ACP 单条消息超过 {} MiB 安全上限",
                limit / 1024 / 1024
            ));
        }
        scratch.extend_from_slice(&available[..payload_len]);
        let consumed = payload_len + usize::from(newline.is_some());
        reader.consume(consumed);

        if newline.is_some() {
            if scratch.last() == Some(&b'\r') {
                scratch.pop();
            }
            return String::from_utf8(std::mem::take(scratch))
                .map(Some)
                .map_err(|_| "Grok ACP 消息不是有效 UTF-8".to_string());
        }
    }
}

fn validate_outbound_message(message: &str) -> Result<(), String> {
    if message.len() > MAX_ACP_LINE_BYTES {
        return Err("ACP 请求超过 16 MiB 安全上限".into());
    }
    if message.contains(['\r', '\n']) {
        return Err("ACP 请求必须是单行 JSON".into());
    }
    serde_json::from_str::<serde_json::Value>(message)
        .map_err(|error| format!("ACP 消息不是有效 JSON：{error}"))?;
    Ok(())
}

async fn stop_locked(process: &mut Option<AgentProcess>) {
    if let Some(mut running) = process.take() {
        let _ = running.child.kill().await;
        let _ = running.child.wait().await;
    }
}

fn build_agent_args(options: &AgentStartOptions) -> Result<Vec<String>, String> {
    // Grok 1.0.x requires global flags before the `agent stdio` subcommand.
    let mut args = Vec::new();
    if let Some(model) = options
        .model
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        args.push("--model".into());
        args.push(model.trim().into());
    }
    if let Some(effort) = options
        .reasoning_effort
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        args.push("--reasoning-effort".into());
        args.push(effort.trim().into());
    }
    if let Some(mode) = options
        .permission_mode
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        args.push("--permission-mode".into());
        args.push(mode.into());
    }
    if options.always_approve.unwrap_or(false) {
        args.push("--always-approve".into());
    }
    // Leader is a pager/TUI feature in Grok 1.0.x and is rejected by the ACP
    // agent process. It remains available through the embedded CLI terminal.
    args.push("agent".into());
    args.push("stdio".into());
    // `--debug` belongs to `agent stdio`, so it must follow the subcommand.
    if options.debug.unwrap_or(false) {
        args.push("--debug".into());
    }
    Ok(args)
}

async fn start_with_options(
    app: AppHandle,
    state: State<'_, AgentState>,
    options: AgentStartOptions,
) -> Result<AgentStartResult, String> {
    let canonical = canonical_directory(options.cwd.trim())?;
    let args = build_agent_args(&options)?;
    let generation = state.generation.fetch_add(1, Ordering::SeqCst) + 1;
    let live_generation = state.generation.clone();

    let mut slot = state.process.lock().await;
    stop_locked(&mut slot).await;

    let mut command = Command::new(grok_executable()?);
    command
        .args(&args)
        .current_dir(&canonical)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    configure_tokio_command(&mut command);
    if crate::computer::gate_enabled() {
        command.env("GROK_MAX_MCP_OUTPUT_BYTES", "8000000");
    }

    let mut child = command
        .spawn()
        .map_err(|error| format!("无法启动 Grok Build：{error}"))?;
    let pid = child.id();
    let stdin = child.stdin.take().ok_or("无法连接 Grok 标准输入")?;
    let stdout = child.stdout.take().ok_or("无法连接 Grok 标准输出")?;
    let stderr = child.stderr.take().ok_or("无法连接 Grok 错误输出")?;

    let stdout_app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut reader = BufReader::new(stdout);
        let mut scratch = Vec::new();
        loop {
            match next_bounded_line(&mut reader, &mut scratch, MAX_ACP_LINE_BYTES).await {
                Ok(Some(line)) => {
                    if should_emit_agent_event(live_generation.load(Ordering::SeqCst), generation) {
                        emit_event(&stdout_app, "message", line);
                    }
                }
                Ok(None) => {
                    if should_emit_agent_event(live_generation.load(Ordering::SeqCst), generation) {
                        emit_event(&stdout_app, "disconnected", "Grok Build 连接已关闭");
                    }
                    break;
                }
                Err(error) => {
                    if should_emit_agent_event(live_generation.load(Ordering::SeqCst), generation) {
                        emit_event(&stdout_app, "error", format!("读取 Grok 输出失败：{error}"));
                    }
                    break;
                }
            }
        }
    });

    let stderr_app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut reader = BufReader::new(stderr);
        let mut scratch = Vec::new();
        loop {
            match next_bounded_line(&mut reader, &mut scratch, 1024 * 1024).await {
                Ok(Some(line)) => emit_event(&stderr_app, "log", line),
                Ok(None) => break,
                Err(error) => {
                    emit_event(&stderr_app, "error", error);
                    break;
                }
            }
        }
    });

    *slot = Some(AgentProcess {
        child,
        stdin,
        cwd: canonical.clone(),
        options,
    });

    emit_event(&app, "started", canonical.to_string_lossy().to_string());
    Ok(AgentStartResult {
        cwd: canonical.to_string_lossy().to_string(),
        pid,
        args,
    })
}

#[tauri::command]
pub async fn start_agent(
    app: AppHandle,
    state: State<'_, AgentState>,
    cwd: String,
) -> Result<AgentStartResult, String> {
    start_with_options(
        app,
        state,
        AgentStartOptions {
            cwd,
            ..Default::default()
        },
    )
    .await
}

#[tauri::command]
pub async fn start_agent_advanced(
    app: AppHandle,
    state: State<'_, AgentState>,
    options: AgentStartOptions,
) -> Result<AgentStartResult, String> {
    start_with_options(app, state, options).await
}

#[tauri::command]
pub async fn send_agent_message(
    state: State<'_, AgentState>,
    message: String,
) -> Result<(), String> {
    validate_outbound_message(&message)?;

    let mut slot = state.process.lock().await;
    let process = slot.as_mut().ok_or("Grok Build 尚未连接")?;
    process
        .stdin
        .write_all(format!("{message}\n").as_bytes())
        .await
        .map_err(|error| format!("发送 ACP 消息失败：{error}"))?;
    process
        .stdin
        .flush()
        .await
        .map_err(|error| format!("刷新 ACP 消息失败：{error}"))
}

#[tauri::command]
pub async fn stop_agent(state: State<'_, AgentState>) -> Result<(), String> {
    state.generation.fetch_add(1, Ordering::SeqCst);
    let mut slot = state.process.lock().await;
    stop_locked(&mut slot).await;
    Ok(())
}

#[tauri::command]
pub async fn agent_status(state: State<'_, AgentState>) -> Result<serde_json::Value, String> {
    let mut slot = state.process.lock().await;
    if let Some(process) = slot.as_mut() {
        let exited = process.child.try_wait().ok().flatten().is_some();
        Ok(serde_json::json!({
          "running": !exited,
          "cwd": process.cwd.to_string_lossy(),
          "pid": process.child.id(),
          "options": process.options
        }))
    } else {
        Ok(serde_json::json!({ "running": false }))
    }
}

#[cfg(test)]
mod tests {
    use super::{
        build_agent_args, should_emit_agent_event, validate_outbound_message, AgentStartOptions,
    };

    #[test]
    fn drops_stdout_eof_from_a_superseded_agent() {
        assert!(should_emit_agent_event(3, 3));
        assert!(!should_emit_agent_event(3, 2));
        assert!(!should_emit_agent_event(4, 3));
    }

    #[test]
    fn builds_explicit_agent_arguments_without_a_shell() {
        let args = build_agent_args(&AgentStartOptions {
            cwd: "C:\\repo".into(),
            model: Some("grok-4.6".into()),
            reasoning_effort: Some("xhigh".into()),
            always_approve: Some(false),
            permission_mode: Some("auto".into()),
            leader: Some(false),
            debug: Some(true),
        })
        .unwrap();

        assert_eq!(
            args,
            vec![
                "--model",
                "grok-4.6",
                "--reasoning-effort",
                "xhigh",
                "--permission-mode",
                "auto",
                "agent",
                "stdio",
                "--debug"
            ]
        );
    }

    #[test]
    fn omits_model_flag_when_unset() {
        let args = build_agent_args(&AgentStartOptions {
            cwd: "C:\\repo".into(),
            model: None,
            reasoning_effort: None,
            always_approve: Some(false),
            permission_mode: None,
            leader: Some(false),
            debug: Some(false),
        })
        .unwrap();

        assert_eq!(args, vec!["agent", "stdio"]);
    }

    #[test]
    fn outbound_acp_messages_are_single_bounded_json_lines() {
        assert!(validate_outbound_message(r#"{"jsonrpc":"2.0","id":1}"#).is_ok());
        assert!(validate_outbound_message("{}\n{}").is_err());
        assert!(validate_outbound_message("not json").is_err());
    }
}
