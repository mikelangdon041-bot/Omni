// Check that this machine's audio really can be captured, without needing the
// app, a sign-in, or a meeting.
//
//   cargo run --example probe            list the endpoints
//   cargo run --example probe -- 6       record 6 seconds and report levels
//
// It exists because "no sound reached the recorder" has several unrelated
// causes (a muted endpoint, a headset that vanished, loopback being blocked)
// and guessing between them from inside a tray app is miserable.

use std::time::Duration;

use omni_recorder_lib::audio;

fn main() -> anyhow::Result<()> {
    println!("Microphones (capture endpoints):");
    for d in audio::list_devices(false)? {
        println!("  {}{}", d.name, if d.is_default { "   [default]" } else { "" });
    }
    println!("\nSpeakers (render endpoints, captured in loopback):");
    for d in audio::list_devices(true)? {
        println!("  {}{}", d.name, if d.is_default { "   [default]" } else { "" });
    }

    let seconds: u64 = std::env::args()
        .nth(1)
        .and_then(|a| a.parse().ok())
        .unwrap_or(0);
    if seconds == 0 {
        println!("\nPass a number of seconds to record a test clip.");
        return Ok(());
    }

    let path = std::env::temp_dir().join("omni-probe.mp3");
    println!("\nRecording {seconds}s to {}…", path.display());
    let recorder = audio::Recorder::start(
        path.clone(),
        Some(String::new()),
        Some(String::new()),
    )?;

    for _ in 0..seconds * 4 {
        std::thread::sleep(Duration::from_millis(250));
        print!("\r  {:>5.1}s  level {:>3}%   ", recorder.seconds(), recorder.level());
        use std::io::Write;
        let _ = std::io::stdout().flush();
    }
    if let Some(e) = recorder.first_error() {
        println!("\n  problem: {e}");
    }

    let recording = recorder.stop()?;
    let size = std::fs::metadata(&recording.path).map(|m| m.len()).unwrap_or(0);
    println!("\n\nResult");
    println!("  file           {} ({size} bytes)", recording.path.display());
    println!("  duration       {:.1}s", recording.seconds);
    println!("  heard mic      {}", recording.heard_mic);
    println!("  heard speakers {}", recording.heard_system);
    if !recording.heard_system {
        println!("\n  Nothing came off the speakers. Was anything playing?");
    }
    Ok(())
}
