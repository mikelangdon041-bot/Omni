// Omni Recorder — a tray app whose entire job is to remove the clicks between
// "this meeting is starting" and a recording that is running.
//
// The web app can already do all of this, but starting a recording there means
// opening a tab, ticking consent, and getting through a screen-share picker
// where the "share system audio" checkbox is easy to miss and silently costs
// you the far end of the call. Here it is one hotkey, and the audio devices
// were decided once in Settings.
//
// The shape of it:
//   hotkey / tray / window  ->  toggle()
//   toggle() start          ->  audio::Recorder writing an MP3
//   toggle() stop           ->  upload, transcribe, capture, open the meeting
//
// Everything long-running happens off the UI thread and reports back by
// emitting `status` events, which is the only thing the window renders.

// Public so the examples can exercise these on their own, without a window:
// `probe` checks a machine's audio devices, `e2e` runs a recording all the way
// through a real deployment. Both are how this app gets tested at all, given
// the alternative is starting a meeting.
pub mod audio;
pub mod auth;
pub mod omni;
mod settings;

use std::path::PathBuf;
use std::sync::Mutex;

use serde::Serialize;
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};
use tauri_plugin_autostart::ManagerExt as AutostartExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tauri_plugin_notification::NotificationExt;

// Ctrl+Shift+R starts a meeting; this starts a piece of writing. Fixed rather
// than a Settings field like the recording hotkey — the recording one earns
// that because missing it costs you a meeting, this one only saves a few
// clicks either way. Easy to promote later if it turns out to matter.
//
// Ctrl+Shift+W specifically is a bad choice: it is "close window" in Firefox
// and several editors including this one, so it is already claimed
// system-wide on a normal dev machine before this app ever starts. Verified
// by hand — RegisterHotKey for Ctrl+Shift+W failed with
// ERROR_HOTKEY_ALREADY_REGISTERED here; Ctrl+Alt+W did not.
const COMPOSE_HOTKEY: &str = "Ctrl+Alt+W";

#[derive(Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Phase {
    /// Signed out, or no Omni address yet.
    Setup,
    Idle,
    Recording,
    /// Uploading, transcribing, writing the notes.
    Working,
    Done,
    Error,
}

#[derive(Clone, Serialize)]
pub struct Status {
    phase: Phase,
    message: String,
    /// 0-100 while working; ignored otherwise.
    percent: u32,
    seconds: u64,
    /// Peak level 0-100 while recording, for the meter.
    level: u32,
    signed_in: bool,
    username: String,
    omni_url: String,
    hotkey: String,
    capture_mic: bool,
    capture_system: bool,
    keep_audio: bool,
    open_when_done: bool,
    start_at_login: bool,
    mic_device_id: String,
    system_device_id: String,
    /// URL of the last finished meeting, so "Open it" works after the fact.
    last_meeting: String,
    /// Recordings found on disk that never became meetings — the app was
    /// killed, the machine restarted, or an upload failed. Offered back rather
    /// than left in a folder nobody would think to look in.
    orphans: Vec<Orphan>,
}

#[derive(Clone, Serialize)]
pub struct Orphan {
    path: String,
    /// "23 May, 14:05" — enough to recognise which meeting it was.
    when: String,
    /// Rounded minutes, so a stray two-second file is obviously not a meeting.
    minutes: u64,
}

/// Anything left in the recordings folder is by definition unfinished: a
/// recording is deleted the moment its meeting exists.
fn find_orphans(app: &AppHandle) -> Vec<Orphan> {
    let dir = app
        .path()
        .app_local_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir())
        .join("recordings");
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };

    let mut out: Vec<(std::time::SystemTime, Orphan)> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("mp3") {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        // A file with nothing in it is a start that never got anywhere.
        if meta.len() < 8_000 {
            let _ = std::fs::remove_file(&path);
            continue;
        }
        let modified = meta.modified().unwrap_or(std::time::SystemTime::UNIX_EPOCH);
        let when: chrono::DateTime<chrono::Local> = modified.into();
        // 64 kbps mono, so bytes to seconds is a division. Near enough for
        // "was this the hour-long one or the short one?".
        let minutes = meta.len() / (8_000 * 60);
        out.push((
            modified,
            Orphan {
                path: path.to_string_lossy().to_string(),
                when: when.format("%-d %b, %H:%M").to_string(),
                minutes,
            },
        ));
    }
    // Newest first: the one you just lost is the one you want back.
    out.sort_by(|a, b| b.0.cmp(&a.0));
    out.into_iter().map(|(_, o)| o).collect()
}

