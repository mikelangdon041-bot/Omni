// Windows telling us the screen has gone.
//
// A meeting that ends with everyone closing their laptop leaves a recording
// running: the hotkey was never pressed, and silence alone takes minutes to be
// sure of. The screen locking, the display sleeping, or the machine suspending
// are all the same fact — whatever was happening is not happening on this
// screen any more — and they arrive immediately.
//
// Getting them means owning a window. Both notifications are delivered as
// window messages and there is no polling equivalent for the display state, so
// this creates one of its own on a thread of its own and runs a message loop
// there. It is never shown: zero-sized, never passed to ShowWindow, and not a
// message-only (HWND_MESSAGE) window either, because those are documented not
// to receive broadcast messages and WM_POWERBROADCAST is one.

use std::sync::OnceLock;

use windows::core::PCWSTR;
use windows::Win32::Foundation::{HANDLE, HINSTANCE, HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::Power::{RegisterPowerSettingNotification, POWERBROADCAST_SETTING};
use windows::Win32::System::RemoteDesktop::{
    WTSRegisterSessionNotification, NOTIFY_FOR_THIS_SESSION,
};
use windows::Win32::System::SystemServices::GUID_CONSOLE_DISPLAY_STATE;
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, RegisterClassW,
    TranslateMessage, DEVICE_NOTIFY_WINDOW_HANDLE, MSG, PBT_APMSUSPEND, PBT_POWERSETTINGCHANGE,
    WINDOW_EX_STYLE, WINDOW_STYLE, WM_POWERBROADCAST, WM_WTSSESSION_CHANGE, WNDCLASSW,
    WTS_SESSION_LOCK,
};

/// Why we think nobody is at this screen.
#[derive(Clone, Copy, Debug)]
pub enum Away {
    /// The display was switched off — power settings, or the lid.
    ScreenOff,
    /// The workstation locked (Win+L, or the lock screen timing out).
    Locked,
    /// The machine is going to sleep.
    Suspending,
}

type Handler = Box<dyn Fn(Away) + Send + Sync + 'static>;

// One watcher per process, so the window procedure — which Windows calls with
// no context of ours — can find the handler without a pointer round trip
// through the window's user data.
static HANDLER: OnceLock<Handler> = OnceLock::new();

/// Start watching. Calling it twice is a no-op: the second handler is dropped
/// rather than replacing the first, because two windows both stopping the same
/// recording is worse than one.
pub fn watch(on_away: impl Fn(Away) + Send + Sync + 'static) {
    if HANDLER.set(Box::new(on_away)).is_err() {
        return;
    }
    let _ = std::thread::Builder::new()
        .name("omni-session".into())
        .spawn(|| unsafe { pump() });
}

fn fire(away: Away) {
    if let Some(handler) = HANDLER.get() {
        handler(away);
    }
}

unsafe extern "system" fn wndproc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    match msg {
        WM_POWERBROADCAST => {
            match wparam.0 as u32 {
                PBT_POWERSETTINGCHANGE => {
                    // The lparam is a POWERBROADCAST_SETTING whose payload for
                    // GUID_CONSOLE_DISPLAY_STATE is one byte: 0 off, 1 on,
                    // 2 dimmed. Dimmed is not off — that is the warning before
                    // the screen goes, and a meeting is often still running.
                    let setting = &*(lparam.0 as *const POWERBROADCAST_SETTING);
                    if setting.PowerSetting == GUID_CONSOLE_DISPLAY_STATE
                        && setting.DataLength >= 1
                        && setting.Data[0] == 0
                    {
                        fire(Away::ScreenOff);
                    }
                }
                PBT_APMSUSPEND => fire(Away::Suspending),
                _ => {}
            }
            // TRUE: the message was handled. Nothing here refuses a suspend.
            LRESULT(1)
        }
        WM_WTSSESSION_CHANGE => {
            if wparam.0 as u32 == WTS_SESSION_LOCK {
                fire(Away::Locked);
            }
            LRESULT(0)
        }
        _ => DefWindowProcW(hwnd, msg, wparam, lparam),
    }
}

unsafe fn pump() {
    let instance: HINSTANCE = GetModuleHandleW(None)
        .map(|module| HINSTANCE(module.0))
        .unwrap_or_default();
    // Null-terminated: PCWSTR is a raw pointer, and Windows reads until it
    // finds the terminator whether or not one was written.
    let class: Vec<u16> = "OmniRecorderSessionWatcher\0".encode_utf16().collect();
    let name = PCWSTR(class.as_ptr());

    let wc = WNDCLASSW {
        lpfnWndProc: Some(wndproc),
        hInstance: instance,
        lpszClassName: name,
        ..Default::default()
    };
    if RegisterClassW(&wc) == 0 {
        return;
    }

    let Ok(hwnd) = CreateWindowExW(
        WINDOW_EX_STYLE(0),
        name,
        name,
        WINDOW_STYLE(0),
        0,
        0,
        0,
        0,
        None,
        None,
        Some(instance),
        None,
    ) else {
        return;
    };

    // Both registrations are best effort. Losing one costs a trigger, never
    // the recording: the silence clock still ends a meeting nobody stopped.
    let _ = RegisterPowerSettingNotification(
        HANDLE(hwnd.0),
        &GUID_CONSOLE_DISPLAY_STATE,
        DEVICE_NOTIFY_WINDOW_HANDLE,
    );
    let _ = WTSRegisterSessionNotification(hwnd, NOTIFY_FOR_THIS_SESSION);

    let mut msg = MSG::default();
    // Runs for the life of the app. GetMessageW returns 0 only on WM_QUIT,
    // which nothing here posts, and -1 on an error the loop cannot fix.
    while GetMessageW(&mut msg, None, 0, 0).as_bool() {
        let _ = TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }
}
