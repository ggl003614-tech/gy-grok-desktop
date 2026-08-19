use crate::platform::{canonical_directory, configure_pty_command, grok_executable};
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    io::{Read, Write},
    sync::{Arc, Mutex},
    thread,
};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

const MAX_ARGUMENTS: usize = 128;
const MAX_ARGUMENT_LENGTH: usize = 4_096;
const MAX_TERMINALS: usize = 12;

type SharedChild = Arc<Mutex<Box<dyn Child + Send + Sync>>>;

struct TerminalSession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: SharedChild,
    cwd: String,
}

#[derive(Default)]
pub struct TerminalState {
    sessions: Mutex<HashMap<String, TerminalSession>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalStartOptions {
    pub cwd: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default = "default_rows")]
    pub rows: u16,
    #[serde(default = "default_columns")]
    pub columns: u16,
    #[serde(default)]
    pub appearance: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalInfo {
    pub terminal_id: String,
    pub process_id: Option<u32>,
    pub cwd: String,
    pub running: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalOutputEvent {
    terminal_id: String,
    data: Vec<u8>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalExitEvent {
    terminal_id: String,
    exit_code: Option<u32>,
    signal: Option<String>,
    error: Option<String>,
}

fn default_rows() -> u16 {
    30
}

fn default_columns() -> u16 {
    120
}

fn normalize_appearance(value: Option<&str>) -> &'static str {
    match value
        .map(|item| item.trim().to_ascii_lowercase())
        .as_deref()
    {
        Some("dark") => "dark",
        _ => "light",
    }
}

fn apply_cli_appearance(command: &mut CommandBuilder, appearance: &str) {
    let theme = if appearance == "dark" {
        "groknight"
    } else {
        "grokday"
    };
    let color_fg_bg = if appearance == "dark" { "15;0" } else { "0;15" };
    command.env("GROK_APPEARANCE", appearance);
    command.env("LC_GROK_APPEARANCE", appearance);
    command.env("GROK_THEME", theme);
    command.env("LC_GROK_THEME", theme);
    command.env("COLORFGBG", color_fg_bg);
    command.env("COLORTERM", "truecolor");
    command.env("TERM", "xterm-256color");
}

fn validate_options(options: &TerminalStartOptions) -> Result<(), String> {
    if options.rows == 0 || options.columns == 0 {
        return Err("Terminal rows and columns must be greater than zero".into());
    }
    if options.args.len() > MAX_ARGUMENTS {
        return Err(format!("At most {MAX_ARGUMENTS} CLI arguments are allowed"));
    }
    if options
        .args
        .iter()
        .any(|argument| argument.len() > MAX_ARGUMENT_LENGTH || argument.contains('\0'))
    {
        return Err(format!(
            "CLI arguments cannot contain a null byte or exceed {MAX_ARGUMENT_LENGTH} bytes"
        ));
    }
    Ok(())
}

fn emit_terminal_output(app: &AppHandle, terminal_id: &str, data: Vec<u8>) {
    let _ = app.emit(
        "grok-terminal-output",
        TerminalOutputEvent {
            terminal_id: terminal_id.to_owned(),
            data,
        },
    );
}

fn emit_terminal_exit(
    app: &AppHandle,
    terminal_id: &str,
    exit_code: Option<u32>,
    signal: Option<String>,
    error: Option<String>,
) {
    let _ = app.emit(
        "grok-terminal-exit",
        TerminalExitEvent {
            terminal_id: terminal_id.to_owned(),
            exit_code,
            signal,
            error,
        },
    );
}

fn read_terminal_output(
    app: AppHandle,
    terminal_id: String,
    mut reader: Box<dyn Read + Send>,
    child: SharedChild,
) {
    thread::spawn(move || {
        let mut buffer = vec![0_u8; 16 * 1024];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(count) => emit_terminal_output(&app, &terminal_id, buffer[..count].to_vec()),
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(error) => {
                    emit_terminal_exit(&app, &terminal_id, None, None, Some(error.to_string()));
                    return;
                }
            }
        }

        match child.lock() {
            Ok(mut child) => match child.wait() {
                Ok(status) => emit_terminal_exit(
                    &app,
                    &terminal_id,
                    Some(status.exit_code()),
                    status.signal().map(str::to_owned),
                    None,
                ),
                Err(error) => {
                    emit_terminal_exit(&app, &terminal_id, None, None, Some(error.to_string()))
                }
            },
            Err(_) => emit_terminal_exit(
                &app,
                &terminal_id,
                None,
                None,
                Some("Terminal child state is poisoned".into()),
            ),
        }
    });
}