pub struct AppState {
    recorder: Mutex<Option<audio::Recorder>>,
    settings: Mutex<settings::Settings>,
    status: Mutex<Status>,
    tray: Mutex<Option<TrayIcon>>,
    /// Guards against a second hotkey press while a stop is still being
    /// processed, which would otherwise start a recording on top of an upload.
    busy: Mutex<bool>,
}

impl AppState {
    fn new(settings: settings::Settings) -> Self {
        let signed_in = auth::has_stored_session(&settings.username);
        let status = Status {
            phase: if signed_in && !settings.normalized_url().is_empty() {
                Phase::Idle
            } else {
                Phase::Setup
            },
            message: String::new(),
            percent: 0,
            seconds: 0,
            level: 0,
            signed_in,
            username: settings.username.clone(),
            omni_url: settings.normalized_url(),
            hotkey: settings.hotkey.clone(),
            capture_mic: settings.capture_mic,
            capture_system: settings.capture_system,
            keep_audio: settings.keep_audio,
            open_when_done: settings.open_when_done,
            start_at_login: settings.start_at_login,
            mic_device_id: settings.mic_device_id.clone(),
            system_device_id: settings.system_device_id.clone(),
            last_meeting: String::new(),
            orphans: Vec::new(),
        };
        Self {
            recorder: Mutex::new(None),
            settings: Mutex::new(settings),
            status: Mutex::new(status),
            tray: Mutex::new(None),
            busy: Mutex::new(false),
        }
    }
}

/// Update the status and tell the window about it. Every state change in the
/// app goes through here, so there is exactly one thing to keep consistent.
fn set_status(app: &AppHandle, mutate: impl FnOnce(&mut Status)) {
    let snapshot = {
        let state = app.state::<AppState>();
        let mut status = state.status.lock().unwrap();
        mutate(&mut status);
        status.clone()
    };
    let _ = app.emit("status", &snapshot);
    update_tray(app, &snapshot);
}

fn update_tray(app: &AppHandle, status: &Status) {
    let state = app.state::<AppState>();
    let tray = state.tray.lock().unwrap();
    let Some(tray) = tray.as_ref() else { return };

    let tooltip = match status.phase {
        Phase::Recording => format!("Omni Recorder, recording {}", mmss(status.seconds)),
        Phase::Working => format!("Omni Recorder, {} ({}%)", status.message, status.percent),
        Phase::Setup => "Omni Recorder, sign in to get started".to_string(),
        Phase::Error => format!("Omni Recorder, {}", status.message),
        _ => format!("Omni Recorder, press {} to record", status.hotkey),
    };
    let _ = tray.set_tooltip(Some(&tooltip));

    // The icon is the only status indicator visible when the window is shut,
    // so it has to say whether something is being recorded right now.
    let name = if status.phase == Phase::Recording {
        "icons/tray-recording.png"
    } else {
        "icons/tray-idle.png"
    };
    if let Ok(path) = app.path().resolve(name, tauri::path::BaseDirectory::Resource) {
        if let Ok(image) = Image::from_path(path) {
            let _ = tray.set_icon(Some(image));
        }
    }
}

fn mmss(seconds: u64) -> String {
    format!("{:02}:{:02}", seconds / 60, seconds % 60)
}

fn recording_path(app: &AppHandle) -> PathBuf {
    let dir = app
        .path()
        .app_local_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir())
        .join("recordings");
    let stamp = chrono::Local::now().format("%Y-%m-%d-%H%M%S");
    dir.join(format!("meeting-{stamp}.mp3"))
}

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

