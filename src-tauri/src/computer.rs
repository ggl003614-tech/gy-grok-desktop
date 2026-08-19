//! Local desktop capture and input for the opt-in Desk computer MCP.
//! Off unless the user enables 控制电脑. The live server binds 127.0.0.1 only.

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

pub const MCP_NAME: &str = "desk-computer";
pub const MCP_FLAG: &str = "--computer-mcp";
pub const HTTP_BIND: &str = "127.0.0.1:18765";
pub const HTTP_URL: &str = "http://127.0.0.1:18765/mcp";
const MAX_TYPE_CHARS: usize = 4000;
const MAX_WAIT_MS: u64 = 8000;
const REUSE_SECS: u64 = 8;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CaptureDetail {
    Low,
    High,
}

impl CaptureDetail {
    pub fn parse(value: &str) -> Self {
        if value.trim().eq_ignore_ascii_case("high") {
            Self::High
        } else {
            Self::Low
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Low => "low",
            Self::High => "high",
        }
    }

    fn max_width(self) -> u32 {
        match self {
            Self::Low => 960,
            Self::High => 1280,
        }
    }

    fn jpeg_quality(self) -> u8 {
        match self {
            Self::Low => 52,
            Self::High => 72,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerControlStatus {
    pub enabled: bool,
    pub mcp_name: &'static str,
    pub exe: Option<String>,
    pub endpoint: &'static str,
    pub detail: &'static str,
}

#[derive(Debug, Clone)]
pub struct CaptureResult {
    pub width: u32,
    pub height: u32,
    pub path: PathBuf,
    pub bytes: Vec<u8>,
    pub mime: &'static str,
    pub reused: bool,
}

struct LastShot {
    at: Instant,
    detail: CaptureDetail,
    result: CaptureResult,
}

static LAST_SHOT: Mutex<Option<LastShot>> = Mutex::new(None);

pub fn control_state_path() -> PathBuf {
    let base = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    base.join("dev.grokdesk.desktop")
        .join("computer-control.json")
}

pub fn gate_enabled() -> bool {
    let Ok(text) = fs::read_to_string(control_state_path()) else {
        return true;
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) else {
        return false;
    };
    value.get("enabled").and_then(|item| item.as_bool()) == Some(true)
}

fn read_control_state() -> serde_json::Value {
    fs::read_to_string(control_state_path())
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_else(|| serde_json::json!({}))
}

fn write_control_state(value: &serde_json::Value) -> Result<(), String> {
    let path = control_state_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("无法写入控制电脑开关：{error}"))?;
    }
    fs::write(&path, serde_json::to_vec_pretty(value).unwrap_or_default())
        .map_err(|error| format!("无法保存控制电脑开关：{error}"))
}

pub fn write_gate(enabled: bool) -> Result<(), String> {
    let mut body = read_control_state();
    body["enabled"] = serde_json::json!(enabled);
    body["updatedAt"] = serde_json::json!(now_millis());
    if body.get("detail").and_then(|item| item.as_str()).is_none() {
        body["detail"] = serde_json::json!("low");
    }
    write_control_state(&body)
}

pub fn capture_detail() -> CaptureDetail {
    read_control_state()
        .get("detail")
        .and_then(|item| item.as_str())
        .map(CaptureDetail::parse)
        .unwrap_or(CaptureDetail::Low)
}

pub fn write_capture_detail(detail: CaptureDetail) -> Result<(), String> {
    let mut body = read_control_state();
    body["detail"] = serde_json::json!(detail.as_str());
    body["updatedAt"] = serde_json::json!(now_millis());
    write_control_state(&body)
}

pub fn current_desk_exe() -> Result<String, String> {
    let exe = std::env::current_exe().map_err(|error| format!("找不到 Grok Desk：{error}"))?;
    Ok(crate::platform::strip_verbatim_prefix(exe)
        .to_string_lossy()
        .into_owned())
}

pub fn status() -> ComputerControlStatus {
    ComputerControlStatus {
        enabled: gate_enabled(),
        mcp_name: MCP_NAME,
        exe: current_desk_exe().ok(),
        endpoint: HTTP_URL,
        detail: capture_detail().as_str(),
    }
}

pub fn require_enabled() -> Result<(), String> {
    if gate_enabled() {
        Ok(())
    } else {
        Err("控制电脑未开启。请在 Grok Desk → 设置里打开「控制电脑」，然后开一场新对话。".into())
    }
}

pub fn capture_dir() -> PathBuf {
    std::env::temp_dir().join("grok-desk-captures")
}

pub fn scale_rgba(width: u32, height: u32, rgba: &[u8], max_width: u32) -> (u32, u32, Vec<u8>) {
    if width == 0
        || height == 0
        || rgba.len()
            < (width as usize)
                .saturating_mul(height as usize)
                .saturating_mul(4)
    {
        return (width, height, rgba.to_vec());
    }
    if width <= max_width {
        return (width, height, rgba.to_vec());
    }
    let new_w = max_width.max(1);
    let new_h = ((height as u64 * new_w as u64) / width as u64).max(1) as u32;
    let mut out = vec![0_u8; new_w as usize * new_h as usize * 4];
    for y in 0..new_h {
        let src_y = (y as u64 * height as u64) / new_h as u64;
        for x in 0..new_w {
            let src_x = (x as u64 * width as u64) / new_w as u64;
            let src = ((src_y * width as u64 + src_x) * 4) as usize;
            let dst = ((y as u64 * new_w as u64 + x as u64) * 4) as usize;
            out[dst..dst + 4].copy_from_slice(&rgba[src..src + 4]);
        }
    }
    (new_w, new_h, out)
}

#[cfg(test)]
pub fn encode_png(width: u32, height: u32, rgba: &[u8]) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    let mut encoder = png::Encoder::new(&mut out, width, height);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    let mut writer = encoder
        .write_header()
        .map_err(|error| format!("无法编码截图：{error}"))?;
    writer
        .write_image_data(rgba)
        .map_err(|error| format!("无法写入截图：{error}"))?;
    writer
        .finish()
        .map_err(|error| format!("无法完成截图：{error}"))?;
    Ok(out)
}

