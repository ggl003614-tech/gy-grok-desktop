use std::path::{Path, PathBuf};

pub fn canonical_directory(path: impl AsRef<Path>) -> Result<PathBuf, String> {
    let requested = path.as_ref();
    let canonical = requested
        .canonicalize()
        .map_err(|error| format!("无法打开目录 {}：{error}", requested.display()))?;
    if !canonical.is_dir() {
        return Err(format!("路径不是目录：{}", canonical.display()));
    }
    Ok(strip_verbatim_prefix(canonical))
}

pub fn strip_verbatim_prefix(path: PathBuf) -> PathBuf {
    let text = path.to_string_lossy();
    text.strip_prefix(r"\\?\")
        .map(PathBuf::from)
        .unwrap_or(path)
}

pub fn normalize_cwd_key(path: &str) -> String {
    path.trim()
        .trim_start_matches(r"\\?\")
        .replace('/', "\\")
        .trim_end_matches(['\\', '/'])
        .to_ascii_lowercase()
}

pub fn grok_executable() -> Result<PathBuf, String> {
    if let Some(explicit) = std::env::var_os("GROK_BIN") {
        let path = PathBuf::from(explicit);
        if path.is_file() {
            return Ok(path);
        }
        return Err(format!("GROK_BIN 指向的文件不存在：{}", path.display()));
    }

    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from);
    if let Some(home) = home {
        for candidate in [
            home.join(".grok").join("bin").join("grok.exe"),
            home.join(".grok").join("bin").join("grok"),
        ] {
            if candidate.is_file() {
                return Ok(candidate);
            }
        }
    }

    Ok(PathBuf::from(if cfg!(windows) {
        "grok.exe"
    } else {
        "grok"
    }))
}

/// 双击启动的 GUI 进程环境里没有 HTTPS_PROXY，而 Grok CLI（reqwest）只认
/// 环境变量、不读 Windows 系统代理。Clash 这类工具开「系统代理」模式时，
/// CLI 的流量就会绕开代理直连 —— x.ai 直连不通，登录和对话全部卡死，
/// 界面上看起来就是「一直在准备」。
///
/// 这里把系统代理（WinINET 注册表）翻译成环境变量。只在用户没自己设过时注入，
/// 命令行里显式给的值永远优先。
#[cfg(windows)]
pub fn system_proxy_from_registry() -> Option<String> {
    use std::process::Command as StdCommand;
    // reg.exe 而不是引一个注册表 crate：只读两个值，犯不上加依赖。
    let query = |name: &str| -> Option<String> {
        let output = StdCommand::new("reg")
            .args([
                "query",
                r"HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings",
                "/v",
                name,
            ])
            .output()
            .ok()?;
        let text = String::from_utf8_lossy(&output.stdout).into_owned();
        text.lines()
            .find(|line| line.contains(name))
            .and_then(|line| line.split_whitespace().last())
            .map(str::to_owned)
    };
    let enabled = query("ProxyEnable")?;
    if !enabled.ends_with('1') {
        return None;
    }
    let server = query("ProxyServer")?;
    if server.is_empty() || server.contains(';') {
        // “http=…;https=…” 的分协议写法很少见，先不处理，避免注错。
        return None;
    }
    Some(if server.starts_with("http") {
        server
    } else {
        format!("http://{server}")
    })
}

#[cfg(not(windows))]
pub fn system_proxy_from_registry() -> Option<String> {
    None
}

/// 进程启动早期调用一次：把系统代理写进本进程的环境变量。
/// 之后 spawn 的所有子进程（grok agent、CLI 探针、登录）都会继承。
pub fn adopt_system_proxy() {
    let already_set = [
        "HTTPS_PROXY",
        "https_proxy",
        "HTTP_PROXY",
        "http_proxy",
        "ALL_PROXY",
    ]
    .iter()
    .any(|name| std::env::var_os(name).is_some_and(|value| !value.is_empty()));
    if already_set {
        return;
    }
    if let Some(proxy) = system_proxy_from_registry() {
        std::env::set_var("HTTPS_PROXY", &proxy);
        std::env::set_var("HTTP_PROXY", &proxy);
        // 本机回环别走代理：内置电脑控制和预览面板都在 127.0.0.1 上。
        std::env::set_var("NO_PROXY", "localhost,127.0.0.1,::1");
    }
}

pub fn configure_tokio_command(command: &mut tokio::process::Command) {
    if std::env::var_os("HOME").is_none() {
        if let Some(profile) = std::env::var_os("USERPROFILE") {
            command.env("HOME", profile);
        }
    }

    #[cfg(windows)]
    {
        // Never attach a console. Interactive grok TUI abort (BEX64 / c0000409)
        // is what users see as "the GUI crashed" when login is spawned wrong.
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        command.creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP);
    }
}

