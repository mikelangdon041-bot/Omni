"use client";

import { useState } from "react";

// Small localStorage-backed useState for remembering simple UI choices (e.g.
// which tab was active, which sections were collapsed) across visits.
// `allowed`, if given, guards against a stale/foreign value in storage.
export function usePersistedState<T extends string>(
  key: string,
  initial: T,
  allowed?: readonly T[],
): [T, (v: T) => void] {
  const [state, setState] = useState<T>(() => {
    if (typeof window === "undefined") return initial;
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
