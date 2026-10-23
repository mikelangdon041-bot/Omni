"use client";

// Other ways to ask a question under the same setup. The writer liked one
// kind of question for one setup and another for the next, and said another
// person might choose differently again, so the versions are offered side by
// side and picking one swaps it in. The one it replaces stays as an option.

import type { QuestionOption, SharperQuestion } from "@/lib/meetingprep/types";

type Holder = { text: string; followUp: string; options?: QuestionOption[]; suggested?: SharperQuestion };

/** The options for a question, an older single suggestion included. */
export function choicesOf(x: Holder): QuestionOption[] {
  const opts = [...(x.options || [])];
  if (x.suggested && !opts.some((o) => o.text === x.suggested!.text))
    opts.push({ kind: "Sharper", text: x.suggested.text, followUp: x.suggested.followUp });
  return opts;
}

/** What to save when an option is picked: it becomes the question, and the old question becomes an option. */
export function pickOption(x: Holder, o: QuestionOption) {
  return {
    text: o.text,
    followUp: o.followUp || x.followUp,
    suggested: undefined,
    options: [
      { kind: "Yours before", text: x.text, followUp: x.followUp },
      ...choicesOf(x).filter((c) => c.text !== o.text && c.text !== x.text),
    ],
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
  onPick: (patch: ReturnType<typeof pickOption>) => void;
  /** Writes options for a question that has none. */
  onWrite?: () => void;
}) {
  const opts = choicesOf(x);
  if (busy) return <p className="mt-1.5 text-xs text-muted">Writing other ways to ask it…</p>;
  if (!opts.length)
    return onWrite ? (
      <button type="button" onClick={onWrite} className="mt-1.5 text-xs font-medium text-[var(--accent)] hover:underline">
        Other ways to ask it
      </button>
    ) : null;
  return (
    <div className="mt-2 rounded-md bg-canvas px-2.5 py-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Or ask it this way</p>
      <ul className="mt-1 space-y-1.5">
        {opts.map((o) => (
          <li key={o.text} className="flex items-start gap-2">
            <button
              type="button"
              onClick={() => onPick(pickOption(x, o))}
              className="min-w-0 flex-1 rounded px-1 py-0.5 text-left text-sm text-ink hover:bg-surface"
              title="Use this one"
            >
              <span className="mr-1.5 text-[11px] font-semibold text-muted">{o.kind}</span>
              {o.text}
            </button>
            <button
              type="button"
              onClick={() => onPick(pickOption(x, o))}
              className="shrink-0 pt-0.5 text-xs font-medium text-[var(--accent)] hover:underline"
            >
              Use this
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
