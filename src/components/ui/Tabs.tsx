"use client";

import { cn } from "@/lib/ui";

// Underline tabs; active tab uses the module accent.
export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: readonly T[];
  active: T;
  onChange: (t: T) => void;
}) {
  return (
    <div className="mb-6 flex gap-1 overflow-x-auto border-b border-border">
      {tabs.map((t) => (
        <button
          key={t}
          onClick={() => onChange(t)}
          className={cn(
            "-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition",
            active === t
              ? "border-[var(--accent)] text-[var(--accent)]"
              : "border-transparent text-muted hover:text-ink",
          )}
        >
          {t}
        </button>
      ))}
    </div>
  );
}
