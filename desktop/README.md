# Omni Recorder

A Windows tray app that records a meeting and sends it to Omni's Meeting Prep.

Omni can already do all of this in the browser, but starting a recording there
takes too many clicks: open a tab, tick consent, then get through a screen-share
picker where the "share system audio" checkbox is easy to miss, and missing it
silently costs you the far end of the call. Here it is one hotkey, and the audio
devices were decided once.

Press **Ctrl+Shift+R** anywhere. Press it again when the meeting ends. The
recording uploads, gets transcribed, becomes notes with follow-ups, and the
finished meeting opens in your browser.

It starts with Windows and sits in the tray, because a shortcut you have to
remember to launch something for is not a shortcut, and by the time you notice
the meeting has started.

## What it captures

Two sources, mixed to one mono track:

- **What you hear** — the meeting's own audio, taken from the speakers via
  WASAPI loopback. No screen share, no prompt, no checkbox to miss.
- **Your microphone** — your side of the conversation.

Loopback is why this is a native app rather than a script. ffmpeg on Windows can
only open *capture* endpoints through dshow, and a machine with no Stereo Mix
and no virtual audio cable has no capture endpoint carrying the meeting's audio.
WASAPI can open a *render* endpoint in loopback mode, which is a different thing
entirely and the only way to hear the far end without a screen share.

The two devices are independent and drift, and loopback delivers nothing at all
while nothing is playing. So the output timeline is wall clock: every 100 ms the
mixer works out how many samples should exist by now, takes that many from each
source, and pads with silence whatever a source could not supply. A silent gap
stays a silent gap instead of pulling everything after it earlier.

Audio is encoded to 64 kbps mono MP3 as it is captured, not afterwards. A
two-hour meeting is about 60 MB rather than the 700 MB the same thing would be
as WAV, which matters because it all has to go up over whatever connection the
meeting was on.

## What it does with it

Nothing new server-side. It drives the same endpoints the web app does:

| Step | Endpoint |
| --- | --- |
| Which Supabase project to sign in against | `GET /api/desktop/config` |
| Sign in | Supabase `token?grant_type=password` |
| Upload, prepare, transcribe, discard | `POST /api/meeting/transcribe-upload` |
| Notes, follow-ups, and the meeting row | `POST /api/meeting/capture` |

Uploads go to Supabase storage in 40 MB parts through signed URLs, because
Vercel rejects request bodies past about 4.5 MB and Supabase rejects any single
object over 50 MB. Transcription runs one chunk per request, so a long meeting
costs more requests rather than a timeout.

`/api/meeting/capture` is the one piece the web app did not already have.
In the browser, creating the meeting is client-side: the record page asks for
the notes, shows them for review, and inserts the row when you press Save. A
tray app has no review screen, so this endpoint does both halves and applies the
review defaults — keep the transcript, cut the opening small talk, keep every
follow-up. All of it is editable on the meeting page, which is where it sends
you.

## Signing in

Username and password, and nothing else: there is one Omni and the app already
knows where it is (`DEFAULT_OMNI_URL` in `settings.rs`, changeable in Settings
if the deployment ever moves). Asking for the address on the screen whose job
is to remove friction was one field of pure friction, and a placeholder there
read as already-filled and submitted empty.

It is the same username and password as the web app, mapped to the same
synthetic `<username>@omni.local` address. Only the refresh token is kept, in
the Windows Credential Manager under **Omni Recorder**; your password is
exchanged once and forgotten. A refresh token the server refuses is deleted,
which is what returns the app to the sign-in screen rather than leaving it
apparently signed in and failing at the end of every recording.

## Building it

Needs the Rust toolchain and the MSVC C++ build tools.

```powershell
npm install
npx tauri build      # installer at src-tauri/target/release/bundle/nsis/
npx tauri dev        # run against the ui/ folder directly
```

The app is **not code signed**, so SmartScreen will warn on first run:
*More info → Run anyway*. Signing it would need a certificate; it does not need
one to work.

### Testing without holding a meeting

Two examples run the real code paths without the window:

```powershell
cd src-tauri
cargo run --example probe                       # list the audio endpoints
cargo run --example probe -- 6                  # record 6s, report levels
cargo run --example e2e -- <url> <user> <pass> <file.mp3>
```

`probe` is the thing to run when the app says no sound reached it — a muted
endpoint, a headset that vanished, and blocked loopback all look the same from
inside the app but not from here. `e2e` pushes a recording through a real
deployment: sign in, upload, transcribe, notes, meeting.

## Layout

```
ui/                  the window: one static page, no framework, no build step
src-tauri/src/
  lib.rs             tray, hotkey, state machine, Tauri commands
  audio.rs           WASAPI capture, mixing, MP3 encoding
  auth.rs            Supabase sign-in, credential store
  omni.rs            the upload/transcribe/capture protocol
  settings.rs        remembered devices, shortcut, preferences
```

Closing the window hides it; the app keeps running in the tray, which is the
whole point of the hotkey. Quit from the tray menu, which stops and writes out a
recording in progress rather than abandoning it.
