use crate::computer::{
    status, write_capture_detail, write_gate, CaptureDetail, ComputerControlStatus, HTTP_URL,
    MCP_NAME,
};
use crate::extensions::{manage_mcp, McpManageRequest};

#[tauri::command]
pub fn computer_control_status() -> ComputerControlStatus {
    status()
}

#[tauri::command]
pub async fn set_computer_control(enabled: bool) -> Result<ComputerControlStatus, String> {
    write_gate(enabled)?;
    if enabled {
        register_mcp().await?;
    } else {
        let _ = manage_mcp(McpManageRequest {
            action: "disable".into(),
            name: MCP_NAME.into(),
            transport: None,
            command_or_url: None,
            args: Vec::new(),
            scope: Some("user".into()),
            cwd: None,
        })
        .await;
    }
    Ok(status())
}

#[tauri::command]
pub fn set_capture_detail(detail: String) -> Result<ComputerControlStatus, String> {
    write_capture_detail(CaptureDetail::parse(&detail))?;
    Ok(status())
}

pub async fn prepare_for_product() {
    if !crate::computer::control_state_path().exists() {
        let _ = crate::computer::write_gate(true);
    }
    if crate::computer::gate_enabled() {
        let _ = register_mcp().await;
    }
}

async fn register_mcp() -> Result<(), String> {
    let _ = manage_mcp(McpManageRequest {
        action: "remove".into(),
        name: MCP_NAME.into(),
        transport: None,
        command_or_url: None,
        args: Vec::new(),
        scope: Some("user".into()),
        cwd: None,
    })
    .await;
    manage_mcp(McpManageRequest {
        action: "add".into(),
        name: MCP_NAME.into(),
        transport: Some("http".into()),
        command_or_url: Some(HTTP_URL.into()),
        args: Vec::new(),
        scope: Some("user".into()),
        cwd: None,
    })
    .await
    .map(|_| ())
}