fn start_recording(app: &AppHandle) -> Result<(), String> {
    let settings = {
        let state = app.state::<AppState>();
        let s = state.settings.lock().unwrap();
        s.clone()
    };

    if settings.normalized_url().is_empty() || !auth::has_stored_session(&settings.username) {
        return Err("Sign in to Omni first.".into());
    }

    let path = recording_path(app);
    let recorder = audio::Recorder::start(
        path,
        settings.capture_mic.then(|| settings.mic_device_id.clone()),
        settings.capture_system.then(|| settings.system_device_id.clone()),
    )
    .map_err(|e| e.to_string())?;

    {
        let state = app.state::<AppState>();
        *state.recorder.lock().unwrap() = Some(recorder);
    }
    set_status(app, |s| {
        s.phase = Phase::Recording;
        s.message = String::new();
        s.seconds = 0;
        s.percent = 0;
        s.last_meeting = String::new();
    });

    // Tick the elapsed time and level so the tray tooltip and the window both
    // show a recording that is visibly alive.
    let app = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(250));
        let reading = {
            let state = app.state::<AppState>();
            let recorder = state.recorder.lock().unwrap();
            recorder
                .as_ref()
                .map(|r| (r.seconds() as u64, r.level(), r.first_error()))
        };
        let Some((seconds, level, error)) = reading else { break };
        set_status(&app, |s| {
            if s.phase == Phase::Recording {
                s.seconds = seconds;
                s.level = level;
                // A device that failed to open means half the meeting is
                // missing. Say so now, while there is time to do something.
                if let Some(error) = error {
                    s.message = error;
                }
            }
        });
    });

    Ok(())
}

async fn stop_recording(app: AppHandle) {
    let recorder = {
        let state = app.state::<AppState>();
        let mut slot = state.recorder.lock().unwrap();
        slot.take()
    };
    let Some(recorder) = recorder else { return };

    set_status(&app, |s| {
        s.phase = Phase::Working;
        s.message = "Finishing the recording".into();
        s.percent = 0;
        s.level = 0;
    });

    let recording = match recorder.stop() {
        Ok(r) => r,
        Err(e) => return fail(&app, format!("Could not finish the recording: {e}")),
    };

    if recording.seconds < 1.0 {
        return fail(&app, "That recording was too short to transcribe.".into());
    }
    if !recording.heard_mic && !recording.heard_system {
        let _ = std::fs::remove_file(&recording.path);
        return fail(
            &app,
            "No sound reached the recorder. Check the devices in Settings.".into(),
        );
    }

    let settings = {
        let state = app.state::<AppState>();
        let s = state.settings.lock().unwrap();
        s.clone()
    };

    match upload_and_capture(&app, &settings, &recording.path).await {
        Ok(captured) => {
            let url = format!("{}{}", settings.normalized_url(), captured.path);
            let _ = std::fs::remove_file(&recording.path);
            let title = captured.title.clone();
            set_status(&app, |s| {
                s.phase = Phase::Done;
                s.percent = 100;
                s.message = title.clone();
                s.last_meeting = url.clone();
            });
            notify(&app, "Meeting saved", &captured.title);
            if settings.open_when_done {
                let _ = tauri_plugin_opener::open_url(&url, None::<&str>);
            }
        }
        Err(e) => {
            // The recording stays on disk when the upload fails: it is the
            // only copy of the meeting, and it can be dropped into the web
            // uploader by hand.
            fail(
                &app,
                format!("{e}\n\nThe recording is kept at {}", recording.path.display()),
            );
        }
    }
}

async fn upload_and_capture(
    app: &AppHandle,
    settings: &settings::Settings,
    audio: &std::path::Path,
) -> Result<omni::Captured, String> {
    let base = settings.normalized_url();
    let config = auth::fetch_config(&base).await.map_err(|e| e.to_string())?;
    let token = auth::access_token(&config, &settings.username)
        .await
        .map_err(|e| e.to_string())?;
    let client = omni::Client::new(&base, &token).map_err(|e| e.to_string())?;

    let progress = {
        let app = app.clone();
        move |p: omni::Progress| {
            set_status(&app, |s| {
                s.phase = Phase::Working;
                s.percent = p.percent;
                s.message = p.label;
            });
        }
    };

    let (transcript, _speakers, audio_path) = client
        .transcribe(audio, settings.keep_audio, &progress)
        .await
        .map_err(|e| e.to_string())?;

    if transcript.trim().is_empty() {
        return Err("No speech was picked up in that recording.".into());
    }

    set_status(app, |s| {
        s.phase = Phase::Working;
        s.percent = 100;
        s.message = "Writing your notes".into();
    });

    client
        .capture(&transcript, &audio_path, settings.keep_audio)
        .await
        .map_err(|e| e.to_string())
}

