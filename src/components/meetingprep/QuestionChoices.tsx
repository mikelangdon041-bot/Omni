"use client";

// Other ways to ask a question under the same setup. The writer liked one
// kind of question for one setup and another for the next, and said another
// person might choose differently again, so the versions are offered side by
// side and picking one swaps it in. The one it replaces stays as an option.
// Sometimes they like two: "Keep both" holds the second under the first, to
// ask if the first falls flat, and it travels with the question. (Not
// "backup": in the list that already means a question held in reserve.)

import { useState } from "react";
import type { QuestionOption, SharperQuestion } from "@/lib/meetingprep/types";

type Holder = {
  text: string;
  followUp: string;
  forWhom?: string;
  options?: QuestionOption[];
  suggested?: SharperQuestion;
  optionChosen?: boolean;
};

/** The options for a question, an older single suggestion included. */
export function choicesOf(x: Holder): QuestionOption[] {
  const opts = [...(x.options || [])];
  if (x.suggested && !opts.some((o) => o.text === x.suggested!.text))
    opts.push({ kind: "Sharper", text: x.suggested.text, followUp: x.suggested.followUp });
  return opts;
}

/** The backup questions kept beside the main one. */
export function backupsOf(x: { options?: QuestionOption[] }): QuestionOption[] {
  return (x.options || []).filter((o) => o.keep);
}

/** What to save when an option is picked: it becomes the question, and the old question becomes an option. */
export function pickOption(x: Holder, o: QuestionOption) {
  // A version written for particular panelists makes the question theirs:
  // picking one used to leave the old names on it.
  const who = o.forWhom ?? (o.kind.startsWith("For ") ? o.kind.slice(4) : x.forWhom);
  return {
    text: o.text,
    followUp: o.followUp || x.followUp,
    forWhom: who || "",
    suggested: undefined,
    optionChosen: true,
    options: [
      { kind: "Yours before", text: x.text, followUp: x.followUp, forWhom: x.forWhom || "" },
      ...choicesOf(x).filter((c) => c.text !== o.text && c.text !== x.text),
    ],
  };
}

/** Keep an option as a backup question, or let it go back to being a version. */
function keepOption(x: Holder, o: QuestionOption, keep: boolean) {
  return {
    suggested: undefined,
    options: choicesOf(x).map((c) => (c.text === o.text ? { ...c, keep } : c)),
  };
}