pub fn rgba_to_rgb(rgba: &[u8]) -> Vec<u8> {
    rgba.chunks_exact(4)
        .flat_map(|pixel| [pixel[0], pixel[1], pixel[2]])
        .collect()
}

pub fn encode_jpeg(width: u32, height: u32, rgba: &[u8], quality: u8) -> Result<Vec<u8>, String> {
    let rgb = rgba_to_rgb(rgba);
    let mut out = Vec::new();
    jpeg_encoder::Encoder::new(&mut out, quality)
        .encode(
            &rgb,
            width as u16,
            height as u16,
            jpeg_encoder::ColorType::Rgb,
        )
        .map_err(|error| format!("无法压缩截图：{error}"))?;
    Ok(out)
}

pub fn save_capture(bytes: &[u8], ext: &str) -> Result<PathBuf, String> {
    let dir = capture_dir();
    fs::create_dir_all(&dir).map_err(|error| format!("无法创建截图目录：{error}"))?;
    prune_captures(&dir);
    let path = dir.join(format!("shot-{}.{}", now_millis(), ext));
    fs::write(&path, bytes).map_err(|error| format!("无法保存截图：{error}"))?;
    Ok(path)
}

fn prune_captures(dir: &Path) {
    let mut files: Vec<_> = fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|entry| {
            matches!(
                entry.path().extension().and_then(|ext| ext.to_str()),
                Some("png" | "jpg" | "jpeg")
            )
        })
        .collect();
    files.sort_by_key(|entry| entry.metadata().and_then(|meta| meta.modified()).ok());
    let extra = files.len().saturating_sub(6);
    for entry in files.into_iter().take(extra) {
        let _ = fs::remove_file(entry.path());
    }
}

