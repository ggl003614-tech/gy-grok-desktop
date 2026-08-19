//! First-run runtime for the shipped app: install official Grok CLI if missing,
//! then wire built-in computer control. No separate backend for the user to start.

use crate::cli::check_grok;
use crate::computer_control::prepare_for_product;
use crate::platform::grok_executable;
use serde::Serialize;
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    time::Duration,
};
use tauri::{AppHandle, Emitter};

const CHANNEL_URLS: &[&str] = &[
    "https://x.ai/cli/stable",
    "https://storage.googleapis.com/grok-build-public-artifacts/cli/stable",
];

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BootstrapEvent {
    phase: &'static str,
    message: String,
    percent: Option<u8>,
}

pub fn is_official_cli_url(url: &str) -> bool {
    let url = url.trim();
    if url.len() >= 512 || url.contains([' ', '\n', '\r', '\t', '"', '\'', '<', '>', '\\']) {
        return false;
    }
    url.starts_with("https://x.ai/cli/")
        || url.starts_with("https://storage.googleapis.com/grok-build-public-artifacts/cli/")
}

pub fn parse_channel_version(text: &str) -> Result<String, String> {
    let version = text.trim();
    if version.len() > 32
        || !version
            .chars()
            .next()
            .is_some_and(|character| character.is_ascii_digit())
        || !version
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '.' | '-'))
    {
        return Err("官方版本号无效".into());
    }
    Ok(version.to_string())
}

pub fn cli_platform() -> Result<&'static str, String> {
    match std::env::consts::ARCH {
        "x86_64" => Ok("windows-x86_64"),
        "aarch64" => Ok("windows-aarch64"),
        other => Err(format!("当前系统架构暂不支持自动安装：{other}")),
    }
}

fn grok_home() -> Result<PathBuf, String> {
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .ok_or_else(|| "找不到用户主目录".to_string())?;
    Ok(PathBuf::from(home).join(".grok"))
}

fn emit(app: &AppHandle, phase: &'static str, message: impl Into<String>, percent: Option<u8>) {
    let _ = app.emit(
        "grok-bootstrap",
        BootstrapEvent {
            phase,
            message: message.into(),
            percent,
        },
    );
}

fn fetch_text(url: &str) -> Result<String, String> {
    if !is_official_cli_url(url) {
        return Err("拒绝非官方下载地址".into());
    }
    ureq::get(url)
        .timeout(Duration::from_secs(30))
        .call()
        .map_err(|error| format!("无法读取官方版本：{error}"))?
        .into_string()
        .map_err(|error| format!("无法读取官方版本：{error}"))
}

fn resolve_version() -> Result<(String, &'static str), String> {
    let mut last = "无法读取官方版本".to_string();
    for url in CHANNEL_URLS {
        match fetch_text(url).and_then(|text| parse_channel_version(&text)) {
            Ok(version) => {
                let base = url.trim_end_matches("/stable");
                return Ok((version, base));
            }
            Err(error) => last = error,
        }
    }
    Err(last)
}

fn download_file(app: &AppHandle, url: &str, dest: &Path) -> Result<(), String> {
    if !is_official_cli_url(url) {
        return Err("拒绝非官方下载地址".into());
    }
    let response = ureq::get(url)
        .timeout(Duration::from_secs(300))
        .call()
        .map_err(|error| format!("下载官方 Grok 失败：{error}"))?;
    let total = response
        .header("Content-Length")
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(0);
    let mut reader = response.into_reader();
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("无法创建下载目录：{error}"))?;
    }
    let mut file = fs::File::create(dest).map_err(|error| format!("无法写入下载文件：{error}"))?;
    let mut buffer = [0_u8; 65_536];
    let mut copied = 0_u64;
    let mut last_percent = 255_u8;
    loop {
        let read = reader
            .read(&mut buffer)
            .map_err(|error| format!("下载中断：{error}"))?;
        if read == 0 {
            break;
        }
        file.write_all(&buffer[..read])
            .map_err(|error| format!("写入下载失败：{error}"))?;
        copied += read as u64;
        if let Some(ratio) = copied.saturating_mul(100).checked_div(total) {
            let percent = ratio.min(99) as u8;
            if percent != last_percent {
                emit(
                    app,
                    "download",
                    format!("正在下载官方 Grok Build… {percent}%"),
                    Some(percent),
                );
                last_percent = percent;
            }
        }
    }
    file.flush()
        .map_err(|error| format!("保存下载失败：{error}"))?;
    if copied < 1_000_000 {
        let _ = fs::remove_file(dest);
        return Err("官方安装包异常偏小，已取消安装".into());
    }
    Ok(())
}

