// Everything the recorder remembers between runs, except the refresh token,
// which lives in the Windows credential store instead (see auth.rs).
//
// The device choices are the point of this file. Picking a microphone and a
// speaker endpoint every time is exactly the friction the app exists to
// remove, so they are chosen once in Settings and never asked about again.

use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

pub const DEFAULT_HOTKEY: &str = "Ctrl+Shift+R";

/// Where Omni actually lives. Filled in on first run so the sign-in screen has
/// nothing to type but a username and password. A placeholder here instead
/// read as already-filled and the form submitted with an empty address.
/// Editable, for the day the deployment moves.
pub const DEFAULT_OMNI_URL: &str = "https://omni-nine-navy.vercel.app";

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    /// Base URL of the Omni deployment, no trailing slash.
    pub omni_url: String,
    /// Omni username (not the synthetic email) — shown in the UI and used as
    /// the credential-store account name.
    pub username: String,
    /// WASAPI endpoint id of the microphone. Empty means "whatever Windows
    /// calls the default", which is usually what you want.
    pub mic_device_id: String,
    /// WASAPI endpoint id of the *playback* device to capture in loopback
    /// mode. Empty means the default output.
    pub system_device_id: String,
    pub capture_mic: bool,
    pub capture_system: bool,
    /// Keep the audio on the meeting instead of deleting it after
    /// transcription. Off by default, matching the web app.
    pub keep_audio: bool,
    /// Keep the transcript on the meeting instead of dropping it once the
    /// notes are written. Off by default, matching the web app's review
    /// screen — the notes are what gets saved unless you ask for more.
    pub keep_transcript: bool,
    pub hotkey: String,
    /// Open the finished meeting in the browser when the upload completes.
    pub open_when_done: bool,
    /// Start with Windows. On by default: a hotkey you have to remember to
    /// launch something for is not a hotkey, and the meeting has usually
    /// started by the time you notice.
    pub start_at_login: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            omni_url: DEFAULT_OMNI_URL.to_string(),
            username: String::new(),
            mic_device_id: String::new(),
            system_device_id: String::new(),
            capture_mic: true,
            capture_system: true,
            keep_audio: false,
            keep_transcript: false,
            hotkey: DEFAULT_HOTKEY.to_string(),
            open_when_done: true,
            start_at_login: true,
        }
    }
}

impl Settings {
    /// Trailing slashes are the classic way to end up requesting
    /// `https://host//api/...`, so they are stripped once, here.
    pub fn normalized_url(&self) -> String {
        self.omni_url.trim().trim_end_matches('/').to_string()
    }
}

static PATH: Mutex<Option<PathBuf>> = Mutex::new(None);

pub fn set_path(path: PathBuf) {
    *PATH.lock().unwrap() = Some(path);
}

fn path() -> Option<PathBuf> {
    PATH.lock().unwrap().clone()
}

pub fn load() -> Settings {
    let Some(p) = path() else {
        return Settings::default();
    };
    // A missing or corrupt file is not worth surfacing: defaults are a working
    // state, and the user is about to be asked to sign in anyway.
    //
    // The BOM strip is not paranoia. Anything that rewrites this file with a
    // Windows text editor or PowerShell's `Out-File -Encoding utf8` prepends
    // one, serde rejects the whole document, and the symptom is silently being
    // signed out with every setting back to default.
    fs::read_to_string(p)
        .ok()
        .and_then(|raw| serde_json::from_str(raw.trim_start_matches('\u{feff}')).ok())
        .unwrap_or_default()
}

pub fn save(settings: &Settings) -> anyhow::Result<()> {
    let Some(p) = path() else {
        anyhow::bail!("No config directory");
    };
    if let Some(dir) = p.parent() {
        fs::create_dir_all(dir)?;
    }
    fs::write(p, serde_json::to_string_pretty(settings)?)?;
    Ok(())
}
