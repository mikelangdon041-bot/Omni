"use client";

import { useEffect, useState } from "react";

// A percentage for work whose real progress we can't observe. The AI calls
// return in one shot, so there is nothing to count — but a bar that visibly
// moves is the difference between "it's working" and "it's hung", which is the
// whole reason for showing one.
//
// The curve eases toward 95% and never reaches it: it decelerates as it goes,
// so a slow call keeps creeping rather than sitting at 100% for ten seconds.

export function useProgress(active: boolean, expectedMs = 20000): number {
  const [pct, setPct] = useState(0);

  useEffect(() => {
    if (!active) return;
    const started = Date.now();
    const step = () => {
      const elapsed = (Date.now() - started) / expectedMs;
      setPct(Math.min(95, Math.round(95 * (1 - Math.exp(-2.4 * elapsed)))));
    };
    // Deferred so the first sample lands after the reset, not during the effect.
    const first = setTimeout(step, 0);
    const timer = setInterval(step, 180);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [active, expectedMs]);

  return active ? pct : 0;
}

/** A thin gradient progress bar with the percentage beside a label. */
export function ProgressBar({
  pct,
  label,
  className = "",
}: {
  pct: number;
  label?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      {label && (
        <div className="mb-1 flex items-center justify-between text-[11px] font-medium text-muted">
          <span>{label}</span>
          <span className="tabular-nums">{pct}%</span>
        </div>
      )}
      <div className="h-1.5 overflow-hidden rounded-full bg-canvas">
        <div
          className="h-full rounded-full bg-gradient-to-r from-[var(--grad-from)] via-[var(--grad-via)] to-[var(--grad-to)] transition-[width] duration-200 ease-out"
          style={{ width: `${Math.max(2, pct)}%` }}
        />
      </div>
    </div>
  );
}
