"use client";

// Who's who: say who each "Speaker A" is, once, and the notes are rewritten
// with it. Shown wherever unnamed labels are still sitting in the notes.
// A name, or "Me", plus pronouns for anyone else. Applying it is one rewrite
// for all of them, because who one person is changes how sentences about the
// others read.

import { useState } from "react";
import { Users } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { isComplete, type Pronouns, type SpeakerAssignment } from "@/lib/meetingprep/speakers";

type Props = {
  labels: string[];
  /** The first thing a speaker said, so they can be recognised. */
  sample?: (label: string) => string;
  /** Names to offer: the meeting's attendees. */
  people: string[];
  busy?: boolean;
  /** What applying does, in a few words: "Rewrites the notes". */
  applyHint?: string;
  onApply: (assignments: SpeakerAssignment[]) => void;
};

export function WhoIsWho({ labels, sample, people, busy, applyHint, onApply }: Props) {
  const [rows, setRows] = useState<Record<string, SpeakerAssignment>>({});
  if (!labels.length) return null;

  const row = (label: string): SpeakerAssignment => rows[label] || { label, name: "", pronouns: "" };
  const set = (label: string, patch: Partial<SpeakerAssignment>) =>
    setRows((r) => {
      const next = { ...r, [label]: { ...row(label), ...patch } };
      // Only one of them can be you.
      if (patch.me) for (const k of Object.keys(next)) if (k !== label) next[k] = { ...next[k], me: false };
      return next;
    });
  const ready = labels.map(row).filter(isComplete);

  return (
    <div className="mb-3 rounded-lg border border-border bg-canvas p-3">
      <p className="flex items-center gap-2 text-sm font-medium">
        <Users size={15} className="text-[var(--accent)]" /> Who&apos;s who
      </p>
      <p className="mt-0.5 text-xs text-muted">
        Say who each speaker is and the notes are rewritten with it: names, &ldquo;I&rdquo; for you, and
        whose point is whose.
      </p>
      <datalist id="omni-whoiswho">
        {people.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      <div className="mt-3 space-y-2">
        {labels.map((label) => {
          const r = row(label);
          const said = sample?.(label);
          return (
            <div key={label}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-20 shrink-0 text-xs font-semibold">{label}</span>
                <input
                  value={r.me ? "" : r.name}
                  disabled={r.me}
                  onChange={(e) => set(label, { name: e.target.value, me: false })}
                  list="omni-whoiswho"
                  placeholder={r.me ? "You" : "Name"}
                  className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none transition focus:border-[var(--accent)] disabled:opacity-60"
                />
                <button
                  type="button"
                  onClick={() => set(label, { me: !r.me })}
                  className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition ${
                    r.me
                      ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                      : "border-border text-muted hover:text-ink"
                  }`}
                >
                  Me
                </button>
                {!r.me && (
                  <select
                    value={r.pronouns || ""}
                    onChange={(e) => set(label, { pronouns: e.target.value as Pronouns })}
                    className="rounded-md border border-border bg-surface px-1.5 py-1.5 text-xs"
                    aria-label={`Pronouns for ${label}`}
                  >
                    <option value="">Pronouns</option>
                    <option value="he">he</option>
                    <option value="she">she</option>
                    <option value="they">they</option>
                  </select>
                )}
              </div>
              {said && <p className="ml-[5.5rem] mt-0.5 truncate text-[11px] italic text-muted">&ldquo;{said}…&rdquo;</p>}
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex items-center justify-end gap-3">
        {applyHint && <span className="text-[11px] text-muted">{applyHint}</span>}
        <Button size="sm" disabled={busy || !ready.length} onClick={() => onApply(ready)}>
          {busy ? "Rewriting…" : "Apply"}
        </Button>
      </div>
    </div>
  );
}
