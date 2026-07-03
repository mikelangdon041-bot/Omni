"use client";

// Small shared visual bits for the conference module.

import { cn } from "@/lib/ui";

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-14">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--accent-soft)] border-t-[var(--accent)]" />
      <span className="text-sm text-muted">{label}</span>
    </div>
  );
}

// Progress bar for anything that takes time. percent = 0..100, or null for
// an indeterminate sweep while we wait on an AI/network call.
export function ProgressBar({
  percent,
  label,
  className,
}: {
  percent: number | null;
  label?: string;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      {(label || percent !== null) && (
        <div className="flex items-center justify-between text-xs">
          <span className="min-w-0 flex-1 truncate font-medium text-muted">{label}</span>
          {percent !== null && (
            <span className="ml-2 shrink-0 font-bold text-[var(--accent)]">
              {Math.round(percent)}%
            </span>
          )}
        </div>
      )}
      <div className="h-2 overflow-hidden rounded-full bg-[var(--accent-soft)]">
        {percent === null ? (
          <div className="omni-indeterminate h-full w-2/5 rounded-full bg-[var(--accent)]" />
        ) : (
          <div
            className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-300"
            style={{ width: `${Math.max(3, Math.min(100, percent))}%` }}
          />
        )}
      </div>
    </div>
  );
}

// Colored icon badge used in section headers and stat cards.
export function IconBadge({
  color,
  children,
  size = 32,
  className,
}: {
  color: string;
  children: React.ReactNode;
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={cn("grid shrink-0 place-items-center rounded-xl text-white shadow-sm", className)}
      style={{ background: color, width: size, height: size }}
    >
      {children}
    </span>
  );
}
