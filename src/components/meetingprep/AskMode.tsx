"use client";

// Meeting Prep — Ask mode: the screen you have open while the meeting is
// actually happening. Its own file because it is its own thing: no editing,
// no generating, no lists of twenty. One question at a size you can read from
// arm's length, and a way to get to the next one.

import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Check, ListChecks, Star, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { QuestionItem } from "@/lib/meetingprep/types";

/**
 * Ask mode: the view you have open while the meeting is happening.
 *
 * It was a dialog, which is wrong for this. During a session you are glancing
 * at a screen from arm's length while someone talks, and what you need is one
 * question at a size you can read without leaning in, the probe underneath
 * it, and a way to move on without aiming at anything. So: full screen, two
 * questions' worth of chrome, and arrow keys.
 *
 * "All of them" is the other half of the job, for when you want to skip ahead
 * or see what you have left. Backups sit at the end of the running order,
 * out of the main flow, because that is what holding one in reserve means.
 */
export function AskMode({
  onClose,
  topic,
  title,
  picked,
  onToggleAsked,
  onResetTicks,
}: {
  onClose: () => void;
  /** The subject, on screen while you are standing in front of the room. */
  topic: string;
  title: string;
  picked: QuestionItem[];
  onToggleAsked: (q: QuestionItem) => void;
  onResetTicks: () => void;
}) {
  const main = picked.filter((q) => !q.backup);
  const backups = picked.filter((q) => q.backup);
  const flow = [...main, ...backups];
  const done = picked.filter((q) => q.asked).length;
  const [mode, setMode] = useState<"one" | "all">("one");
  const [at, setAt] = useState(0);
  const here = Math.max(0, Math.min(at, flow.length - 1));
  const cur = flow[here];

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (mode !== "one") return;
      if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        setAt((n) => Math.min(flow.length - 1, n + 1));
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setAt((n) => Math.max(0, n - 1));
      } else if (e.key === "Enter" && cur) {
        e.preventDefault();
        onToggleAsked(cur);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, flow.length, cur, onToggleAsked, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-canvas">
      <header className="shrink-0 border-b border-border bg-surface">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold leading-tight text-ink">
              {topic || title}
            </p>
            <p className="mt-0.5 text-xs text-muted">
              {done} of {picked.length} asked
              {backups.length ? ` · ${backups.length} in reserve` : ""}
            </p>
          </div>
          <div className="hidden shrink-0 rounded-lg border border-border bg-canvas p-0.5 sm:flex">
            {(
              [
                ["one", "One at a time"],
                ["all", "All of them"],
              ] as const
            ).map(([k, lbl]) => (
              <button
                key={k}
                type="button"
                onClick={() => setMode(k)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                  mode === k ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
                }`}
              >
                {lbl}
              </button>
            ))}
          </div>
          {done > 0 && (
            <Button size="sm" variant="ghost" className="shrink-0" onClick={onResetTicks}>
              Clear ticks
            </Button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close ask mode"
            className="shrink-0 rounded-lg p-1.5 text-muted transition hover:bg-canvas hover:text-ink"
          >
            <X size={20} />
          </button>
        </div>
        {/* How far through you are, which is the one number that matters
            when you are watching the clock. */}
        <div className="h-1 bg-border">
          <div
            className="h-full bg-[var(--accent)] transition-all duration-300"
            style={{ width: `${picked.length ? (done / picked.length) * 100 : 0}%` }}
          />
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        {!cur ? (
          <p className="mx-auto max-w-3xl px-5 py-16 text-center text-sm text-muted">
            Nothing picked yet.
          </p>
        ) : mode === "one" ? (
          <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-center px-5 py-8">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full bg-[var(--accent-soft)] px-2.5 py-1 font-semibold text-[var(--accent)]">
                {cur.backup ? "In reserve" : `${here + 1} of ${main.length}`}
              </span>
              {cur.forWhom && (
                <span className="rounded-full border border-border px-2.5 py-1 text-muted">
                  For {cur.forWhom}
                </span>
              )}
              {cur.asked && (
                <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-700">
                  <Check size={12} /> Asked
                </span>
              )}
            </div>

            <p
              className={`mt-5 text-balance text-2xl font-semibold leading-tight tracking-tight text-ink sm:text-[2rem] ${
                cur.asked ? "opacity-40" : ""
              }`}
            >
              {cur.text}
            </p>

            {cur.followUp && (
              <div className="mt-6 rounded-xl border border-border bg-surface p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                  If the answer is thin
                </p>
                <p className="mt-1.5 text-base leading-snug text-ink/75 sm:text-lg">
                  {cur.followUp}
                </p>
              </div>
            )}

            {/* Quiet, and small, because it is the one thing on this screen
                that is not to be read out: it is what they stand on if the
                answer comes back as a challenge. */}
            {cur.sourceNote && (
              <p className="mt-3 text-sm text-muted">Source: {cur.sourceNote}</p>
            )}

            <div className="mt-7 flex items-center gap-2">
              <Button
                variant="secondary"
                disabled={here === 0}
                onClick={() => setAt(here - 1)}
              >
                <ArrowLeft size={16} /> Back
              </Button>
              <Button
                variant={cur.asked ? "secondary" : "primary"}
                onClick={() => onToggleAsked(cur)}
              >
                <Check size={16} /> {cur.asked ? "Undo" : "Asked it"}
              </Button>
              <span className="flex-1" />
              <Button
                variant="secondary"
                disabled={here === flow.length - 1}
                onClick={() => setAt(here + 1)}
              >
                Next <ArrowRight size={16} />
              </Button>
            </div>

            {/* Where you are in the running order, and what is left. */}
            <div className="mt-6 flex flex-wrap gap-1.5">
              {flow.map((q, i) => (
                <button
                  key={q.id}
                  type="button"
                  aria-label={`Go to question ${i + 1}`}
                  onClick={() => setAt(i)}
                  className={`h-1.5 w-7 rounded-full transition ${
                    i === here
                      ? "bg-[var(--accent)]"
                      : q.asked
                        ? "bg-emerald-400"
                        : "bg-border hover:bg-muted/50"
                  }`}
                />
              ))}
            </div>

            <p className="mt-4 hidden text-[11px] text-muted sm:block">
              Arrow keys or space to move, Enter to tick it off, Esc to close.
            </p>
            <div className="mt-5 sm:hidden">
              <Button size="sm" variant="secondary" onClick={() => setMode("all")}>
                <ListChecks size={14} /> See all of them
              </Button>
            </div>
          </div>
        ) : (
          <div className="mx-auto w-full max-w-3xl px-4 py-5">
            <ol className="space-y-2">
              {main.map((q, i) => (
                <AskRow
                  key={q.id}
                  q={q}
                  n={i + 1}
                  onOpen={() => {
                    setAt(flow.indexOf(q));
                    setMode("one");
                  }}
                  onToggle={() => onToggleAsked(q)}
                />
              ))}
            </ol>
            {backups.length > 0 && (
              <>
                <p className="mb-2 mt-5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
                  <Star size={12} className="fill-current text-amber-500" /> In reserve
                </p>
                <ol className="space-y-2">
                  {backups.map((q) => (
                    <AskRow
                      key={q.id}
                      q={q}
                      onOpen={() => {
                        setAt(flow.indexOf(q));
                        setMode("one");
                      }}
                      onToggle={() => onToggleAsked(q)}
                    />
                  ))}
                </ol>
              </>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

// One question in the list view. The tick is its own target so that tapping
// the question opens it big rather than silently marking it asked.
function AskRow({
  q,
  n,
  onOpen,
  onToggle,
}: {
  q: QuestionItem;
  n?: number;
  onOpen: () => void;
  onToggle: () => void;
}) {
  return (
    <li
      className={`flex items-start gap-3 rounded-xl border p-3 transition ${
        q.asked ? "border-border bg-canvas/60" : "border-border bg-surface"
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-label={q.asked ? "Not asked yet" : "Mark as asked"}
        className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg text-xs font-semibold transition ${
          q.asked
            ? "bg-emerald-100 text-emerald-700"
            : "bg-[var(--accent-soft)] text-[var(--accent)] hover:brightness-95"
        }`}
      >
        {q.asked ? <Check size={15} /> : (n ?? <Star size={13} className="fill-current" />)}
      </button>
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <span
          className={`block text-base leading-snug sm:text-lg ${
            q.asked ? "text-muted line-through" : "font-medium text-ink"
          }`}
        >
          {q.text}
        </span>
        {q.forWhom && <span className="mt-0.5 block text-sm text-muted">For {q.forWhom}</span>}
        {q.followUp && (
          <span className="mt-1 block text-sm text-muted">Then: {q.followUp}</span>
        )}
      </button>
    </li>
  );
}