fn fail(app: &AppHandle, message: String) {
    // A failure can be the moment the session died — a revoked or rotated
    // refresh token is dropped when it is refused, so re-reading the
    // credential store here is what moves the app back to the sign-in screen
    // instead of leaving it looking signed in and failing every time.
    let still_signed_in = {
        let state = app.state::<AppState>();
        let settings = state.settings.lock().unwrap();
        auth::has_stored_session(&settings.username)
    };
    let for_status = message.clone();
    set_status(app, move |s| {
        s.signed_in = still_signed_in;
        s.phase = if still_signed_in { Phase::Error } else { Phase::Setup };
        s.message = for_status;
        s.percent = 0;
    });
    notify(app, "Omni Recorder", &message);
    show_window(app);
}

fn notify(app: &AppHandle, title: &str, body: &str) {
    let _ = app.notification().builder().title(title).body(body).show();
}

fn show_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// The one entry point every trigger shares: hotkey, tray, and the button.
fn toggle(app: &AppHandle) {
    let recording = {
        let state = app.state::<AppState>();
        let is_recording = state.recorder.lock().unwrap().is_some();
        is_recording
    };

    if recording {
        {
            let state = app.state::<AppState>();
            let mut busy = state.busy.lock().unwrap();
            if *busy {
                return;
            }
            *busy = true;
        }
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            stop_recording(app.clone()).await;
            let state = app.state::<AppState>();
            let mut busy = state.busy.lock().unwrap();
            *busy = false;
        });
        return;
    }

    let working = {
        let state = app.state::<AppState>();
        let phase = state.status.lock().unwrap().phase;
        phase == Phase::Working
    };
    if working {
        // The previous meeting is still uploading. Starting another recording
        // now would compete with it for the network and the status line;
        // there is nothing useful to do but say so.
        notify(
            app,
            "Omni Recorder",
            "Still finishing the last meeting. Try again in a moment.",
        );
        return;
    }

    match start_recording(app) {
        Ok(()) => notify(app, "Recording", "Omni is recording this meeting."),
        Err(e) => fail(app, e),
    }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command]
fn get_status(state: State<AppState>) -> Status {
    let status = state.status.lock().unwrap();
    status.clone()
}

#[tauri::command]
fn list_audio_devices() -> Result<serde_json::Value, String> {
    let inputs = audio::list_devices(false).map_err(|e| e.to_string())?;
    let outputs = audio::list_devices(true).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "inputs": inputs, "outputs": outputs }))
}

// Signing in is a username and a password. There is one Omni and the app
// already knows where it is, so asking for the address every time was one
// field of pure friction on the screen that exists to remove friction. It
// lives in Settings instead, for the day the deployment moves.
#[tauri::command]
async fn sign_in(app: AppHandle, username: String, password: String) -> Result<(), String> {
    let base = {
        let state = app.state::<AppState>();
        let settings = state.settings.lock().unwrap();
        let url = settings.normalized_url();
        if url.is_empty() {
            settings::DEFAULT_OMNI_URL.to_string()
        } else {
            url
        }
    };

    let config = auth::fetch_config(&base).await.map_err(|e| e.to_string())?;
    auth::sign_in(&config, &username, &password)
        .await
        .map_err(|e| e.to_string())?;

    let username = username.trim().to_lowercase();
    {
        let state = app.state::<AppState>();
        let mut settings = state.settings.lock().unwrap();
        settings.omni_url = base.clone();
        settings.username = username.clone();
        settings::save(&settings).map_err(|e| e.to_string())?;
    }
    set_status(&app, move |s| {
        s.signed_in = true;
        s.username = username;
        s.omni_url = base;
        s.phase = Phase::Idle;
        s.message = String::new();
    });
    Ok(())
}

