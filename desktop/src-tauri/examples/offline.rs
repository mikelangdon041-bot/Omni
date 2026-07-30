// Being offline must not sign you out.
//
//   cargo run --example offline
//
// A refresh against an unreachable host has to leave the stored credential
// alone, while a refresh the server actually refuses has to clear it. Those
// two look identical from the app and are opposite in consequence: one is a
// train tunnel, the other is a session that is genuinely over.

use omni_recorder_lib::auth::{self, DesktopConfig};

const USER: &str = "__offline_test__";

fn store(secret: &str) {
    keyring::Entry::new("Omni Recorder", USER)
        .expect("entry")
        .set_password(secret)
        .expect("write");
}

fn present() -> bool {
    keyring::Entry::new("Omni Recorder", USER)
        .expect("entry")
        .get_password()
        .is_ok()
}

fn clear() {
    if let Ok(e) = keyring::Entry::new("Omni Recorder", USER) {
        let _ = e.delete_credential();
    }
}

#[tokio::main]
async fn main() {
    let mut failures = 0;

    // 1. Unreachable host: the credential must survive.
    store("pretend-refresh-token");
    let unreachable = DesktopConfig {
        // Reserved by RFC 6761 to never resolve.
        supabase_url: "https://omni-offline-test.invalid".into(),
        supabase_anon_key: "anon".into(),
        email_domain: "omni.local".into(),
    };
    let err = auth::access_token(&unreachable, USER).await.unwrap_err();
    let kept = present();
    println!("offline  -> error: {err}");
    println!("         -> credential kept: {kept}  (must be true)");
    if !kept {
        failures += 1;
    }
    clear();

    // 2. A real Supabase host refusing a nonsense token: it must be cleared.
    store("definitely-not-a-real-refresh-token");
    let real = match auth::fetch_config("https://omni-nine-navy.vercel.app").await {
        Ok(c) => c,
        Err(e) => {
            println!("\nskipped the rejection case, could not reach Omni: {e}");
            clear();
            std::process::exit(if failures > 0 { 1 } else { 0 });
        }
    };
    let err = auth::access_token(&real, USER).await.unwrap_err();
    let gone = !present();
    println!("\nrejected -> error: {err}");
    println!("         -> credential cleared: {gone}  (must be true)");
    if !gone {
        failures += 1;
    }
    clear();

    println!("\n{}", if failures == 0 { "both correct" } else { "FAILED" });
    std::process::exit(if failures > 0 { 1 } else { 0 });
}
