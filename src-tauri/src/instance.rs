//! Keep one visible Desk window. A second launch restores the first instead
//! of looking like a crash (frameless + minimized parks off-screen on Windows).

#[cfg(windows)]
mod win {
    use std::ptr::null_mut;
    use std::sync::atomic::{AtomicPtr, Ordering};

    const SW_RESTORE: i32 = 9;
    const ERROR_ALREADY_EXISTS: u32 = 183;
    static MUTEX: AtomicPtr<std::ffi::c_void> = AtomicPtr::new(null_mut());

    #[link(name = "user32")]
    extern "system" {
        fn FindWindowW(class: *const u16, name: *const u16) -> *mut std::ffi::c_void;
        fn ShowWindow(hwnd: *mut std::ffi::c_void, cmd: i32) -> i32;
        fn SetForegroundWindow(hwnd: *mut std::ffi::c_void) -> i32;
        fn IsIconic(hwnd: *mut std::ffi::c_void) -> i32;
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn CreateMutexW(
            attributes: *mut std::ffi::c_void,
            initial_owner: i32,
            name: *const u16,
        ) -> *mut std::ffi::c_void;
        fn GetLastError() -> u32;
        fn CloseHandle(handle: *mut std::ffi::c_void) -> i32;
    }

    fn wide(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(std::iter::once(0)).collect()
    }

    pub fn restore_existing_window(title: &str) -> bool {
        let title = wide(title);
        unsafe {
            let hwnd = FindWindowW(null_mut(), title.as_ptr());
            if hwnd.is_null() {
                return false;
            }
            if IsIconic(hwnd) != 0 {
                ShowWindow(hwnd, SW_RESTORE);
            }
            SetForegroundWindow(hwnd);
            true
        }
    }

    /// Returns true when this process should continue and own the app window.
    pub fn try_become_primary(mutex_name: &str) -> bool {
        let name = wide(mutex_name);
        unsafe {
            let handle = CreateMutexW(null_mut(), 1, name.as_ptr());
            if handle.is_null() {
                return true;
            }
            if GetLastError() == ERROR_ALREADY_EXISTS {
                CloseHandle(handle);
                return false;
            }
            MUTEX.store(handle, Ordering::SeqCst);
            true
        }
    }
}

pub const DESK_WINDOW_TITLE: &str = "GY Grok";
pub const DESK_INSTANCE_MUTEX: &str = "Local\\GrokDesk.SingleInstance";

pub fn window_needs_restore(x: i32, y: i32, width: u32, height: u32) -> bool {
    x <= -10_000 || y <= -10_000 || width < 200 || height < 120
}

/// Returns false when another Desk is already running and was asked to show itself.
pub fn claim_or_focus_existing() -> bool {
    #[cfg(windows)]
    {
        if !win::try_become_primary(DESK_INSTANCE_MUTEX) {
            let _ = win::restore_existing_window(DESK_WINDOW_TITLE);
            return false;
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::window_needs_restore;

    #[test]
    fn parks_windows_minimized_rect_as_lost() {
        assert!(window_needs_restore(-21333, -21333, 158, 26));
        assert!(!window_needs_restore(640, 286, 1280, 820));
    }
}