#[tauri::command]
fn sign_out(app: AppHandle) {
    let username = {
        let state = app.state::<AppState>();
        let settings = state.settings.lock().unwrap();
        settings.username.clone()
    };
    auth::sign_out(&username);
    set_status(&app, |s| {
        s.signed_in = false;
        s.phase = Phase::Setup;
        s.message = String::new();
    });
}

#[derive(serde::Deserialize)]
pub struct SettingsPatch {
    omni_url: String,
    mic_device_id: String,
    system_device_id: String,
    capture_mic: bool,
    capture_system: bool,
    keep_audio: bool,
    open_when_done: bool,
    start_at_login: bool,
    hotkey: String,
}

/// Keep the Windows run-at-login entry in step with the setting. Best effort:
/// a registry write that fails is worth reporting, never worth blocking the
/// rest of the settings over.
fn apply_autostart(app: &AppHandle, enabled: bool) {
    let manager = app.autolaunch();
    let _ = if enabled {
        manager.enable()
    } else {
        manager.disable()
    };
}

#[tauri::command]
fn save_settings(app: AppHandle, patch: SettingsPatch) -> Result<(), String> {
    let previous_hotkey = {
        let state = app.state::<AppState>();
        let mut settings = state.settings.lock().unwrap();
        let previous = settings.hotkey.clone();
        // An address cleared to nothing would lock the app out of its own
        // deployment, so an empty box means "put it back to the default".
        let typed = patch.omni_url.trim().trim_end_matches('/').to_string();
        settings.omni_url = if typed.is_empty() {
            settings::DEFAULT_OMNI_URL.to_string()
        } else if typed.starts_with("http") {
            typed
        } else {
            format!("https://{typed}")
        };
        settings.mic_device_id = patch.mic_device_id;
        settings.system_device_id = patch.system_device_id;
        settings.capture_mic = patch.capture_mic;
        settings.capture_system = patch.capture_system;
        settings.keep_audio = patch.keep_audio;
        settings.open_when_done = patch.open_when_done;
        settings.start_at_login = patch.start_at_login;
        settings.hotkey = if patch.hotkey.trim().is_empty() {
            settings::DEFAULT_HOTKEY.to_string()
        } else {
            patch.hotkey.trim().to_string()
        };
        settings::save(&settings).map_err(|e| e.to_string())?;
        previous
    };

    let settings = {
        let state = app.state::<AppState>();
        let s = state.settings.lock().unwrap();
        s.clone()
    };

    if previous_hotkey != settings.hotkey {
        register_hotkey(&app, &previous_hotkey, &settings.hotkey)?;
    }
    apply_autostart(&app, settings.start_at_login);

    set_status(&app, move |s| {
        s.start_at_login = settings.start_at_login;
        s.omni_url = settings.omni_url;
        s.mic_device_id = settings.mic_device_id;
        s.system_device_id = settings.system_device_id;
        s.capture_mic = settings.capture_mic;
        s.capture_system = settings.capture_system;
        s.keep_audio = settings.keep_audio;
        s.open_when_done = settings.open_when_done;
        s.hotkey = settings.hotkey;
    });
    Ok(())
}

#[tauri::command]
fn toggle_recording(app: AppHandle) {
    toggle(&app);
}

// Send a recording that never made it — the app was killed mid-meeting, the
// machine restarted, or the upload failed. Same pipeline as a normal stop, so
// a recovered meeting is indistinguishable from one that went straight
// through.
#[tauri::command]
async fn recover(app: AppHandle, path: String) -> Result<(), String> {
    let file = std::path::PathBuf::from(&path);
    if !file.is_file() {
        return Err("That recording is no longer on disk.".into());
    }
    let settings = {
        let state = app.state::<AppState>();
        let s = state.settings.lock().unwrap();
        s.clone()
    };
    set_status(&app, |s| {
        s.phase = Phase::Working;
        s.percent = 0;
        s.message = "Sending the recovered recording".into();
    });

    match upload_and_capture(&app, &settings, &file).await {
        Ok(captured) => {
            let url = format!("{}{}", settings.normalized_url(), captured.path);
            let _ = std::fs::remove_file(&file);
            let title = captured.title.clone();
            let orphans = find_orphans(&app);
            let for_status = url.clone();
            set_status(&app, move |s| {
                s.phase = Phase::Done;
                s.percent = 100;
                s.message = title;
                s.last_meeting = for_status;
                s.orphans = orphans;
            });
            if settings.open_when_done {
                let _ = tauri_plugin_opener::open_url(&url, None::<&str>);
            }
            Ok(())
        }
        Err(e) => {
            // Left on disk deliberately: a failed recovery must not be the
            // thing that finally loses the recording.
            fail(&app, e.clone());
            Err(e)
        }
    }
}

