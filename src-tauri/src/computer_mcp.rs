//! JSON-RPC MCP stdio server for opt-in desktop control.
//! Grok launches this as `grok-desk.exe --computer-mcp`.

use crate::computer::{self, MCP_NAME};
use serde_json::{json, Value};
use std::io::{self, BufRead, Write};

pub fn run() {
    let stdin = io::stdin();
    let mut stdout = io::stdout();
    let mut reader = stdin.lock();
    loop {
        match read_message(&mut reader) {
            Ok(Some(request)) => {
                if let Some(response) = handle_request(&request) {
                    if write_message(&mut stdout, &response).is_err() {
                        break;
                    }
                }
            }
            Ok(None) => break,
            Err(_) => break,
        }
    }
}

pub fn handle_request(request: &Value) -> Option<Value> {
    let method = request.get("method")?.as_str()?;
    let id = request.get("id").cloned();
    id.as_ref()?;
    let result = match method {
        "initialize" => initialize(request),
        "ping" => json!({}),
        "tools/list" => json!({ "tools": tool_defs() }),
        "tools/call" => call_tool(request),
        _ => {
            return Some(json!({
                "jsonrpc": "2.0",
                "id": id,
                "error": { "code": -32601, "message": format!("Unknown method: {method}") }
            }));
        }
    };
    Some(json!({ "jsonrpc": "2.0", "id": id, "result": result }))
}

fn initialize(request: &Value) -> Value {
    let version = request
        .pointer("/params/protocolVersion")
        .and_then(Value::as_str)
        .unwrap_or("2024-11-05");
    json!({
        "protocolVersion": version,
        "capabilities": { "tools": { "listChanged": false } },
        "serverInfo": { "name": MCP_NAME, "version": "0.1.0" },
        "instructions": "You can see the user's Windows desktop and control the mouse and keyboard when they explicitly ask. Screenshots spend usage quickly, so take at most one screenshot, then click or type from that image. Do not screenshot after every action. Prefer list_windows and screen_info. Only screenshot again if the UI must have changed and you cannot proceed. Pass detail=high only when text is unreadable. If 控制电脑 is off, tell the user to enable it in Grok Desk settings."
    })
}

fn tool_defs() -> Value {
    json!([
        {
            "name": "screenshot",
            "description": "Capture a small JPEG of the desktop. Spends usage — take one shot, then act. Do not call this after every click. detail=low is default; detail=high only if text is unreadable. force=true takes a new shot instead of reusing one from the last 8 seconds.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "detail": { "type": "string", "enum": ["low", "high"] },
                    "force": { "type": "boolean" }
                }
            }
        },
        {
            "name": "screen_info",
            "description": "Return virtual-screen size and current mouse position in screen pixels.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "list_windows",
            "description": "List visible top-level window titles and bounds.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "focus_window",
            "description": "Bring a visible window to the front by a title substring.",
            "inputSchema": {
                "type": "object",
                "required": ["title"],
                "properties": { "title": { "type": "string" } }
            }
        },
        {
            "name": "move_mouse",
            "description": "Move the mouse to screen coordinates from screen_info / screenshot.",
            "inputSchema": {
                "type": "object",
                "required": ["x", "y"],
                "properties": {
                    "x": { "type": "integer" },
                    "y": { "type": "integer" }
                }
            }
        },
        {
            "name": "click",
            "description": "Click at screen coordinates. button is left, right, or middle. clicks is 1 or 2.",
            "inputSchema": {
                "type": "object",
                "required": ["x", "y"],
                "properties": {
                    "x": { "type": "integer" },
                    "y": { "type": "integer" },
                    "button": { "type": "string" },
                    "clicks": { "type": "integer" }
                }
            }
        },
        {
            "name": "type_text",
            "description": "Type unicode text into the focused window. Do not type secrets unless the user just asked you to.",
            "inputSchema": {
                "type": "object",
                "required": ["text"],
                "properties": { "text": { "type": "string" } }
            }
        },
        {
            "name": "press_key",
            "description": "Press one named key such as enter, tab, esc, backspace, delete, up, down, left, right, win, or f5.",
            "inputSchema": {
                "type": "object",
                "required": ["key"],
                "properties": { "key": { "type": "string" } }
            }
        },
        {
            "name": "hotkey",
            "description": "Send a shortcut such as ctrl+c. Pass 1 to 4 key names in order.",
            "inputSchema": {
                "type": "object",
                "required": ["keys"],
                "properties": {
                    "keys": { "type": "array", "items": { "type": "string" } }
                }
            }
        },
        {
            "name": "wait",
            "description": "Pause up to 8000 ms for the UI to settle after a click.",
            "inputSchema": {
                "type": "object",
                "properties": { "ms": { "type": "integer" } }
            }
        }
    ])
}

