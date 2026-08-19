mod agent;
mod attachments;
mod billing;
mod bootstrap;
mod cli;
mod computer;
mod computer_control;
mod computer_http;
mod computer_mcp;
mod extensions;
mod history;
mod instance;
mod platform;
mod store;
mod terminal;
mod workspace;

use agent::{
    agent_status, send_agent_message, start_agent, start_agent_advanced, stop_agent, AgentState,
};
use attachments::{import_attachments, import_data_url, import_folder};
use billing::{fetch_account_credits, redeem_usage_reset};
use bootstrap::ensure_runtime;
use cli::{
    cancel_grok_login, check_grok, export_diagnostics, export_grok_session, logout_grok,
    open_external_url, open_preview_url, probe_account, run_cli_probe, start_grok_login,
};
use computer::take_screenshot;
use computer_control::{computer_control_status, set_capture_detail, set_computer_control};
use computer_mcp::run as run_computer_mcp_loop;
use extensions::{import_skill, list_extensions, manage_mcp, open_skills_home};
use history::{
    delete_grok_session, grok_session_usage, import_grok_transcript, list_grok_sessions,
};
use store::{
    append_local_message, delete_local_session, get_settings, list_local_sessions, list_workspaces,
    load_local_messages, load_local_transcript, remove_workspace, save_local_transcript,
    set_setting, upsert_local_session, upsert_workspace, StoreState,
};
use terminal::{
    list_grok_terminals, resize_grok_terminal, start_grok_terminal, stop_grok_terminal,
    write_grok_terminal, TerminalState,
};
use workspace::{
    get_git_diff, get_git_status, list_workspace_directory, read_workspace_file,
    search_workspace_files,
};

pub use computer::MCP_FLAG as COMPUTER_MCP_FLAG;
pub use instance::claim_or_focus_existing;

pub fn run_computer_mcp() {
    run_computer_mcp_loop();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 要在任何子进程 spawn 之前做：Clash 这类代理开「系统代理」模式时，
    // 双击启动的进程没有代理环境变量，Grok CLI 会直连被墙，卡死在准备页。
    platform::adopt_system_proxy();
    tauri::Builder::default()
        .manage(AgentState::default())
        .manage(TerminalState::default())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            use tauri::Manager;
            let data_dir = app
                .path()
                .app_data_dir()
                .map_err(|error| format!("Could not resolve app data directory: {error}"))?;
            app.manage(StoreState::open(&data_dir.join("grok-desk.sqlite3"))?);
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Info)
                    .build(),
            )?;
            computer_http::start();
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                if let (Ok(pos), Ok(size)) = (window.outer_position(), window.outer_size()) {
                    if instance::window_needs_restore(pos.x, pos.y, size.width, size.height) {
                        let _ = window.center();
                    }
                }
                let _ = window.set_focus();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            check_grok,
            ensure_runtime,
            export_diagnostics,
            export_grok_session,
            run_cli_probe,
            start_grok_login,
            cancel_grok_login,
            open_external_url,
            open_preview_url,
            probe_account,
            fetch_account_credits,
            redeem_usage_reset,
            computer_control_status,
            set_computer_control,
            set_capture_detail,
            take_screenshot,
            list_extensions,
            manage_mcp,
            import_skill,
            open_skills_home,
            logout_grok,
            start_agent,
            start_agent_advanced,
            send_agent_message,
            stop_agent,
            agent_status,
            start_grok_terminal,
            write_grok_terminal,
            resize_grok_terminal,
            list_grok_terminals,
            stop_grok_terminal,
            get_settings,
            set_setting,
            upsert_workspace,
            list_workspaces,
            remove_workspace,
            upsert_local_session,
            list_local_sessions,
            delete_local_session,
            append_local_message,
            load_local_messages,
            save_local_transcript,
            load_local_transcript,
            import_grok_transcript,
            list_grok_sessions,
            grok_session_usage,
            delete_grok_session,
            list_workspace_directory,
            search_workspace_files,
            read_workspace_file,
            get_git_status,
            get_git_diff,
            import_attachments,
            import_data_url,
            import_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Grok Desk");
}
