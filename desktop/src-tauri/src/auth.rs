// Signing in without shipping a browser.
//
// Omni's web app authenticates against Supabase and keeps the session in
// cookies. A tray app has no cookie jar worth having, so it does the same
// password grant directly and keeps only the refresh token, in the Windows
// Credential Manager. The password itself is never stored: it is exchanged
// once, at sign-in, and forgotten.
//
// Usernames are mapped to a synthetic email (`<username>@omni.local`) exactly
// as the web login does, so the same account works in both places. The domain
// and the project's URL and anon key come from the deployment itself, which
// means moving Omni to a new project needs no new build of this app.

use anyhow::{anyhow, Context, Result};
use keyring::Entry;
use serde::Deserialize;
use std::sync::Mutex;
use std::time::{Duration, Instant};

const SERVICE: &str = "Omni Recorder";

/// Where the last signed-in username is kept, under a fixed name.
///
/// The refresh token is stored per user, so finding it needs the username, and
/// the username lived only in settings.json. Losing that one file therefore
/// signed you out even though the credential was sitting untouched in the
/// credential store, because nothing knew whose credential to ask for. Keeping
/// the name next to the token means the session survives anything that happens
/// to the config file.
const LAST_USER: &str = "__last_user__";

#[derive(Clone, Debug, Deserialize)]
pub struct DesktopConfig {
    #[serde(rename = "supabaseUrl")]
    pub supabase_url: String,
    #[serde(rename = "supabaseAnonKey")]
    pub supabase_anon_key: String,
    #[serde(rename = "emailDomain")]
    pub email_domain: String,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: String,
    #[serde(default)]
    expires_in: u64,
}

#[derive(Debug, Deserialize)]
struct AuthError {
    #[serde(default)]
    error_description: Option<String>,
    #[serde(default)]
    msg: Option<String>,
    #[serde(default)]
    message: Option<String>,
}

struct Cached {
    token: String,
    /// When it stops being usable. Refreshed early rather than on failure, so
    /// a long meeting cannot expire mid-upload.
    expires: Instant,
}

static CACHE: Mutex<Option<Cached>> = Mutex::new(None);

fn client() -> Result<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .context("Could not start the HTTP client")
}

/// Ask the Omni deployment which Supabase project it uses.
pub async fn fetch_config(omni_url: &str) -> Result<DesktopConfig> {
    let url = format!("{omni_url}/api/desktop/config");
    let res = client()?
        .get(&url)
        .send()
        .await
        .with_context(|| format!("Could not reach Omni at {omni_url}"))?;
    if !res.status().is_success() {
        return Err(anyhow!(
            "Omni answered {} for {url}. Check the address is right and that the deployment is up to date.",
            res.status()
        ));
    }
    let config: DesktopConfig = res.json().await.context("Omni sent an unexpected reply")?;
    if config.supabase_url.is_empty() || config.supabase_anon_key.is_empty() {
        return Err(anyhow!("That Omni deployment has no Supabase settings"));
    }
    Ok(config)
}

fn entry(username: &str) -> Result<Entry> {
    Entry::new(SERVICE, username).context("Could not open the Windows credential store")
}

/// Why a token request failed, which decides whether the stored credential is
/// worth keeping.
///
/// These are not the same thing at all. A server that says "this token is no
/// good" means the session is over. A server we could not reach says nothing
/// about the token — the laptop is on a train, the wifi dropped, the VPN is
/// reconnecting — and throwing the credential away for that would sign you out
/// for being offline, which is exactly when you least want to be handed a
/// login screen.
enum TokenError {
    /// Refused outright. It will not work later either.
    Rejected(String),
    /// Could not ask. The credential may well still be fine.
    Unavailable(String),
}

impl TokenError {
    fn message(&self) -> &str {
        match self {
            TokenError::Rejected(m) | TokenError::Unavailable(m) => m,
        }
    }
}

async fn token_request(
    config: &DesktopConfig,
    grant: &str,
    body: serde_json::Value,
) -> std::result::Result<TokenResponse, TokenError> {
    let url = format!("{}/auth/v1/token?grant_type={grant}", config.supabase_url);
    let http = client().map_err(|e| TokenError::Unavailable(e.to_string()))?;
    let res = http
        .post(&url)
        .header("apikey", &config.supabase_anon_key)
        .header("Authorization", format!("Bearer {}", config.supabase_anon_key))
        .json(&body)
        .send()
        .await
        .map_err(|_| {
            TokenError::Unavailable("Could not reach Omni. Check your connection.".into())
        })?;

    let status = res.status();
    if !status.is_success() {
        let text = res.text().await.unwrap_or_default();
        let detail = serde_json::from_str::<AuthError>(&text)
            .ok()
            .and_then(|e| e.error_description.or(e.msg).or(e.message))
            .unwrap_or_else(|| {
                if status == reqwest::StatusCode::BAD_REQUEST {
                    "Wrong username or password".to_string()
                } else {
                    format!("Sign-in failed ({status})")
                }
            });
        // Only the client-error range is the server actually refusing us.
        // A 500, a 502 from a cold deployment or a 429 are all temporary.
        return Err(if status.is_client_error() {
            TokenError::Rejected(detail)
        } else {
            TokenError::Unavailable(detail)
        });
    }

    res.json()
        .await
        .map_err(|_| TokenError::Unavailable("Omni sent an unexpected reply".into()))
}

