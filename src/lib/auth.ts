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