fn call_tool(request: &Value) -> Value {
    let name = request
        .pointer("/params/name")
        .and_then(Value::as_str)
        .unwrap_or("");
    let args = request
        .pointer("/params/arguments")
        .cloned()
        .unwrap_or_else(|| json!({}));
    match invoke_tool(name, &args) {
        Ok(content) => json!({ "content": content, "isError": false }),
        Err(message) => json!({
            "content": [{ "type": "text", "text": message }],
            "isError": true
        }),
    }
}

fn invoke_tool(name: &str, args: &Value) -> Result<Value, String> {
    match name {
        "screenshot" => {
            let force = args.get("force").and_then(Value::as_bool).unwrap_or(false);
            let detail = args.get("detail").and_then(Value::as_str);
            computer::screenshot_payload(force, detail)
        }
        "screen_info" => {
            Ok(json!([{ "type": "text", "text": computer::screen_info()?.to_string() }]))
        }
        "list_windows" => {
            Ok(json!([{ "type": "text", "text": computer::list_windows()?.to_string() }]))
        }
        "focus_window" => {
            let title = args.get("title").and_then(Value::as_str).unwrap_or("");
            Ok(text(computer::focus_window(title)?))
        }
        "move_mouse" => {
            let x = int_arg(args, "x")?;
            let y = int_arg(args, "y")?;
            Ok(text(computer::move_mouse(x, y)?))
        }
        "click" => {
            let x = int_arg(args, "x")?;
            let y = int_arg(args, "y")?;
            let button = args.get("button").and_then(Value::as_str).unwrap_or("left");
            let clicks = args.get("clicks").and_then(Value::as_u64).unwrap_or(1) as u32;
            Ok(text(computer::click_at(x, y, button, clicks)?))
        }
        "type_text" => {
            let value = args.get("text").and_then(Value::as_str).unwrap_or("");
            Ok(text(computer::type_text(value)?))
        }
        "press_key" => {
            let key = args.get("key").and_then(Value::as_str).unwrap_or("");
            Ok(text(computer::press_named_key(key)?))
        }
        "hotkey" => {
            let keys = args
                .get("keys")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(|item| item.as_str().map(str::to_string))
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            Ok(text(computer::press_hotkey(&keys)?))
        }
        "wait" => {
            let ms = args.get("ms").and_then(Value::as_u64).unwrap_or(500);
            Ok(text(computer::wait_ms(ms)?))
        }
        other => Err(format!("未知工具：{other}")),
    }
}

fn text(message: String) -> Value {
    json!([{ "type": "text", "text": message }])
}

fn int_arg(args: &Value, name: &str) -> Result<i32, String> {
    args.get(name)
        .and_then(Value::as_i64)
        .map(|value| value as i32)
        .ok_or_else(|| format!("缺少参数 {name}"))
}

