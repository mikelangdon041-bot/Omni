// The Outlook pane's saved sign-in. SERVER ONLY.
//
// Why this exists: Outlook runs the add-in in its own WebView2 browser, and it
// moves that browser's storage to a fresh, empty folder whenever Office or the
// WebView2 runtime updates — which mostly happens across a reboot. The session
// cookie is fine (400-day maxAge, refreshed hourly without a single failure);
// it is simply left behind in the old folder, and the pane opens in a new one
// with no cookie at all. Measured on 2026-09-15: six such moves since May, the
// latest at the first Outlook launch after a WebView2 update at 03:49.
//
// No cookie setting survives the jar being replaced, so the pane keeps a second
// credential somewhere that does: Outlook's roaming settings, which live in the
// mailbox rather than in the WebView. That credential is a key minted here — a
// random secret whose hash is kept on the user — and trading it in mints an
// ordinary session.
//
// Deliberately NOT the Supabase refresh token. That rotates every hour, so a
// second copy of it goes stale within the hour, and presenting a stale one is
// token reuse: Supabase revokes the whole session family. This key never
// rotates, so it cannot fall out of step with anything.
//
// Hashes live in app_metadata (writable only with the service role) rather than
// a table, so there is no hand-run migration to drift out of step with the code.

import { createHash, randomBytes, timingSafeEqual } from "crypto";
import type { User } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

const FIELD = "outlook_keys";
// One per mailbox the add-in is installed in, plus slack for the odd re-mint.
const MAX_KEYS = 5;
// last-used is informational; don't rewrite the user on every single restore.
const TOUCH_AFTER_S = 24 * 60 * 60;

/** h: sha256 of the secret (hex, truncated — 160 bits); c/u: created/used, epoch s. */
interface StoredKey {
  h: string;
  c: number;
  u: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECRET = /^[A-Za-z0-9_-]{43}$/;

const now = () => Math.floor(Date.now() / 1000);
const hashOf = (secret: string) => createHash("sha256").update(secret).digest("hex").slice(0, 40);

/** "<user id>.<secret>" — the id says whose key it is, the secret proves it. */
function parse(key: string): { userId: string; secret: string } | null {
  const dot = key.indexOf(".");
  if (dot === -1) return null;
  const userId = key.slice(0, dot);
  const secret = key.slice(dot + 1);
  return UUID.test(userId) && SECRET.test(secret) ? { userId, secret } : null;
}

function keysOf(user: User): StoredKey[] {
  const raw = (user.app_metadata as Record<string, unknown> | undefined)?.[FIELD];
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (k): k is StoredKey =>
      !!k && typeof k.h === "string" && typeof k.c === "number" && typeof k.u === "number",
  );
}

function matches(stored: string, secret: string) {
  const a = Buffer.from(stored);
  const b = Buffer.from(hashOf(secret));
  return a.length === b.length && timingSafeEqual(a, b);
}

async function save(user: User, keys: StoredKey[]) {
  const admin = createAdminClient();
  // Spread, not replace: provider/providers live in app_metadata too.
  const { error } = await admin.auth.admin.updateUserById(user.id, {
    app_metadata: { ...(user.app_metadata || {}), [FIELD]: keys },
  });
  if (error) throw error;
}

async function userById(id: string): Promise<User | null> {
  const { data } = await createAdminClient().auth.admin.getUserById(id);
  return data?.user ?? null;
}

/** A new key for this user. `replace`, if it is one of theirs, is revoked. */
export async function mintOutlookKey(userId: string, replace?: string): Promise<string> {
  const user = await userById(userId);
  if (!user) throw new Error("No such user");
  const old = replace ? parse(replace) : null;
  const kept = keysOf(user).filter(
    (k) => !(old && old.userId === userId && matches(k.h, old.secret)),
  );
  const secret = randomBytes(32).toString("base64url");
  const t = now();
  const next = [...kept.sort((a, b) => b.u - a.u).slice(0, MAX_KEYS - 1), { h: hashOf(secret), c: t, u: t }];
  await save(user, next);
  return `${userId}.${secret}`;
}

/** Whose key this is, or null when it is malformed, unknown, or revoked. */
export async function checkOutlookKey(key: string): Promise<User | null> {
  const parsed = parse(key);
  if (!parsed) return null;
  const user = await userById(parsed.userId);
  if (!user) return null;
  const keys = keysOf(user);
  const hit = keys.find((k) => matches(k.h, parsed.secret));
  if (!hit) return null;
  if (now() - hit.u > TOUCH_AFTER_S) {
    hit.u = now();
    await save(user, keys).catch(() => {});
  }
  return user;
}

/** Revoke one key. The key is its own proof, so this needs no session. */
export async function forgetOutlookKey(key: string): Promise<void> {
  const parsed = parse(key);
  if (!parsed) return;
  const user = await userById(parsed.userId);
  if (!user) return;
  const keys = keysOf(user);
  const kept = keys.filter((k) => !matches(k.h, parsed.secret));
  if (kept.length !== keys.length) await save(user, kept);
}

/** Revoke every key the user has — for when the password itself is in doubt. */
export async function forgetAllOutlookKeys(userId: string): Promise<void> {
  const user = await userById(userId);
  if (user && keysOf(user).length) await save(user, []);
}