pub fn screenshot(force: bool, detail: Option<CaptureDetail>) -> Result<CaptureResult, String> {
    require_enabled()?;
    let detail = detail.unwrap_or_else(capture_detail);
    if !force {
        if let Ok(guard) = LAST_SHOT.lock() {
            if let Some(last) = guard.as_ref() {
                if last.detail == detail && last.at.elapsed() < Duration::from_secs(REUSE_SECS) {
                    let mut reused = last.result.clone();
                    reused.reused = true;
                    return Ok(reused);
                }
            }
        }
    }
    let (width, height, rgba) = capture_rgba()?;
    let (width, height, rgba) = scale_rgba(width, height, &rgba, detail.max_width());
    let bytes = encode_jpeg(width, height, &rgba, detail.jpeg_quality())?;
    let path = save_capture(&bytes, "jpg")?;
    let result = CaptureResult {
        width,
        height,
        path,
        bytes,
        mime: "image/jpeg",
        reused: false,
    };
    if let Ok(mut guard) = LAST_SHOT.lock() {
        *guard = Some(LastShot {
            at: Instant::now(),
            detail,
            result: result.clone(),
        });
    }
    Ok(result)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotPayload {
    pub path: String,
    pub width: u32,
    pub height: u32,
    pub data_url: String,
}

#[tauri::command]
pub fn take_screenshot() -> Result<ScreenshotPayload, String> {
    let shot = screenshot(true, None)?;
    Ok(ScreenshotPayload {
        path: shot.path.to_string_lossy().into_owned(),
        width: shot.width,
        height: shot.height,
        data_url: format!("data:{};base64,{}", shot.mime, BASE64.encode(&shot.bytes)),
    })
}

pub fn screenshot_payload(force: bool, detail: Option<&str>) -> Result<serde_json::Value, String> {
    let shot = screenshot(force, detail.map(CaptureDetail::parse))?;
    let note = if shot.reused {
        format!(
            "复用了 {} 秒内的上一张截图（{}x{} JPEG），避免重复耗额度。需要新图请传 force=true。文件：{}",
            REUSE_SECS,
            shot.width,
            shot.height,
            shot.path.display()
        )
    } else {
        format!(
            "已截取屏幕 {}x{}（节省额度的 JPEG）。先根据这张图行动，不要连续截屏。文件：{}",
            shot.width,
            shot.height,
            shot.path.display()
        )
    };
    Ok(serde_json::json!([
        { "type": "text", "text": note },
        {
            "type": "image",
            "mimeType": shot.mime,
            "data": BASE64.encode(&shot.bytes)
        }
    ]))
}

pub fn parse_key(name: &str) -> Result<u16, String> {
    let key = name.trim().to_ascii_lowercase();
    let vk = match key.as_str() {
        "enter" | "return" => 0x0D,
        "tab" => 0x09,
        "esc" | "escape" => 0x1B,
        "backspace" => 0x08,
        "delete" | "del" => 0x2E,
        "space" | "spacebar" => 0x20,
        "left" => 0x25,
        "up" => 0x26,
        "right" => 0x27,
        "down" => 0x28,
        "home" => 0x24,
        "end" => 0x23,
        "pageup" | "pgup" => 0x21,
        "pagedown" | "pgdn" => 0x22,
        "win" | "meta" | "super" => 0x5B,
        "ctrl" | "control" => 0x11,
        "alt" | "option" => 0x12,
        "shift" => 0x10,
        "caps" | "capslock" => 0x14,
        other if other.len() == 1 => {
            let ch = other.chars().next().unwrap();
            if ch.is_ascii_alphabetic() {
                ch.to_ascii_uppercase() as u16
            } else if ch.is_ascii_digit() {
                ch as u16
            } else {
                return Err(format!("不支持的按键：{name}"));
            }
        }
        other if other.starts_with('f') && other[1..].parse::<u8>().is_ok() => {
            let n: u8 = other[1..].parse().unwrap();
            if (1..=12).contains(&n) {
                0x6F + u16::from(n)
            } else {
                return Err(format!("不支持的功能键：{name}"));
            }
        }
        _ => return Err(format!("不支持的按键：{name}")),
    };
    Ok(vk)
}

pub fn type_text(text: &str) -> Result<String, String> {
    require_enabled()?;
    if text.chars().count() > MAX_TYPE_CHARS {
        return Err(format!("一次最多输入 {MAX_TYPE_CHARS} 个字符"));
    }
    if text.contains('\0') {
        return Err("文本包含非法字符".into());
    }
    send_unicode(text)?;
    Ok(format!("已输入 {} 个字符", text.chars().count()))
}

pub fn press_named_key(name: &str) -> Result<String, String> {
    require_enabled()?;
    let vk = parse_key(name)?;
    send_vk(vk, true)?;
    send_vk(vk, false)?;
    Ok(format!("已按下 {name}"))
}

pub fn press_hotkey(keys: &[String]) -> Result<String, String> {
    require_enabled()?;
    if keys.is_empty() || keys.len() > 4 {
        return Err("快捷键需要 1 到 4 个键".into());
    }
    let vks: Result<Vec<u16>, String> = keys.iter().map(|key| parse_key(key)).collect();
    let vks = vks?;
    for vk in &vks {
        send_vk(*vk, true)?;
        thread::sleep(Duration::from_millis(15));
    }
    for vk in vks.iter().rev() {
        send_vk(*vk, false)?;
        thread::sleep(Duration::from_millis(15));
    }
    Ok(format!("已发送快捷键 {}", keys.join("+")))
}

pub fn wait_ms(ms: u64) -> Result<String, String> {
    require_enabled()?;
    let ms = ms.min(MAX_WAIT_MS);
    thread::sleep(Duration::from_millis(ms));
    Ok(format!("已等待 {ms} 毫秒"))
}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}

