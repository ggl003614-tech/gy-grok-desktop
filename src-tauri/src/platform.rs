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
        return Err(format!(
            "GROK_BIN 指向的文件不存在：{}",
            path.display()
        ));
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
    PREFIXES.iter().any(|prefix| {
        url == prefix.trim_end_matches('/') || url.starts_with(prefix)
    })
}

pub fn is_safe_preview_url(url: &str) -> bool {
    let url = url.trim();
    if url.len() >= 512 || url.contains([' ', '\n', '\r', '\t', '"', '\'', '<', '>', '\\']) {
        return false;
    }
    ["http://localhost", "https://localhost", "http://127.0.0.1", "https://127.0.0.1"]
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
