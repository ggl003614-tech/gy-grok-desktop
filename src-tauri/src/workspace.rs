use crate::platform::{canonical_directory, configure_tokio_command};
use serde::Serialize;
use std::{
    path::{Component, Path, PathBuf},
    time::UNIX_EPOCH,
};
use tokio::{process::Command, time::timeout};

const MAX_FILE_BYTES: usize = 2 * 1024 * 1024;
const MAX_DIFF_BYTES: usize = 4 * 1024 * 1024;
const MAX_DIRECTORY_ENTRIES: usize = 5_000;
const MAX_SEARCH_ENTRIES: usize = 50_000;
const MAX_SEARCH_RESULTS: usize = 250;
const MAX_SEARCH_DEPTH: usize = 24;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    path: String,
    name: String,
    is_directory: bool,
    is_symlink: bool,
    size: u64,
    modified_at: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileContent {
    path: String,
    content: String,
    size: usize,
    line_count: usize,
    truncated: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitChange {
    path: String,
    original_path: Option<String>,
    index_status: String,
    worktree_status: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    is_repository: bool,
    branch: Option<String>,
    upstream: Option<String>,
    ahead: u32,
    behind: u32,
    changes: Vec<GitChange>,
    error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiff {
    path: Option<String>,
    staged: bool,
    content: String,
    truncated: bool,
}

fn validate_relative_path(path: &str) -> Result<PathBuf, String> {
    let candidate = Path::new(path);
    if candidate.is_absolute()
        || candidate.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err("Workspace path must be relative and cannot escape its root".into());
    }
    Ok(candidate.to_path_buf())
}

fn resolve_existing(root: &str, relative: &str) -> Result<(PathBuf, PathBuf), String> {
    let root = canonical_directory(root)?;
    let relative = validate_relative_path(relative)?;
    let target = root
        .join(relative)
        .canonicalize()
        .map_err(|error| format!("Could not resolve workspace path: {error}"))?;
    if !target.starts_with(&root) {
        return Err("Workspace path escapes its root".into());
    }
    Ok((root, target))
}

fn relative_string(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

#[tauri::command]
pub fn list_workspace_directory(root: String, relative: String) -> Result<Vec<FileEntry>, String> {
    let (root, directory) = resolve_existing(&root, &relative)?;
    if !directory.is_dir() {
        return Err("Requested workspace path is not a directory".into());
    }
    let mut entries = Vec::new();
    let reader = std::fs::read_dir(&directory)
        .map_err(|error| format!("Could not read workspace directory: {error}"))?;
    for entry in reader.take(MAX_DIRECTORY_ENTRIES) {
        let entry = entry.map_err(|error| format!("Could not read directory entry: {error}"))?;
        let path = entry.path();
        let metadata = std::fs::symlink_metadata(&path)
            .map_err(|error| format!("Could not read file metadata: {error}"))?;
        entries.push(FileEntry {
            path: relative_string(&root, &path),
            name: entry.file_name().to_string_lossy().into_owned(),
            is_directory: metadata.is_dir(),
            is_symlink: metadata.file_type().is_symlink(),
            size: metadata.len(),
            modified_at: metadata
                .modified()
                .ok()
                .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
                .map(|duration| duration.as_millis().min(u64::MAX as u128) as u64),
        });
    }
    entries.sort_by(|left, right| {
        right
            .is_directory
            .cmp(&left.is_directory)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    Ok(entries)
}

fn ignored_search_directory(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        ".git" | "node_modules" | "target" | "dist" | "build" | ".next" | ".cache" | ".turbo"
    )
}

#[tauri::command]
pub fn search_workspace_files(root: String, query: String) -> Result<Vec<FileEntry>, String> {
    let root = canonical_directory(root)?;
    let query = query.trim().to_lowercase();
    if query.is_empty() || query.len() > 120 {
        return Err("Search query must contain between 1 and 120 characters".into());
    }

    let mut results = Vec::new();
    let mut stack = vec![(root.clone(), 0usize)];
    let mut visited = 0usize;
    while let Some((directory, depth)) = stack.pop() {
        if visited >= MAX_SEARCH_ENTRIES || results.len() >= MAX_SEARCH_RESULTS {
            break;
        }
        let reader = match std::fs::read_dir(&directory) {
            Ok(reader) => reader,
            Err(_) => continue,
        };
        for entry in reader {
            if visited >= MAX_SEARCH_ENTRIES || results.len() >= MAX_SEARCH_RESULTS {
                break;
            }
            visited += 1;
            let Ok(entry) = entry else { continue };
            let path = entry.path();
            let Ok(metadata) = std::fs::symlink_metadata(&path) else {
                continue;
            };
            if metadata.file_type().is_symlink() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            let is_directory = metadata.is_dir();
            if is_directory && ignored_search_directory(&name) {
                continue;
            }
            let relative = relative_string(&root, &path);
            if relative.to_lowercase().contains(&query) {
                results.push(FileEntry {
                    path: relative,
                    name,
                    is_directory,
                    is_symlink: false,
                    size: metadata.len(),
                    modified_at: metadata
                        .modified()
                        .ok()
                        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
                        .map(|duration| duration.as_millis().min(u64::MAX as u128) as u64),
                });
            }
            if is_directory && depth < MAX_SEARCH_DEPTH {
                stack.push((path, depth + 1));
            }
        }
    }
    results.sort_by_key(|entry| entry.path.to_lowercase());
    Ok(results)
}

#[tauri::command]
pub fn read_workspace_file(root: String, relative: String) -> Result<FileContent, String> {
    let (root, file) = resolve_existing(&root, &relative)?;
    if !file.is_file() {
        return Err("Requested workspace path is not a file".into());
    }
    let bytes = std::fs::read(&file).map_err(|error| format!("Could not read file: {error}"))?;
    if bytes.iter().take(8_192).any(|byte| *byte == 0) {
        return Err("Binary files cannot be previewed as text".into());
    }
    let truncated = bytes.len() > MAX_FILE_BYTES;
    let bounded = &bytes[..bytes.len().min(MAX_FILE_BYTES)];
    let content = String::from_utf8_lossy(bounded).into_owned();
    Ok(FileContent {
        path: relative_string(&root, &file),
        size: bytes.len(),
        line_count: content.lines().count(),
        content,
        truncated,
    })
}

async fn run_git(root: &Path, args: &[String]) -> Result<std::process::Output, String> {
    let mut command = Command::new("git");
    command.args(args).current_dir(root);
    configure_tokio_command(&mut command);
    timeout(std::time::Duration::from_secs(30), command.output())
        .await
        .map_err(|_| "Git command timed out after 30 seconds".to_string())?
        .map_err(|error| format!("Could not run Git: {error}"))
}

fn parse_branch_header(header: &str) -> (Option<String>, Option<String>, u32, u32) {
    let value = header.trim_start_matches("## ");
    let (name, rest) = value
        .split_once("...")
        .map(|(left, right)| (left, Some(right)))
        .unwrap_or((value, None));
    let branch = (!name.is_empty()).then(|| name.to_owned());
    let mut upstream = None;
    let mut ahead = 0;
    let mut behind = 0;
    if let Some(rest) = rest {
        let remote = rest.split(" [").next().unwrap_or(rest);
        upstream = (!remote.is_empty()).then(|| remote.to_owned());
        if let Some(details) = rest.split_once(" [").map(|(_, details)| details) {
            for part in details.trim_end_matches(']').split(", ") {
                if let Some(value) = part.strip_prefix("ahead ") {
                    ahead = value.parse().unwrap_or(0);
                } else if let Some(value) = part.strip_prefix("behind ") {
                    behind = value.parse().unwrap_or(0);
                }
            }
        }
    }
    (branch, upstream, ahead, behind)
}

#[tauri::command]
pub async fn get_git_status(root: String) -> Result<GitStatus, String> {
    let root = canonical_directory(root)?;
    let args = vec![
        "status".into(),
        "--porcelain=v1".into(),
        "--branch".into(),
        "-z".into(),
        "--untracked-files=all".into(),
    ];
    let output = run_git(&root, &args).await?;
    if !output.status.success() {
        let error = String::from_utf8_lossy(&output.stderr).trim().to_owned();
        return Ok(GitStatus {
            is_repository: false,
            branch: None,
            upstream: None,
            ahead: 0,
            behind: 0,
            changes: Vec::new(),
            error: Some(error),
        });
    }

    let mut records = output.stdout.split(|byte| *byte == 0).peekable();
    let mut branch = None;
    let mut upstream = None;
    let mut ahead = 0;
    let mut behind = 0;
    let mut changes = Vec::new();
    while let Some(record) = records.next() {
        if record.is_empty() {
            continue;
        }
        let record = String::from_utf8_lossy(record);
        if record.starts_with("## ") {
            (branch, upstream, ahead, behind) = parse_branch_header(&record);
            continue;
        }
        if record.len() < 3 {
            continue;
        }
        let index_status = record[0..1].to_owned();
        let worktree_status = record[1..2].to_owned();
        let path = record[3..].to_owned();
        let original_path = if index_status == "R" || index_status == "C" {
            records
                .next()
                .filter(|value| !value.is_empty())
                .map(|value| String::from_utf8_lossy(value).into_owned())
        } else {
            None
        };
        changes.push(GitChange {
            path,
            original_path,
            index_status,
            worktree_status,
        });
    }
    Ok(GitStatus {
        is_repository: true,
        branch,
        upstream,
        ahead,
        behind,
        changes,
        error: None,
    })
}

#[tauri::command]
pub async fn get_git_diff(
    root: String,
    path: Option<String>,
    staged: bool,
) -> Result<GitDiff, String> {
    let root = canonical_directory(root)?;
    let path = path
        .map(|value| {
            validate_relative_path(&value)?;
            Ok::<String, String>(value.replace('\\', "/"))
        })
        .transpose()?;
    let mut args = vec![
        "diff".into(),
        "--no-ext-diff".into(),
        "--no-color".into(),
        "--unified=3".into(),
    ];
    if staged {
        args.push("--cached".into());
    }
    if let Some(path) = &path {
        args.push("--".into());
        args.push(path.clone());
    }
    let output = run_git(&root, &args).await?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_owned());
    }
    let truncated = output.stdout.len() > MAX_DIFF_BYTES;
    let content =
        String::from_utf8_lossy(&output.stdout[..output.stdout.len().min(MAX_DIFF_BYTES)])
            .into_owned();
    Ok(GitDiff {
        path,
        staged,
        content,
        truncated,
    })
}

#[cfg(test)]
mod tests {
    use super::{parse_branch_header, validate_relative_path};

    #[test]
    fn rejects_workspace_escape_paths() {
        assert!(validate_relative_path("src/main.rs").is_ok());
        assert!(validate_relative_path("../secret.txt").is_err());
        assert!(validate_relative_path("C:\\secret.txt").is_err());
    }

    #[test]
    fn parses_git_branch_tracking_status() {
        let (branch, upstream, ahead, behind) =
            parse_branch_header("## main...origin/main [ahead 2, behind 1]");
        assert_eq!(branch.as_deref(), Some("main"));
        assert_eq!(upstream.as_deref(), Some("origin/main"));
        assert_eq!(ahead, 2);
        assert_eq!(behind, 1);
    }
}
