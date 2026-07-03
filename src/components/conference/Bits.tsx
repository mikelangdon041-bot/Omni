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
