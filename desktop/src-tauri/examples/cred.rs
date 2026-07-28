// Does the Windows credential store actually hold our sign-in?
//
//   cargo run --example cred -- <username>
//
// Exists because "signed out again after a restart" has two very different
// causes, storing failing and reading failing, and they look identical from
// the app.

#[tokio::main]
async fn main() {
    let user = std::env::args().nth(1).unwrap_or_else(|| "desktoptest".into());

    // With a url and password, run the real sign-in first and then read it
    // back in the same process, which separates "storing failed" from
    // "storing worked but nothing survives the process".
    if let (Some(url), Some(password)) = (std::env::args().nth(2), std::env::args().nth(3)) {
        let config = omni_recorder_lib::auth::fetch_config(&url).await.expect("config");
        match omni_recorder_lib::auth::sign_in(&config, &user, &password).await {
            Ok(()) => println!("sign_in ok"),
            Err(e) => println!("sign_in failed: {e}"),
        }
    }

    println!("has_stored_session({user}) = {}", omni_recorder_lib::auth::has_stored_session(&user));

    let entry = keyring::Entry::new("Omni Recorder", &user).expect("entry");
    match entry.get_password() {
        Ok(secret) => println!("read back {} chars", secret.len()),
        Err(e) => println!("read failed: {e}"),
    }

    println!("--- round trip on a scratch account ---");
    let scratch = keyring::Entry::new("Omni Recorder", "__roundtrip__").expect("entry");
    println!("write: {:?}", scratch.set_password("hello"));
    println!("read:  {:?}", scratch.get_password());
    println!("del:   {:?}", scratch.delete_credential());

    // Deliberately never writes to the real account: doing so overwrites a
    // live refresh token, and the app then fails at the end of a recording
    // with "refresh token is not valid" for no reason anyone could guess.
    println!("--- a second Entry sees the same scratch credential ---");
    let a = keyring::Entry::new("Omni Recorder", "__roundtrip2__").expect("entry");
    println!("write: {:?}", a.set_password("hello"));
    let b = keyring::Entry::new("Omni Recorder", "__roundtrip2__").expect("entry");
    println!("read from a second Entry: {:?}", b.get_password());
    println!("del:   {:?}", b.delete_credential());
}
