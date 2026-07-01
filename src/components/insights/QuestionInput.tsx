"use client";

import { cn } from "@/lib/ui";
import type { AnswerValue, QuestionNode } from "@/lib/insights/types";

// Renders the right control for a question type and reports value changes up.
export function QuestionInput({
  node,
  value,
  onChange,
}: {
  node: QuestionNode;
  value: AnswerValue | undefined;
  onChange: (v: AnswerValue) => void;
}) {
  const selected = new Set(value?.optionIds || []);

  switch (node.type) {
    case "single":
    case "boolean":
      return (
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap gap-2">
          {node.options.map((o) => {
            const active = selected.has(o.id);
            return (
              <button
                key={o.id}
                // Click the selected option again to clear the answer.
                onClick={() => onChange(active ? {} : { optionIds: [o.id] })}
                className={cn(
                  "rounded-lg border px-3.5 py-2 text-sm font-medium transition",
                  active
                    ? "border-[var(--accent)] bg-accent-soft text-[var(--accent)]"
                    : "border-border bg-surface text-ink hover:border-[var(--accent)]/50",
                )}
              >
                <span className="inline-flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ background: o.color || "#cbd5e1" }}
                  />
                  {o.label}
                </span>
              </button>
            );
          })}
          </div>
          {selected.size > 0 && (
            <span className="text-[11px] text-muted">Tap the selected answer again to clear it.</span>
          )}
        </div>
      );

    case "multi":
      return (
        <div className="flex flex-wrap gap-2">
          {node.options.map((o) => {
            const active = selected.has(o.id);
            return (
              <button
                key={o.id}
                onClick={() => {
                  const next = new Set(selected);
                  if (next.has(o.id)) next.delete(o.id);
                  else next.add(o.id);
                  onChange({ optionIds: [...next] });
                }}
                className={cn(
                  "rounded-lg border px-3.5 py-2 text-sm font-medium transition",
                  active
                    ? "border-[var(--accent)] bg-accent-soft text-[var(--accent)]"
                    : "border-border bg-surface text-ink hover:border-[var(--accent)]/50",
                )}
              >
                <span className="inline-flex items-center gap-2">
                  <span
                    className={cn(
                      "grid h-4 w-4 place-items-center rounded border",
                      active ? "border-[var(--accent)] bg-[var(--accent)] text-white" : "border-border",
                    )}
                  >
                    {active && "✓"}
                  </span>
                  {o.label}
                </span>
              </button>
            );
          })}
        </div>
      );

    case "scale": {
      const min = node.scale_min ?? 1;
      const max = node.scale_max ?? 10;
      const cur = value?.scale ?? min;
      return (
        <div className="flex items-center gap-4">
          <input
            type="range"
            min={min}
            max={max}
            value={cur}
            onChange={(e) => onChange({ scale: Number(e.target.value) })}
            className="h-2 flex-1 cursor-pointer appearance-none rounded-full bg-border accent-[var(--accent)]"
          />
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-accent-soft text-sm font-semibold text-[var(--accent)]">
            {value?.scale ?? "–"}
          </span>
        </div>
      );
    }

    case "number":
      return (
        <input
          type="number"
          value={value?.number ?? ""}
          onChange={(e) =>
            onChange(
              e.target.value === ""
                ? {}
                : { number: Number(e.target.value) },
            )
          }
          placeholder="Enter a number"
          className="w-40 rounded-lg border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20"
        />
      );

    case "text":
      return (
        <textarea
          value={value?.text ?? ""}
          onChange={(e) => onChange({ text: e.target.value })}
          placeholder="Type your answer…"
          className="min-h-24 w-full resize-y rounded-lg border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20"
        />
      );
  }
}
