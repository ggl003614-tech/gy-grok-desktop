//! 应用自身的更新检查。
//!
//! 走 GitHub Releases API 而不是 Tauri 的 updater：后者要签名密钥和一份托管的
//! 更新清单，为一个自用工具搭那套不值当。这里只回答一个问题 ——
//! 「仓库上有没有比我新的版本」，下载和安装交给用户点链接。
//!
//! 注意跟 CommandCenter 里那个「更新」区分开：那个查的是 Grok CLI，不是本应用。

use serde::{Deserialize, Serialize};
use std::time::Duration;

const RELEASES_URL: &str =
    "https://api.github.com/repos/ggl003614-tech/gy-grok-desktop/releases/latest";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheck {
    pub current: String,
    /// 远端最新版本号（去掉 v 前缀）。仓库还没发过 release 时是 None。
    pub latest: Option<String>,
    pub newer: bool,
    /// release 页面地址，给用户点。
    pub url: Option<String>,
    pub notes: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GithubRelease {
    tag_name: Option<String>,
    html_url: Option<String>,
    body: Option<String>,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    prerelease: bool,
}

/// 把 "v0.2.1" / "0.2.1-beta" 拆成可比较的数字段。
/// 认不出来的段当 0 —— 宁可判成「不是更新」，也不要提示一个假更新。
fn parse_version(raw: &str) -> Vec<u64> {
    raw.trim()
        .trim_start_matches(['v', 'V'])
        .split(['-', '+'])
        .next()
        .unwrap_or("")
        .split('.')
        .map(|part| part.parse::<u64>().unwrap_or(0))
        .collect()
}

/// 远端是不是严格新于本地。段数不同时短的那边补 0（0.2 == 0.2.0）。
pub fn is_newer(latest: &str, current: &str) -> bool {
    let (a, b) = (parse_version(latest), parse_version(current));
    if a.is_empty() {
        return false;
    }
    let len = a.len().max(b.len());
    for index in 0..len {
        let left = a.get(index).copied().unwrap_or(0);
        let right = b.get(index).copied().unwrap_or(0);
        if left != right {
            return left > right;
        }
    }
    false
}

fn current_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

fn fetch_latest() -> Result<GithubRelease, String> {
    let response = ureq::get(RELEASES_URL)
        // GitHub 拒绝没有 User-Agent 的请求。
        .set("User-Agent", "GY-Grok-Desktop")
        .set("Accept", "application/vnd.github+json")
        .timeout(Duration::from_secs(15))
        .call()
        .map_err(|error| match error {
            // 还没发过 release 时 API 返回 404，这不是错误，是「暂无版本」。
            ureq::Error::Status(404, _) => "no-release".to_string(),
            other => format!("连接 GitHub 失败：{other}"),
        })?;
    response
        .into_json::<GithubRelease>()
        .map_err(|error| format!("解析 GitHub 返回失败：{error}"))
}

#[tauri::command]
pub async fn check_app_update() -> Result<UpdateCheck, String> {
    let current = current_version();
    let outcome = tokio::task::spawn_blocking(fetch_latest)
        .await
        .map_err(|error| format!("检查更新任务中断：{error}"))?;

    match outcome {
        Ok(release) if release.draft || release.prerelease => Ok(UpdateCheck {
            current,
            latest: None,
            newer: false,
            url: None,
            notes: None,
            error: None,
        }),
        Ok(release) => {
            let latest = release
                .tag_name
                .map(|tag| tag.trim_start_matches(['v', 'V']).to_string())
                .filter(|tag| !tag.is_empty());
            let newer = latest
                .as_deref()
                .map(|tag| is_newer(tag, &current))
                .unwrap_or(false);
            Ok(UpdateCheck {
                current,
                latest,
                newer,
                url: release.html_url,
                notes: release.body.filter(|body| !body.trim().is_empty()),
                error: None,
            })
        }
        // 网络不通或仓库还没发版都不该弹错误红字，如实说明即可。
        Err(reason) => Ok(UpdateCheck {
            current,
            latest: None,
            newer: false,
            url: None,
            notes: None,
            error: Some(reason),
        }),
    }
}

/// CLI 那边的版本情况。跟本应用的更新是两码事 —— 一个是这个 GUI，
/// 一个是官方的 grok 命令行，用户很容易混，所以界面上分两块显示。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliUpdateCheck {
    /// 本机装的版本。`grok --version` 输出形如 "grok 1.0.5 (5115b46bc9)"。
    pub current: Option<String>,
    /// 官方稳定版频道上的版本，纯数字串如 "1.0.5"。
    pub latest: Option<String>,
    pub newer: bool,
    pub error: Option<String>,
}

