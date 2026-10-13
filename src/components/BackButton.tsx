"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

// True when this page is where the visit started — opened from the desktop
// recorder, an email, a bookmark or a new tab. history.back() from there
// either does nothing (fresh tab) or leaves the app, so the caller's parent
// page is the only sensible "back".
function isLandingPage(): boolean {
  if (window.history.length <= 1) return true;
  const nav = performance.getEntriesByType("navigation")[0] as
    | PerformanceNavigationTiming
    | undefined;
  return !!nav && nav.name === window.location.href;
}

// The page one level up: /meeting-prep/abc → /meeting-prep.
function parentPath(): string {
  const parts = window.location.pathname.split("/").filter(Boolean);
  return "/" + parts.slice(0, -1).join("/");
}

// Goes back to the previous page in history, unless `href` is given — some
// callers need a guaranteed destination (the piece can be reached by a deep
// link or a chat handoff, not just by browsing from the list it belongs to,
// and history.back() from there lands wherever the visit started instead).
// With no history to go back to, it goes to `fallback`, or the parent page.
export function BackButton({
  label = "Back",
  href,
  fallback,
}: {
  label?: string;
  href?: string;
  fallback?: string;
}) {
  const router = useRouter();
  function go() {
    if (href) router.push(href);
    else if (isLandingPage()) router.push(fallback ?? parentPath());
    else router.back();
  }
  return (
    <button
      onClick={go}
      className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted transition hover:text-ink"
    >
      <ArrowLeft size={15} /> {label}
    </button>
  );
}
