use crate::platform::canonical_directory;
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
};
use uuid::Uuid;

const MAX_FILES: usize = 12;
const MAX_FILE_BYTES: u64 = 25 * 1024 * 1024;
const MAX_TEXT_EMBED: usize = 256 * 1024;
const MAX_IMAGE_PREVIEW: usize = 1_500_000;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedAttachment {
    pub id: String,
    pub name: String,
    pub stored_path: String,
    pub absolute_path: String,
    pub mime: String,
    pub size: u64,
    pub kind: String,
    pub text: Option<String>,
    pub data_url: Option<String>,
}

fn sanitize_file_name(name: &str) -> String {
    let trimmed = Path::new(name)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("file");
    let cleaned: String = trimmed
        .chars()
        .map(|character| {
            if character.is_alphanumeric() || matches!(character, '.' | '-' | '_' | ' ') {
                character
            } else {
                '_'
            }
        })
        .collect();
    let cleaned = cleaned.trim().trim_start_matches('.');
    if cleaned.is_empty() {
        "file".into()
    } else {
        cleaned.chars().take(80).collect()
    }
}

fn mime_and_kind(path: &Path) -> (&'static str, &'static str) {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => ("image/png", "image"),
        "jpg" | "jpeg" => ("image/jpeg", "image"),
        "gif" => ("image/gif", "image"),
        "webp" => ("image/webp", "image"),
        "bmp" => ("image/bmp", "image"),
        "svg" => ("image/svg+xml", "image"),
        "txt" | "md" | "json" | "csv" | "log" | "toml" | "yaml" | "yml" | "xml" | "html"
        | "css" | "js" | "ts" | "tsx" | "jsx" | "rs" | "py" | "go" | "java" => {
            ("text/plain", "text")
        }
        "pdf" => ("application/pdf", "file"),
        other if !other.is_empty() => ("application/octet-stream", "file"),
        _ => ("application/octet-stream", "file"),
    }
}

fn inbox_dir(root: &Path) -> Result<PathBuf, String> {
    let directory = root.join(".grok-desk").join("inbox");
    fs::create_dir_all(&directory).map_err(|error| format!("无法创建附件目录：{error}"))?;
    Ok(directory)
}

#[tauri::command]
pub fn import_attachments(
    root: String,
    paths: Vec<String>,
) -> Result<Vec<ImportedAttachment>, String> {
    if paths.is_empty() {
        return Ok(Vec::new());
    }
    if paths.len() > MAX_FILES {
        return Err(format!("一次最多附加 {MAX_FILES} 个文件"));
    }
    let root = canonical_directory(root)?;
    let inbox = inbox_dir(&root)?;
    let mut imported = Vec::new();

    for path in paths {
        let source = PathBuf::from(path.trim());
        if !source.is_file() {
            return Err(format!("不是文件：{}", source.display()));
        }
        let metadata =
            fs::metadata(&source).map_err(|error| format!("无法读取文件信息：{error}"))?;
        if metadata.len() > MAX_FILE_BYTES {
            return Err(format!(
                "{} 超过 {} MB",
                source.display(),
                MAX_FILE_BYTES / 1024 / 1024
            ));
        }
        let name = sanitize_file_name(
            source
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("file"),
        );
        let stored_name = format!("{}-{}", &Uuid::new_v4().to_string()[..8], name);
        let destination = inbox.join(&stored_name);
        fs::copy(&source, &destination).map_err(|error| format!("无法复制附件：{error}"))?;
        let (mime, kind) = mime_and_kind(&destination);
        let bytes = if matches!(kind, "text" | "image") && metadata.len() as usize <= MAX_IMAGE_PREVIEW
        {
            fs::read(&destination).ok()
        } else {
            None
        };
        let text = if kind == "text" {
            bytes.as_ref().and_then(|content| {
                if content.len() <= MAX_TEXT_EMBED {
                    String::from_utf8(content.clone()).ok()
                } else {
                    None
                }
            })
        } else {
            None
        };
        let data_url = if kind == "image" {
            bytes.as_ref().map(|content| {
                format!("data:{mime};base64,{}", base64_encode(content))
            })
        } else {
            None
        };
        imported.push(ImportedAttachment {
            id: Uuid::new_v4().to_string(),
            name,
            stored_path: format!(".grok-desk/inbox/{stored_name}"),
            absolute_path: destination.to_string_lossy().into_owned(),
            mime: mime.into(),
            size: metadata.len(),
            kind: kind.into(),
            text,
            data_url,
        });
    }
    Ok(imported)
}

fn decode_data_url(data_url: &str) -> Result<(String, Vec<u8>), String> {
    let (header, payload) = data_url
        .split_once(',')
        .ok_or_else(|| "剪贴板图片格式无法识别".to_string())?;
    let mime = header
        .strip_prefix("data:")
        .and_then(|value| value.split(';').next())
        .filter(|value| !value.is_empty())
        .unwrap_or("image/png")
        .to_string();
    if !header.contains("base64") {
        return Err("剪贴板图片需要是 base64 数据".into());
    }
    let cleaned: String = payload.chars().filter(|character| !character.is_whitespace()).collect();
    let bytes = decode_base64(&cleaned)?;
    if bytes.is_empty() {
        return Err("剪贴板图片是空的".into());
    }
    if bytes.len() > MAX_FILE_BYTES as usize {
        return Err("剪贴板图片太大".into());
    }
    Ok((mime, bytes))
}

