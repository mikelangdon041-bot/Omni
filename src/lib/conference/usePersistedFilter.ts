"use client";

import { useState } from "react";

// Filter/tab/sort state that survives leaving the page and coming back —
// switching tabs, following a link into a detail page and back, or closing
// and reopening the app. Backed by localStorage, namespaced per conference
// and per filter so different conferences (and different pages) don't leak
// state into each other. (Same shape as the schedule page's local
// usePersisted — shared here so every filtered list gets it for free.)
export function usePersistedFilter<T>(
  conferenceId: string,
  key: string,
  initial: T,
): [T, (v: T | ((prev: T) => T)) => void] {
  const storageKey = `omni_conf_${conferenceId}_${key}`;
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") return initial;
    try {
      const raw = localStorage.getItem(storageKey);
      return raw !== null ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });

  function set(v: T | ((prev: T) => T)) {
    setValue((prev) => {
      const next = typeof v === "function" ? (v as (prev: T) => T)(prev) : v;
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // storage full/unavailable — filter just won't persist this time
      }
      return next;
    });
  }

  return [value, set];
}
