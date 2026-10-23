"use client";

// Other ways to ask a question under the same setup. The writer liked one
// kind of question for one setup and another for the next, and said another
// person might choose differently again, so the versions are offered side by
// side and picking one swaps it in. The one it replaces stays as an option.
// Sometimes they like two: "Keep both" holds the second as a backup question,
// said if the first one falls flat, and it travels with the question.

import { useState } from "react";
import type { QuestionOption, SharperQuestion } from "@/lib/meetingprep/types";

type Holder = {
  text: string;
  followUp: string;
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
  return {
    text: o.text,
    followUp: o.followUp || x.followUp,
    suggested: undefined,
    optionChosen: true,
    options: [
      { kind: "Yours before", text: x.text, followUp: x.followUp },
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
            <li key={o.text} className="flex items-start gap-2 text-sm">
              <span className="min-w-0 flex-1 text-ink">
                <span className="mr-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Backup</span>
                {o.text}
              </span>
              <button
                type="button"
                onClick={() => onPick(pickOption(x, o))}
                className="shrink-0 pt-0.5 text-xs text-muted hover:text-ink hover:underline"
                title="Make this the main question"
              >
                Make main
              </button>
              <button
                type="button"
                onClick={() => onPick(keepOption(x, o, false))}
                className="shrink-0 pt-0.5 text-xs text-muted hover:text-ink hover:underline"
              >
                Drop
              </button>
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
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Or ask it this way</p>
            {x.optionChosen && (
              <button type="button" onClick={() => setShown(false)} className="ml-auto text-xs text-muted hover:text-ink hover:underline">
                Hide
              </button>
            )}
          </div>
          <ul className="mt-1 space-y-1.5">
            {rest.map((o) => (
              <li key={o.text} className="flex items-start gap-2">
                <span className="min-w-0 flex-1 px-1 py-0.5 text-sm text-ink">{o.text}</span>
                <button
                  type="button"
                  onClick={() => {
                    setShown(false);
                    onPick(pickOption(x, o));
                  }}
                  className="shrink-0 pt-0.5 text-xs font-medium text-[var(--accent)] hover:underline"
                >
                  Use this
                </button>
                <button
                  type="button"
                  onClick={() => onPick(keepOption(x, o, true))}
                  className="shrink-0 pt-0.5 text-xs font-medium text-[var(--accent)] hover:underline"
                  title="Keep this one too, as a backup question under the same setup"
                >
                  Keep both
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
