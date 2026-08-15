use crate::platform::{grok_executable, normalize_cwd_key};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{fs, path::PathBuf, process::Command};

const MAX_HISTORY_BYTES: u64 = 8 * 1024 * 1024;

pub fn parse_grok_chat_history(text: &str) -> Vec<Value> {
    let mut items = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let kind = value
            .get("type")
            .or_else(|| value.get("role"))
            .and_then(Value::as_str)
            .unwrap_or("");
        let blob = collect_text(value.get("content"));
        if kind == "user" {
            if let Some(query) = extract_user_query(&blob) {
                items.push(json!({
                    "id": format!("grok-user-{}", items.len() + 1),
                    "kind": "user",
                    "text": query,
                }));
            }
        } else if kind == "assistant" {
            let clean = strip_tool_calls(&blob);
            if !clean.is_empty() {
                items.push(json!({
                    "id": format!("grok-assistant-{}", items.len() + 1),
                    "kind": "assistant",
                    "text": clean,
                }));
            }
        } else if kind == "reasoning" || kind == "thought" {
            if !blob.trim().is_empty() {
                items.push(json!({
                    "id": format!("grok-thought-{}", items.len() + 1),
                    "kind": "thought",
                    "text": blob.trim(),
                }));
            }
        } else if kind == "tool_result" || kind == "tool" || kind == "tool_use" {
            let title = value
                .get("title")
                .or_else(|| value.get("name"))
                .and_then(Value::as_str)
                .unwrap_or("工具");
            let images = merge_image_lists(
                &collect_images(value.get("images")),
                &collect_images(value.get("content")),
            );
            items.push(json!({
                "id": format!("grok-tool-{}", items.len() + 1),
                "kind": "tool",
                "title": title,
                "text": blob,
                "status": value.get("status").and_then(Value::as_str).unwrap_or("completed"),
                "toolCallId": value.get("toolCallId").or_else(|| value.get("id")).or_else(|| value.get("tool_call_id")).and_then(Value::as_str).unwrap_or(""),
                "images": images,
            }));
        }
    }
    items
}

fn collect_text(content: Option<&Value>) -> String {
    match content {
        Some(Value::String(text)) => text.clone(),
        Some(Value::Array(parts)) => parts
            .iter()
            .map(|part| collect_text(Some(part)))
            .filter(|text| !text.is_empty())
            .collect::<Vec<_>>()
            .join("\n"),
        Some(Value::Object(map)) => {
            if let Some(Value::String(text)) = map.get("text") {
                return text.clone();
            }
            if let Some(nested) = map.get("content") {
                return collect_text(Some(nested));
            }
            String::new()
        }
        _ => String::new(),
    }
}