#[cfg(windows)]
mod win {
    use super::*;
    use std::mem::{size_of, zeroed};
    use std::ptr::null_mut;

    const SM_XVIRTUALSCREEN: i32 = 76;
    const SM_YVIRTUALSCREEN: i32 = 77;
    const SM_CXVIRTUALSCREEN: i32 = 78;
    const SM_CYVIRTUALSCREEN: i32 = 79;
    const SRCCOPY: u32 = 0x00CC_0020;
    const BI_RGB: u32 = 0;
    const DIB_RGB_COLORS: u32 = 0;
    const MOUSEEVENTF_LEFTDOWN: u32 = 0x0002;
    const MOUSEEVENTF_LEFTUP: u32 = 0x0004;
    const MOUSEEVENTF_RIGHTDOWN: u32 = 0x0008;
    const MOUSEEVENTF_RIGHTUP: u32 = 0x0010;
    const MOUSEEVENTF_MIDDLEDOWN: u32 = 0x0020;
    const MOUSEEVENTF_MIDDLEUP: u32 = 0x0040;
    const KEYEVENTF_KEYUP: u32 = 0x0002;
    const KEYEVENTF_UNICODE: u32 = 0x0004;
    const INPUT_MOUSE: u32 = 0;
    const INPUT_KEYBOARD: u32 = 1;
    const SW_RESTORE: i32 = 9;

    #[repr(C)]
    struct BitmapInfoHeader {
        bi_size: u32,
        bi_width: i32,
        bi_height: i32,
        bi_planes: u16,
        bi_bit_count: u16,
        bi_compression: u32,
        bi_size_image: u32,
        bi_x_pels_per_meter: i32,
        bi_y_pels_per_meter: i32,
        bi_clr_used: u32,
        bi_clr_important: u32,
    }

    #[repr(C)]
    struct BitmapInfo {
        header: BitmapInfoHeader,
        colors: [u32; 3],
    }

    #[repr(C)]
    struct Point {
        x: i32,
        y: i32,
    }

    #[repr(C)]
    struct Rect {
        left: i32,
        top: i32,
        right: i32,
        bottom: i32,
    }

    #[derive(Clone, Copy)]
    #[repr(C)]
    struct MouseInput {
        dx: i32,
        dy: i32,
        mouse_data: u32,
        dw_flags: u32,
        time: u32,
        dw_extra_info: usize,
    }

    #[derive(Clone, Copy)]
    #[repr(C)]
    struct KeybdInput {
        w_vk: u16,
        w_scan: u16,
        dw_flags: u32,
        time: u32,
        dw_extra_info: usize,
    }

