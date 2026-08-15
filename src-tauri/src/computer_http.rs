//! Localhost streamable-HTTP MCP so Grok can call computer tools
//! without spawning a second grok-desk.exe (stdio timed out).

use crate::computer::HTTP_BIND;
use crate::computer_mcp::handle_request;
use serde_json::Value;
use std::{
    collections::BTreeMap,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    thread,
    time::Duration,
};

pub fn start() {
    thread::Builder::new()
        .name("desk-computer-mcp".into())
        .spawn(|| {
            let listener = match TcpListener::bind(HTTP_BIND) {
                Ok(listener) => listener,
                Err(error) => {
                    eprintln!("desk-computer MCP listen failed on {HTTP_BIND}: {error}");
                    return;
                }
            };
            let _ = listener.set_nonblocking(false);
            for incoming in listener.incoming() {
                if let Ok(stream) = incoming {
                    thread::spawn(move || {
                        let _ = handle_connection(stream);
                    });
                }
            }
        })
        .ok();
}

fn handle_connection(mut stream: TcpStream) -> Result<(), String> {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(20)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(20)));
    let request = read_http(&mut stream)?;
    let (status, headers, body) = respond(&request);
    write_http(&mut stream, status, &headers, &body)
}

pub struct HttpRequest {
    pub method: String,
    pub path: String,
    pub headers: BTreeMap<String, String>,
    pub body: Vec<u8>,
}

pub fn respond(request: &HttpRequest) -> (u16, Vec<(String, String)>, Vec<u8>) {
    let path = request.path.split('?').next().unwrap_or("/");
    if path != "/mcp" && path != "/" {
        return text(404, "not found");
    }
    if request.method == "GET" || request.method == "HEAD" {
        return (
            200,
            vec![
                ("Content-Type".into(), "text/event-stream".into()),
                ("Cache-Control".into(), "no-cache".into()),
                ("Mcp-Session-Id".into(), "desk-local".into()),
            ],
            b": desk-computer ready\n\n".to_vec(),
        );
    }
    if request.method != "POST" {
        return text(405, "POST /mcp");
    }
    let value: Value = match serde_json::from_slice(&request.body) {
        Ok(value) => value,
        Err(error) => return text(400, &format!("invalid json: {error}")),
    };
    match handle_request(&value) {
        None => (
            202,
            vec![("Mcp-Session-Id".into(), "desk-local".into())],
            Vec::new(),
        ),
        Some(response) => encode_mcp_response(request, &response),
    }
}

fn encode_mcp_response(
    request: &HttpRequest,
    response: &Value,
) -> (u16, Vec<(String, String)>, Vec<u8>) {
    let accept = request
        .headers
        .get("accept")
        .map(String::as_str)
        .unwrap_or("");
    let payload = serde_json::to_vec(response).unwrap_or_else(|_| b"{}".to_vec());
    if accept.contains("text/event-stream") {
        let mut body = b"event: message\ndata: ".to_vec();
        body.extend_from_slice(&payload);
        body.extend_from_slice(b"\n\n");
        return (
            200,
            vec![
                ("Content-Type".into(), "text/event-stream".into()),
                ("Cache-Control".into(), "no-cache".into()),
                ("Mcp-Session-Id".into(), "desk-local".into()),
            ],
            body,
        );
    }
    (
        200,
        vec![
            ("Content-Type".into(), "application/json".into()),
            ("Mcp-Session-Id".into(), "desk-local".into()),
        ],
        payload,
    )
}

fn text(status: u16, message: &str) -> (u16, Vec<(String, String)>, Vec<u8>) {
    (
        status,
        vec![("Content-Type".into(), "text/plain; charset=utf-8".into())],
        message.as_bytes().to_vec(),
    )
}

