"use client";

// Other ways to ask a question under the same setup. The writer liked one
// kind of question for one setup and another for the next, and said another
// person might choose differently again, so the versions are offered side by
// side and picking one swaps it in. The one it replaces stays as an option.
// Sometimes they like two: "Keep both" holds the second under the first, to
// ask if the first falls flat, and it travels with the question. (Not
// "backup": in the list that already means a question held in reserve.)

import { useState } from "react";
import { Loader2 } from "lucide-react";
import type { QuestionOption, SharperQuestion } from "@/lib/meetingprep/types";

type Holder = {
  text: string;
  followUp: string;
  forWhom?: string;
  setup?: string;
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
    // A version with its own lead-in brings it; the old one goes with the old question.
    ...(o.setup ? { setup: o.setup } : {}),
    suggested: undefined,
    optionChosen: true,
    options: [
      { kind: "Yours before", text: x.text, followUp: x.followUp, forWhom: x.forWhom || "", ...(o.setup ? { setup: x.setup || "" } : {}) },
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
  fold = false,
  startOpen = false,
}: {
  x: Holder;
  busy?: boolean;
  onPick: (patch: Partial<Holder>) => void;
  /** Writes options for a question that has none. */
  onWrite?: () => void;
  /** Keep the versions behind a button until asked for. On the list eight
   *  open versions under one question were most of the page. */
  fold?: boolean;
  /** Open on arrival: the writer just asked for these and is waiting. */
  startOpen?: boolean;
}) {
  const opts = choicesOf(x);
  const kept = opts.filter((o) => o.keep);
  const rest = opts.filter((o) => !o.keep);
  const [shown, setShown] = useState(startOpen);
  const open = shown || (!fold && !x.optionChosen);

  return (
    <>
      {kept.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {kept.map((o) => (
            <li key={o.text} className="text-sm">
              <p className="text-ink">
                <span className="mr-1.5 text-[11px] font-semibold text-emerald-700">Also kept, if that falls flat:</span>
                {o.text}
              </p>
              {/* Either one can end up the question: this swaps them, and the
                  one it replaces stays kept in its place. */}
              <div className="mt-0.5 flex gap-3 text-xs font-medium">
                <button
                  type="button"
                  onClick={() => {
                    const next = pickOption(x, o);
                    // The question it replaces is kept as the second way, not lost among the versions.
                    next.options = next.options.map((c) => (c.kind === "Yours before" ? { ...c, keep: true, kind: "Kept" } : c));
                    onPick(next);
                  }}
                  className="text-[var(--accent)] hover:underline"
                >
                  Use this one instead
                </button>
                <button
                  type="button"
                  onClick={() => onPick(keepOption(x, o, false))}
                  className="text-muted hover:text-ink hover:underline"
                >
                  Don&apos;t keep it
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {busy ? (
        // Said plainly and in colour: a grey line under the question read as
        // nothing happening.
        <p className="mt-2 inline-flex items-center gap-2 rounded-md bg-[var(--accent-soft)] px-2.5 py-1.5 text-xs font-medium text-[var(--accent)]">
          <Loader2 size={13} className="animate-spin" />
          Writing other ways to ask it. About 20 seconds; they open here when ready.
        </p>
      ) : !opts.length ? (
        onWrite ? (
          <button
            type="button"
            onClick={onWrite}
            className="mt-1.5 rounded-md border border-border px-2 py-0.5 text-xs font-medium text-ink/80 transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
          >
            Write other ways to ask it
          </button>
        ) : null
      ) : !rest.length ? null : !open ? (
        // Once one is chosen the rest are kept, folded away: the writer said
        // the one they picked should stand alone with the others a click off.
        <button
          type="button"
          onClick={() => setShown(true)}
          className="mt-1.5 rounded-md border border-border px-2 py-0.5 text-xs font-medium text-ink/80 transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
        >
          {rest.length} other {rest.length === 1 ? "way" : "ways"} to ask it
        </button>
      ) : (
        <div className="mt-2 rounded-md bg-canvas px-2.5 py-2">
          <div className="flex items-center">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Other ways to ask it</p>
            {/* Liking the one you have is a choice too: it folds the rest away. */}
            <button
              type="button"
              onClick={() => (x.optionChosen || fold ? setShown(false) : onPick({ optionChosen: true }))}
              className="ml-auto text-xs font-medium text-muted hover:text-ink hover:underline"
            >
              {x.optionChosen || fold ? "Hide" : "Keep mine, hide these"}
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
                {o.setup && <p className="mb-0.5 text-sm leading-relaxed text-ink/65">{o.setup}</p>}
                <p className="text-sm leading-snug text-ink">{o.text}</p>
                {/* Who this version suits, so a version that opens the
                    question to another panelist says so. */}
                {o.forWhom && !o.kind.startsWith("For ") && (
                  <p className="mt-0.5">
                    <ForChip who={o.forWhom} />
                  </p>
                )}
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
          <button
            type="button"
            onClick={() => (x.optionChosen || fold ? setShown(false) : onPick({ optionChosen: true }))}
            className="mt-2 text-xs font-medium text-muted hover:text-ink hover:underline"
          >
            None of these, hide them
          </button>
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

/** The panelists a question is put to, from its comma-separated askWho. */
export function askList(askWho?: string): string[] {
  return (askWho || "").split(/\s*,\s*/).filter(Boolean);
}

/**
 * Who to put it to. Every panelist is offered and any number can be picked:
 * the ones it was written for are filled, the rest are dashed "+ Name", so
 * the writer can disagree with the suggestion or split a question between
 * two. Picking someone is only a choice of who to ask: it does not rewrite
 * who the question was written for, so taking them off puts them back as
 * they were.
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
  /** The panelists chosen, comma separated, or "" for nobody. */
  onChange: (who: string, forWhom?: string) => void;
}) {
  if (!panel.length) return <ForChip who={forWhom} />;
  const fits = namesIn(forWhom, panel);
  const chosen = askList(value);
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className="text-[10px] font-semibold text-muted">{chosen.length ? "Asking:" : "Ask:"}</span>
      {panel.map((n) => {
        const fit = fits.includes(n);
        const on = chosen.includes(n);
        return (
          <button
            key={n}
            type="button"
            onClick={() => onChange((on ? chosen.filter((x) => x !== n) : panel.filter((x) => x === n || chosen.includes(x))).join(", "))}
            title={on ? `Asking ${n}. Click to take them off.` : fit ? `Ask ${n}` : `Not written for ${n}, but you can ask them anyway`}
            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold transition ${
              on
                ? "border border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)]"
                : fit
                  ? "border border-transparent bg-[var(--accent-soft)] text-[var(--accent)] hover:bg-[var(--accent)]/20"
                  : "border border-dashed border-border text-muted hover:border-[var(--accent)] hover:text-[var(--accent)]"
            }`}
          >
            {on ? `✓ ${n}` : fit ? n : `+ ${n}`}
          </button>
        );
      })}
    </span>
  );
}

/** Whether a "for" line covers this panelist: named, or "Everyone". */
export function fitsPanelist(forWhom: string, name: string): boolean {
  return /^(?:for )?everyone\b/i.test(forWhom.trim()) || new RegExp(`\\b${name}\\b`, "i").test(forWhom);
}
