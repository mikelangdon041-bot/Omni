// Push a recording all the way through a real Omni deployment: sign in, upload,
// transcribe, write the notes, create the meeting.
//
//   cargo run --example e2e -- <omni-url> <username> <password> <file.mp3> [keep]
//
// "keep" exercises the branch that stores the audio and the transcript on the
// meeting instead of discarding them once the notes are written, which is
// otherwise only reachable by ticking a box.
//
// Same modules the tray app uses, so a pass here means the app's own path
// works; it just skips the window and the hotkey. Worth having because the
// alternative way to test this is to hold a meeting.

use omni_recorder_lib::{auth, omni};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let keep = args.len() > 4 && args[4] == "keep";
    let [url, username, password, file] = &args[..4.min(args.len())] else {
        eprintln!("usage: e2e <omni-url> <username> <password> <file.mp3> [keep]");
        std::process::exit(2);
    };

    println!("1. asking {url} which Supabase project it uses");
    let config = auth::fetch_config(url).await?;
    println!("   -> {}", config.supabase_url);

    println!("2. signing in as {username}");
    auth::sign_in(&config, username, password).await?;
    let token = auth::access_token(&config, username).await?;
    println!("   -> access token, {} chars", token.len());

    let client = omni::Client::new(url, &token)?;

    println!("3. uploading and transcribing {file} (keep audio: {keep})");
    let progress = |p: omni::Progress| println!("   {:>3}%  {}", p.percent, p.label);
    let (transcript, speakers, audio_path) = client
        .transcribe(std::path::Path::new(file), keep, &progress)
        .await?;
    println!("   -> {} chars, speakers {:?}", transcript.len(), speakers);
    println!("   -> kept audio at {audio_path:?}");
    println!("   -> transcript:\n{}", indent(&transcript));

    println!("4. writing the notes and creating the meeting");
    // Keeping the transcript rides on the same flag: the point of this run is
    // to see the whole artifact, and the meeting is thrown away afterwards.
    let captured = client
        .capture(&transcript, &audio_path, keep, keep, "", "", "")
        .await?;
    println!("   -> {} ({})", captured.title, captured.id);
    println!("\nOpen it at: {url}{}", captured.path);

    // The credential store is the app's, not the test's.
    auth::sign_out(username);
    Ok(())
}

fn indent(text: &str) -> String {
    text.lines()
        .map(|l| format!("      {l}"))
        .collect::<Vec<_>>()
        .join("\n")
}