    #[derive(Clone, Copy)]
    #[repr(C)]
    union InputData {
        mi: MouseInput,
        ki: KeybdInput,
    }

    #[derive(Clone, Copy)]
    #[repr(C)]
    struct Input {
        r#type: u32,
        data: InputData,
    }

    #[link(name = "user32")]
    extern "system" {
        fn GetSystemMetrics(index: i32) -> i32;
        fn GetDC(hwnd: *mut std::ffi::c_void) -> *mut std::ffi::c_void;
        fn ReleaseDC(hwnd: *mut std::ffi::c_void, hdc: *mut std::ffi::c_void) -> i32;
        fn GetCursorPos(point: *mut Point) -> i32;
        fn SetCursorPos(x: i32, y: i32) -> i32;
        fn SendInput(count: u32, inputs: *mut Input, size: i32) -> u32;
        fn EnumWindows(
            callback: unsafe extern "system" fn(*mut std::ffi::c_void, isize) -> i32,
            lparam: isize,
        ) -> i32;
        fn IsWindowVisible(hwnd: *mut std::ffi::c_void) -> i32;
        fn GetWindowTextW(hwnd: *mut std::ffi::c_void, text: *mut u16, max: i32) -> i32;
        fn GetWindowRect(hwnd: *mut std::ffi::c_void, rect: *mut Rect) -> i32;
        fn ShowWindow(hwnd: *mut std::ffi::c_void, cmd: i32) -> i32;
        fn SetForegroundWindow(hwnd: *mut std::ffi::c_void) -> i32;
        fn IsIconic(hwnd: *mut std::ffi::c_void) -> i32;
    }

    #[link(name = "gdi32")]
    extern "system" {
        fn CreateCompatibleDC(hdc: *mut std::ffi::c_void) -> *mut std::ffi::c_void;
        fn CreateCompatibleBitmap(
            hdc: *mut std::ffi::c_void,
            width: i32,
            height: i32,
        ) -> *mut std::ffi::c_void;
        fn SelectObject(
            hdc: *mut std::ffi::c_void,
            obj: *mut std::ffi::c_void,
        ) -> *mut std::ffi::c_void;
        fn BitBlt(
            dst: *mut std::ffi::c_void,
            x: i32,
            y: i32,
            w: i32,
            h: i32,
            src: *mut std::ffi::c_void,
            sx: i32,
            sy: i32,
            rop: u32,
        ) -> i32;
        fn GetDIBits(
            hdc: *mut std::ffi::c_void,
            bitmap: *mut std::ffi::c_void,
            start: u32,
            lines: u32,
            bits: *mut u8,
            info: *mut BitmapInfo,
            usage: u32,
        ) -> i32;
        fn DeleteObject(obj: *mut std::ffi::c_void) -> i32;
        fn DeleteDC(hdc: *mut std::ffi::c_void) -> i32;
    }

    pub fn capture_rgba() -> Result<(u32, u32, Vec<u8>), String> {
        unsafe {
            let x = GetSystemMetrics(SM_XVIRTUALSCREEN);
            let y = GetSystemMetrics(SM_YVIRTUALSCREEN);
            let width = GetSystemMetrics(SM_CXVIRTUALSCREEN);
            let height = GetSystemMetrics(SM_CYVIRTUALSCREEN);
            if width <= 0 || height <= 0 {
                return Err("无法读取屏幕尺寸".into());
            }
            let screen = GetDC(null_mut());
            if screen.is_null() {
                return Err("无法打开屏幕设备".into());
            }
            let memory = CreateCompatibleDC(screen);
            let bitmap = CreateCompatibleBitmap(screen, width, height);
            if memory.is_null() || bitmap.is_null() {
                ReleaseDC(null_mut(), screen);
                return Err("无法创建截图画布".into());
            }
            let old = SelectObject(memory, bitmap);
            let copied = BitBlt(memory, 0, 0, width, height, screen, x, y, SRCCOPY);
            let mut info: BitmapInfo = zeroed();
            info.header.bi_size = size_of::<BitmapInfoHeader>() as u32;
            info.header.bi_width = width;
            info.header.bi_height = -height;
            info.header.bi_planes = 1;
            info.header.bi_bit_count = 32;
            info.header.bi_compression = BI_RGB;
            let mut bgra = vec![0_u8; (width * height * 4) as usize];
            let got = GetDIBits(
                memory,
                bitmap,
                0,
                height as u32,
                bgra.as_mut_ptr(),
                &mut info,
                DIB_RGB_COLORS,
            );
            SelectObject(memory, old);
            DeleteObject(bitmap);
            DeleteDC(memory);
            ReleaseDC(null_mut(), screen);
            if copied == 0 || got == 0 {
                return Err("截取屏幕失败".into());
            }
            let mut rgba = vec![0_u8; bgra.len()];
            for (src, dst) in bgra.chunks_exact(4).zip(rgba.chunks_exact_mut(4)) {
                dst[0] = src[2];
                dst[1] = src[1];
                dst[2] = src[0];
                dst[3] = 255;
            }
            Ok((width as u32, height as u32, rgba))
        }
    }

