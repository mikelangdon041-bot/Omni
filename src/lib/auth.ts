// Username/password auth uses a hidden synthetic email so users never see or
// type an email. We map a username to `<username>@omni.local`.
export const EMAIL_DOMAIN = "omni.local";

export function usernameToEmail(username: string) {
  return `${normalizeUsername(username)}@${EMAIL_DOMAIN}`;
}

export function normalizeUsername(username: string) {
  return username.trim().toLowerCase();
}

// Allow letters, numbers, dot, underscore, hyphen; 3–30 chars.
export function isValidUsername(username: string) {
  return /^[a-z0-9._-]{3,30}$/.test(normalizeUsername(username));
}

/**
 * Where to go after signing in, when the sign-in didn't start at the front door.
 * The Outlook task pane is the case that needs it: it is a 400px panel with no
 * address bar, so being dropped on the dashboard afterwards is a dead end — you
 * cannot navigate back to the add-in from inside it.
 *
 * Only same-site paths survive. A `next` is attacker-supplied by definition, and
 * an unchecked one turns the login page into an open redirect: `//evil.com` and
 * `https://evil.com` are both things a browser will happily treat as another
 * origin, so anything that isn't a single leading slash is thrown away.
 */
export function safeNext(raw: string | null | undefined): string | null {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return null;
  // A backslash is a slash to some URL parsers, so "/\evil.com" is the same
  // trick wearing a different hat.
  if (raw.includes("\\")) return null;
  return raw;
}

// "Remember me": marker cookie set at login. "1" (or absent) → long-lived
// session cookies; "0" → browser-session cookies, enforced on every refresh.
export const REMEMBER_COOKIE = "omni-remember";
export const REMEMBER_MAX_AGE = 400 * 24 * 60 * 60; // matches @supabase/ssr default

// Alphanumeric only (no hyphen/punctuation, no 0/O/1/l/I) — safe to read
// aloud, hard to mis-select on mobile, and unambiguous character-by-character.
const TEMP_PASSWORD_CHARS = "abcdefghjkmnpqrstuvwxyzACDEFGHJKMNPQRSTUVWXYZ23456789";
export function generateTempPassword(length = 14) {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += TEMP_PASSWORD_CHARS[Math.floor(Math.random() * TEMP_PASSWORD_CHARS.length)];
  }
  return out;
}