export function QuestionChoices({
  x,
  busy = false,
  onPick,
  onWrite,
}: {
  x: Holder;
  busy?: boolean;
  onPick: (patch: Partial<Holder>) => void;
  /** Writes options for a question that has none. */
  onWrite?: () => void;
}) {
  const opts = choicesOf(x);
  const kept = opts.filter((o) => o.keep);
  const rest = opts.filter((o) => !o.keep);
  const [shown, setShown] = useState(false);
  const open = shown || !x.optionChosen;

  return (
    <>
      {kept.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {kept.map((o) => (
            <li key={o.text} className="text-sm">
              <p className="text-ink">
                <span className="mr-1.5 text-[11px] font-semibold text-muted">If that falls flat:</span>
                {o.text}
              </p>
              <div className="mt-0.5 flex gap-3 text-xs">
                <button
                  type="button"
                  onClick={() => onPick(pickOption(x, o))}
                  className="text-muted hover:text-ink hover:underline"
                  title="Make this the main question"
                >
                  Make main
                </button>
                <button
                  type="button"
                  onClick={() => onPick(keepOption(x, o, false))}
                  className="text-muted hover:text-ink hover:underline"
                >
                  Drop
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {busy ? (
        <p className="mt-1.5 text-xs text-muted">Writing other ways to ask it…</p>
      ) : !opts.length ? (
        onWrite ? (
          <button type="button" onClick={onWrite} className="mt-1.5 text-xs font-medium text-[var(--accent)] hover:underline">
            Other ways to ask it
          </button>
        ) : null
      ) : !rest.length ? null : !open ? (
        // Once one is chosen the rest are kept, folded away: the writer said
        // the one they picked should stand alone with the others a click off.
        <button type="button" onClick={() => setShown(true)} className="mt-1.5 text-xs text-muted hover:text-ink hover:underline">
          Other versions ({rest.length})
        </button>
      ) : (
        <div className="mt-2 rounded-md bg-canvas px-2.5 py-2">
          <div className="flex items-center">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Other ways to ask it</p>
            {/* Liking the one you have is a choice too: it folds the rest away. */}
            <button
              type="button"
              onClick={() => (x.optionChosen ? setShown(false) : onPick({ optionChosen: true }))}
              className="ml-auto text-xs font-medium text-muted hover:text-ink hover:underline"
            >
              {x.optionChosen ? "Hide" : "Keep mine, hide these"}
            </button>
          </div>
          {/* The question first, full width; what to do with it underneath,
              so the eye reads the question rather than a column of links. */}
          <ul className="mt-1 divide-y divide-border">
            {rest.map((o) => (
              <li key={o.text} className="py-2 first:pt-1 last:pb-0">
                {/* A version rewritten for particular panelists says so:
                    without it, it read as the same question reworded. */}
                {o.kind.startsWith("For ") && (
                  <p className="mb-0.5 text-[11px] font-semibold text-[var(--accent)]">Reworked {o.kind.replace(/^For /, "for ")}
                    {o.note && <span className="font-normal text-muted">: {o.note}</span>}
                  </p>
                )}
                <p className="text-sm leading-snug text-ink">{o.text}</p>
                <div className="mt-1 flex gap-3 text-xs font-medium">
                  <button
                    type="button"
                    onClick={() => {
                      setShown(false);
                      onPick(pickOption(x, o));
                    }}
                    className="text-[var(--accent)] hover:underline"
                  >
                    Use this instead
                  </button>
                  <button
                    type="button"
                    onClick={() => onPick(keepOption(x, o, true))}
                    className="text-muted hover:text-ink hover:underline"
                    title="Keep this one too, under the first, to ask if the first falls flat"
                  >
                    Keep both
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

/** Who a question is for, at a glance. */
export function ForChip({ who }: { who: string }) {
  if (!who.trim()) return null;
  return (
    <span className="rounded bg-[var(--accent-soft)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--accent)]">
      {/^for\b/i.test(who) ? who : `For ${who}`}
    </span>
  );
}

/** First names of the people in the room, for the chips. */
export function panelNames(attendees: { name: string }[] = []): string[] {
  return attendees.map((a) => a.name.trim().split(/[\s,]+/)[0]).filter(Boolean);
}

/** The panelists a "for" line names; everyone when it says so, or says nothing. */
export function namesIn(forWhom: string, panel: string[]): string[] {
  const named = panel.filter((n) => new RegExp(`\\b${n}\\b`, "i").test(forWhom));
  return named.length ? named : panel;
}

/**
 * Who to put it to. The chips are the panelists it works for; one click
 * assigns it to that one, so the writer can plan who speaks when. Those it
 * does not suit are left off rather than greyed, so the choice is real.
 */
export function AskWho({
  forWhom,
  panel,
  value,
  onChange,
}: {
  forWhom: string;
  panel: string[];
  value?: string;
  onChange: (who: string) => void;
}) {
  if (!panel.length) return <ForChip who={forWhom} />;
  const names = namesIn(forWhom, panel);
  const general = names.length === panel.length;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className="text-[10px] font-semibold text-muted">{general ? "Ask anyone:" : "Works for:"}</span>
      {names.map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(value === n ? "" : n)}
          title={value === n ? `Assigned to ${n}. Click to unassign.` : `Put this one to ${n}`}
          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold transition ${
            value === n
              ? "bg-[var(--accent)] text-[var(--accent-fg)]"
              : "bg-[var(--accent-soft)] text-[var(--accent)] hover:bg-[var(--accent)]/20"
          }`}
        >
          {value === n ? `Ask ${n}` : n}
        </button>
      ))}
    </span>
  );
}

/** Whether a "for" line covers this panelist: named, or "Everyone". */
export function fitsPanelist(forWhom: string, name: string): boolean {
  return /^(?:for )?everyone\b/i.test(forWhom.trim()) || new RegExp(`\\b${name}\\b`, "i").test(forWhom);
}