#[tauri::command]
fn discard_orphan(app: AppHandle, path: String) {
    let file = std::path::PathBuf::from(&path);
    // Only ever inside our own recordings folder, so a bad path from the
    // window cannot be turned into deleting something else.
    let dir = app
        .path()
        .app_local_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir())
        .join("recordings");
    if file.starts_with(&dir) {
        let _ = std::fs::remove_file(&file);
    }
    let orphans = find_orphans(&app);
    set_status(&app, move |s| s.orphans = orphans);
}

#[tauri::command]
fn open_url(url: String) {
    let _ = tauri_plugin_opener::open_url(&url, None::<&str>);
}

#[tauri::command]
fn hide_window(app: AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}

// Each shortcut carries its own handler rather than one handler dispatching
// on every press, because that is what lets the recording hotkey and the
// compose hotkey coexist: a single blanket handler firing `toggle` for any
// registered shortcut would start a recording every time Ctrl+Shift+W was
// pressed too.
fn register_hotkey(app: &AppHandle, previous: &str, next: &str) -> Result<(), String> {
    let shortcuts = app.global_shortcut();
    if let Ok(old) = previous.parse::<Shortcut>() {
        let _ = shortcuts.unregister(old);
    }
    let parsed = next
        .parse::<Shortcut>()
        .map_err(|_| format!("\"{next}\" is not a shortcut Windows understands."))?;
    shortcuts
        .on_shortcut(parsed, |app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                toggle(app);
            }
        })
        .map_err(|e| format!("Could not claim {next}: {e}. Another app may already have it."))
}

