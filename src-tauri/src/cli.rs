use crate::platform::{
    canonical_directory, configure_tokio_command, grok_executable, is_safe_preview_url,
    is_safe_xai_https_url,
};
use serde::{Deserialize, Serialize};
use std::{
    path::PathBuf,
    process::Stdio,
    sync::atomic::{AtomicU32, Ordering},
    time::SystemTime,
};
use tauri::{AppHandle, Emitter};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::Command,
    time::{timeout, Duration},
};

static LOGIN_PID: AtomicU32 = AtomicU32::new(0);

const MAX_CAPTURE_BYTES: usize = 2 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrokStatus {
    pub available: bool,
    pub version: Option<String>,
    pub path: Option<String>,
    pub error: Option<String>,
    pub home: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountProbe {
    pub authenticated: bool,
    pub email: Option<String>,
    pub subscription_tier: Option<String>,
    pub auth_mode: Option<String>,
    pub team_name: Option<String>,
    pub is_zero_data_retention: Option<bool>,
    pub coding_data_retention_opt_out: Option<bool>,
    pub grok_path: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceAuth {
    pub url: String,
    pub code: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliProbeRequest {
    kind: String,
    cwd: Option<String>,
    query: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliCommandOutput {
    kind: String,
    args: Vec<String>,
    success: bool,
    exit_code: Option<i32>,
    stdout: String,
    stderr: String,
    truncated: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LoginEvent {
    kind: &'static str,
    payload: String,
}

fn truncate_output(bytes: &[u8]) -> (String, bool) {
    let truncated = bytes.len() > MAX_CAPTURE_BYTES;
    let bounded = if truncated {
        &bytes[..MAX_CAPTURE_BYTES]
    } else {
        bytes
    };
    (String::from_utf8_lossy(bounded).to_string(), truncated)
}

fn probe_args(request: &CliProbeRequest) -> Result<Vec<String>, String> {
    let args = match request.kind.as_str() {
        "version" => vec!["version".into()],
        "models" => vec!["models".into()],
        "inspect" => vec!["inspect".into(), "--json".into()],
        "sessions" => vec![
            "sessions".into(),
            "list".into(),
            "--limit".into(),
            "100".into(),
        ],
        "sessionSearch" => {
            let query = request
                .query
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or("会话搜索需要关键词")?;
            vec![
                "sessions".into(),
                "search".into(),
                "--limit".into(),
                "100".into(),
                query.into(),
            ]
        }
        "mcp" => vec!["mcp".into(), "list".into(), "--json".into()],
        "plugins" => vec!["plugin".into(), "list".into(), "--json".into()],
        "worktrees" => vec![
            "worktree".into(),
            "list".into(),
            "--json".into(),
            "--all".into(),
        ],
        "leaders" => vec!["leader".into(), "list".into()],
        "update" => vec!["update".into(), "--check".into(), "--json".into()],
        "diskUsage" => vec!["du".into()],
        other => return Err(format!("不支持的 Grok 只读探针：{other}")),
    };
    Ok(args)
}

pub fn parse_device_auth(text: &str) -> Option<DeviceAuth> {
    let mut url = None;
    let mut code = None;
    for line in text.lines() {
        let trimmed = line.trim();
        if is_safe_xai_https_url(trimmed) {
            url = Some(trimmed.to_string());
            if let Some(value) = trimmed.split("user_code=").nth(1) {
                let extracted = value.split('&').next().unwrap_or(value).trim();
                if !extracted.is_empty() {
                    code = Some(extracted.to_string());
                }
            }
        }
        if looks_like_device_code(trimmed)
            && (url.is_some() || text.contains("Confirm this code") || text.contains("user_code"))
        {
            code = Some(trimmed.to_string());
        }
    }
    Some(DeviceAuth {
        url: url?,
        code: code?,
    })
}

fn looks_like_device_code(value: &str) -> bool {
    let chars = value.chars().count();
    (6..=20).contains(&chars)
        && value.contains('-')
        && value.chars().all(|character| {
            character.is_ascii_uppercase() || character.is_ascii_digit() || character == '-'
        })
}

async fn kill_login_process() {
    let pid = LOGIN_PID.swap(0, Ordering::SeqCst);
    if pid == 0 {
        return;
    }
    #[cfg(windows)]
    {
        let mut command = Command::new("taskkill");
        command.args(["/PID", &pid.to_string(), "/T", "/F"]);
        configure_tokio_command(&mut command);
        let _ = command.status().await;
    }
    #[cfg(not(windows))]
    {
        let _ = Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .status()
            .await;
    }
}

fn user_home() -> Option<String> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(|value| value.to_string_lossy().into_owned())
}

fn grok_status(
    available: bool,
    version: Option<String>,
    path: Option<String>,
    error: Option<String>,
) -> GrokStatus {
    GrokStatus {
        available,
        version,
        path,
        error,
        home: user_home(),
    }
}

#[tauri::command]
pub async fn check_grok() -> GrokStatus {
    let path = match grok_executable() {
        Ok(path) => path,
        Err(error) => {
            return grok_status(false, None, None, Some(error));
        }
    };
    let mut command = Command::new(&path);
    command.arg("version");
    configure_tokio_command(&mut command);
    match command.output().await {
        Ok(output) if output.status.success() => grok_status(
            true,
            Some(String::from_utf8_lossy(&output.stdout).trim().to_string()),
            Some(path.to_string_lossy().into_owned()),
            None,
        ),
        Ok(output) => grok_status(
            false,
            None,
            Some(path.to_string_lossy().into_owned()),
            Some(String::from_utf8_lossy(&output.stderr).trim().to_string()),
        ),
        Err(error) => grok_status(
            false,
            None,
            Some(path.to_string_lossy().into_owned()),
            Some(error.to_string()),
        ),
    }
}

#[tauri::command]
pub async fn export_diagnostics(path: String) -> Result<String, String> {
    let target = PathBuf::from(path.trim());
    if !target.is_absolute()
        || target.extension().and_then(|value| value.to_str()) != Some("json")
        || !target.parent().is_some_and(|parent| parent.is_dir())
    {
        return Err("Diagnostics must be saved to an existing absolute .json path".into());
    }
    let grok = check_grok().await;
    let generated_at = SystemTime::UNIX_EPOCH
        .elapsed()
        .map(|duration| duration.as_millis().min(u64::MAX as u128) as u64)
        .unwrap_or_default();
    let diagnostics = serde_json::json!({
        "schemaVersion": 1,
        "generatedAtUnixMs": generated_at,
        "application": {
            "name": "GY Grok",
            "version": env!("CARGO_PKG_VERSION"),
            "debugBuild": cfg!(debug_assertions),
        },
        "platform": {
            "os": std::env::consts::OS,
            "arch": std::env::consts::ARCH,
        },
        "grokBuild": {
            "available": grok.available,
            "version": grok.version,
            "error": grok.error,
        },
        "privacy": "This file intentionally excludes account identity, tokens, prompts, project paths, environment variables, and tool output."
    });
    let content = serde_json::to_string_pretty(&diagnostics)
        .map_err(|error| format!("Could not encode diagnostics: {error}"))?;
    std::fs::write(&target, content)
        .map_err(|error| format!("Could not write diagnostics: {error}"))?;
    Ok(target.to_string_lossy().into_owned())
}

fn validate_session_id(value: &str) -> Result<&str, String> {
    let value = value.trim();
    if value.is_empty()
        || value.len() > 128
        || !value.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '-' || character == '_'
        })
    {
        return Err("Session id contains unsupported characters".into());
    }
    Ok(value)
}

#[tauri::command]
pub async fn export_grok_session(
    session_id: String,
    path: String,
    cwd: String,
) -> Result<String, String> {
    let session_id = validate_session_id(&session_id)?;
    let cwd = canonical_directory(cwd)?;
    let target = PathBuf::from(path.trim());
    let extension = target
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !target.is_absolute()
        || !matches!(extension.as_str(), "md" | "markdown")
        || !target.parent().is_some_and(|parent| parent.is_dir())
    {
        return Err("Session export must use an existing absolute .md path".into());
    }

    let mut command = Command::new(grok_executable()?);
    command
        .args(["export", session_id])
        .arg(&target)
        .current_dir(cwd);
    configure_tokio_command(&mut command);
    let output = timeout(Duration::from_secs(60), command.output())
        .await
        .map_err(|_| "Grok session export timed out after 60 seconds".to_string())?
        .map_err(|error| format!("Could not start Grok session export: {error}"))?;
    if !output.status.success() {
        let (stderr, _) = truncate_output(&output.stderr);
        return Err(if stderr.trim().is_empty() {
            format!("Grok session export exited with {:?}", output.status.code())
        } else {
            stderr.trim().to_owned()
        });
    }
    Ok(target.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn run_cli_probe(request: CliProbeRequest) -> Result<CliCommandOutput, String> {
    let args = probe_args(&request)?;
    let cwd = match request
        .cwd
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(value) => Some(canonical_directory(value)?),
        None => None,
    };

    let mut command = Command::new(grok_executable()?);
    command.args(&args);
    if let Some(cwd) = cwd {
        command.current_dir(cwd);
    }
    configure_tokio_command(&mut command);
    let output = timeout(Duration::from_secs(45), command.output())
        .await
        .map_err(|_| "Grok probe timed out after 45 seconds".to_string())?
        .map_err(|error| format!("运行 Grok 命令失败：{error}"))?;
    let (stdout, stdout_truncated) = truncate_output(&output.stdout);
    let (stderr, stderr_truncated) = truncate_output(&output.stderr);
    Ok(CliCommandOutput {
        kind: request.kind,
        args,
        success: output.status.success(),
        exit_code: output.status.code(),
        stdout,
        stderr,
        truncated: stdout_truncated || stderr_truncated,
    })
}

#[tauri::command]
pub async fn logout_grok() -> Result<CliCommandOutput, String> {
    let args = vec!["logout".to_string()];
    let mut command = Command::new(grok_executable()?);
    command.args(&args);
    configure_tokio_command(&mut command);
    let output = timeout(Duration::from_secs(30), command.output())
        .await
        .map_err(|_| "Grok logout timed out after 30 seconds".to_string())?
        .map_err(|error| format!("Could not run Grok logout: {error}"))?;
    let (stdout, stdout_truncated) = truncate_output(&output.stdout);
    let (stderr, stderr_truncated) = truncate_output(&output.stderr);
    Ok(CliCommandOutput {
        kind: "logout".into(),
        args,
        success: output.status.success(),
        exit_code: output.status.code(),
        stdout,
        stderr,
        truncated: stdout_truncated || stderr_truncated,
    })
}

fn emit_login(app: &AppHandle, kind: &'static str, payload: impl Into<String>) {
    let _ = app.emit(
        "grok-login-event",
        LoginEvent {
            kind,
            payload: payload.into(),
        },
    );
}

fn watch_login_stream<R: tokio::io::AsyncRead + Unpin + Send + 'static>(
    app: AppHandle,
    kind: &'static str,
    stream: R,
    open_browser: bool,
) {
    tauri::async_runtime::spawn(async move {
        let mut lines = BufReader::new(stream).lines();
        let mut combined = String::new();
        let mut emitted_device = false;
        while let Ok(Some(line)) = lines.next_line().await {
            combined.push_str(&line);
            combined.push('\n');
            emit_login(&app, kind, line);
            if !emitted_device {
                if let Some(device) = parse_device_auth(&combined) {
                    emitted_device = true;
                    if let Ok(payload) = serde_json::to_string(&device) {
                        emit_login(&app, "device", payload);
                    }
                    if open_browser {
                        let _ = open_external_url(device.url).await;
                    }
                }
            }
        }
    });
}

#[tauri::command]
pub async fn start_grok_login(
    app: AppHandle,
    mode: Option<String>,
) -> Result<serde_json::Value, String> {
    // Never spawn interactive TUI `grok login`. Without a console, grok.exe
    // aborts (BEX64 / c0000409) and the desktop window looks like it crashed.
    let requested = mode.as_deref().unwrap_or("device");
    if !matches!(requested, "browser" | "oauth" | "device") {
        return Err(format!("不支持的登录模式：{requested}"));
    }
    let open_browser = requested != "device";
    let args = vec!["login".to_string(), "--device-auth".to_string()];

    kill_login_process().await;

    let mut command = Command::new(grok_executable()?);
    command
        .args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    configure_tokio_command(&mut command);
    let mut child = command
        .spawn()
        .map_err(|error| format!("无法启动 Grok 登录：{error}"))?;
    let pid = child.id().unwrap_or(0);
    LOGIN_PID.store(pid, Ordering::SeqCst);
    let stdout = child.stdout.take().ok_or("无法读取 Grok 登录输出")?;
    let stderr = child.stderr.take().ok_or("无法读取 Grok 登录错误输出")?;

    watch_login_stream(app.clone(), "stdout", stdout, open_browser);
    watch_login_stream(app.clone(), "stderr", stderr, open_browser);

    let exit_app = app.clone();
    tauri::async_runtime::spawn(async move {
        let result = child.wait().await;
        LOGIN_PID.store(0, Ordering::SeqCst);
        // 非零退出时也要给出可读原因。只塞 exitCode 的话，界面拿不到 error
        // 字段就只能显示自己那句「请检查上方输出」，而那句话指向的输出并不存在。
        let payload = match result {
            Ok(status) if status.success() => serde_json::json!({
              "success": true,
              "exitCode": status.code()
            })
            .to_string(),
            Ok(status) => serde_json::json!({
              "success": false,
              "exitCode": status.code(),
              "error": match status.code() {
                  Some(code) => format!("grok login 退出，代码 {code}"),
                  None => "grok login 被信号终止".to_string(),
              }
            })
            .to_string(),
            Err(error) => serde_json::json!({
              "success": false,
              "error": format!("等待 grok login 失败：{error}")
            })
            .to_string(),
        };
        emit_login(&exit_app, "exit", payload);
    });

    Ok(serde_json::json!({
        "pid": pid,
        "args": args,
        "headless": true,
        "opensBrowser": open_browser
    }))
}

#[tauri::command]
pub async fn cancel_grok_login() -> Result<(), String> {
    kill_login_process().await;
    Ok(())
}

#[tauri::command]
pub async fn open_preview_url(url: String) -> Result<(), String> {
    if !is_safe_preview_url(&url) {
        return Err("预览只允许打开本机 localhost / 127.0.0.1 地址".into());
    }
    open_in_browser(url.trim())
}

#[tauri::command]
pub async fn open_external_url(url: String) -> Result<(), String> {
    if is_safe_xai_https_url(&url) {
        return open_in_browser(url.trim());
    }
    if is_safe_preview_url(&url) {
        return open_in_browser(url.trim());
    }
    Err("只允许打开 xAI 官方登录地址或本机预览地址".into())
}

fn open_in_browser(url: &str) -> Result<(), String> {
    #[cfg(windows)]
    {
        let mut command = Command::new("cmd");
        command.args(["/C", "start", "", url.trim()]);
        configure_tokio_command(&mut command);
        command
            .spawn()
            .map_err(|error| format!("无法打开浏览器：{error}"))?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let mut command = Command::new("xdg-open");
        command.arg(url.trim());
        command
            .spawn()
            .map_err(|error| format!("无法打开浏览器：{error}"))?;
        Ok(())
    }
}

#[tauri::command]
pub async fn probe_account() -> Result<AccountProbe, String> {
    let path = grok_executable()?;
    let grok_path = path.to_string_lossy().into_owned();
    let mut command = Command::new(&path);
    command
        .args(["agent", "stdio"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    configure_tokio_command(&mut command);
    let mut child = command
        .spawn()
        .map_err(|error| format!("无法启动 Grok ACP 探测：{error}"))?;
    let mut stdin = child.stdin.take().ok_or("无法连接 Grok 标准输入")?;
    let mut stdout = BufReader::new(child.stdout.take().ok_or("无法连接 Grok 标准输出")?).lines();

    let result = timeout(Duration::from_secs(45), async {
        rpc_exchange(
            &mut stdin,
            &mut stdout,
            1,
            "initialize",
            serde_json::json!({
                "protocolVersion": 1,
                "clientCapabilities": {}
            }),
        )
        .await
    })
    .await;
    let initialize = match result {
        Ok(Ok(value)) => value,
        Ok(Err(error)) => {
            let _ = child.kill().await;
            return Ok(unauthenticated_probe(grok_path, error));
        }
        Err(_) => {
            let _ = child.kill().await;
            return Ok(unauthenticated_probe(
                grok_path,
                "探测 Grok 账户超时".into(),
            ));
        }
    };

    let auth_methods = initialize
        .get("authMethods")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();
    let has_cached = auth_methods
        .iter()
        .any(|method| method.get("id").and_then(|value| value.as_str()) == Some("cached_token"));
    if !has_cached {
        let _ = child.kill().await;
        return Ok(unauthenticated_probe(
            grok_path,
            "本机还没有可用的 Grok 登录，请先完成官方授权".into(),
        ));
    }

    let auth = timeout(Duration::from_secs(45), async {
        rpc_exchange(
            &mut stdin,
            &mut stdout,
            2,
            "authenticate",
            serde_json::json!({
                "methodId": "cached_token",
                "_meta": { "headless": true }
            }),
        )
        .await
    })
    .await;
    let _ = child.kill().await;
    let auth = match auth {
        Ok(Ok(value)) => value,
        Ok(Err(error)) => return Ok(unauthenticated_probe(grok_path, error)),
        Err(_) => return Ok(unauthenticated_probe(grok_path, "认证探测超时".into())),
    };

    let meta = auth
        .get("_meta")
        .cloned()
        .unwrap_or(serde_json::Value::Null);
    Ok(AccountProbe {
        authenticated: true,
        email: meta
            .get("email")
            .and_then(|value| value.as_str())
            .map(str::to_owned),
        subscription_tier: meta
            .get("subscription_tier")
            .and_then(|value| value.as_str())
            .map(str::to_owned),
        auth_mode: meta
            .get("auth_mode")
            .and_then(|value| value.as_str())
            .map(str::to_owned),
        team_name: meta
            .get("team_name")
            .and_then(|value| value.as_str())
            .map(str::to_owned),
        is_zero_data_retention: meta.get("is_zdr").and_then(|value| value.as_bool()),
        coding_data_retention_opt_out: meta
            .get("coding_data_retention_opt_out")
            .and_then(|value| value.as_bool()),
        grok_path,
        error: None,
    })
}

/// Start `grok agent stdio`, authenticate with the cached CLI login, then call
/// one ACP method. This is the same path the TUI uses for `/usage`.
pub async fn authenticated_acp_call(
    method: &str,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let path = grok_executable()?;
    let mut command = Command::new(&path);
    command
        .args(["agent", "stdio"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    configure_tokio_command(&mut command);
    let mut child = command
        .spawn()
        .map_err(|error| format!("无法启动 Grok CLI：{error}"))?;
    let mut stdin = child.stdin.take().ok_or("无法连接 Grok 标准输入")?;
    let mut stdout = BufReader::new(child.stdout.take().ok_or("无法连接 Grok 标准输出")?).lines();

    let result = timeout(Duration::from_secs(45), async {
        rpc_exchange(
            &mut stdin,
            &mut stdout,
            1,
            "initialize",
            serde_json::json!({
                "protocolVersion": 1,
                "clientCapabilities": {}
            }),
        )
        .await?;
        rpc_exchange(
            &mut stdin,
            &mut stdout,
            2,
            "authenticate",
            serde_json::json!({
                "methodId": "cached_token",
                "_meta": { "headless": true }
            }),
        )
        .await?;
        rpc_exchange(&mut stdin, &mut stdout, 3, method, params).await
    })
    .await;
    let _ = child.kill().await;
    match result {
        Ok(Ok(value)) => Ok(value),
        Ok(Err(error)) => Err(error),
        Err(_) => Err("从 Grok CLI 读取额度超时".into()),
    }
}

fn unauthenticated_probe(grok_path: String, error: String) -> AccountProbe {
    AccountProbe {
        authenticated: false,
        email: None,
        subscription_tier: None,
        auth_mode: None,
        team_name: None,
        is_zero_data_retention: None,
        coding_data_retention_opt_out: None,
        grok_path,
        error: Some(error),
    }
}

async fn rpc_exchange(
    stdin: &mut tokio::process::ChildStdin,
    stdout: &mut tokio::io::Lines<BufReader<tokio::process::ChildStdout>>,
    id: u64,
    method: &str,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let payload = serde_json::json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": method,
        "params": params
    });
    stdin
        .write_all(format!("{payload}\n").as_bytes())
        .await
        .map_err(|error| format!("发送 {method} 失败：{error}"))?;
    stdin
        .flush()
        .await
        .map_err(|error| format!("刷新 {method} 失败：{error}"))?;

    loop {
        let line = stdout
            .next_line()
            .await
            .map_err(|error| format!("读取 {method} 失败：{error}"))?
            .ok_or_else(|| format!("Grok 在 {method} 期间关闭了连接"))?;
        let value: serde_json::Value = match serde_json::from_str(&line) {
            Ok(value) => value,
            Err(_) => continue,
        };
        let response_id = value.get("id").and_then(|entry| {
            entry
                .as_u64()
                .or_else(|| entry.as_i64().map(|number| number as u64))
        });
        if response_id != Some(id) {
            continue;
        }
        if let Some(error) = value.get("error") {
            return Err(error
                .get("message")
                .and_then(|message| message.as_str())
                .unwrap_or("ACP 探测失败")
                .to_string());
        }
        return Ok(value
            .get("result")
            .cloned()
            .unwrap_or(serde_json::Value::Null));
    }
}

#[cfg(test)]
mod tests {
    use super::{
        parse_device_auth, probe_args, truncate_output, validate_session_id, CliProbeRequest,
        MAX_CAPTURE_BYTES,
    };

    #[test]
    fn rejects_unknown_probe() {
        let request = CliProbeRequest {
            kind: "arbitrary".into(),
            cwd: None,
            query: None,
        };
        assert!(probe_args(&request).is_err());
    }

    #[test]
    fn limits_captured_output() {
        let bytes = vec![b'x'; MAX_CAPTURE_BYTES + 1];
        let (output, truncated) = truncate_output(&bytes);
        assert!(truncated);
        assert_eq!(output.len(), MAX_CAPTURE_BYTES);
    }

    #[test]
    fn validates_session_ids_before_spawning_the_cli() {
        assert_eq!(
            validate_session_id("019ffa3c-1234").unwrap(),
            "019ffa3c-1234"
        );
        assert!(validate_session_id("../../escape").is_err());
        assert!(validate_session_id("session\n--debug").is_err());
    }

    #[test]
    fn parses_device_code_from_headless_login_output() {
        let output = r#"
To sign in, open this URL in your browser:

  https://accounts.x.ai/oauth2/device?user_code=BRYY-GR5B

Confirm this code in your browser:

  BRYY-GR5B
"#;
        let device = parse_device_auth(output).expect("device auth");
        assert_eq!(
            device.url,
            "https://accounts.x.ai/oauth2/device?user_code=BRYY-GR5B"
        );
        assert_eq!(device.code, "BRYY-GR5B");
        assert!(parse_device_auth("not a login").is_none());
    }
}