#[tauri::command]
pub fn start_grok_terminal(
    app: AppHandle,
    state: State<'_, TerminalState>,
    options: TerminalStartOptions,
) -> Result<TerminalInfo, String> {
    validate_options(&options)?;
    let canonical_cwd = canonical_directory(&options.cwd)?;

    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "Terminal state is poisoned".to_string())?;
    if sessions.len() >= MAX_TERMINALS {
        return Err(format!(
            "At most {MAX_TERMINALS} terminals can be open at once"
        ));
    }

    let pair = native_pty_system()
        .openpty(PtySize {
            rows: options.rows,
            cols: options.columns,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| format!("Could not create terminal: {error}"))?;

    let mut command = CommandBuilder::new(grok_executable()?);
    command.args(&options.args);
    command.cwd(&canonical_cwd);
    configure_pty_command(&mut command);
    apply_cli_appearance(
        &mut command,
        normalize_appearance(options.appearance.as_deref()),
    );

    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| format!("Could not start Grok CLI: {error}"))?;
    let process_id = child.process_id();
    let child = Arc::new(Mutex::new(child));
    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| format!("Could not read terminal output: {error}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| format!("Could not open terminal input: {error}"))?;

    let terminal_id = Uuid::new_v4().to_string();
    let cwd = canonical_cwd.to_string_lossy().into_owned();
    read_terminal_output(app, terminal_id.clone(), reader, Arc::clone(&child));
    sessions.insert(
        terminal_id.clone(),
        TerminalSession {
            master: pair.master,
            writer,
            child,
            cwd: cwd.clone(),
        },
    );

    Ok(TerminalInfo {
        terminal_id,
        process_id,
        cwd,
        running: true,
    })
}

#[tauri::command]
pub fn write_grok_terminal(
    state: State<'_, TerminalState>,
    terminal_id: String,
    data: String,
) -> Result<(), String> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "Terminal state is poisoned".to_string())?;
    let session = sessions
        .get_mut(&terminal_id)
        .ok_or_else(|| "Terminal does not exist or is closed".to_string())?;
    session
        .writer
        .write_all(data.as_bytes())
        .and_then(|_| session.writer.flush())
        .map_err(|error| format!("Could not write to terminal: {error}"))
}

#[tauri::command]
pub fn resize_grok_terminal(
    state: State<'_, TerminalState>,
    terminal_id: String,
    rows: u16,
    columns: u16,
) -> Result<(), String> {
    if rows == 0 || columns == 0 {
        return Err("Terminal rows and columns must be greater than zero".into());
    }
    let sessions = state
        .sessions
        .lock()
        .map_err(|_| "Terminal state is poisoned".to_string())?;
    let session = sessions
        .get(&terminal_id)
        .ok_or_else(|| "Terminal does not exist or is closed".to_string())?;
    session
        .master
        .resize(PtySize {
            rows,
            cols: columns,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| format!("Could not resize terminal: {error}"))
}

#[tauri::command]
pub fn list_grok_terminals(state: State<'_, TerminalState>) -> Result<Vec<TerminalInfo>, String> {
    let sessions = state
        .sessions
        .lock()
        .map_err(|_| "Terminal state is poisoned".to_string())?;
    sessions
        .iter()
        .map(|(terminal_id, session)| {
            let mut child = session
                .child
                .lock()
                .map_err(|_| "Terminal child state is poisoned".to_string())?;
            let running = child
                .try_wait()
                .map_err(|error| format!("Could not read terminal state: {error}"))?
                .is_none();
            Ok(TerminalInfo {
                terminal_id: terminal_id.clone(),
                process_id: child.process_id(),
                cwd: session.cwd.clone(),
                running,
            })
        })
        .collect()
}

#[tauri::command]
pub fn stop_grok_terminal(
    state: State<'_, TerminalState>,
    terminal_id: String,
) -> Result<(), String> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| "Terminal state is poisoned".to_string())?;
    let Some(session) = sessions.remove(&terminal_id) else {
        return Ok(());
    };
    let mut child = session
        .child
        .lock()
        .map_err(|_| "Terminal child state is poisoned".to_string())?;
    if child
        .try_wait()
        .map_err(|error| format!("Could not read terminal state: {error}"))?
        .is_none()
    {
        child
            .kill()
            .map_err(|error| format!("Could not stop terminal: {error}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        normalize_appearance, validate_options, TerminalStartOptions, MAX_ARGUMENTS,
        MAX_ARGUMENT_LENGTH,
    };

    #[test]
    fn validates_terminal_arguments() {
        let too_many = TerminalStartOptions {
            cwd: ".".into(),
            args: vec!["x".into(); MAX_ARGUMENTS + 1],
            rows: 30,
            columns: 120,
            appearance: None,
        };
        assert!(validate_options(&too_many).is_err());

        let too_long = TerminalStartOptions {
            cwd: ".".into(),
            args: vec!["x".repeat(MAX_ARGUMENT_LENGTH + 1)],
            rows: 30,
            columns: 120,
            appearance: None,
        };
        assert!(validate_options(&too_long).is_err());

        let valid = TerminalStartOptions {
            cwd: ".".into(),
            args: vec!["sessions".into(), "list".into()],
            rows: 30,
            columns: 120,
            appearance: Some("light".into()),
        };
        assert!(validate_options(&valid).is_ok());
    }

    #[test]
    fn defaults_cli_appearance_to_light() {
        assert_eq!(normalize_appearance(None), "light");
        assert_eq!(normalize_appearance(Some("LIGHT")), "light");
        assert_eq!(normalize_appearance(Some("dark")), "dark");
        assert_eq!(normalize_appearance(Some(" nope ")), "light");
    }
}
