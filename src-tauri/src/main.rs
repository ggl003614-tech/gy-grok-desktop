// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    std::panic::set_hook(Box::new(|info| {
        let path = std::env::temp_dir().join("grok-desk-panic.log");
        let body = format!("{info}\n");
        let _ = std::fs::write(&path, &body);
        eprintln!("Grok Desk panic: {info}");
    }));
    if std::env::args()
        .skip(1)
        .any(|arg| arg == grok_desk_lib::COMPUTER_MCP_FLAG)
    {
        grok_desk_lib::run_computer_mcp();
        return;
    }
    if !grok_desk_lib::claim_or_focus_existing() {
        return;
    }
    grok_desk_lib::run();
}