    pub fn screen_info() -> Result<serde_json::Value, String> {
        unsafe {
            let mut cursor = Point { x: 0, y: 0 };
            let _ = GetCursorPos(&mut cursor);
            Ok(serde_json::json!({
                "x": GetSystemMetrics(SM_XVIRTUALSCREEN),
                "y": GetSystemMetrics(SM_YVIRTUALSCREEN),
                "width": GetSystemMetrics(SM_CXVIRTUALSCREEN),
                "height": GetSystemMetrics(SM_CYVIRTUALSCREEN),
                "cursorX": cursor.x,
                "cursorY": cursor.y
            }))
        }
    }

    struct WindowCollect(Vec<serde_json::Value>);

    unsafe extern "system" fn enum_windows_cb(hwnd: *mut std::ffi::c_void, lparam: isize) -> i32 {
        if IsWindowVisible(hwnd) == 0 {
            return 1;
        }
        let mut buf = [0_u16; 512];
        let len = GetWindowTextW(hwnd, buf.as_mut_ptr(), buf.len() as i32);
        if len <= 0 {
            return 1;
        }
        let title = String::from_utf16_lossy(&buf[..len as usize]);
        let mut rect = Rect {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        };
        let _ = GetWindowRect(hwnd, &mut rect);
        let bag = &mut *(lparam as *mut WindowCollect);
        bag.0.push(serde_json::json!({
            "title": title,
            "x": rect.left,
            "y": rect.top,
            "width": (rect.right - rect.left).max(0),
            "height": (rect.bottom - rect.top).max(0)
        }));
        1
    }

    pub fn list_windows() -> Result<serde_json::Value, String> {
        let mut bag = WindowCollect(Vec::new());
        unsafe {
            EnumWindows(enum_windows_cb, &mut bag as *mut _ as isize);
        }
        bag.0.truncate(40);
        Ok(serde_json::json!(bag.0))
    }

    pub fn focus_window(title: &str) -> Result<String, String> {
        let needle = title.trim().to_ascii_lowercase();
        if needle.is_empty() {
            return Err("请提供窗口标题的一部分".into());
        }
        let mut bag = WindowCollect(Vec::new());
        unsafe {
            EnumWindows(enum_windows_cb, &mut bag as *mut _ as isize);
        }
        let Some(hit) = bag.0.iter().find(|entry| {
            entry
                .get("title")
                .and_then(|value| value.as_str())
                .map(|title| title.to_ascii_lowercase().contains(&needle))
                .unwrap_or(false)
        }) else {
            return Err(format!("没有找到标题包含「{title}」的窗口"));
        };
        let found_title = hit
            .get("title")
            .and_then(|value| value.as_str())
            .unwrap_or(title)
            .to_string();
        // Re-walk to get the HWND: EnumWindows again matching exact title.
        struct FocusTarget {
            title: String,
            hwnd: *mut std::ffi::c_void,
        }
        let mut target = FocusTarget {
            title: found_title.clone(),
            hwnd: null_mut(),
        };
        unsafe extern "system" fn find_cb(hwnd: *mut std::ffi::c_void, lparam: isize) -> i32 {
            let target = &mut *(lparam as *mut FocusTarget);
            if IsWindowVisible(hwnd) == 0 {
                return 1;
            }
            let mut buf = [0_u16; 512];
            let len = GetWindowTextW(hwnd, buf.as_mut_ptr(), buf.len() as i32);
            if len <= 0 {
                return 1;
            }
            let title = String::from_utf16_lossy(&buf[..len as usize]);
            if title == target.title {
                target.hwnd = hwnd;
                return 0;
            }
            1
        }
        unsafe {
            EnumWindows(find_cb, &mut target as *mut _ as isize);
            if target.hwnd.is_null() {
                return Err("找到窗口但无法激活".into());
            }
            if IsIconic(target.hwnd) != 0 {
                ShowWindow(target.hwnd, SW_RESTORE);
            }
            if SetForegroundWindow(target.hwnd) == 0 {
                return Err(format!(
                    "系统拒绝把「{found_title}」送到前台，可再试一次或让用户点一下 Desk 窗口"
                ));
            }
        }
        Ok(format!("已激活窗口：{found_title}"))
    }

