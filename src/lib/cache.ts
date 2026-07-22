"use client";

// Tiny localStorage cache for instant paints: pages render cached data
// immediately and refresh from the network in the background. Mirrors the
// same helper in the Iter app (my-expo-app/Iter/src/lib/cache.ts).
const PREFIX = "omni-cache:";
const MAX_ITEM_ENTRIES = 10;

// Namespaces that hold larger per-item payloads (a full meeting brief, a
// full doc, a full deck…) get pruned to the most-recently-written N entries
// so localStorage doesn't blow its quota. Add a namespace here any time a
// module starts caching a per-item detail record.
const PRUNED_NAMESPACES = ["mtg:", "doc:", "deck:"];

export function getCached<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function setCached(key: string, value: unknown) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    const ns = PRUNED_NAMESPACES.find((p) => key.startsWith(p));
    if (ns) prune(ns);
  } catch {
    // quota exceeded — drop the pruned namespaces' entries and retry once
    try {
      for (const ns of PRUNED_NAMESPACES) prune(ns, 0);
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch {}
  }
}

export function dropCached(key: string) {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {}
}

// Wipe every cached entry — call this on sign-out. Per-user data is cached
// under this one prefix (scoped by user id within the key), so a shared
// device that logs out and back in as someone else must not risk a stale
// instant-paint flashing the previous person's data before the network
// fetch corrects it.
export function clearAllCached() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith(PREFIX)) localStorage.removeItem(k);
    }
  } catch {}
}

// Keep only the most recently written entries for a namespace (they can be large).
function prune(namespace: string, keep = MAX_ITEM_ENTRIES) {
  const keys: { key: string; t: number }[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith(PREFIX + namespace)) {
      try {
        keys.push({ key: k, t: JSON.parse(localStorage.getItem(k) ?? "{}")._t ?? 0 });
      } catch {
        keys.push({ key: k, t: 0 });
      }
    }
  }
  keys
    .sort((a, b) => b.t - a.t)
    .slice(keep)
    .forEach(({ key }) => localStorage.removeItem(key));
}
