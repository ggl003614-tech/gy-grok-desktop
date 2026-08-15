use crate::platform::{canonical_directory, configure_tokio_command, grok_executable};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
};
use tokio::{process::Command, time::{timeout, Duration}};

const MAX_SKILL_FILES: usize = 200;
const MAX_SKILL_BYTES: u64 = 8 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServerInfo {
    pub name: String,
    pub transport: String,
    pub target: String,
    pub source_type: String,
    pub source_label: String,
    pub enabled: bool,
    pub managed: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillInfo {
    pub name: String,
    pub description: String,
    pub path: String,
    pub source_type: String,
    pub user_invocable: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionSnapshot {
    pub mcp_servers: Vec<McpServerInfo>,
    pub skills: Vec<SkillInfo>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpManageRequest {
    pub action: String,
    pub name: String,
    #[serde(default)]
    pub transport: Option<String>,
    #[serde(default)]
    pub command_or_url: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub scope: Option<String>,
    #[serde(default)]
    pub cwd: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandResult {
    pub success: bool,
    pub args: Vec<String>,
    pub stdout: String,
    pub stderr: String,
}

pub fn validate_mcp_name(name: &str) -> Result<&str, String> {
    let name = name.trim();
    if name.len() < 1 || name.len() > 64 {
        return Err("MCP 名称长度需要在 1 到 64 个字符之间".into());
    }
    if !name
        .chars()
        .enumerate()
        .all(|(index, character)| {
            character.is_ascii_alphanumeric()
                || character == '_'
                || character == '-'
                || (index > 0 && character == '.')
        })
    {
        return Err("MCP 名称只能使用字母、数字、连字符和下划线".into());
    }
    Ok(name)
}

pub fn validate_mcp_target(transport: &str, value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() || value.len() > 512 || value.contains(['\0', '\n', '\r']) {
        return Err("命令或地址无效".into());
    }
    match transport {
        "http" | "sse" => {
            if !(value.starts_with("https://") || value.starts_with("http://127.0.0.1") || value.starts_with("http://localhost"))
            {
                return Err("远程 MCP 只允许 https，或本机 http://127.0.0.1 / localhost".into());
            }
            if value.contains([' ', '"', '\'', '<', '>', '\\']) {
                return Err("MCP 地址包含不支持的字符".into());
            }
            Ok(value.to_string())
        }
        "stdio" => {
            if value.chars().any(|character| "<>|&;`$\n\r".contains(character)) {
                return Err("MCP 命令包含不支持的字符".into());
            }
            Ok(value.to_string())
        }
        other => Err(format!("不支持的 MCP 传输：{other}")),
    }
}

pub fn sanitize_skill_name(value: &str) -> Result<String, String> {
    let value = value
        .trim()
        .trim_matches(|character: char| !character.is_ascii_alphanumeric() && character != '-' && character != '_')
        .to_ascii_lowercase()
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '-' || character == '_' {
                character
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string();
    if value.is_empty() || value.len() > 64 {
        return Err("无法从技能目录得到合法名称".into());
    }
    Ok(value)
}

pub fn skill_name_from_markdown(text: &str) -> Option<String> {
    let trimmed = text.trim_start_matches('\u{feff}').trim_start();
    let rest = trimmed.strip_prefix("---")?;
    let rest = rest
        .strip_prefix("\r\n")
        .or_else(|| rest.strip_prefix('\n'))?;
    let front = rest.split("\n---").next()?;
    for line in front.lines() {
        let line = line.trim();
        if let Some(name) = line.strip_prefix("name:") {
            let name = name.trim().trim_matches('"').trim_matches('\'');
            if !name.is_empty() {
                return Some(name.to_string());
            }
        }
    }
    None
}

pub fn parse_extension_snapshot(value: &serde_json::Value) -> ExtensionSnapshot {
    let mcp_servers = value
        .get("mcpServers")
        .and_then(|entry| entry.as_array())
        .into_iter()
        .flatten()
        .filter_map(|entry| {
            let name = entry.get("name")?.as_str()?.trim();
            if name.is_empty() {
                return None;
            }
            let source = entry.get("source").cloned().unwrap_or(serde_json::Value::Null);
            let source_type = source
                .get("type")
                .and_then(|item| item.as_str())
                .unwrap_or("user")
                .to_string();
            let source_label = source
                .get("plugin_name")
                .or_else(|| source.get("path"))
                .and_then(|item| item.as_str())
                .unwrap_or(&source_type)
                .to_string();
            let managed = matches!(source_type.as_str(), "user" | "config" | "");
            Some(McpServerInfo {
                name: name.to_string(),
                transport: entry
                    .get("transport")
                    .and_then(|item| item.as_str())
                    .unwrap_or("stdio")
                    .to_string(),
                target: entry
                    .get("target")
                    .and_then(|item| item.as_str())
                    .unwrap_or_default()
                    .to_string(),
                source_type,
                source_label,
                enabled: entry
                    .get("enabled")
                    .and_then(|item| item.as_bool())
                    .or_else(|| {
                        entry
                            .get("compatibilityStatus")
                            .and_then(|item| item.as_str())
                            .map(|status| status != "disabled")
                    })
                    .unwrap_or(true),
                managed,
            })
        })
        .collect();

    let skills = value
        .get("skills")
        .and_then(|entry| entry.as_array())
        .into_iter()
        .flatten()
        .filter_map(|entry| {
            let name = entry.get("name")?.as_str()?.trim();
            if name.is_empty() {
                return None;
            }
            let source = entry.get("source").cloned().unwrap_or(serde_json::Value::Null);
            Some(SkillInfo {
                name: name.to_string(),
                description: entry
                    .get("description")
                    .and_then(|item| item.as_str())
                    .unwrap_or_default()
                    .to_string(),
                path: source
                    .get("path")
                    .and_then(|item| item.as_str())
                    .unwrap_or_default()
                    .to_string(),
                source_type: source
                    .get("type")
                    .and_then(|item| item.as_str())
                    .unwrap_or("user")
                    .to_string(),
                user_invocable: entry
                    .get("userInvocable")
                    .and_then(|item| item.as_bool())
                    .unwrap_or(false),
            })
        })
        .collect();

    ExtensionSnapshot {
        mcp_servers,
        skills,
    }
}

fn grok_home() -> Result<PathBuf, String> {
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .ok_or_else(|| "找不到用户主目录".to_string())?;
    Ok(PathBuf::from(home).join(".grok"))
}

pub fn skills_home() -> Result<PathBuf, String> {
    Ok(grok_home()?.join("skills"))
}

fn build_mcp_args(request: &McpManageRequest) -> Result<Vec<String>, String> {
    let name = validate_mcp_name(&request.name)?;
    match request.action.as_str() {
        "remove" => Ok(vec!["mcp".into(), "remove".into(), name.into()]),
        "enable" => Ok(vec!["mcp".into(), "enable".into(), name.into()]),
        "disable" => Ok(vec!["mcp".into(), "disable".into(), name.into()]),
        "add" => {
            let transport = request
                .transport
                .as_deref()
                .unwrap_or("stdio")
                .trim()
                .to_ascii_lowercase();
            let target = validate_mcp_target(
                &transport,
                request.command_or_url.as_deref().unwrap_or(""),
            )?;
            let scope = match request.scope.as_deref().unwrap_or("user") {
                "project" => "project",
                "user" => "user",
                other => return Err(format!("不支持的 MCP 范围：{other}")),
            };
            let mut args = vec![
                "mcp".into(),
                "add".into(),
                name.into(),
                "--transport".into(),
                transport.clone(),
                "--scope".into(),
                scope.into(),
            ];
            if transport == "stdio" {
                args.push("--".into());
                args.push(target);
                for argument in &request.args {
                    if argument.len() > 256 || argument.contains('\0') {
                        return Err("MCP 参数过长或不合法".into());
                    }
                    args.push(argument.clone());
                }
            } else {
                args.push(target);
            }
            Ok(args)
        }
        other => Err(format!("不支持的 MCP 操作：{other}")),
    }
}

async fn run_grok(args: Vec<String>, cwd: Option<PathBuf>) -> Result<CommandResult, String> {
    let mut command = Command::new(grok_executable()?);
    command.args(&args);
    if let Some(cwd) = cwd {
        command.current_dir(cwd);
    }
    configure_tokio_command(&mut command);
    let output = timeout(Duration::from_secs(45), command.output())
        .await
        .map_err(|_| "Grok 命令超时".to_string())?
        .map_err(|error| format!("无法运行 Grok：{error}"))?;
    Ok(CommandResult {
        success: output.status.success(),
        args,
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
    })
}

#[tauri::command]
pub async fn list_extensions(cwd: Option<String>) -> Result<ExtensionSnapshot, String> {
    let cwd = match cwd.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
        Some(value) => Some(canonical_directory(value)?),
        None => None,
    };
    let result = run_grok(vec!["inspect".into(), "--json".into()], cwd).await?;
    if !result.success {
        return Err(result.stderr.trim().to_string().if_empty("无法读取 Grok 扩展"));
    }
    let value: serde_json::Value = serde_json::from_str(result.stdout.trim())
        .map_err(|error| format!("无法解析 grok inspect：{error}"))?;
    Ok(parse_extension_snapshot(&value))
}

#[tauri::command]
pub async fn manage_mcp(request: McpManageRequest) -> Result<CommandResult, String> {
    let args = build_mcp_args(&request)?;
    let cwd = match request
        .cwd
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(value) => Some(canonical_directory(value)?),
        None => None,
    };
    let result = run_grok(args, cwd).await?;
    if !result.success {
        return Err(result.stderr.trim().to_string().if_empty("MCP 操作失败"));
    }
    Ok(result)
}

#[tauri::command]
pub async fn import_skill(source_dir: String) -> Result<SkillInfo, String> {
    let source = canonical_directory(source_dir)?;
    let skill_file = source.join("SKILL.md");
    if !skill_file.is_file() {
        return Err("所选文件夹里没有 SKILL.md".into());
    }
    let markdown = fs::read_to_string(&skill_file)
        .map_err(|error| format!("无法读取 SKILL.md：{error}"))?;
    let raw_name = skill_name_from_markdown(&markdown)
        .unwrap_or_else(|| {
            source
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("skill")
                .to_string()
        });
    let name = sanitize_skill_name(&raw_name)?;
    let home = skills_home()?;
    fs::create_dir_all(&home).map_err(|error| format!("无法创建技能目录：{error}"))?;
    let destination = home.join(&name);
    if destination.exists() {
        return Err(format!("技能 {name} 已经存在于 ~/.grok/skills"));
    }
    copy_skill_dir(&source, &destination)?;
    Ok(SkillInfo {
        name,
        description: markdown.lines().find(|line| !line.starts_with('-') && !line.is_empty() && !line.starts_with('#'))
            .unwrap_or_default()
            .to_string(),
        path: destination.join("SKILL.md").to_string_lossy().into_owned(),
        source_type: "user".into(),
        user_invocable: true,
    })
}

#[tauri::command]
pub async fn open_skills_home() -> Result<String, String> {
    let home = skills_home()?;
    fs::create_dir_all(&home).map_err(|error| format!("无法创建技能目录：{error}"))?;
    open_directory(&home)?;
    Ok(home.to_string_lossy().into_owned())
}

fn copy_skill_dir(source: &Path, destination: &Path) -> Result<(), String> {
    let mut files = 0usize;
    let mut bytes = 0u64;
    copy_skill_walk(source, destination, &mut files, &mut bytes)
}

fn copy_skill_walk(
    source: &Path,
    destination: &Path,
    files: &mut usize,
    bytes: &mut u64,
) -> Result<(), String> {
    fs::create_dir_all(destination).map_err(|error| format!("无法创建 {destination:?}：{error}"))?;
    for entry in fs::read_dir(source).map_err(|error| format!("无法读取技能目录：{error}"))? {
        let entry = entry.map_err(|error| format!("无法读取技能文件：{error}"))?;
        let name = entry.file_name();
        let name_text = name.to_string_lossy();
        if matches!(
            name_text.as_ref(),
            ".git" | "node_modules" | "__pycache__" | ".DS_Store" | "Thumbs.db"
        ) {
            continue;
        }
        let file_type = entry
            .file_type()
            .map_err(|error| format!("无法判断文件类型：{error}"))?;
        if file_type.is_symlink() {
            return Err("技能目录不能包含符号链接".into());
        }
        let from = entry.path();
        let to = destination.join(&name);
        if file_type.is_dir() {
            copy_skill_walk(&from, &to, files, bytes)?;
            continue;
        }
        *files += 1;
        if *files > MAX_SKILL_FILES {
            return Err("技能文件数量超过限制".into());
        }
        let metadata = entry
            .metadata()
            .map_err(|error| format!("无法读取文件大小：{error}"))?;
        *bytes += metadata.len();
        if *bytes > MAX_SKILL_BYTES {
            return Err("技能体积超过 8 MB".into());
        }
        fs::copy(&from, &to).map_err(|error| format!("无法复制技能文件：{error}"))?;
    }
    Ok(())
}

fn open_directory(path: &Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        std::process::Command::new("explorer")
            .arg(path)
            .spawn()
            .map_err(|error| format!("无法打开文件夹：{error}"))?;
        return Ok(());
    }
    #[cfg(not(windows))]
    {
        std::process::Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|error| format!("无法打开文件夹：{error}"))?;
        Ok(())
    }
}

trait IfEmpty {
    fn if_empty(self, fallback: &str) -> String;
}

impl IfEmpty for String {
    fn if_empty(self, fallback: &str) -> String {
        if self.is_empty() {
            fallback.to_string()
        } else {
            self
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        parse_extension_snapshot, sanitize_skill_name, skill_name_from_markdown, validate_mcp_name,
        validate_mcp_target,
    };

    #[test]
    fn validates_mcp_names_and_targets() {
        assert!(validate_mcp_name("github").is_ok());
        assert!(validate_mcp_name("../x").is_err());
        assert!(validate_mcp_target("http", "https://mcp.example.com/mcp").is_ok());
        assert!(validate_mcp_target("http", "http://evil.example").is_err());
        assert!(validate_mcp_target("stdio", "npx").is_ok());
        assert!(validate_mcp_target("stdio", "rm && echo").is_err());
    }

    #[test]
    fn sanitizes_skill_names() {
        assert_eq!(sanitize_skill_name("My Skill").unwrap(), "my-skill");
        assert!(sanitize_skill_name("***").is_err());
        assert_eq!(
            skill_name_from_markdown("---\nname: commit\ndescription: x\n---\n# Hi\n").as_deref(),
            Some("commit")
        );
    }

    #[test]
    fn parses_inspect_extensions() {
        let value = serde_json::json!({
            "mcpServers": [
                {"name": "livemap", "transport": "stdio", "target": "python", "source": {"type": "claudeJson", "path": "C:/x"}},
                {"name": "mine", "transport": "http", "target": "https://mcp.example.com"}
            ],
            "skills": [
                {"name": "review", "description": "Review code", "userInvocable": true, "source": {"type": "user", "path": "C:/skills/review/SKILL.md"}}
            ]
        });
        let snapshot = parse_extension_snapshot(&value);
        assert_eq!(snapshot.mcp_servers.len(), 2);
        assert!(!snapshot.mcp_servers[0].managed);
        assert!(snapshot.mcp_servers[1].managed);
        assert_eq!(snapshot.skills[0].name, "review");
    }
}