/// 从 `grok --version` 的输出里取版本号。
/// 输出是 "grok 1.0.5 (5115b46bc9)"，取第一个像版本号的段。
pub fn parse_cli_version(raw: &str) -> Option<String> {
    raw.split_whitespace()
        .find(|part| part.chars().next().is_some_and(|c| c.is_ascii_digit()) && part.contains('.'))
        .map(|part| {
            part.trim_matches(|c: char| !c.is_ascii_alphanumeric() && c != '.')
                .to_string()
        })
        .filter(|part| !part.is_empty())
}

#[tauri::command]
pub async fn check_cli_update() -> Result<CliUpdateCheck, String> {
    let status = crate::cli::check_grok().await;
    let current = status.version.as_deref().and_then(parse_cli_version);

    let latest = tokio::task::spawn_blocking(crate::bootstrap::resolve_version)
        .await
        .map_err(|error| format!("检查 CLI 更新任务中断：{error}"))?;

    match latest {
        Ok((version, _base)) => {
            let newer = current
                .as_deref()
                .map(|now| is_newer(&version, now))
                // 读不到本机版本时不敢说「有更新」—— 那会让人白跑一趟。
                .unwrap_or(false);
            Ok(CliUpdateCheck {
                current,
                latest: Some(version),
                newer,
                error: None,
            })
        }
        Err(reason) => Ok(CliUpdateCheck {
            current,
            latest: None,
            newer: false,
            error: Some(reason),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compares_semver_parts() {
        assert!(is_newer("0.2.0", "0.1.0"));
        assert!(is_newer("1.0.0", "0.9.9"));
        assert!(is_newer("0.1.1", "0.1.0"));
        assert!(!is_newer("0.1.0", "0.1.0"));
        assert!(!is_newer("0.1.0", "0.2.0"));
    }

    #[test]
    fn tolerates_v_prefix_and_suffixes() {
        assert!(is_newer("v0.2.0", "0.1.0"));
        assert!(is_newer("V0.2.0", "v0.1.0"));
        // 预发布后缀不参与比较，只看数字段
        assert!(is_newer("0.2.0-beta.1", "0.1.0"));
        assert!(!is_newer("0.1.0-beta", "0.1.0"));
    }

    #[test]
    fn pads_missing_parts() {
        assert!(!is_newer("0.1", "0.1.0"));
        assert!(is_newer("0.2", "0.1.9"));
    }

    #[test]
    fn garbage_never_claims_an_update() {
        // 认不出来就别提示更新 —— 假更新比不提示更糟
        assert!(!is_newer("", "0.1.0"));
        assert!(!is_newer("latest", "0.1.0"));
        assert!(!is_newer("not-a-version", "0.1.0"));
    }

    #[test]
    fn reads_version_out_of_cli_banner() {
        // 真实输出："grok 1.0.5 (5115b46bc9)"
        assert_eq!(
            parse_cli_version("grok 1.0.5 (5115b46bc9)").as_deref(),
            Some("1.0.5")
        );
        assert_eq!(parse_cli_version("grok 1.0.5").as_deref(), Some("1.0.5"));
        assert_eq!(
            parse_cli_version("  grok  2.10.3-beta  ").as_deref(),
            Some("2.10.3-beta")
        );
    }

    #[test]
    fn cli_banner_without_a_version_yields_none() {
        assert_eq!(parse_cli_version("grok"), None);
        assert_eq!(parse_cli_version(""), None);
        // 提交哈希不带点，不能被当成版本号
        assert_eq!(parse_cli_version("grok (5115b46bc9)"), None);
    }
}