fn replace_file(source: &Path, dest: &Path) -> Result<(), String> {
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("无法创建 Grok 目录：{error}"))?;
    }
    match fs::copy(source, dest) {
        Ok(_) => Ok(()),
        Err(_) => {
            let old = dest.with_extension("exe.old");
            let _ = fs::remove_file(&old);
            if dest.exists() {
                fs::rename(dest, &old)
                    .map_err(|error| format!("无法替换已占用的 Grok：{error}"))?;
            }
            fs::copy(source, dest).map_err(|error| format!("无法安装 Grok：{error}"))?;
            Ok(())
        }
    }
}

fn install_official_cli(app: &AppHandle) -> Result<PathBuf, String> {
    emit(app, "resolve", "正在读取官方 Grok 版本…", Some(2));
    let platform = cli_platform()?;
    let (version, base) = resolve_version()?;
    emit(
        app,
        "resolve",
        format!("准备安装官方 Grok {version}"),
        Some(8),
    );
    let home = grok_home()?;
    let download = home.join("downloads").join(format!("grok-{platform}.exe"));
    let mut last_error = "下载失败".to_string();
    let mut downloaded = false;
    for suffix in [".exe", ""] {
        let url = format!("{base}/grok-{version}-{platform}{suffix}");
        match download_file(app, &url, &download) {
            Ok(()) => {
                downloaded = true;
                break;
            }
            Err(error) => last_error = error,
        }
    }
    if !downloaded {
        return Err(last_error);
    }
    emit(app, "install", "正在写入官方 Grok…", Some(92));
    let bin = home.join("bin");
    replace_file(&download, &bin.join("grok.exe"))?;
    replace_file(&download, &bin.join("agent.exe"))?;
    emit(app, "install", "官方 Grok Build 已安装", Some(100));
    Ok(bin.join("grok.exe"))
}

#[tauri::command]
pub async fn ensure_runtime(app: AppHandle) -> Result<crate::cli::GrokStatus, String> {
    let status = check_grok().await;
    if !status.available {
        emit(
            &app,
            "install",
            "本机还没有 Grok Build，软件正在自动安装官方 CLI…",
            Some(1),
        );
        let app_for_download = app.clone();
        tokio::task::spawn_blocking(move || install_official_cli(&app_for_download))
            .await
            .map_err(|error| format!("安装任务中断：{error}"))??;
    }
    emit(&app, "computer", "正在接通内置电脑控制…", None);
    prepare_for_product().await;
    let ready = check_grok().await;
    if !ready.available {
        return Err(ready
            .error
            .clone()
            .unwrap_or_else(|| "官方 Grok 安装后仍无法运行".into()));
    }
    let _ = grok_executable();
    emit(&app, "ready", "GY Grok 已就绪", Some(100));
    Ok(ready)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_accepts_official_cli_urls() {
        assert!(is_official_cli_url("https://x.ai/cli/stable"));
        assert!(is_official_cli_url(
            "https://x.ai/cli/grok-1.0.3-windows-x86_64.exe"
        ));
        assert!(is_official_cli_url(
            "https://storage.googleapis.com/grok-build-public-artifacts/cli/stable"
        ));
        assert!(!is_official_cli_url("https://evil.example/x.ai/cli/stable"));
        assert!(!is_official_cli_url("http://x.ai/cli/stable"));
    }

    #[test]
    fn parses_official_version_text() {
        assert_eq!(parse_channel_version("1.0.3\n").unwrap(), "1.0.3");
        assert!(parse_channel_version("latest").is_err());
        assert!(parse_channel_version("../evil").is_err());
    }
}
