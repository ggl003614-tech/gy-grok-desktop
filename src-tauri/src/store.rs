use crate::platform::canonical_directory;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::BTreeMap, path::Path, sync::Mutex, time::SystemTime};
use tauri::State;
use uuid::Uuid;

const SETTING_KEYS: &[&str] = &[
    "appearance.theme",
    "appearance.language",
    "appearance.fontScale",
    "editor.fontSize",
    "editor.wordWrap",
    "terminal.fontSize",
    "terminal.shell",
    "agent.model",
    "agent.reasoningEffort",
    "agent.permissionMode",
    "agent.alwaysApprove",
    "agent.leader",
    "agent.maxTurns",
    "privacy.saveHistory",
    "privacy.telemetry",
    "updates.channel",
    "desktop.control",
    "desktop.captureDetail",
    "life.mode",
    "life.integrity",
];

pub struct StoreState {
    connection: Mutex<Connection>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRecord {
    pub id: String,
    pub path: String,
    pub name: String,
    pub last_opened_at: i64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSessionRecord {
    pub id: String,
    pub remote_session_id: Option<String>,
    pub workspace_id: String,
    pub title: String,
    pub model_id: Option<String>,
    pub reasoning_effort: Option<String>,
    pub status: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertSessionInput {
    pub id: Option<String>,
    pub remote_session_id: Option<String>,
    pub workspace_id: String,
    pub title: String,
    pub model_id: Option<String>,
    pub reasoning_effort: Option<String>,
    pub status: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalMessageRecord {
    pub id: i64,
    pub session_id: String,
    pub role: String,
    pub kind: String,
    pub content: Value,
    pub created_at: i64,
    pub sequence: i64,
}

impl StoreState {
    pub fn open(path: &Path) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("Could not create app data directory: {error}"))?;
        }
        let connection = Connection::open(path)
            .map_err(|error| format!("Could not open app database: {error}"))?;
        Self::from_connection(connection)
    }

    fn from_connection(connection: Connection) -> Result<Self, String> {
        connection
            .execute_batch(
                "PRAGMA foreign_keys = ON;
                 PRAGMA journal_mode = WAL;
                 CREATE TABLE IF NOT EXISTS settings (
                   key TEXT PRIMARY KEY,
                   value_json TEXT NOT NULL,
                   updated_at INTEGER NOT NULL
                 );
                 CREATE TABLE IF NOT EXISTS workspaces (
                   id TEXT PRIMARY KEY,
                   path TEXT NOT NULL UNIQUE,
                   name TEXT NOT NULL,
                   last_opened_at INTEGER NOT NULL
                 );
                 CREATE TABLE IF NOT EXISTS local_sessions (
                   id TEXT PRIMARY KEY,
                   remote_session_id TEXT,
                   workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                   title TEXT NOT NULL,
                   model_id TEXT,
                   reasoning_effort TEXT,
                   status TEXT NOT NULL,
                   created_at INTEGER NOT NULL,
                   updated_at INTEGER NOT NULL
                 );
                 CREATE INDEX IF NOT EXISTS local_sessions_workspace_updated
                   ON local_sessions(workspace_id, updated_at DESC);
                 CREATE TABLE IF NOT EXISTS local_messages (
                   id INTEGER PRIMARY KEY AUTOINCREMENT,
                   session_id TEXT NOT NULL REFERENCES local_sessions(id) ON DELETE CASCADE,
                   role TEXT NOT NULL,
                   kind TEXT NOT NULL,
                   content_json TEXT NOT NULL,
                   created_at INTEGER NOT NULL,
                   sequence INTEGER NOT NULL,
                   UNIQUE(session_id, sequence)
                 );
                 PRAGMA user_version = 1;",
            )
            .map_err(|error| format!("Could not migrate app database: {error}"))?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }
}

fn now_millis() -> i64 {
    SystemTime::UNIX_EPOCH
        .elapsed()
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or_default()
}

fn validate_setting(key: &str, value: &Value) -> Result<(), String> {
    if !SETTING_KEYS.contains(&key) {
        return Err(format!("Unknown setting: {key}"));
    }
    let serialized = serde_json::to_string(value)
        .map_err(|error| format!("Could not encode setting value: {error}"))?;
    if serialized.len() > 32 * 1024 {
        return Err("Setting value is too large".into());
    }
    Ok(())
}

#[tauri::command]
pub fn get_settings(state: State<'_, StoreState>) -> Result<BTreeMap<String, Value>, String> {
    let connection = state
        .connection
        .lock()
        .map_err(|_| "Database state is poisoned".to_string())?;
    let mut statement = connection
        .prepare("SELECT key, value_json FROM settings ORDER BY key")
        .map_err(|error| format!("Could not read settings: {error}"))?;
    let rows = statement
        .query_map([], |row| {
            let key: String = row.get(0)?;
            let value_json: String = row.get(1)?;
            Ok((key, value_json))
        })
        .map_err(|error| format!("Could not read settings: {error}"))?;

    let mut settings = BTreeMap::new();
    for row in rows {
        let (key, value_json) = row.map_err(|error| format!("Could not read setting: {error}"))?;
        let value = serde_json::from_str(&value_json)
            .map_err(|error| format!("Setting {key} is invalid: {error}"))?;
        settings.insert(key, value);
    }
    Ok(settings)
}

#[tauri::command]
pub fn set_setting(state: State<'_, StoreState>, key: String, value: Value) -> Result<(), String> {
    validate_setting(&key, &value)?;
    let value_json = serde_json::to_string(&value)
        .map_err(|error| format!("Could not encode setting value: {error}"))?;
    let connection = state
        .connection
        .lock()
        .map_err(|_| "Database state is poisoned".to_string())?;
    connection
        .execute(
            "INSERT INTO settings(key, value_json, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json,
               updated_at = excluded.updated_at",
            params![key, value_json, now_millis()],
        )
        .map_err(|error| format!("Could not save setting: {error}"))?;
    Ok(())
}

#[tauri::command]
pub fn upsert_workspace(
    state: State<'_, StoreState>,
    path: String,
    name: Option<String>,
) -> Result<WorkspaceRecord, String> {
    let canonical = canonical_directory(path)?;
    let path = canonical.to_string_lossy().into_owned();
    let inferred_name = canonical
        .file_name()
        .and_then(|part| part.to_str())
        .unwrap_or(&path)
        .to_owned();
    let name = name
        .map(|name| name.trim().to_owned())
        .filter(|name| !name.is_empty())
        .unwrap_or(inferred_name);
    let now = now_millis();
    let connection = state
        .connection
        .lock()
        .map_err(|_| "Database state is poisoned".to_string())?;
    let existing_id: Option<String> = connection
        .query_row(
            "SELECT id FROM workspaces WHERE path = ?1",
            params![path],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| format!("Could not find workspace: {error}"))?;
    let id = existing_id.unwrap_or_else(|| Uuid::new_v4().to_string());
    connection
        .execute(
            "INSERT INTO workspaces(id, path, name, last_opened_at) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(path) DO UPDATE SET name = excluded.name,
               last_opened_at = excluded.last_opened_at",
            params![id, path, name, now],
        )
        .map_err(|error| format!("Could not save workspace: {error}"))?;
    Ok(WorkspaceRecord {
        id,
        path,
        name,
        last_opened_at: now,
    })
}

#[tauri::command]
pub fn list_workspaces(state: State<'_, StoreState>) -> Result<Vec<WorkspaceRecord>, String> {
    let connection = state
        .connection
        .lock()
        .map_err(|_| "Database state is poisoned".to_string())?;
    let mut statement = connection
        .prepare(
            "SELECT id, path, name, last_opened_at FROM workspaces
             ORDER BY last_opened_at DESC",
        )
        .map_err(|error| format!("Could not list workspaces: {error}"))?;
    let rows = statement
        .query_map([], |row| {
            Ok(WorkspaceRecord {
                id: row.get(0)?,
                path: row.get(1)?,
                name: row.get(2)?,
                last_opened_at: row.get(3)?,
            })
        })
        .map_err(|error| format!("Could not list workspaces: {error}"))?;
    rows.map(|row| row.map_err(|error| format!("Could not read workspace: {error}")))
        .collect()
}

#[tauri::command]
pub fn remove_workspace(state: State<'_, StoreState>, id: String) -> Result<(), String> {
    let connection = state
        .connection
        .lock()
        .map_err(|_| "Database state is poisoned".to_string())?;
    connection
        .execute("DELETE FROM workspaces WHERE id = ?1", params![id])
        .map_err(|error| format!("Could not remove workspace metadata: {error}"))?;
    Ok(())
}

#[tauri::command]
pub fn upsert_local_session(
    state: State<'_, StoreState>,
    input: UpsertSessionInput,
) -> Result<LocalSessionRecord, String> {
    let now = now_millis();
    let connection = state
        .connection
        .lock()
        .map_err(|_| "Database state is poisoned".to_string())?;
    let id = match input.id.clone() {
        Some(id) => id,
        None => match input.remote_session_id.as_deref() {
            Some(remote_session_id) => connection
                .query_row(
                    "SELECT id FROM local_sessions
                     WHERE workspace_id = ?1 AND remote_session_id = ?2
                     ORDER BY updated_at DESC LIMIT 1",
                    params![input.workspace_id, remote_session_id],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|error| format!("Could not find local session: {error}"))?
                .unwrap_or_else(|| Uuid::new_v4().to_string()),
            None => Uuid::new_v4().to_string(),
        },
    };
    let created_at: i64 = connection
        .query_row(
            "SELECT created_at FROM local_sessions WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| format!("Could not find local session: {error}"))?
        .unwrap_or(now);
    let existing_title: Option<String> = connection
        .query_row(
            "SELECT title FROM local_sessions WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| format!("Could not read local session title: {error}"))?;
    let title = resolve_session_title(input.title.trim(), existing_title.as_deref());
    let status = input.status.as_deref().unwrap_or("idle");
    connection
        .execute(
            "INSERT INTO local_sessions(
               id, remote_session_id, workspace_id, title, model_id,
               reasoning_effort, status, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(id) DO UPDATE SET
               remote_session_id = excluded.remote_session_id,
               workspace_id = excluded.workspace_id,
               title = excluded.title,
               model_id = excluded.model_id,
               reasoning_effort = excluded.reasoning_effort,
               status = excluded.status,
               updated_at = excluded.updated_at",
            params![
                id,
                input.remote_session_id,
                input.workspace_id,
                title,
                input.model_id,
                input.reasoning_effort,
                status,
                created_at,
                now
            ],
        )
        .map_err(|error| format!("Could not save local session: {error}"))?;
    Ok(LocalSessionRecord {
        id,
        remote_session_id: input.remote_session_id,
        workspace_id: input.workspace_id,
        title: title.to_owned(),
        model_id: input.model_id,
        reasoning_effort: input.reasoning_effort,
        status: status.to_owned(),
        created_at,
        updated_at: now,
    })
}

#[tauri::command]
pub fn list_local_sessions(
    state: State<'_, StoreState>,
    workspace_id: String,
) -> Result<Vec<LocalSessionRecord>, String> {
    let connection = state
        .connection
        .lock()
        .map_err(|_| "Database state is poisoned".to_string())?;
    let mut statement = connection
        .prepare(
            "SELECT id, remote_session_id, workspace_id, title, model_id,
               reasoning_effort, status, created_at, updated_at
             FROM local_sessions WHERE workspace_id = ?1 ORDER BY updated_at DESC",
        )
        .map_err(|error| format!("Could not list local sessions: {error}"))?;
    let rows = statement
        .query_map(params![workspace_id], |row| {
            Ok(LocalSessionRecord {
                id: row.get(0)?,
                remote_session_id: row.get(1)?,
                workspace_id: row.get(2)?,
                title: row.get(3)?,
                model_id: row.get(4)?,
                reasoning_effort: row.get(5)?,
                status: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        })
        .map_err(|error| format!("Could not list local sessions: {error}"))?;
    rows.map(|row| row.map_err(|error| format!("Could not read local session: {error}")))
        .collect()
}

#[tauri::command]
pub fn delete_local_session(state: State<'_, StoreState>, id: String) -> Result<(), String> {
    let connection = state
        .connection
        .lock()
        .map_err(|_| "Database state is poisoned".to_string())?;
    connection
        .execute("DELETE FROM local_sessions WHERE id = ?1", params![id])
        .map_err(|error| format!("Could not delete local session: {error}"))?;
    Ok(())
}

#[tauri::command]
pub fn append_local_message(
    state: State<'_, StoreState>,
    session_id: String,
    role: String,
    kind: String,
    content: Value,
) -> Result<LocalMessageRecord, String> {
    let content_json = serde_json::to_string(&content)
        .map_err(|error| format!("Could not encode message: {error}"))?;
    if content_json.len() > 2 * 1024 * 1024 {
        return Err("Message is too large".into());
    }
    let now = now_millis();
    let connection = state
        .connection
        .lock()
        .map_err(|_| "Database state is poisoned".to_string())?;
    let sequence: i64 = connection
        .query_row(
            "SELECT COALESCE(MAX(sequence), -1) + 1 FROM local_messages WHERE session_id = ?1",
            params![session_id],
            |row| row.get(0),
        )
        .map_err(|error| format!("Could not allocate message sequence: {error}"))?;
    connection
        .execute(
            "INSERT INTO local_messages(session_id, role, kind, content_json, created_at, sequence)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![session_id, role, kind, content_json, now, sequence],
        )
        .map_err(|error| format!("Could not save local message: {error}"))?;
    let id = connection.last_insert_rowid();
    Ok(LocalMessageRecord {
        id,
        session_id,
        role,
        kind,
        content,
        created_at: now,
        sequence,
    })
}

#[tauri::command]
pub fn load_local_messages(
    state: State<'_, StoreState>,
    session_id: String,
) -> Result<Vec<LocalMessageRecord>, String> {
    let connection = state
        .connection
        .lock()
        .map_err(|_| "Database state is poisoned".to_string())?;
    let mut statement = connection
        .prepare(
            "SELECT id, session_id, role, kind, content_json, created_at, sequence
             FROM local_messages WHERE session_id = ?1 ORDER BY sequence",
        )
        .map_err(|error| format!("Could not load local messages: {error}"))?;
    let rows = statement
        .query_map(params![session_id], |row| {
            let content_json: String = row.get(4)?;
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                content_json,
                row.get::<_, i64>(5)?,
                row.get::<_, i64>(6)?,
            ))
        })
        .map_err(|error| format!("Could not load local messages: {error}"))?;
    let mut messages = Vec::new();
    for row in rows {
        let (id, session_id, role, kind, content_json, created_at, sequence) =
            row.map_err(|error| format!("Could not read local message: {error}"))?;
        let content = serde_json::from_str(&content_json)
            .map_err(|error| format!("Local message {id} is invalid: {error}"))?;
        messages.push(LocalMessageRecord {
            id,
            session_id,
            role,
            kind,
            content,
            created_at,
            sequence,
        });
    }
    Ok(messages)
}

fn is_placeholder_title(title: &str) -> bool {
    matches!(title, "" | "New task" | "Recovered task")
}

fn resolve_session_title(requested: &str, existing: Option<&str>) -> String {
    if !is_placeholder_title(requested) {
        return requested.to_string();
    }
    existing
        .filter(|title| !is_placeholder_title(title))
        .unwrap_or("New task")
        .to_string()
}

pub fn save_transcript(
    state: &StoreState,
    session_id: &str,
    items: &Value,
) -> Result<(), String> {
    let encoded = serde_json::to_string(items)
        .map_err(|error| format!("Could not encode transcript: {error}"))?;
    if encoded.len() > 2 * 1024 * 1024 {
        return Err("Transcript is too large".into());
    }
    let now = now_millis();
    let mut connection = state
        .connection
        .lock()
        .map_err(|_| "Database state is poisoned".to_string())?;
    let tx = connection
        .transaction()
        .map_err(|error| format!("Could not start transcript save: {error}"))?;
    tx.execute(
        "DELETE FROM local_messages WHERE session_id = ?1",
        params![session_id],
    )
    .map_err(|error| format!("Could not replace transcript: {error}"))?;
    tx.execute(
        "INSERT INTO local_messages(session_id, role, kind, content_json, created_at, sequence)
         VALUES (?1, 'system', 'timeline', ?2, ?3, 0)",
        params![session_id, encoded, now],
    )
    .map_err(|error| format!("Could not save transcript: {error}"))?;
    tx.execute(
        "UPDATE local_sessions SET updated_at = ?1 WHERE id = ?2",
        params![now, session_id],
    )
    .map_err(|error| format!("Could not touch session: {error}"))?;
    tx.commit()
        .map_err(|error| format!("Could not commit transcript: {error}"))?;
    Ok(())
}

pub fn load_transcript(state: &StoreState, session_id: &str) -> Result<Value, String> {
    let messages = {
        let connection = state
            .connection
            .lock()
            .map_err(|_| "Database state is poisoned".to_string())?;
        let mut statement = connection
            .prepare(
                "SELECT kind, role, content_json FROM local_messages
                 WHERE session_id = ?1 ORDER BY sequence",
            )
            .map_err(|error| format!("Could not load transcript: {error}"))?;
        let rows = statement
            .query_map(params![session_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .map_err(|error| format!("Could not load transcript: {error}"))?;
        let mut values = Vec::new();
        for row in rows {
            values.push(row.map_err(|error| format!("Could not read transcript: {error}"))?);
        }
        values
    };
    if let Some((_, _, content_json)) = messages.iter().find(|(kind, _, _)| kind == "timeline") {
        let value: Value = serde_json::from_str(content_json)
            .map_err(|error| format!("Stored transcript is invalid: {error}"))?;
        if value.is_array() {
            return Ok(value);
        }
        if let Some(items) = value.get("items") {
            return Ok(items.clone());
        }
    }
    let mut items = Vec::new();
    for (kind, role, content_json) in messages {
        let content: Value = serde_json::from_str(&content_json).unwrap_or(Value::Null);
        let text = content
            .get("text")
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .to_string();
        if text.is_empty() {
            continue;
        }
        let item_kind = if kind == "markdown" || role == "assistant" {
            "assistant"
        } else if role == "user" {
            "user"
        } else {
            continue;
        };
        items.push(serde_json::json!({
            "id": format!("local-{item_kind}-{}", items.len()),
            "kind": item_kind,
            "text": text,
        }));
    }
    Ok(Value::Array(items))
}

#[tauri::command]
pub fn save_local_transcript(
    state: State<'_, StoreState>,
    session_id: String,
    items: Value,
) -> Result<(), String> {
    save_transcript(&state, &session_id, &items)
}

#[tauri::command]
pub fn load_local_transcript(
    state: State<'_, StoreState>,
    session_id: String,
) -> Result<Value, String> {
    load_transcript(&state, &session_id)
}

#[cfg(test)]
mod tests {
    use super::{
        load_transcript, resolve_session_title, save_transcript, validate_setting, StoreState,
    };
    use rusqlite::Connection;
    use serde_json::json;

    #[test]
    fn migrates_an_empty_database() {
        let store = StoreState::from_connection(Connection::open_in_memory().unwrap()).unwrap();
        let connection = store.connection.lock().unwrap();
        let version: i64 = connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, 1);
    }

    #[test]
    fn rejects_unknown_and_oversized_settings() {
        assert!(validate_setting("secrets.apiKey", &json!("nope")).is_err());
        assert!(validate_setting("appearance.theme", &json!("dark")).is_ok());
        assert!(validate_setting("desktop.control", &json!(true)).is_ok());
        assert!(validate_setting("desktop.captureDetail", &json!("low")).is_ok());
        assert!(validate_setting("appearance.theme", &json!("x".repeat(40_000))).is_err());
    }

    #[test]
    fn keeps_a_real_title_when_reconnect_sends_a_placeholder() {
        assert_eq!(
            resolve_session_title("New task", Some("修登录闪退")),
            "修登录闪退"
        );
        assert_eq!(resolve_session_title("给侧栏加预览", Some("New task")), "给侧栏加预览");
    }

    #[test]
    fn replaces_and_reloads_a_session_transcript() {
        let store = StoreState::from_connection(Connection::open_in_memory().unwrap()).unwrap();
        {
            let connection = store.connection.lock().unwrap();
            connection
                .execute(
                    "INSERT INTO workspaces(id, path, name, last_opened_at) VALUES ('w1', 'C:/p', 'p', 1)",
                    [],
                )
                .unwrap();
            connection
                .execute(
                    "INSERT INTO local_sessions(id, remote_session_id, workspace_id, title, status, created_at, updated_at)
                     VALUES ('s1', 'remote-1', 'w1', 'New task', 'idle', 1, 1)",
                    [],
                )
                .unwrap();
        }
        save_transcript(
            &store,
            "s1",
            &json!([
                {"id": "u1", "kind": "user", "text": "先看这个项目"},
                {"id": "a1", "kind": "assistant", "text": "这是一个桌面客户端"}
            ]),
        )
        .unwrap();
        let loaded = load_transcript(&store, "s1").unwrap();
        assert_eq!(loaded[0]["text"], "先看这个项目");
        assert_eq!(loaded[1]["kind"], "assistant");
    }
}