fn read_message<R: BufRead>(reader: &mut R) -> Result<Option<Value>, String> {
    let mut header = String::new();
    let mut first = [0_u8; 1];
    match reader.read(&mut first) {
        Ok(0) => return Ok(None),
        Ok(_) => {}
        Err(error) => return Err(error.to_string()),
    }
    if first[0] == b'{' {
        let mut rest = String::new();
        reader
            .read_line(&mut rest)
            .map_err(|error| error.to_string())?;
        let line = format!("{{{}", rest);
        return serde_json::from_str(line.trim())
            .map(Some)
            .map_err(|error| error.to_string());
    }
    header.push(first[0] as char);
    loop {
        let mut line = String::new();
        let read = reader
            .read_line(&mut line)
            .map_err(|error| error.to_string())?;
        if read == 0 {
            return Ok(None);
        }
        header.push_str(&line);
        if header.contains("\r\n\r\n") || header.contains("\n\n") {
            break;
        }
        if header.len() > 8 * 1024 {
            return Err("MCP header too large".into());
        }
    }
    let length = header
        .lines()
        .find_map(|line| {
            line.split_once(':').and_then(|(name, value)| {
                if name.eq_ignore_ascii_case("content-length") {
                    value.trim().parse::<usize>().ok()
                } else {
                    None
                }
            })
        })
        .ok_or_else(|| "MCP message missing Content-Length".to_string())?;
    if length == 0 || length > 8 * 1024 * 1024 {
        return Err("MCP body size rejected".into());
    }
    let mut body = vec![0_u8; length];
    reader
        .read_exact(&mut body)
        .map_err(|error| error.to_string())?;
    serde_json::from_slice(&body)
        .map(Some)
        .map_err(|error| error.to_string())
}

fn write_message<W: Write>(writer: &mut W, value: &Value) -> io::Result<()> {
    // Grok's MCP stdio client reads newline-delimited JSON. LSP-style
    // Content-Length framing is treated as a decode error ("expected value
    // at line 1 column 1") and the server then hits the 30s startup timeout.
    let mut body = serde_json::to_vec(value)?;
    body.push(b'\n');
    writer.write_all(&body)?;
    writer.flush()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn initialize_advertises_tools() {
        let response = handle_request(&json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": { "protocolVersion": "2025-03-26" }
        }))
        .unwrap();
        assert_eq!(response["result"]["protocolVersion"], "2025-03-26");
        assert_eq!(response["result"]["serverInfo"]["name"], MCP_NAME);
    }

    #[test]
    fn lists_screenshot_and_click() {
        let response = handle_request(&json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/list"
        }))
        .unwrap();
        let names: Vec<&str> = response["result"]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .map(|tool| tool["name"].as_str().unwrap())
            .collect();
        assert!(names.contains(&"screenshot"));
        let screenshot = response["result"]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .find(|tool| tool["name"] == "screenshot")
            .unwrap();
        assert!(screenshot["description"]
            .as_str()
            .unwrap()
            .contains("Spends usage"));
        assert!(names.contains(&"click"));
        assert!(names.contains(&"type_text"));
    }

    #[test]
    fn writes_newline_delimited_json_not_content_length() {
        let mut out = Vec::new();
        write_message(&mut out, &json!({"jsonrpc":"2.0","id":1,"result":{}})).unwrap();
        let text = String::from_utf8(out).unwrap();
        assert!(text.starts_with('{'), "{text}");
        assert!(text.ends_with('\n'), "{text}");
        assert!(!text.contains("Content-Length"));
        assert!(serde_json::from_str::<Value>(text.trim()).is_ok());
    }

    #[test]
    fn notifications_have_no_response() {
        assert!(handle_request(&json!({
            "jsonrpc": "2.0",
            "method": "notifications/initialized"
        }))
        .is_none());
    }

    #[test]
    fn refuses_input_when_gate_is_off() {
        if computer::gate_enabled() {
            return;
        }
        let response = handle_request(&json!({
            "jsonrpc": "2.0",
            "id": 3,
            "method": "tools/call",
            "params": { "name": "click", "arguments": { "x": 1, "y": 1 } }
        }))
        .unwrap();
        assert_eq!(response["result"]["isError"], true);
        assert!(response["result"]["content"][0]["text"]
            .as_str()
            .unwrap()
            .contains("未开启"));
    }
}
