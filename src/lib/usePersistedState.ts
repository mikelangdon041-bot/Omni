"use client";

import { useState } from "react";

// Small localStorage-backed useState for remembering simple UI choices (e.g.
// which tab was active, which sections were collapsed) across visits.
// `allowed`, if given, guards against a stale/foreign value in storage.
//
// `force` outranks whatever is stored, for the case where something outside
// the app is asking for a particular view — a deep link that says which tab to
// open. It is written through as well, so the choice sticks the way any other
// choice would.
export function usePersistedState<T extends string>(
  key: string,
  initial: T,
  allowed?: readonly T[],
  force?: T | null,
): [T, (v: T) => void] {
  const [state, setState] = useState<T>(() => {
    if (typeof window === "undefined") return force ?? initial;
    if (force) {
      try {
        window.localStorage.setItem(key, force);
      } catch {
        // ignore
      }
      return force;
    }
    try {
      const stored = window.localStorage.getItem(key);
      if (stored && (!allowed || (allowed as readonly string[]).includes(stored))) {
        return stored as T;
      }
    } catch {
      // localStorage unavailable (private mode, etc.) — fall back silently.
    }
    return initial;
  });

  const set = (v: T) => {
    setState(v);
    try {
      window.localStorage.setItem(key, v);
    } catch {
      // ignore
    }
  };

  return [state, set];
}
