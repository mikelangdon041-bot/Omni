"use client";

// Meeting Prep — Ask mode: the screen you have open while the meeting is
// actually happening. Its own file because it is its own thing: no editing,
// no generating, no lists of twenty. One question at a size you can read from
// arm's length, and a way to get to the next one.

import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Check, ListChecks, Star, Timer, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { stripAskedQuestion, type QuestionItem, type QuestionOption } from "@/lib/meetingprep/types";

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
  picked: all,
  panel = [],
  onToggleAsked,
  onResetTicks,
  onUseKept,
  minutesOf,
  quickOf,
  slotMin,
  leadMin = 0,
  endMin = 0,
  clockKey = "",
}: {
  onClose: () => void;
  /** The subject, on screen while you are standing in front of the room. */
  topic: string;
  title: string;
  picked: QuestionItem[];
  /** First names, for showing one person's questions. */
  panel?: string[];
  onToggleAsked: (q: QuestionItem) => void;
  onResetTicks: () => void;
  /** Swaps a kept second question in for the main one. */
  onUseKept?: (q: QuestionItem, o: QuestionOption) => void;
  /** How long a question runs, the same reckoning as the list's. */
  minutesOf?: (q: QuestionItem) => number;
  /** A question to everyone, asked for a minute each: how long it takes then. Null for any other. */
  quickOf?: (q: QuestionItem) => number | null;
  /** The whole slot, in minutes. */
  slotMin?: number | null;
  /** Before the first question: introductions and the opening. */
  leadMin?: number;
  /** After the last: the close, and any audience questions. */
  endMin?: number;
  clockKey?: string;
}) {
  // In the room you may only want the must-asks, or one person's share.
  const [show, setShow] = useState<string>("all");
  const asks = (q: QuestionItem) => (q.askWho || "").split(/\s*,\s*/).filter(Boolean);
  const picked = all.filter((q) =>
    show === "all" ? true : show === "must" ? q.mustAsk : show === "reserve" ? q.backup : asks(q).includes(show),
  );
  const filters = [
    { key: "all", label: "All", n: all.length },
    { key: "must", label: "Must ask", n: all.filter((q) => q.mustAsk).length },
    { key: "reserve", label: "In reserve", n: all.filter((q) => q.backup).length },
    ...panel.map((n) => ({ key: n, label: n, n: all.filter((q) => asks(q).includes(n)).length })),
  ].filter((f) => f.key === "all" || f.n > 0);
  // The clock, kept through closing Ask mode or the pane.
  const clockStore = `mp:clock:${clockKey}`;
  const [startedAt, setStartedAt] = useState<number | null>(() => {
    try {
      const v = Number(localStorage.getItem(clockStore));
      return v > 0 ? v : null;
    } catch {
      return null;
    }
  });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [startedAt]);
  const startClock = (on: boolean) => {
    const v = on ? Date.now() : null;
    setStartedAt(v);
    setNow(Date.now());
    try {
      if (v) localStorage.setItem(clockStore, String(v));
      else localStorage.removeItem(clockStore);
    } catch {}
  };

  const main = picked.filter((q) => !q.backup);
  const backups = picked.filter((q) => q.backup);
  const flow = [...main, ...backups];

  // Against the whole running order, whatever is filtered: the time left
  // after every main question you have not ticked yet is what is spare.
  const clock = (() => {
    if (!minutesOf || !slotMin || !startedAt) return null;
    const gone = Math.max(0, (now - startedAt) / 60000);
    const toCome = all.filter((q) => !q.backup && !q.asked).reduce((n, q) => n + minutesOf(q), 0) + Math.max(0, leadMin - gone);
    const left = slotMin - endMin - gone;
    const spare = left - toCome;
    const reserve = all.find((q) => q.backup && !q.asked && minutesOf(q) <= spare);
    // Running over with a question to everyone still to come: a minute each
    // on it is the cut that keeps the running order, before skipping any.
    let quick: { q: QuestionItem; saves: number; both: boolean } | null = null;
    if (spare <= -1 && quickOf) {
      const toAll = all
        .filter((q) => !q.backup && !q.asked)
        .map((q) => ({ q, saves: minutesOf(q) - (quickOf(q) ?? minutesOf(q)) }))
        .filter((x) => x.saves >= 1);
      if (toAll.length) {
        const one = toAll.find((x) => x.saves >= -spare);
        const all2 = toAll.reduce((n, x) => n + x.saves, 0);
        quick = one ? { q: one.q, saves: one.saves, both: false } : { q: toAll[0].q, saves: all2, both: toAll.length > 1 };
      }
    }
    return { gone, left, spare, reserve, quick };
  })();
  const goTo = (q: QuestionItem) => {
    setShow("all");
    setMode("one");
    const order = [...all.filter((x) => !x.backup), ...all.filter((x) => x.backup)];
    setAt(Math.max(0, order.findIndex((x) => x.id === q.id)));
  };
  const mmss = (min: number) => {
    const t = Math.max(0, Math.round(min * 60));
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
  };
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
        {filters.length > 1 && (
          <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-1.5 px-4 pb-2.5 text-xs">
            <span className="mr-0.5 font-semibold text-muted">Show</span>
            {filters.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => {
                  setShow(f.key);
                  setAt(0);
                }}
                className={`rounded-full border px-2 py-0.5 font-medium transition ${
                  show === f.key
                    ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)]"
                    : "border-border bg-surface text-ink/80 hover:border-[var(--accent)]"
                }`}
              >
                {f.label} <span className="tabular-nums opacity-70">{f.n}</span>
              </button>
            ))}
          </div>
        )}
        {/* Ahead or behind, and whether a reserve question fits. One number,
            spare time, after everything still to come in the running order. */}
        {minutesOf && slotMin ? (
          <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-x-3 gap-y-1 px-4 pb-2.5 text-xs">
            {!clock ? (
              <>
                <Button size="sm" variant="secondary" onClick={() => startClock(true)}>
                  <Timer size={13} /> Start the clock
                </Button>
                <span className="text-muted">Start it when the panel starts, to see if you&apos;re ahead and when a reserve question fits.</span>
              </>
            ) : (
              <>
                <span className="font-mono text-sm font-semibold tabular-nums text-ink">{mmss(clock.gone)}</span>
                <span className="text-muted">{clock.left > 0 ? `${Math.round(clock.left)} min left` : "Time's up"}</span>
                <span
                  className={`rounded-full px-2 py-0.5 font-semibold ${
                    clock.spare >= 1 ? "bg-emerald-50 text-emerald-800" : clock.spare <= -1 ? "bg-amber-100 text-amber-900" : "bg-canvas text-ink/80"
                  }`}
                  title="Time left, after every question in your running order you haven't ticked yet. Tick each one as you finish it."
                >
                  {clock.spare >= 1
                    ? `About ${Math.round(clock.spare)} min spare`
                    : clock.spare <= -1
                      ? clock.quick
                        ? `About ${Math.round(-clock.spare)} min over: ask for a minute each on ${
                            clock.quick.both ? "the questions to everyone" : `“${clock.quick.q.text.split(/\s+/).slice(0, 6).join(" ")}…”`
                          }, which saves about ${Math.round(clock.quick.saves)} min${clock.quick.saves + clock.spare < -0.5 ? ", and skip one that isn't a must-ask" : ""}`
                        : `About ${Math.round(-clock.spare)} min over: skip one that isn't a must-ask`
                      : "On time"}
                </span>
                {clock.reserve && (
                  <button type="button" onClick={() => goTo(clock.reserve!)} className="font-medium text-[var(--accent)] hover:underline">
                    Room for a reserve question: go to it
                  </button>
                )}
                {/* Time in hand before a whole new question: the probe, or a
                    second voice on this one. */}
                {clock.spare >= 1.5 && (
                  <span className="text-muted">
                    {clock.spare >= 3 ? "Ahead: use the probe, or ask another panelist to come in on this one." : "A little ahead: room for the probe."}
                  </span>
                )}
                <button type="button" onClick={() => startClock(false)} className="ml-auto text-muted hover:text-ink hover:underline">
                  Reset clock
                </button>
              </>
            )}
          </div>
        ) : null}
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
              {(cur.askWho || cur.forWhom) && (
                <span className="rounded-full border border-border px-2.5 py-1 text-muted">
                  {cur.askWho ? `Ask ${asks(cur).join(", ")}` : `For ${cur.forWhom}`}
                </span>
              )}
              {cur.mustAsk && (
                <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 font-semibold text-amber-800">
                  <Star size={12} className="fill-current" /> Must ask
                </span>
              )}
              {cur.asked && (
                <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-700">
                  <Check size={12} /> Asked
                </span>
              )}
            </div>

            {/* Said first, so it reads first, a size down: the question is
                the line that has to survive a glance. */}
            {/* Laid out to be said: the setup a sentence a line, so each break
                is a breath, numbers in bold to land on, then the question.
                One block of grey was hard to keep your place in. */}
            {stripAskedQuestion(cur.setup, cur.text) && (
              <div className={`mt-5 ${cur.asked ? "opacity-40" : ""}`}>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Say first</p>
                <div className="mt-1.5 space-y-1.5 text-lg leading-relaxed text-ink/80 sm:text-xl">
                  {sentences(stripAskedQuestion(cur.setup, cur.text)).map((line, i) => (
                    <p key={i}>
                      <Spoken text={line} />
                    </p>
                  ))}
                </div>
              </div>
            )}
            <div className={`${cur.setup ? "mt-5" : "mt-5"} ${cur.asked ? "opacity-40" : ""}`}>
              {stripAskedQuestion(cur.setup, cur.text) && (
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--accent)]">Then ask</p>
              )}
              <p className="mt-1 text-balance text-2xl font-semibold leading-tight tracking-tight text-ink sm:text-[2rem]">
                <Spoken text={cur.text} names={panel} />
              </p>
            </div>

            {(cur.options || []).some((o) => o.keep) && (
              <div className="mt-6 rounded-xl border border-border bg-surface p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Or ask</p>
                {(cur.options || [])
                  .filter((o) => o.keep && o.text.trim())
                  .map((o, i) => (
                    <div key={i} className="mt-1.5">
                      {o.setup && <p className="text-sm leading-relaxed text-muted">{o.setup}</p>}
                      <p className="text-base leading-snug text-ink/75 sm:text-lg">{o.text}</p>
                      {onUseKept && (
                        <button
                          type="button"
                          onClick={() => onUseKept(cur, o)}
                          className="mt-0.5 text-xs font-medium text-[var(--accent)] hover:underline"
                        >
                          Use this one instead
                        </button>
                      )}
                    </div>
                  ))}
              </div>
            )}

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
        {stripAskedQuestion(q.setup, q.text) && !q.asked && (
          <span className="mb-0.5 block text-sm leading-snug text-muted">{stripAskedQuestion(q.setup, q.text)}</span>
        )}
        <span
          className={`block text-base leading-snug sm:text-lg ${
            q.asked ? "text-muted line-through" : "font-medium text-ink"
          }`}
        >
          {q.text}
        </span>
        {(q.askWho || q.forWhom) && (
          <span className="mt-0.5 block text-sm text-muted">
            {q.askWho ? `Ask ${q.askWho}` : `For ${q.forWhom}`}
            {q.mustAsk ? " · Must ask" : ""}
          </span>
        )}
        {(q.options || [])
          .filter((o) => o.keep && o.text.trim())
          .map((o, i) => (
            <span key={i} className="mt-1 block text-sm text-muted">
              Or: {o.text}
            </span>
          ))}
        {q.followUp && (
          <span className="mt-1 block text-sm text-muted">Then: {q.followUp}</span>
        )}
      </button>
    </li>
  );
}

/** A setup split where you would breathe: one sentence a line. */
function sentences(t: string): string[] {
  return t
    .trim()
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"\u201c])/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/**
 * Words to be said, with what to land on marked: numbers and percentages in
 * bold, and a panelist's name at the start in colour, the cue to turn to them.
 */
function Spoken({ text, names = [] }: { text: string; names?: string[] }) {
  const lead = names.find((n) => n && new RegExp(`^${n.replace(/[^A-Za-z]/g, "")}\\b`, "i").test(text));
  const rest = lead ? text.slice(lead.length) : text;
  const parts = rest.split(/(\b\d[\d,.]*(?:\s?(?:percent|%|x|times|billion|million))?)/i);
  return (
    <>
      {lead && <span className="text-[var(--accent)]">{text.slice(0, lead.length)}</span>}
      {parts.map((p, i) => (i % 2 ? <strong key={i} className="font-semibold text-ink">{p}</strong> : <span key={i}>{p}</span>))}
    </>
  );
}
