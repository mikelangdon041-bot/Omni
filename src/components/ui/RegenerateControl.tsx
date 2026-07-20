"use client";

// Shared "regenerate this" control (Meeting Prep sections, and anywhere else
// that needs the same pattern). Two ways to act:
//  - "Adjust" — always available: type what should be different, submit.
//  - Plain "Redo" (no guidance) — only shown when `canRedoPlain` is true.
//    Regenerating with no guidance from unchanged inputs would just
//    reproduce roughly the same content, so the caller should only offer it
//    once there's actually something to redo (edited content, or the
//    underlying inputs changed).

import { useState } from "react";
import { RefreshCw, Wand2 } from "lucide-react";
import { Button } from "./Button";
import { Textarea } from "./Input";

export function RegenerateControl({
  canRedoPlain,
  busy,
  onRegenerate,
  redoLabel = "Redo",
  adjustLabel = "Adjust",
  prompt = "What should be different?",
  placeholder = "Describe what you want changed…",
}: {
  canRedoPlain: boolean;
  busy?: boolean;
  onRegenerate: (guidance: string) => void;
  redoLabel?: string;
  adjustLabel?: string;
  prompt?: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [guidance, setGuidance] = useState("");

  if (open) {
    return (
      <div className="w-full rounded-lg border border-[var(--accent)]/30 bg-[var(--accent-soft)]/25 p-3">
        <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-[var(--accent)]">
          <Wand2 size={12} /> {prompt}
        </p>
        <Textarea
          autoFocus
          value={guidance}
          onChange={(e) => setGuidance(e.target.value)}
          placeholder={placeholder}
          className="min-h-16 bg-surface text-sm"
        />
        <div className="mt-2 flex justify-end gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setOpen(false);
              setGuidance("");
            }}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={busy || !guidance.trim()}
            onClick={() => {
              onRegenerate(guidance.trim());
              setOpen(false);
              setGuidance("");
            }}
          >
            <RefreshCw size={13} className={busy ? "animate-spin" : ""} />
            {busy ? "Working…" : redoLabel}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-end gap-1">
      {canRedoPlain && (
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => onRegenerate("")}>
          <RefreshCw size={13} className={busy ? "animate-spin" : ""} />
          {busy ? "Redoing…" : redoLabel}
        </Button>
      )}
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => setOpen(true)}>
        <Wand2 size={13} /> {adjustLabel}
      </Button>
    </div>
  );
}
