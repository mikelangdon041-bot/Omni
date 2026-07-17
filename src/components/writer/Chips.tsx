"use client";

import { cn } from "@/lib/ui";

// Clickable multi-select chips — the "you'd normally ask me, now I click"
// intake control.
export function ChipGroup({
  label,
  options,
  selected,
  onToggle,
  single,
}: {
  label: string;
  options: string[] | { key: string; label: string }[];
  selected: string[];
  onToggle: (key: string) => void;
  /** Radio behavior: exactly one stays selected. */
  single?: boolean;
}) {
  const opts = options.map((o) => (typeof o === "string" ? { key: o, label: o } : o));
  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
        {label}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {opts.map((o) => {
          const on = selected.includes(o.key);
          return (
            <button
              key={o.key}
              type="button"
              onClick={() => {
                if (single && on) return;
                onToggle(o.key);
              }}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs font-medium transition",
                on
                  ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                  : "border-border bg-surface text-muted hover:border-[var(--accent)]/50 hover:text-ink",
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