    pub fn move_mouse(x: i32, y: i32) -> Result<String, String> {
        unsafe {
            if SetCursorPos(x, y) == 0 {
                return Err("无法移动鼠标".into());
            }
        }
        Ok(format!("鼠标已移到 {x},{y}"))
    }

    pub fn click_at(x: i32, y: i32, button: &str, clicks: u32) -> Result<String, String> {
        move_mouse(x, y)?;
        thread::sleep(Duration::from_millis(30));
        let (down, up) = match button {
            "right" => (MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP),
            "middle" => (MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP),
            _ => (MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP),
        };
        let times = clicks.clamp(1, 2);
        for _ in 0..times {
            send_mouse(down)?;
            thread::sleep(Duration::from_millis(20));
            send_mouse(up)?;
            thread::sleep(Duration::from_millis(40));
        }
        Ok(format!("已在 {x},{y} {button} 点击 {times} 次"))
    }

    fn send_mouse(flags: u32) -> Result<(), String> {
        unsafe {
            let mut input = Input {
                r#type: INPUT_MOUSE,
                data: InputData {
                    mi: MouseInput {
                        dx: 0,
                        dy: 0,
                        mouse_data: 0,
                        dw_flags: flags,
                        time: 0,
                        dw_extra_info: 0,
                    },
                },
            };
            if SendInput(1, &mut input, size_of::<Input>() as i32) != 1 {
                return Err("发送鼠标事件失败".into());
            }
        }
        Ok(())
    }

    pub fn send_vk(vk: u16, down: bool) -> Result<(), String> {
        unsafe {
            let mut input = Input {
                r#type: INPUT_KEYBOARD,
                data: InputData {
                    ki: KeybdInput {
                        w_vk: vk,
                        w_scan: 0,
                        dw_flags: if down { 0 } else { KEYEVENTF_KEYUP },
                        time: 0,
                        dw_extra_info: 0,
                    },
                },
            };
            if SendInput(1, &mut input, size_of::<Input>() as i32) != 1 {
                return Err("发送按键失败".into());
            }
        }
        Ok(())
    }

    pub fn send_unicode(text: &str) -> Result<(), String> {
        for ch in text.encode_utf16() {
            unsafe {
                let mut down = Input {
                    r#type: INPUT_KEYBOARD,
                    data: InputData {
                        ki: KeybdInput {
                            w_vk: 0,
                            w_scan: ch,
                            dw_flags: KEYEVENTF_UNICODE,
                            time: 0,
                            dw_extra_info: 0,
                        },
                    },
                };
                let mut up = down;
                up.data.ki.dw_flags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;
                if SendInput(1, &mut down, size_of::<Input>() as i32) != 1
                    || SendInput(1, &mut up, size_of::<Input>() as i32) != 1
                {
                    return Err("发送文字失败".into());
                }
            }
            thread::sleep(Duration::from_millis(4));
        }
        Ok(())
    }
}