fn read_http(stream: &mut TcpStream) -> Result<HttpRequest, String> {
    let mut buf = Vec::new();
    let mut chunk = [0_u8; 4096];
    let header_end = loop {
        let read = stream.read(&mut chunk).map_err(|error| error.to_string())?;
        if read == 0 {
            break None;
        }
        buf.extend_from_slice(&chunk[..read]);
        if let Some(index) = find_header_end(&buf) {
            break Some(index);
        }
        if buf.len() > 32 * 1024 {
            return Err("HTTP headers too large".into());
        }
    };
    let header_end = header_end.ok_or_else(|| "empty HTTP request".to_string())?;
    let (head, rest) = buf.split_at(header_end);
    let head = String::from_utf8_lossy(head);
    let mut lines = head.split('\n');
    let start = lines.next().unwrap_or("").trim();
    let mut parts = start.split_whitespace();
    let method = parts.next().unwrap_or("GET").to_ascii_uppercase();
    let path = parts.next().unwrap_or("/").to_string();
    let mut headers = BTreeMap::new();
    for line in lines {
        let line = line.trim();
        if let Some((name, value)) = line.split_once(':') {
            headers.insert(name.trim().to_ascii_lowercase(), value.trim().to_string());
        }
    }
    let length = headers
        .get("content-length")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(0);
    if length > 8 * 1024 * 1024 {
        return Err("HTTP body too large".into());
    }
    let mut body = rest.to_vec();
    while body.len() < length {
        let read = stream.read(&mut chunk).map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        body.extend_from_slice(&chunk[..read]);
    }
    body.truncate(length);
    Ok(HttpRequest {
        method,
        path,
        headers,
        body,
    })
}

fn find_header_end(buf: &[u8]) -> Option<usize> {
    buf.windows(4)
        .position(|window| window == b"\r\n\r\n")
        .map(|index| index + 4)
        .or_else(|| {
            buf.windows(2)
                .position(|window| window == b"\n\n")
                .map(|index| index + 2)
        })
}

fn write_http(
    stream: &mut TcpStream,
    status: u16,
    headers: &[(String, String)],
    body: &[u8],
) -> Result<(), String> {
    let reason = match status {
        200 => "OK",
        202 => "Accepted",
        400 => "Bad Request",
        404 => "Not Found",
        405 => "Method Not Allowed",
        _ => "Error",
    };
    let mut out = format!("HTTP/1.1 {status} {reason}\r\n");
    out.push_str("Connection: close\r\n");
    out.push_str(&format!("Content-Length: {}\r\n", body.len()));
    for (name, value) in headers {
        out.push_str(name);
        out.push_str(": ");
        out.push_str(value);
        out.push_str("\r\n");
    }
    out.push_str("\r\n");
    stream
        .write_all(out.as_bytes())
        .map_err(|error| error.to_string())?;
    stream.write_all(body).map_err(|error| error.to_string())?;
    stream.flush().map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn initialize_over_http_returns_json() {
        let request = HttpRequest {
            method: "POST".into(),
            path: "/mcp".into(),
            headers: BTreeMap::from([("content-type".into(), "application/json".into())]),
            body: serde_json::to_vec(&json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": { "protocolVersion": "2025-03-26" }
            }))
            .unwrap(),
        };
        let (status, headers, body) = respond(&request);
        assert_eq!(status, 200);
        assert!(headers.iter().any(|(name, value)| name == "Mcp-Session-Id" && value == "desk-local"));
        let parsed: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(parsed["result"]["serverInfo"]["name"], "desk-computer");
    }

    #[test]
    fn notification_returns_accepted() {
        let request = HttpRequest {
            method: "POST".into(),
            path: "/mcp".into(),
            headers: BTreeMap::new(),
            body: serde_json::to_vec(&json!({
                "jsonrpc": "2.0",
                "method": "notifications/initialized"
            }))
            .unwrap(),
        };
        let (status, _, body) = respond(&request);
        assert_eq!(status, 202);
        assert!(body.is_empty());
    }
}