pub fn configure_pty_command(command: &mut portable_pty::CommandBuilder) {
    if std::env::var_os("HOME").is_none() {
        if let Some(profile) = std::env::var_os("USERPROFILE") {
            command.env("HOME", profile);
        }
    }
}

pub fn is_safe_xai_https_url(url: &str) -> bool {
    let url = url.trim();
    if url.len() >= 512 || url.contains([' ', '\n', '\r', '\t', '"', '\'', '<', '>', '\\']) {
        return false;
    }
    const PREFIXES: &[&str] = &[
        "https://accounts.x.ai/",
        "https://console.x.ai/",
        "https://grok.com/",
        "https://www.grok.com/",
    ];
    PREFIXES
        .iter()
        .any(|prefix| url == prefix.trim_end_matches('/') || url.starts_with(prefix))
}

pub fn is_safe_preview_url(url: &str) -> bool {
    let url = url.trim();
    if url.len() >= 512 || url.contains([' ', '\n', '\r', '\t', '"', '\'', '<', '>', '\\']) {
        return false;
    }
    [
        "http://localhost",
        "https://localhost",
        "http://127.0.0.1",
        "https://127.0.0.1",
    ]
    .iter()
    .any(|prefix| {
        url == *prefix
            || url.starts_with(&format!("{prefix}/"))
            || url.starts_with(&format!("{prefix}:"))
    })
}

#[cfg(test)]
mod tests {
    use super::{
        canonical_directory, grok_executable, is_safe_preview_url, is_safe_xai_https_url,
        normalize_cwd_key,
    };

    #[test]
    fn rejects_missing_directory() {
        let missing = std::env::temp_dir().join("grok-desk-directory-that-does-not-exist");
        assert!(canonical_directory(missing).is_err());
    }

    #[test]
    fn only_allows_official_login_urls() {
        assert!(is_safe_xai_https_url(
            "https://accounts.x.ai/oauth2/device?user_code=ABCD-EFGH"
        ));
        assert!(is_safe_xai_https_url("https://console.x.ai/"));
        assert!(is_safe_xai_https_url("https://grok.com/"));
        assert!(!is_safe_xai_https_url("http://accounts.x.ai/oauth2/device"));
        assert!(!is_safe_xai_https_url(
            "https://evil.example/accounts.x.ai/oauth2/device"
        ));
        assert!(!is_safe_xai_https_url(
            "https://accounts.x.ai/oauth2/device?user_code=AB CD"
        ));
    }

    #[test]
    fn only_allows_local_preview_urls() {
        assert!(is_safe_preview_url("http://localhost:5173/app"));
        assert!(is_safe_preview_url("http://127.0.0.1:3000"));
        assert!(!is_safe_preview_url("http://localhost.evil.com"));
        assert!(!is_safe_preview_url("https://example.com"));
    }

    #[test]
    fn treats_verbatim_and_plain_windows_paths_as_the_same_project() {
        assert_eq!(
            normalize_cwd_key(r"\\?\D:\GY工作室\"),
            normalize_cwd_key(r"D:/GY工作室")
        );
    }

    #[test]
    fn resolves_grok_binary_without_panicking() {
        let path = grok_executable().expect("grok path resolution must not fail");
        assert!(!path.as_os_str().is_empty());
    }
}