/// Bring the window forward on whatever it's showing, and tell it to switch to
/// the compose picker instead of asking the Rust side to know anything about
/// Writing Studio — the six document types live in the window's own code,
/// same as every other piece of that UI.
fn open_composer(app: &AppHandle) {
    show_window(app);
    let _ = app.emit("open-compose", ());
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

pub fn run() {
    tauri::Builder::default()
        // Must be the first plugin registered: it is what makes a second
        // launch (autostart racing a manual open, or a stale process from
        // before an update) hand off to the already-running instance instead
        // of starting a rival that silently loses the hotkey registration.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            show_window(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            // The registry Run key rather than a Startup-folder shortcut, so
            // uninstalling takes it with it.
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            // Started by Windows, not by a person: go to the tray, do not pop
            // a window in front of whatever they are already doing.
            Some(vec!["--autostart"]),
        ))
        // No blanket handler here: each shortcut registers its own in
        // register_hotkey / the compose registration below, which is what
        // lets two different hotkeys coexist without one triggering the
        // other's action.
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            get_status,
            list_audio_devices,
            sign_in,
            sign_out,
            save_settings,
            toggle_recording,
            recover,
            discard_orphan,
            open_url,
            hide_window,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let config_path = handle
                .path()
                .app_config_dir()
                .unwrap_or_else(|_| std::env::temp_dir())
                .join("settings.json");
            settings::set_path(config_path);

            let mut loaded = settings::load();
            // The username lives in settings.json, and the refresh token is
            // filed under it, so losing that one file used to sign you out
            // with the credential still sitting there untouched. If the file
            // is gone or was never written, ask the credential store who was
            // signed in last and put it back.
            if loaded.username.trim().is_empty() {
                if let Some(user) = auth::last_user() {
                    loaded.username = user;
                    let _ = settings::save(&loaded);
                }
            }
            let hotkey = loaded.hotkey.clone();
            let start_at_login = loaded.start_at_login;
            app.manage(AppState::new(loaded));

            // Reassert it every launch: an app moved or reinstalled leaves a
            // Run entry pointing at a path that no longer exists.
            apply_autostart(&handle, start_at_login);

            // Tray first: it is the app's only permanent surface, and if the
            // window is closed it is the only way back in.
            let toggle_item =
                MenuItem::with_id(app, "toggle", "Start / stop recording", true, None::<&str>)?;
            let compose_item =
                MenuItem::with_id(app, "compose", "New writing piece", true, None::<&str>)?;
            let open_item =
                MenuItem::with_id(app, "open", "Open Omni Recorder", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(
                app,
                &[&toggle_item, &compose_item, &open_item, &quit_item],
            )?;

            let tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "toggle" => toggle(app),
                    "compose" => open_composer(app),
                    "open" => show_window(app),
                    "quit" => {
                        // Stopping first means a recording in progress is
                        // still written out rather than abandoned.
                        let recorder = {
                            let state = app.state::<AppState>();
                            let mut slot = state.recorder.lock().unwrap();
                            slot.take()
                        };
                        if let Some(recorder) = recorder {
                            let _ = recorder.stop();
                        }
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::DoubleClick { .. } = event {
                        show_window(tray.app_handle());
                    }
                })
                .build(app)?;

            {
                let state = handle.state::<AppState>();
                *state.tray.lock().unwrap() = Some(tray);
            }

            // A hotkey another app already owns is worth saying out loud, but
            // not worth refusing to start over.
            if let Err(e) = register_hotkey(&handle, "", &hotkey) {
                set_status(&handle, move |s| s.message = e);
            }

            // The compose hotkey is fixed, so it only needs registering once,
            // here, rather than going through save_settings like the
            // recording one does.
            if let Err(e) = handle
                .global_shortcut()
                .on_shortcut(COMPOSE_HOTKEY, |app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        open_composer(app);
                    }
                })
            {
                // Unlike the recording hotkey, nothing later ever surfaces
                // this: the window usually starts hidden, and there is no
                // failed-recording moment that would force it open. A silent
                // failure here means Ctrl+Alt+W looks like it does nothing,
                // forever, with no way to find out why — so it gets a
                // notification of its own rather than a status line nobody
                // is looking at.
                let message = format!(
                    "Could not claim {COMPOSE_HOTKEY} for Writing Studio: {e}. Another app may already have it."
                );
                notify(&handle, "Omni Recorder", &message);
                set_status(&handle, move |s| s.message = message);
            }

            // A recording sitting in the folder means the last one never
            // became a meeting. Surface it now: on disk and unmentioned is the
            // same as lost.
            let orphans = find_orphans(&handle);
            let recovered = !orphans.is_empty();
            set_status(&handle, move |s| s.orphans = orphans);

            let snapshot = {
                let state = handle.state::<AppState>();
                let s = state.status.lock().unwrap();
                s.clone()
            };
            update_tray(&handle, &snapshot);

            // Nothing to configure means nothing to look at: it starts in the
            // tray. The first run has no session, so it opens to sign-in —
            // unless Windows started it at login, where putting a window in
            // front of whatever someone is doing is not a welcome.
            let launched_by_windows = std::env::args().any(|a| a == "--autostart");
            if (snapshot.phase == Phase::Setup && !launched_by_windows) || recovered {
                // A recovered recording opens the window even at login: it is
                // the one thing worth interrupting for, because until it is
                // sent it is a meeting nobody has notes for.
                show_window(&handle);
            }
            if recovered {
                notify(
                    &handle,
                    "A recording was left behind",
                    "Omni Recorder has a recording that never became a meeting. Open it to send it.",
                );
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the window is "get out of my way", not "quit" — the
            // hotkey has to keep working, which is the entire point.
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building Omni Recorder")
        .run(|_app, event| {
            if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
                // Same reason: the window closing must not take the tray with
                // it, or the app disappears the first time you tidy up. Quit
                // from the tray menu carries an exit code, and that one is
                // meant, so it is allowed through.
                if code.is_none() {
                    api.prevent_exit();
                }
            }
        });
}
