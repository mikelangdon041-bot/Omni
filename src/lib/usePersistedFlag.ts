"use client";

import { useState } from "react";

// A boolean that survives reloads. Used for capture settings: re-ticking the
// same boxes before every meeting is exactly the friction that stops people
// recording at all.
export function usePersistedFlag(
  key: string,
  initial: boolean,
): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState<boolean>(() => {
    if (typeof window === "undefined") return initial;
    try {
      const stored = window.localStorage.getItem(key);
      return stored === null ? initial : stored === "1";
    } catch {
      return initial;
    }
  });

  const set = (v: boolean) => {
    setValue(v);
    try {
      window.localStorage.setItem(key, v ? "1" : "0");
    } catch {
      // private mode — the setting just won't persist
    }
  };

  return [value, set];
}
