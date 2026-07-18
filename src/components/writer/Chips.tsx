"use client";

import { cn } from "@/lib/ui";

// Clickable multi-select chips — the "you'd normally ask me, now I click"
// intake control. Each group can carry its own hue so the intake reads as a
// colorful palette instead of a wall of grey.

export type ChipHue = "accent" | "sky" | "violet" | "amber" | "rose" | "teal";

const HUES: Record<ChipHue, { on: string; off: string }> = {
  accent: {
    on: "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]",
    off: "hover:border-[var(--accent)]/50",
  },
  sky: {
    on: "border-sky-400 bg-sky-100 text-sky-700",
    off: "hover:border-sky-400/60 hover:bg-sky-50",
  },
  violet: {
    on: "border-violet-400 bg-violet-100 text-violet-700",
    off: "hover:border-violet-400/60 hover:bg-violet-50",
  },
  amber: {
    on: "border-amber-400 bg-amber-100 text-amber-700",
    off: "hover:border-amber-400/60 hover:bg-amber-50",
  },
  rose: {
    on: "border-rose-400 bg-rose-100 text-rose-700",
    off: "hover:border-rose-400/60 hover:bg-rose-50",
  },
  teal: {
    on: "border-teal-400 bg-teal-100 text-teal-700",
    off: "hover:border-teal-400/60 hover:bg-teal-50",
  },
};

export function ChipGroup({
  label,
  options,
  selected,
  onToggle,
  single,
  hue = "accent",
}: {
  label: string;
  options: string[] | { key: string; label: string }[];
  selected: string[];
  onToggle: (key: string) => void;
  /** Radio behavior: exactly one stays selected. */
  single?: boolean;
  hue?: ChipHue;
}) {
  const opts = options.map((o) => (typeof o === "string" ? { key: o, label: o } : o));
  const colors = HUES[hue];
  return (
    <div>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
        {label}
      </p>
      <div className="flex flex-wrap gap-1">
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
                "rounded-full border px-2.5 py-1 text-xs font-medium transition",
                on
                  ? colors.on
                  : cn("border-border bg-surface text-muted hover:text-ink", colors.off),
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