fn extract_user_query(blob: &str) -> Option<String> {
    if let Some(start_at) = blob.find("<user_query>") {
        let rest = blob.get(start_at + "<user_query>".len()..)?;
        if let Some(end) = rest.find("</user_query>") {
            let query = rest[..end].trim();
            if !query.is_empty() {
                return Some(query.to_string());
            }
        }
    }
    if blob.contains("<user_info>")
        || blob.contains("<system-reminder>")
        || blob.contains("<system_reminder>")
        || blob.contains("<system-instruction>")
    {
        return None;
    }
    let trimmed = blob.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn strip_tool_calls(blob: &str) -> String {
    let mut rest = blob;
    let mut out = String::new();
    while let Some(start) = rest.find("<tool_call>") {
        out.push_str(&rest[..start]);
        if let Some(end) = rest[start..].find("</tool_call>") {
            rest = &rest[start + end + "</tool_call>".len()..];
        } else {
            rest = "";
            break;
        }
    }
    out.push_str(rest);
    out.trim().to_string()
}

fn grok_sessions_root() -> Result<PathBuf, String> {
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .ok_or_else(|| "找不到用户主目录".to_string())?;
    Ok(PathBuf::from(home).join(".grok").join("sessions"))
}

pub fn parse_grok_export(markdown: &str) -> Vec<Value> {
    let mut items = Vec::new();
    let mut current: Option<(&'static str, String)> = None;
    for line in markdown.lines() {
        if let Some(kind) = export_heading(line) {
            flush_export_item(&mut items, current.take());
            current = (kind != "skip").then(|| (kind, String::new()));
            continue;
        }
        if let Some((_, buffer)) = &mut current {
            if !buffer.is_empty() {
                buffer.push('\n');
            }
            buffer.push_str(line);
        }
    }
    flush_export_item(&mut items, current);
    items
}

fn export_heading(line: &str) -> Option<&'static str> {
    let trimmed = line.trim();
    if !trimmed.starts_with("## ") {
        return None;
    }
    match trimmed[3..].trim().to_ascii_lowercase().as_str() {
        "user" | "你" => Some("user"),
        "assistant" | "grok" => Some("assistant"),
        "tools" | "tool" | "工具" => Some("tool"),
        _ => None,
    }
}

fn flush_export_item(items: &mut Vec<Value>, current: Option<(&'static str, String)>) {
    let Some((kind, text)) = current else {
        return;
    };
    let text = text.trim();
    if text.is_empty() {
        return;
    }
    if kind == "tool" {
        for line in text.lines() {
            let label = line
                .trim()
                .trim_start_matches(['-', '*'])
                .trim();
            if label.is_empty() {
                continue;
            }
            items.push(json!({
                "id": format!("grok-tool-{}", items.len() + 1),
                "kind": "tool",
                "title": "工具",
                "text": label,
                "status": "completed",
                "toolCallId": format!("export-tool-{}", items.len() + 1),
            }));
        }
        return;
    }
    items.push(json!({
        "id": format!("grok-{kind}-{}", items.len() + 1),
        "kind": kind,
        "text": text,
    }));
}

fn content_text(content: Option<&Value>) -> String {
    collect_text(content)
}

fn guess_image_mime(data: &str) -> &'static str {
    let raw = data
        .rsplit_once(',')
        .map(|(_, rest)| rest)
        .unwrap_or(data);
    if raw.starts_with("/9j/") {
        "image/jpeg"
    } else if raw.starts_with("iVBOR") {
        "image/png"
    } else if raw.starts_with("R0lGOD") {
        "image/gif"
    } else if raw.starts_with("UklGR") {
        "image/webp"
    } else {
        "image/png"
    }
}

fn image_entry(image: &Value) -> Option<Value> {
    let nested = if image.get("type").and_then(Value::as_str) == Some("content") {
        image.get("content").unwrap_or(image)
    } else {
        image
    };
    let is_image = nested.get("type").and_then(Value::as_str) == Some("image")
        || image.get("type").and_then(Value::as_str) == Some("image");
    if !is_image {
        return None;
    }
    let data = nested
        .get("data")
        .or_else(|| image.get("data"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let uri = ["uri", "url"]
        .into_iter()
        .find_map(|key| nested.get(key).and_then(Value::as_str))
        .or_else(|| {
            ["uri", "url"]
                .into_iter()
                .find_map(|key| image.get(key).and_then(Value::as_str))
        })
        .unwrap_or("");
    let src = if !data.is_empty() {
        if data.starts_with("data:") {
            data.to_string()
        } else {
            format!("data:{};base64,{data}", guess_image_mime(data))
        }
    } else if uri.starts_with("data:image/")
        || uri.starts_with("blob:")
        || uri.starts_with("http://")
        || uri.starts_with("https://")
        || uri.starts_with("file:")
    {
        uri.to_string()
    } else {
        return None;
    };
    Some(json!({ "src": src }))
}

fn collect_images(value: Option<&Value>) -> Vec<Value> {
    match value {
        Some(Value::Array(entries)) => entries.iter().filter_map(image_entry).collect(),
        Some(object @ Value::Object(_)) => image_entry(object).into_iter().collect(),
        _ => Vec::new(),
    }
}

fn merge_image_lists(left: &[Value], right: &[Value]) -> Vec<Value> {
    let mut seen = std::collections::BTreeSet::new();
    let mut out = Vec::new();
    for image in left.iter().chain(right) {
        let Some(src) = image.get("src").and_then(Value::as_str) else {
            continue;
        };
        if !seen.insert(src.to_string()) {
            continue;
        }
        out.push(image.clone());
    }
    out
}

pub fn parse_grok_updates(text: &str) -> Vec<Value> {
    let mut items = Vec::new();
    let mut pending_user = String::new();
    let mut pending_assistant = String::new();
    let flush_user = |items: &mut Vec<Value>, pending: &mut String| {
        let text = pending.trim().to_string();
        pending.clear();
        if !text.is_empty() {
            items.push(json!({
                "id": format!("grok-user-{}", items.len() + 1),
                "kind": "user",
                "text": text,
            }));
        }
    };
    let flush_assistant = |items: &mut Vec<Value>, pending: &mut String| {
        let text = pending.trim().to_string();
        pending.clear();
        if !text.is_empty() {
            items.push(json!({
                "id": format!("grok-assistant-{}", items.len() + 1),
                "kind": "assistant",
                "text": text,
            }));
        }
    };
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let params = value.get("params").unwrap_or(&value);
        let update = params.get("update").unwrap_or(params);
        let kind = update
            .get("sessionUpdate")
            .and_then(Value::as_str)
            .unwrap_or("");
        match kind {
            "user_message_chunk" => {
                flush_assistant(&mut items, &mut pending_assistant);
                pending_user.push_str(&content_text(update.get("content")));
            }
            "agent_message_chunk" => {
                flush_user(&mut items, &mut pending_user);
                pending_assistant.push_str(&content_text(update.get("content")));
            }
            "tool_call" | "tool_call_update" => {
                flush_user(&mut items, &mut pending_user);
                flush_assistant(&mut items, &mut pending_assistant);
                let tool_id = update
                    .get("toolCallId")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                let title = update
                    .get("title")
                    .and_then(Value::as_str)
                    .unwrap_or("工具");
                let images = merge_image_lists(
                    &collect_images(update.get("content")),
                    &collect_images(update.get("images")),
                );
                if let Some(existing) = items.iter_mut().find(|item| {
                    !tool_id.is_empty()
                        && item.get("toolCallId").and_then(Value::as_str) == Some(tool_id)
                }) {
                    if let Some(status) = update.get("status") {
                        existing["status"] = status.clone();
                    }
                    if !title.is_empty() && title != "工具" {
                        existing["title"] = json!(title);
                    }
                    let current = existing
                        .get("images")
                        .and_then(Value::as_array)
                        .cloned()
                        .unwrap_or_default();
                    existing["images"] = json!(merge_image_lists(&current, &images));
                    continue;
                }
                items.push(json!({
                    "id": format!("grok-tool-{}", items.len() + 1),
                    "kind": "tool",
                    "title": title,
                    "text": title,
                    "status": update.get("status").and_then(Value::as_str).unwrap_or("pending"),
                    "toolCallId": tool_id,
                    "images": images,
                }));
            }
            "agent_thought_chunk" => {}
            _ => {}
        }
    }
    flush_user(&mut items, &mut pending_user);
    flush_assistant(&mut items, &mut pending_assistant);
    items
}

fn transcript_has_visible_turns(items: &[Value]) -> bool {
    visible_turn_score(items) > 0
}

fn visible_turn_score(items: &[Value]) -> usize {
    items
        .iter()
        .filter(|item| {
            let kind = item.get("kind").and_then(Value::as_str).unwrap_or("");
            let text = item.get("text").and_then(Value::as_str).unwrap_or("");
            let has_images = item
                .get("images")
                .and_then(Value::as_array)
                .is_some_and(|images| !images.is_empty());
            matches!(kind, "user" | "assistant") && !text.trim().is_empty()
                || kind == "tool"
                || has_images
        })
        .count()
}

fn pick_best_transcript(candidates: &[Vec<Value>]) -> Vec<Value> {
    candidates
        .iter()
        .max_by_key(|items| visible_turn_score(items))
        .cloned()
        .unwrap_or_default()
}

fn export_via_cli(session_id: &str) -> Result<String, String> {
    let mut command = Command::new(grok_executable()?);
    command.args(["export", session_id]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let output = command
        .output()
        .map_err(|error| format!("无法运行 grok export：{error}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(if stderr.trim().is_empty() {
            "grok export 失败".into()
        } else {
            stderr.trim().to_string()
        });
    }
    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    if stdout.len() as u64 > MAX_HISTORY_BYTES {
        return Err("会话记录过大".into());
    }
    Ok(stdout)
}

fn is_session_id(value: &str) -> bool {
    let value = value.trim();
    (8..=80).contains(&value.len())
        && value
            .chars()
            .all(|character| character.is_ascii_hexdigit() || character == '-')
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrokDiskSession {
    pub session_id: String,
    pub title: Option<String>,
    pub summary: Option<String>,
    pub cwd: Option<String>,
    pub updated_at: Option<String>,
    pub created_at: Option<String>,
    pub num_chat_messages: Option<u64>,
    pub has_user_query: bool,
    pub context_tokens_used: Option<u64>,
    pub context_window_tokens: Option<u64>,
    pub context_window_usage: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GrokSessionUsage {
    pub context_tokens_used: Option<u64>,
    pub context_window_tokens: Option<u64>,
    pub context_window_usage: Option<u64>,
    pub turn_count: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct SummaryFile {
    info: Option<SummaryInfo>,
    session_summary: Option<String>,
    generated_title: Option<String>,
    created_at: Option<String>,
    updated_at: Option<String>,
    last_active_at: Option<String>,
    num_chat_messages: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct SummaryInfo {
    id: Option<String>,
    cwd: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SignalsFile {
    context_tokens_used: Option<u64>,
    context_window_tokens: Option<u64>,
    context_window_usage: Option<u64>,
    turn_count: Option<u64>,
}

fn read_session_dir(dir: &std::path::Path) -> Option<GrokDiskSession> {
    let summary_text = fs::read_to_string(dir.join("summary.json")).ok()?;
    let summary: SummaryFile = serde_json::from_str(&summary_text).ok()?;
    let session_id = summary
        .info
        .as_ref()
        .and_then(|info| info.id.clone())
        .or_else(|| {
            dir.file_name()
                .and_then(|name| name.to_str())
                .map(str::to_owned)
        })?;
    let signals = fs::read_to_string(dir.join("signals.json"))
        .ok()
        .and_then(|text| serde_json::from_str::<SignalsFile>(&text).ok());
    let title = summary
        .generated_title
        .filter(|value| !value.trim().is_empty())
        .or_else(|| summary.session_summary.clone().filter(|value| !value.trim().is_empty()));
    let has_user_query = summary.num_chat_messages.unwrap_or(0) > 0;
    Some(GrokDiskSession {
        session_id,
        title,
        summary: summary.session_summary,
        cwd: display_cwd(summary.info.and_then(|info| info.cwd)),
        updated_at: summary.last_active_at.or(summary.updated_at),
        created_at: summary.created_at,
        num_chat_messages: summary.num_chat_messages,
        has_user_query,
        context_tokens_used: signals.as_ref().and_then(|item| item.context_tokens_used),
        context_window_tokens: signals.as_ref().and_then(|item| item.context_window_tokens),
        context_window_usage: signals.as_ref().and_then(|item| item.context_window_usage),
        })
}

fn display_cwd(value: Option<String>) -> Option<String> {
    value.map(|cwd| {
        cwd.trim()
            .trim_start_matches(r"\\?\")
            .replace('/', "\\")
            .trim_end_matches(['\\', '/'])
            .to_string()
    })
}

fn session_matches_cwd(session: &GrokDiskSession, cwd: &str) -> bool {
    session
        .cwd
        .as_deref()
        .map(|value| normalize_cwd_key(value) == normalize_cwd_key(cwd))
        .unwrap_or(false)
}

#[tauri::command]
pub fn list_grok_sessions(cwd: Option<String>) -> Result<Vec<GrokDiskSession>, String> {
    let root = grok_sessions_root()?;
    if !root.is_dir() {
        return Ok(Vec::new());
    }
    let wanted = cwd
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(normalize_cwd_key);
    let mut sessions = Vec::new();
    for group in fs::read_dir(&root).map_err(|error| format!("无法读取会话目录：{error}"))? {
        let group = group.map_err(|error| format!("无法读取会话目录：{error}"))?;
        if !group.file_type().map(|kind| kind.is_dir()).unwrap_or(false) {
            continue;
        }
        for entry in fs::read_dir(group.path()).map_err(|error| format!("无法读取会话：{error}"))? {
            let entry = entry.map_err(|error| format!("无法读取会话：{error}"))?;
            if !entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false) {
                continue;
            }
            if let Some(session) = read_session_dir(&entry.path()) {
                if wanted
                    .as_ref()
                    .is_none_or(|cwd| session_matches_cwd(&session, cwd))
                {
                    sessions.push(session);
                }
            }
        }
    }
    sessions.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
    let mut seen = std::collections::HashSet::new();
    sessions.retain(|session| seen.insert(session.session_id.clone()));
    Ok(sessions)
}

#[tauri::command]
pub fn grok_session_usage(session_id: String) -> Result<GrokSessionUsage, String> {
    if !is_session_id(&session_id) {
        return Err("会话 ID 不合法".into());
    }
    let path = find_session_dir(session_id.trim())?;
    let signals = fs::read_to_string(path.join("signals.json"))
        .ok()
        .and_then(|text| serde_json::from_str::<SignalsFile>(&text).ok());
    Ok(GrokSessionUsage {
        context_tokens_used: signals.as_ref().and_then(|item| item.context_tokens_used),
        context_window_tokens: signals.as_ref().and_then(|item| item.context_window_tokens),
        context_window_usage: signals.as_ref().and_then(|item| item.context_window_usage),
        turn_count: signals.as_ref().and_then(|item| item.turn_count),
    })
}

#[tauri::command]
pub fn delete_grok_session(session_id: String) -> Result<(), String> {
    if !is_session_id(&session_id) {
        return Err("会话 ID 不合法".into());
    }
    let mut command = Command::new(grok_executable()?);
    command.args(["sessions", "delete", session_id.trim()]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let output = command
        .output()
        .map_err(|error| format!("无法运行 grok sessions delete：{error}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(if stderr.trim().is_empty() {
            "删除 Grok 会话失败".into()
        } else {
            stderr.trim().to_string()
        });
    }
    Ok(())
}

fn find_session_dir(remote_session_id: &str) -> Result<PathBuf, String> {
    let root = grok_sessions_root()?;
    if !root.is_dir() {
        return Err("本机没有 Grok 会话目录".into());
    }
    for project in fs::read_dir(&root).map_err(|error| format!("无法读取会话目录：{error}"))? {
        let project = project.map_err(|error| format!("无法读取会话目录：{error}"))?;
        if !project.file_type().map(|kind| kind.is_dir()).unwrap_or(false) {
            continue;
        }
        let candidate = project.path().join(remote_session_id);
        if candidate.is_dir() {
            return Ok(candidate);
        }
    }
    Err(format!("找不到会话 {remote_session_id}"))
}

#[tauri::command]
pub fn import_grok_transcript(remote_session_id: String) -> Result<Value, String> {
    if !is_session_id(&remote_session_id) {
        return Err("会话 ID 不合法".into());
    }
    let session_id = remote_session_id.trim();
    let mut candidates: Vec<Vec<Value>> = Vec::new();
    if let Ok(dir) = find_session_dir(session_id) {
        let history_path = dir.join("chat_history.jsonl");
        if history_path.is_file() {
            let metadata = fs::metadata(&history_path).map_err(|error| format!("无法读取会话文件：{error}"))?;
            if metadata.len() > MAX_HISTORY_BYTES {
                return Err("会话记录过大".into());
            }
            let text = fs::read_to_string(&history_path)
                .map_err(|error| format!("无法读取会话记录：{error}"))?;
            candidates.push(parse_grok_chat_history(&text));
        }
        let updates_path = dir.join("updates.jsonl");
        if updates_path.is_file() {
            let metadata = fs::metadata(&updates_path).map_err(|error| format!("无法读取会话更新：{error}"))?;
            if metadata.len() > MAX_HISTORY_BYTES {
                return Err("会话记录过大".into());
            }
            let text = fs::read_to_string(&updates_path)
                .map_err(|error| format!("无法读取会话更新：{error}"))?;
            candidates.push(parse_grok_updates(&text));
        }
    }
    let best = pick_best_transcript(&candidates);
    if transcript_has_visible_turns(&best) {
        return Ok(Value::Array(best));
    }
    if let Ok(markdown) = export_via_cli(session_id) {
        let items = parse_grok_export(&markdown);
        if transcript_has_visible_turns(&items) {
            return Ok(Value::Array(items));
        }
    }
    if find_session_dir(session_id).is_ok() {
        return Ok(Value::Array(best));
    }
    Err(format!("找不到会话 {session_id} 的聊天记录"))
}

#[cfg(test)]
mod tests {
    use super::{
        parse_grok_chat_history, parse_grok_export, parse_grok_updates, pick_best_transcript,
    };

    #[test]
    fn extracts_user_queries_and_assistant_replies() {
        let jsonl = r#"
{"type":"system","content":"ignore"}
{"type":"user","content":[{"type":"text","text":"<user_info>x</user_info>\n<user_query>\n请你阅读我的项目\n</user_query>"}]}
{"type":"assistant","content":[{"type":"text","text":"<tool_call>x</tool_call>"}]}
{"type":"assistant","content":[{"type":"text","text":"读完了。这是 Go Young Studio，一个人在跑的中文 AI 内容工作室。核心不是做一个网站，而是每天从英文源头筛东西，写成中文判断。"}]}
"#;
        let items = parse_grok_chat_history(jsonl);
        assert_eq!(items[0]["kind"], "user");
        assert_eq!(items[0]["text"], "请你阅读我的项目");
        assert!(items.iter().any(|item| item["kind"] == "assistant"
            && item["text"].as_str().unwrap().contains("Go Young Studio")));
    }

    #[test]
    fn keeps_plain_user_lines_and_skips_system_only_blobs() {
        let jsonl = r#"
{"role":"user","content":"直接发一句"}
{"type":"user","content":[{"type":"text","text":"<user_info>os</user_info>\n<system-reminder>ignore</system-reminder>"}]}
{"type":"assistant","content":"收到。"}
"#;
        let items = parse_grok_chat_history(jsonl);
        assert_eq!(items[0]["kind"], "user");
        assert_eq!(items[0]["text"], "直接发一句");
        assert!(items.iter().all(|item| {
            !item["text"].as_str().unwrap_or("").contains("system-reminder")
        }));
        assert!(items.iter().any(|item| item["kind"] == "assistant"
            && item["text"].as_str().unwrap().contains("收到")));
    }

    #[test]
    fn keeps_short_assistant_replies() {
        let jsonl = r#"
{"type":"user","content":[{"type":"text","text":"<user_query>人呢</user_query>"}]}
{"type":"assistant","content":[{"type":"text","text":"在的。"}]}
"#;
        let items = parse_grok_chat_history(jsonl);
        assert_eq!(items.len(), 2);
        assert_eq!(items[1]["text"], "在的。");
    }

    #[test]
    fn keeps_markdown_headings_inside_assistant_export() {
        let markdown = r#"
## User

看一下项目

## Assistant

handoff 找到了。

## 项目是什么

Grok Desk 是桌面客户端。

## User

还有问题
"#;
        let items = parse_grok_export(markdown);
        let assistant = items
            .iter()
            .find(|item| item["kind"] == "assistant")
            .unwrap();
        assert!(assistant["text"].as_str().unwrap().contains("项目是什么"));
        assert!(assistant["text"]
            .as_str()
            .unwrap()
            .contains("Grok Desk 是桌面客户端"));
        assert_eq!(items.last().unwrap()["text"], "还有问题");
    }

    #[test]
    fn prefers_the_transcript_with_more_visible_turns() {
        let thin = vec![serde_json::json!({"kind":"user","text":"hi"})];
        let rich = vec![
            serde_json::json!({"kind":"user","text":"hi"}),
            serde_json::json!({"kind":"assistant","text":"hello"}),
            serde_json::json!({"kind":"tool","text":"read"}),
        ];
        let picked = pick_best_transcript(&[thin, rich.clone()]);
        assert_eq!(picked.len(), 3);
        assert_eq!(picked[1]["kind"], "assistant");
    }

    #[test]
    fn parses_grok_export_markdown() {
        let markdown = r#"
## User

请你阅读我的项目

## Tools

- Read: AGENTS.md

## Assistant

读完了。这是 GY 工作室。

## User

你能做这个管线吗
"#;
        let items = parse_grok_export(markdown);
        assert!(items.iter().any(|item| item["kind"] == "user" && item["text"] == "请你阅读我的项目"));
        assert!(items.iter().any(|item| item["kind"] == "assistant"));
        assert!(items.iter().any(|item| item["kind"] == "tool"));
        assert_eq!(items.last().unwrap()["text"], "你能做这个管线吗");
    }

    #[test]
    fn parses_acp_updates_jsonl() {
        let jsonl = r#"
{"method":"session/update","params":{"update":{"sessionUpdate":"user_message_chunk","content":{"type":"text","text":"帮我看一下登录闪退"}}}}
{"method":"session/update","params":{"update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"我先读相关文件。"}}}}
{"method":"session/update","params":{"update":{"sessionUpdate":"tool_call","toolCallId":"tool-1","title":"read_file","status":"completed"}}}
"#;
        let items = parse_grok_updates(jsonl);
        assert_eq!(items[0]["kind"], "user");
        assert_eq!(items[0]["text"], "帮我看一下登录闪退");
        assert_eq!(items[1]["kind"], "assistant");
        assert!(items[1]["text"].as_str().unwrap().contains("我先读相关文件"));
        assert_eq!(items[2]["kind"], "tool");
    }

    #[test]
    fn keeps_generated_images_from_tool_updates() {
        let jsonl = r#"
{"method":"session/update","params":{"update":{"sessionUpdate":"tool_call","toolCallId":"img-1","title":"image_gen","status":"in_progress"}}}
{"method":"session/update","params":{"update":{"sessionUpdate":"tool_call_update","toolCallId":"img-1","title":"image_gen","status":"completed","content":[{"type":"content","content":{"type":"image","data":"/9j/4AAQ"}}]}}}
"#;
        let items = parse_grok_updates(jsonl);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0]["status"], "completed");
        assert_eq!(
            items[0]["images"][0]["src"],
            "data:image/jpeg;base64,/9j/4AAQ"
        );
    }

    #[test]
    fn keeps_chat_history_tool_result_images() {
        let jsonl = r#"
{"type":"tool_result","tool_call_id":"img-1","name":"read_file","content":"Read image file","images":[{"type":"image","url":"data:image/png;base64,abc"}]}
"#;
        let items = parse_grok_chat_history(jsonl);
        assert_eq!(items[0]["kind"], "tool");
        assert_eq!(items[0]["images"][0]["src"], "data:image/png;base64,abc");
    }
}
