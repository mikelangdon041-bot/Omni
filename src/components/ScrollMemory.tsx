"use client";

// Every page remembers your scroll position — leave a long list scrolled
// halfway down, come back later (even after fully closing the PWA), and
// you're back where you left off instead of dumped at the top. Mounted once
// in the app shell; works for every route with no per-page code.
//
// Keyed by pathname, stored in localStorage (survives the PWA being fully
// closed, unlike sessionStorage).

import { useEffect } from "react";
import { usePathname } from "next/navigation";

const STORAGE_KEY = "omni-scroll-memory";
const MAX_ENTRIES = 80;

function readStore(): Record<string, number> {
  try {
    return JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function writeStore(store: Record<string, number>) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // ignore (quota / private mode)
  }
}

function persist(key: string, y: number) {
  const store = readStore();
  store[key] = y;
  const keys = Object.keys(store);
  if (keys.length > MAX_ENTRIES) {
    // Drop the oldest-inserted entries (insertion order in a plain object).
    for (const k of keys.slice(0, keys.length - MAX_ENTRIES)) delete store[k];
  }
  writeStore(store);
}

export function ScrollMemory() {
  const pathname = usePathname();
  const key = pathname;

  // Take over scroll restoration from the browser so it doesn't fight with
  // ours on back/forward navigation.
  useEffect(() => {
    if ("scrollRestoration" in window.history) {
      const prev = window.history.scrollRestoration;
      window.history.scrollRestoration = "manual";
      return () => {
        window.history.scrollRestoration = prev;
      };
    }
  }, []);

  // Restore this page's remembered position. Content often streams in
  // async (client-side data fetches), so the page may not be tall enough
  // yet on the first attempt — retry for about a second.
  useEffect(() => {
    const y = readStore()[key] || 0;
    let attempts = 0;
    let cancelled = false;
    function tryScroll() {
      if (cancelled) return;
      window.scrollTo(0, y);
      attempts++;
      if (attempts < 14 && Math.abs(window.scrollY - y) > 4) {
        setTimeout(() => requestAnimationFrame(tryScroll), 70);
      }
    }
    if (y > 0) requestAnimationFrame(tryScroll);
    else window.scrollTo(0, 0);
    return () => {
      cancelled = true;
    };
  }, [key]);

  // Continuously remember the current page's scroll position as the user
  // scrolls (rAF-throttled) — no separate "save on navigate away" step
  // needed, this is always up to date. Re-bound whenever the path changes
  // so the closure always persists under the right key.
  useEffect(() => {
    let ticking = false;
    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        persist(key, window.scrollY);
        ticking = false;
      });
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [key]);

  return null;
}
