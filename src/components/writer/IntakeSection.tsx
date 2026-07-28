"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/ui";

// A collapsible, color-coded intake section. Keeps the left rail compact —
// everything except the brief folds away until you want it.
export function IntakeSection({
  title,
  icon: Icon,
  tint,
  badge,
  defaultOpen = false,
  revealWhen = false,
  children,
}: {
  title: string;
  icon: LucideIcon;
  /** Tailwind classes for the icon bubble, e.g. "bg-sky-100 text-sky-600". */
  tint: string;
  /** Small summary shown when there's something selected inside. */
  badge?: string;
  defaultOpen?: boolean;
  /**
   * Opens the section without waiting to be clicked — used when something in
   * here was filled in automatically, so the picks are visible rather than
   * hidden behind a chevron. A click still wins either way.
   */
  revealWhen?: boolean;
  children: React.ReactNode;
}) {
  const [override, setOverride] = useState<boolean | null>(null);
  const open = override ?? (defaultOpen || revealWhen);
  const setOpen = (next: boolean) => setOverride(next);
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left transition hover:bg-canvas/60"
      >
        <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-lg", tint)}>
          <Icon size={15} />
        </span>
        <span className="flex-1 text-sm font-semibold">{title}</span>
        {badge && !open && (
          <span className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[10px] font-semibold text-[var(--accent)]">
            {badge}
          </span>
        )}
        <ChevronDown
          size={16}
          className={cn("shrink-0 text-muted transition-transform", open && "rotate-180")}
        />
      </button>
      {open && <div className="space-y-3 border-t border-border px-3.5 py-3">{children}</div>}
    </section>
  );
}
