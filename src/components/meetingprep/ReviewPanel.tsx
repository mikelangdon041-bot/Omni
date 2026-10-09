"use client";

// What the read-through found, on whichever tab you are standing on.
//
// One review covers the whole pack, so most of what it finds is about
// somewhere else. Showing all of it on every tab would make it noise; showing
// only this tab's would throw away the cross-cutting advice, which is the
// best kind it writes. So this tab's notes are the panel, and the rest sit
// folded underneath with a count, one click from being read.
//
// It gets quieter as it empties. Once everything here is crossed off it
// collapses to a single line, because advice you have already acted on should
// not keep taking up the top of the page.

import { useState } from "react";
import { CheckSquare, Stethoscope, Undo2, Wand2, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { scopeOf, type ReviewScope } from "@/lib/meetingprep/useReview";
import type { ReviewNote } from "@/lib/meetingprep/types";

export function ReviewPanel({
  notes,
  at,
  scope,
  busy,
  onFix,
  onFixAll,
  onToggleDone,
  onDismiss,
  onClear,
  questionText,
}: {
  notes: ReviewNote[];
  at?: string;
  /** The tab this panel is on. Its notes lead; everything else folds away. */
  scope: ReviewScope;
  busy: boolean;
  /** Absent on a tab that cannot act on its own notes yet. */
  onFix?: (n: ReviewNote) => void;
  /** Looks up a question the note named, so the note can quote it. */
  questionText?: (id: string) => string | undefined;
  onFixAll?: (ns: ReviewNote[]) => void;
  onToggleDone: (n: ReviewNote) => void;
  onDismiss: (n: ReviewNote) => void;
  onClear: () => void;
}) {
  const [showDone, setShowDone] = useState(false);
  const [showOther, setShowOther] = useState(false);
  if (!notes.length) return null;

  // Advice about the whole pack belongs on whatever tab you are reading,
  // because it is about all of them.
  const here = notes.filter((n) => scopeOf(n) === scope || scopeOf(n) === "pack");
  const elsewhere = notes.filter((n) => !here.includes(n) && !n.done);

  const open = here.filter((n) => !n.done);
  const done = here.filter((n) => n.done);
  // On the brief, any note can be handed back to the writer of that section.
  // On the questions, only one that named the questions and said what to do
  // to them — the rest are about the order, which is the writer's to arrange.
  const canFix = (n: ReviewNote) =>
    Boolean(onFix) && (scope !== "questions" || Boolean(n.action));
  const fixable = open.filter(canFix);

  // Nothing for this tab at all: say where the advice is rather than nothing,
  // or the button looks like it did nothing.
  if (!open.length && !done.length)
    return elsewhere.length ? (
      <button
        onClick={() => setShowOther((v) => !v)}
        className="flex w-full items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-left text-sm text-muted transition hover:border-[var(--accent)]/40"
      >
        <Stethoscope size={15} className="shrink-0" />
        <span className="min-w-0 flex-1">
          The read-through found nothing on this tab. {elsewhere.length} thing
          {elsewhere.length === 1 ? "" : "s"} elsewhere.
        </span>
        <span className="shrink-0 text-xs underline-offset-2 hover:underline">
          {showOther ? "hide" : "see them"}
        </span>
        {showOther && (
          <ul className="basis-full space-y-1 pt-2 text-xs">
            {elsewhere.map((n) => (
              <li key={n.id}>
                <span className="font-medium text-ink">{n.targetLabel}</span> — {n.title}
              </li>
            ))}
          </ul>
        )}
      </button>
    ) : null;

  // Everything on this tab dealt with: one line, not a panel.
  if (!open.length)
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-sm text-emerald-900">
        <CheckSquare size={15} className="shrink-0" />
        <span className="min-w-0 flex-1">
          All {done.length} thing{done.length === 1 ? "" : "s"} for this tab dealt with.
          {elsewhere.length ? ` ${elsewhere.length} still open elsewhere.` : ""}
        </span>
        <button
          className="shrink-0 text-xs underline-offset-2 hover:underline"
          onClick={() => setShowDone((v) => !v)}
        >
          {showDone ? "hide" : "see them"}
        </button>
        <button className="shrink-0 text-xs underline-offset-2 hover:underline" onClick={onClear}>
          clear
        </button>
        {showDone && (
          <ul className="basis-full space-y-1 pt-2 text-xs text-emerald-900/70">
            {done.map((n) => (
              <li key={n.id} className="line-through">
                {n.title}
              </li>
            ))}
          </ul>
        )}
      </div>
    );

  return (
    <section className="rounded-xl border border-[var(--accent)]/30 bg-[var(--accent-soft)]/25">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--accent)]/20 px-3 py-2">
        <Stethoscope size={15} className="shrink-0 text-[var(--accent)]" />
        <h3 className="text-sm font-semibold">
          {open.length} thing{open.length === 1 ? "" : "s"} worth changing here
        </h3>
        {at && (
          <span className="text-xs text-muted">
            read through {new Date(at).toLocaleDateString()}
          </span>
        )}
        <span className="flex-1" />
        {onFixAll && fixable.length > 1 && (
          <Button size="sm" disabled={busy} onClick={() => onFixAll(fixable)}>
            <Wand2 size={13} /> Fix all {fixable.length} for me
          </Button>
        )}
        <button
          className="rounded p-1 text-muted hover:text-ink"
          title="Clear the read-through"
          aria-label="Clear the read-through"
          onClick={onClear}
        >
          <X size={14} />
        </button>
      </div>
      <ul className="divide-y divide-[var(--accent)]/15">
        {open.map((n) => (
          <li key={n.id} className="flex items-start gap-2.5 p-3">
            <span
              title={`${n.severity} priority`}
              className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                n.severity === "high"
                  ? "bg-red-500"
                  : n.severity === "medium"
                    ? "bg-amber-500"
                    : "bg-slate-300"
              }`}
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{n.title}</p>
              {n.detail && <p className="mt-0.5 text-sm text-muted">{n.detail}</p>}
              {/* The questions it actually means. "Cut the duplicates down
                  to one" sent the writer hunting their own list for the pair
                  the reviewer had in mind; now the note shows them. */}
              {questionText && (n.questionIds?.length ?? 0) > 0 && (
                <ul className="mt-1.5 space-y-1 border-l-2 border-[var(--accent)]/25 pl-2.5">
                  {n.questionIds!.map((id) => {
                    const text = questionText(id);
                    return text ? (
                      <li key={id} className="text-xs text-ink/80">
                        {text}
                      </li>
                    ) : null;
                  })}
                </ul>
              )}
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                  {n.targetLabel}
                </span>
                {canFix(n) && (
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => onFix!(n)}>
                    <Wand2 size={12} />
                    {/* Say what the button will do, not "do it". Binning a
                        question and rewording one are not the same promise. */}
                    {n.action === "bin"
                      ? `Bin ${n.questionIds!.length === 1 ? "it" : `those ${n.questionIds!.length}`}`
                      : n.action === "rewrite"
                        ? `Rewrite ${n.questionIds!.length === 1 ? "it" : `those ${n.questionIds!.length}`}`
                        : "Do it for me"}
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => onToggleDone(n)}>
                  <CheckSquare size={12} /> I&apos;ve done it
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onDismiss(n)}>
                  Not needed
                </Button>
              </div>
            </div>
          </li>
        ))}
      </ul>
      {(done.length > 0 || elsewhere.length > 0) && (
        <div className="space-y-1.5 border-t border-[var(--accent)]/20 px-3 py-2">
          {done.length > 0 && (
            <div>
              <button
                className="text-xs text-muted underline-offset-2 hover:underline"
                onClick={() => setShowDone((v) => !v)}
              >
                {done.length} already dealt with {showDone ? "(hide)" : "(show)"}
              </button>
              {showDone && (
                <ul className="mt-1.5 space-y-1">
                  {done.map((n) => (
                    <li key={n.id} className="flex items-center gap-2 text-xs text-muted">
                      <span className="min-w-0 flex-1 truncate line-through">{n.title}</span>
                      <button
                        className="shrink-0 rounded p-0.5 hover:text-ink"
                        title="Put it back on the list"
                        aria-label="Put it back on the list"
                        onClick={() => onToggleDone(n)}
                      >
                        <Undo2 size={12} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {elsewhere.length > 0 && (
            <div>
              <button
                className="text-xs text-muted underline-offset-2 hover:underline"
                onClick={() => setShowOther((v) => !v)}
              >
                {elsewhere.length} more about the rest of the pack{" "}
                {showOther ? "(hide)" : "(show)"}
              </button>
              {showOther && (
                <ul className="mt-1.5 space-y-1 text-xs text-muted">
                  {elsewhere.map((n) => (
                    <li key={n.id}>
                      <span className="font-medium text-ink">{n.targetLabel}</span> — {n.title}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