/// Exchange a username and password for a session, and keep the refresh token.
pub async fn sign_in(config: &DesktopConfig, username: &str, password: &str) -> Result<()> {
    let username = username.trim().to_lowercase();
    if username.is_empty() {
        return Err(anyhow!("Enter your Omni username"));
    }
    let email = format!("{username}@{}", config.email_domain);
    let tokens = token_request(
        config,
        "password",
        serde_json::json!({ "email": email, "password": password }),
    )
    .await
    .map_err(|e| anyhow!("{}", e.message()))?;

    entry(&username)?
        .set_password(&tokens.refresh_token)
        .context("Could not save the sign-in to the Windows credential store")?;
    // Best effort: without it the session still works, it is just fragile to
    // losing settings.json.
    if let Ok(marker) = entry(LAST_USER) {
        let _ = marker.set_password(&username);
    }
    cache(tokens.access_token, tokens.expires_in);
    Ok(())
}

/// Who was signed in last, for when the config file cannot say.
pub fn last_user() -> Option<String> {
    entry(LAST_USER)
        .ok()?
        .get_password()
        .ok()
        .map(|u| u.trim().to_lowercase())
        .filter(|u| !u.is_empty())
}

pub fn sign_out(username: &str) {
    *CACHE.lock().unwrap() = None;
    if let Ok(e) = entry(&username.trim().to_lowercase()) {
        let _ = e.delete_credential();
    }
    // Signing out is meant to be forgotten, so the name goes with the token.
    if let Ok(marker) = entry(LAST_USER) {
        let _ = marker.delete_credential();
    }
}

pub fn has_stored_session(username: &str) -> bool {
    if username.trim().is_empty() {
        return false;
    }
    entry(&username.trim().to_lowercase())
        .and_then(|e| e.get_password().context("no credential"))
        .is_ok()
}

fn cache(token: String, expires_in: u64) {
    // Treat the token as spent a minute early; a clock that is slightly out
    // should not turn into a 401 halfway through an upload.
    let lifetime = Duration::from_secs(expires_in.max(120).saturating_sub(60));
    *CACHE.lock().unwrap() = Some(Cached {
        token,
        expires: Instant::now() + lifetime,
    });
}

/// A usable access token, refreshing if the cached one is spent.
pub async fn access_token(config: &DesktopConfig, username: &str) -> Result<String> {
    {
        let cached = CACHE.lock().unwrap();
        if let Some(c) = cached.as_ref() {
            if Instant::now() < c.expires {
                return Ok(c.token.clone());
            }
        }
    }

    let username = username.trim().to_lowercase();
    let stored = entry(&username)?
        .get_password()
        .map_err(|_| anyhow!("Signed out. Open Omni Recorder and sign in again."))?;

    let tokens = match token_request(
        config,
        "refresh_token",
        serde_json::json!({ "refresh_token": stored }),
    )
    .await
    {
        Ok(tokens) => tokens,
        Err(TokenError::Rejected(message)) => {
            // A refresh token the server refuses is never going to work again:
            // revoked, rotated out from under us, or the account is gone.
            // Dropping it is what puts the app back on the sign-in screen,
            // rather than leaving it apparently signed in and failing at the
            // end of every recording.
            if let Ok(entry) = entry(&username) {
                let _ = entry.delete_credential();
            }
            *CACHE.lock().unwrap() = None;
            return Err(anyhow!("{message}. Sign in to Omni Recorder again."));
        }
        Err(TokenError::Unavailable(message)) => {
            // Keep the credential. Being offline is not being signed out, and
            // the recording this was for is still on disk waiting to be sent.
            return Err(anyhow!("{message}"));
        }
    };

    // Supabase rotates the refresh token on every use — keeping the old one
    // would work exactly once more and then lock the app out.
    let _ = entry(&username)?.set_password(&tokens.refresh_token);
    cache(tokens.access_token.clone(), tokens.expires_in);
    Ok(tokens.access_token)
}
