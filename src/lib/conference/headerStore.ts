"use client";

// Tiny external store that lets the active conference publish its identity to
// the global AppHeader (a sibling tree — React context can't reach it). The
// ConferenceProvider sets it on mount and clears it on unmount, and the
// AppHeader swaps its module label for the conference name.

import { useSyncExternalStore } from "react";

export interface ConfHeaderInfo {
  id: string;
  name: string;
  status: "live" | "upcoming" | "past";
  daysAway: number;
  // Opens the conference's announce-to-team modal (lives in the provider).
  announce?: () => void;
}

let info: ConfHeaderInfo | null = null;
const subs = new Set<() => void>();

export function setConfHeader(next: ConfHeaderInfo | null) {
  info = next;
  subs.forEach((fn) => fn());
}

export function useConfHeader(): ConfHeaderInfo | null {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => info,
    () => null,
  );
}