fn decode_base64(input: &str) -> Result<Vec<u8>, String> {
    fn value(byte: u8) -> Option<u8> {
        match byte {
            b'A'..=b'Z' => Some(byte - b'A'),
            b'a'..=b'z' => Some(byte - b'a' + 26),
            b'0'..=b'9' => Some(byte - b'0' + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    }
    let mut output = Vec::new();
    let bytes = input.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        let chunk: Vec<u8> = bytes[index..]
            .iter()
            .copied()
            .filter(|byte| *byte != b'=')
            .take(4)
            .collect();
        if chunk.is_empty() {
            break;
        }
        let a = value(chunk[0]).ok_or("剪贴板图片编码无效")?;
        let b = chunk.get(1).copied().and_then(value).unwrap_or(0);
        let c = chunk.get(2).copied().and_then(value).unwrap_or(0);
        let d = chunk.get(3).copied().and_then(value).unwrap_or(0);
        output.push((a << 2) | (b >> 4));
        if chunk.len() > 2 {
            output.push((b << 4) | (c >> 2));
        }
        if chunk.len() > 3 {
            output.push((c << 6) | d);
        }
        index += 4;
        while index < bytes.len() && bytes[index] == b'=' {
            index += 1;
        }
    }
    Ok(output)
}

fn extension_for_mime(mime: &str) -> &'static str {
    match mime {
        "image/jpeg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/bmp" => "bmp",
        _ => "png",
    }
}

fn write_imported_file(
    root: &Path,
    name: &str,
    mime: &str,
    kind: &str,
    bytes: &[u8],
) -> Result<ImportedAttachment, String> {
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err(format!("{name} 超过 {} MB", MAX_FILE_BYTES / 1024 / 1024));
    }
    let inbox = inbox_dir(root)?;
    let safe_name = sanitize_file_name(name);
    let stored_name = format!("{}-{}", &Uuid::new_v4().to_string()[..8], safe_name);
    let destination = inbox.join(&stored_name);
    fs::write(&destination, bytes).map_err(|error| format!("无法保存附件：{error}"))?;
    let text = if kind == "text" && bytes.len() <= MAX_TEXT_EMBED {
        String::from_utf8(bytes.to_vec()).ok()
    } else {
        None
    };
    let data_url = if kind == "image" && bytes.len() <= MAX_IMAGE_PREVIEW {
        Some(format!("data:{mime};base64,{}", base64_encode(bytes)))
    } else {
        None
    };
    Ok(ImportedAttachment {
        id: Uuid::new_v4().to_string(),
        name: safe_name,
        stored_path: format!(".grok-desk/inbox/{stored_name}"),
        absolute_path: destination.to_string_lossy().into_owned(),
        mime: mime.to_string(),
        size: bytes.len() as u64,
        kind: kind.to_string(),
        text,
        data_url,
    })
}

#[tauri::command]
pub fn import_data_url(
    root: String,
    name: String,
    data_url: String,
) -> Result<ImportedAttachment, String> {
    let root = canonical_directory(root)?;
    let (mime, bytes) = decode_data_url(&data_url)?;
    let filename = if Path::new(name.trim()).extension().is_some() {
        name
    } else {
        format!("{}.{}", sanitize_file_name(&name), extension_for_mime(&mime))
    };
    write_imported_file(&root, &filename, &mime, "image", &bytes)
}

#[tauri::command]
pub fn import_folder(root: String, folder: String) -> Result<Vec<ImportedAttachment>, String> {
    let workspace = canonical_directory(root)?;
    let directory = PathBuf::from(folder.trim());
    if !directory.is_dir() {
        return Err(format!("不是文件夹：{}", directory.display()));
    }
    let mut files = Vec::new();
    for entry in fs::read_dir(&directory).map_err(|error| format!("无法读取文件夹：{error}"))? {
        let entry = entry.map_err(|error| format!("无法读取文件夹：{error}"))?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("");
        if name.starts_with('.') {
            continue;
        }
        files.push(path.to_string_lossy().into_owned());
        if files.len() >= MAX_FILES {
            break;
        }
    }
    if files.is_empty() {
        return Err("这个文件夹里没有可附加的文件".into());
    }
    import_attachments(workspace.to_string_lossy().into_owned(), files)
}

fn base64_encode(bytes: &[u8]) -> String {
    const TABLE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut output = String::new();
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = chunk.get(1).copied().unwrap_or(0) as u32;
        let b2 = chunk.get(2).copied().unwrap_or(0) as u32;
        let triple = (b0 << 16) | (b1 << 8) | b2;
        output.push(TABLE[((triple >> 18) & 63) as usize] as char);
        output.push(TABLE[((triple >> 12) & 63) as usize] as char);
        output.push(if chunk.len() > 1 {
            TABLE[((triple >> 6) & 63) as usize] as char
        } else {
            '='
        });
        output.push(if chunk.len() > 2 {
            TABLE[(triple & 63) as usize] as char
        } else {
            '='
        });
    }
    output
}

#[cfg(test)]
mod tests {
    use super::{decode_data_url, mime_and_kind, sanitize_file_name};
    use std::path::Path;

    #[test]
    fn sanitizes_uploaded_names() {
        assert_eq!(sanitize_file_name("..\\secret.png"), "secret.png");
        assert_eq!(sanitize_file_name("照片 1.JPG"), "照片 1.JPG");
        assert_eq!(sanitize_file_name(""), "file");
    }

    #[test]
    fn classifies_images_and_text() {
        assert_eq!(mime_and_kind(Path::new("a.PNG")), ("image/png", "image"));
        assert_eq!(mime_and_kind(Path::new("note.md")), ("text/plain", "text"));
        assert_eq!(
            mime_and_kind(Path::new("pack.pdf")),
            ("application/pdf", "file")
        );
    }

    #[test]
    fn decodes_clipboard_png_data_urls() {
        let (mime, bytes) = decode_data_url("data:image/png;base64,AQID").unwrap();
        assert_eq!(mime, "image/png");
        assert_eq!(bytes, vec![1, 2, 3]);
    }
}
