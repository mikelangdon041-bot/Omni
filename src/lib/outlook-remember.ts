"use client";

// The Outlook pane staying signed in across Outlook moving its browser storage.
// The why is in lib/outlook-keys.ts; this is the pane's half of it.
//
// The key lives in Office's roaming settings — stored in the mailbox, not in the
// WebView — so it is still there when Outlook opens the pane in a brand-new
// browser folder with no cookie in it. The pane then trades it for a session
// and reloads, and nobody sees a sign-in screen.

import { useEffect, useRef, useState } from "react";
import { clearAllCached } from "@/lib/cache";
import { resetSession } from "@/lib/session";

interface RoamingSettings {
  get: (name: string) => unknown;
  set: (name: string, value: unknown) => void;
  remove: (name: string) => void;
  saveAsync: (callback?: (result: { status: string }) => void) => void;
}

const ROAMING_NAME = "omniSignInKey";
// A restore that "worked" but left no session behind (cookies refused, say)
// would otherwise reload forever. One try per this long, per tab.
const TRIED_FLAG = "omni-outlook-restore-tried";
const RETRY_AFTER_MS = 2 * 60 * 1000;

function roaming(): RoamingSettings | null {
  if (typeof window === "undefined") return null;
  const office = (window as unknown as { Office?: { context?: { roamingSettings?: RoamingSettings } } })
    .Office;
  return office?.context?.roamingSettings ?? null;
}

function readKey(): string | null {
  try {
    const value = roaming()?.get(ROAMING_NAME);
    return typeof value === "string" && value ? value : null;
  } catch {
    return null;
  }
}

/** Write (or with null, remove) the key, and wait for the mailbox to take it. */
function writeKey(key: string | null): Promise<boolean> {
  const r = roaming();
  if (!r) return Promise.resolve(false);
  return new Promise((resolve) => {
    try {
      if (key) r.set(ROAMING_NAME, key);
      else r.remove(ROAMING_NAME);
      r.saveAsync((result) => resolve(result?.status === "succeeded"));
    } catch {
      resolve(false);
    }
  });
}

function recentlyTried(): boolean {
  try {
    const at = Number(sessionStorage.getItem(TRIED_FLAG) || 0);
    return !!at && Date.now() - at < RETRY_AFTER_MS;
  } catch {
    return false;
  }
}

function setTried(on: boolean) {
  try {
    if (on) sessionStorage.setItem(TRIED_FLAG, String(Date.now()));
    else sessionStorage.removeItem(TRIED_FLAG);
  } catch {
    // Private storage off: the worst case is one extra attempt.
  }
}

async function post(path: string, body: unknown) {
  return fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(body),
  });
}

/**
 * `hostReady` — Office.onReady has fired, so roaming settings can be read.
 * `userId`/`loading` — straight from useUserId(); a restore only starts once
 * the network has confirmed there is no session, never off the cached id.
 */
export function useOutlookSignIn(hostReady: boolean, userId: string | null, loading: boolean) {
  const [loopGuard] = useState(recentlyTried);
  const [settled, setSettled] = useState(false);
  const started = useRef(false);
  const minted = useRef(false);

  const key = hostReady ? readKey() : null;
  // Derived, so the sign-in prompt never flashes up for the frame between
  // "no session" and the restore starting.
  const restoring = hostReady && !loading && !userId && !!key && !loopGuard && !settled;

  useEffect(() => {
    if (!restoring || !key || started.current) return;
    started.current = true;
    setTried(true);
    void (async () => {
      try {
        const res = await post("/api/auth/outlook-restore", { key });
        if (res.ok) {
          window.location.reload();
          return;
        }
        const json = await res.json().catch(() => ({}));
        if (json?.forget) await writeKey(null);
      } catch {
        // Offline or the server hiccuped: keep the key, show the sign-in.
      }
      setSettled(true);
    })();
  }, [restoring, key]);

  // Signed in, with no key of this person's in the mailbox yet: make one. That
  // is the state straight after typing the password in this pane, and after a
  // key was found revoked.
  useEffect(() => {
    if (!hostReady || loading || !userId || minted.current) return;
    minted.current = true;
    setTried(false);
    if (!roaming()) return;
    const existing = readKey();
    if (existing?.startsWith(`${userId}.`)) return;
    void (async () => {
      try {
        const res = await post("/api/auth/outlook-key", existing ? { replace: existing } : {});
        const json = await res.json().catch(() => ({}));
        if (typeof json?.key === "string") await writeKey(json.key);
        // A key that was someone else's is revoked rather than left behind.
        if (existing && !existing.startsWith(`${userId}.`))
          await post("/api/auth/outlook-forget", { key: existing });
      } catch {
        // Nothing lost: it is tried again on the next load.
      }
    })();
  }, [hostReady, loading, userId]);

  /** Sign out of the pane, revoking its saved sign-in so it cannot come back. */
  async function signOut() {
    const existing = readKey();
    if (existing) {
      await post("/api/auth/outlook-forget", { key: existing }).catch(() => {});
      await writeKey(null);
    }
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
    clearAllCached();
    resetSession();
    window.location.reload();
  }

  return { restoring, signOut };
}