#[cfg(not(windows))]
mod win {
    use super::*;

    pub fn capture_rgba() -> Result<(u32, u32, Vec<u8>), String> {
        Err("控制电脑目前只支持 Windows".into())
    }
    pub fn screen_info() -> Result<serde_json::Value, String> {
        Err("控制电脑目前只支持 Windows".into())
    }
    pub fn list_windows() -> Result<serde_json::Value, String> {
        Err("控制电脑目前只支持 Windows".into())
    }
    pub fn focus_window(_: &str) -> Result<String, String> {
        Err("控制电脑目前只支持 Windows".into())
    }
    pub fn move_mouse(_: i32, _: i32) -> Result<String, String> {
        Err("控制电脑目前只支持 Windows".into())
    }
    pub fn click_at(_: i32, _: i32, _: &str, _: u32) -> Result<String, String> {
        Err("控制电脑目前只支持 Windows".into())
    }
    pub fn send_vk(_: u16, _: bool) -> Result<(), String> {
        Err("控制电脑目前只支持 Windows".into())
    }
    pub fn send_unicode(_: &str) -> Result<(), String> {
        Err("控制电脑目前只支持 Windows".into())
    }
}

pub fn capture_rgba() -> Result<(u32, u32, Vec<u8>), String> {
    win::capture_rgba()
}

pub fn screen_info() -> Result<serde_json::Value, String> {
    require_enabled()?;
    win::screen_info()
}

pub fn list_windows() -> Result<serde_json::Value, String> {
    require_enabled()?;
    win::list_windows()
}

pub fn focus_window(title: &str) -> Result<String, String> {
    require_enabled()?;
    win::focus_window(title)
}

pub fn move_mouse(x: i32, y: i32) -> Result<String, String> {
    require_enabled()?;
    win::move_mouse(x, y)
}

pub fn click_at(x: i32, y: i32, button: &str, clicks: u32) -> Result<String, String> {
    require_enabled()?;
    let button = match button {
        "right" | "middle" | "left" => button,
        _ => "left",
    };
    win::click_at(x, y, button, clicks)
}

fn send_vk(vk: u16, down: bool) -> Result<(), String> {
    win::send_vk(vk, down)
}

fn send_unicode(text: &str) -> Result<(), String> {
    win::send_unicode(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scales_wide_rgba_down() {
        let mut src = vec![0_u8; 8 * 2 * 4];
        src[0] = 255;
        let (w, h, out) = scale_rgba(8, 2, &src, 4);
        assert_eq!((w, h), (4, 1));
        assert_eq!(out.len(), 16);
        assert_eq!(out[0], 255);
    }

    #[test]
    fn encodes_a_tiny_png() {
        let rgba = [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 0, 0, 0, 255];
        let png = encode_png(2, 2, &rgba).unwrap();
        assert!(png.starts_with(&[137, 80, 78, 71]));
    }

    #[test]
    fn encodes_a_tiny_jpeg() {
        let rgba = [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 0, 0, 0, 255];
        let jpeg = encode_jpeg(2, 2, &rgba, 52).unwrap();
        assert!(jpeg.starts_with(&[0xFF, 0xD8]));
        assert!(jpeg.len() < 8_000);
    }

    #[test]
    fn defaults_capture_detail_to_low() {
        assert_eq!(CaptureDetail::parse(""), CaptureDetail::Low);
        assert_eq!(CaptureDetail::parse("high").max_width(), 1280);
        assert!(CaptureDetail::Low.max_width() < 1440);
    }

    #[test]
    fn maps_common_keys() {
        assert_eq!(parse_key("enter").unwrap(), 0x0D);
        assert_eq!(parse_key("ctrl").unwrap(), 0x11);
        assert_eq!(parse_key("c").unwrap(), 0x43);
        assert_eq!(parse_key("f5").unwrap(), 0x74);
        assert!(parse_key("unknown-key").is_err());
    }

    #[test]
    fn gate_defaults_to_off_when_file_missing() {
        // Missing or invalid files must never silently enable computer control.
        if !control_state_path().exists() {
            assert!(!gate_enabled());
        }
    }
}
