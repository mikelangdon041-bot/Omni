"use client";

// Meeting Prep — Ask mode: the screen you have open while the meeting is
// actually happening. Its own file because it is its own thing: no editing,
// no generating, no lists of twenty. One question at a size you can read from
// arm's length, and a way to get to the next one.

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ArrowLeft, ArrowRight, ListChecks, Pause, Play, RotateCcw, Star, Timer, X } from "lucide-react";
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
  onUseKept,
  onPatch,
  opening = "",
  onOpening,
  onWriteTips,
  tipping = false,
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
  /** No longer used: moving on is enough, nothing is ticked off. */
  onToggleAsked?: (q: QuestionItem) => void;
  onResetTicks?: () => void;
  /** Swaps a kept second question in for the main one. */
  onUseKept?: (q: QuestionItem, o: QuestionOption) => void;
  /** Writes the tips for the running order, from here. */
  onWriteTips?: () => void;
  tipping?: boolean;
  /** Changes a question's words from here, for laying it out the way they say it. */
  onPatch?: (q: QuestionItem, p: Partial<QuestionItem>) => void;
  /** What they say to open, before the introductions, and saving it. */
  opening?: string;
  onOpening?: (t: string) => void;
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
      // A clock left running from a rehearsal or a test is not this panel:
      // it read "25 min over" before a word was said.
      if (v > 0 && Date.now() - v > ((slotMin || 60) + 30) * 60000) {
        localStorage.removeItem(clockStore);
        return null;
      }
      return v > 0 ? v : null;
    } catch {
      return null;
    }
  });
  const [now, setNow] = useState(() => Date.now());
  // Paused, like a presenter's timer: when it was paused, kept through
  // closing Ask mode or the pane.
  const pauseStore = `${clockStore}:paused`;
  const [pausedAt, setPausedAt] = useState<number | null>(() => {
    try {
      const v = Number(localStorage.getItem(pauseStore));
      return v > 0 && startedAt ? v : null;
    } catch {
      return null;
    }
  });
  useEffect(() => {
    if (!startedAt || pausedAt) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [startedAt, pausedAt]);
  // When the introductions finished, so the clock stops holding time for
  // them and the questions are timed from where they really started.
  const introStore = `${clockStore}:intros`;
  const [introsAt, setIntrosAt] = useState<number | null>(() => {
    try {
      const v = Number(localStorage.getItem(introStore));
      return v > 0 && startedAt && v >= startedAt ? v : null;
    } catch {
      return null;
    }
  });
  const [introOpen, setIntroOpen] = useState(() => !introsAt);
  const startClock = (on: boolean, from?: number) => {
    const v = on ? (from ?? clockNow()) : null;
    setStartedAt(v);
    setNow(clockNow());
    setPausedAt(null);
    if (!on) setIntrosAt(null);
    try {
      localStorage.removeItem(pauseStore);
      if (v) localStorage.setItem(clockStore, String(v));
      else {
        localStorage.removeItem(clockStore);
        localStorage.removeItem(introStore);
      }
    } catch {}
  };
  const pauseClock = () => {
    const t = clockNow();
    setPausedAt(t);
    setNow(t);
    try {
      localStorage.setItem(pauseStore, String(t));
    } catch {}
  };
  // Resuming moves the start on by however long it sat paused, so the time
  // carries on from where it stopped.
  const resumeClock = () => {
    if (!startedAt || !pausedAt) return;
    const t = clockNow();
    const shift = t - pausedAt;
    const s2 = startedAt + shift;
    const i2 = introsAt ? introsAt + shift : null;
    setStartedAt(s2);
    if (i2) setIntrosAt(i2);
    setPausedAt(null);
    setNow(t);
    try {
      localStorage.setItem(clockStore, String(s2));
      if (i2) localStorage.setItem(introStore, String(i2));
      localStorage.removeItem(pauseStore);
    } catch {}
  };
  const introsDone = () => {
    const t = clockNow();
    // Never started: count the introductions as the time planned for them.
    if (!startedAt) startClock(true, t - leadMin * 60000);
    setIntrosAt(t);
    setIntroOpen(false);
    setAt(0);
    try {
      localStorage.setItem(introStore, String(t));
    } catch {}
  };

  const main = picked.filter((q) => !q.backup);
  const backups = picked.filter((q) => q.backup);
  const flow = [...main, ...backups];

  // The plan: when each question in the running order should start and
  // end, introductions first. It counted forward from what was left before,
  // and sat on "4 min ahead" while the minutes went by; a moderator wants
  // "I should be 12 minutes in by now" and how far off that they are.
  const allMain = all.filter((q) => !q.backup);
  const allBackups = all.filter((q) => q.backup);
  const plan = (() => {
    if (!minutesOf) return [];
    let t = leadMin;
    return allMain.map((q) => {
      const start = t;
      t += minutesOf(q);
      return { q, start, end: t };
    });
  })();
  const mainEnd = plan.length ? plan[plan.length - 1].end : leadMin;
  // Planned time left over before the close: room for a probe or a reserve.
  const slack = slotMin ? Math.max(0, slotMin - endMin - mainEnd) : 0;
  // Where the plan has you, for the question on screen (none: the intros).
  const slotFor = (curId: string | undefined) => {
    const p = plan.find((x) => x.q.id === curId);
    if (p) return { start: p.start, end: p.end };
    const r = allBackups.find((q) => q.id === curId);
    if (r && minutesOf) return { start: mainEnd, end: mainEnd + minutesOf(r) };
    return { start: 0, end: leadMin };
  };
  const clockAt = (curId: string | undefined) => {
    if (!minutesOf || !slotMin || !startedAt) return null;
    const gone = Math.max(0, ((pausedAt ?? now) - startedAt) / 60000);
    const slot = slotFor(curId);
    // Ahead: here before the plan says to be. Behind: still here after the
    // plan says to have moved on. In between, on time.
    const delta = gone < slot.start ? slot.start - gone : gone > slot.end ? slot.end - gone : 0;
    // With the spare time in the plan too: what the tips go on.
    const spare = delta + slack;
    const inMain = allMain.findIndex((q) => q.id === curId);
    const inBackups = allBackups.findIndex((q) => q.id === curId);
    const ahead = inMain >= 0 ? allMain.slice(inMain) : inBackups >= 0 ? [] : allMain;
    // A reserve not yet reached: once you have been past one, it is done.
    // Only offered near the end, before the last question: earlier, time in
    // hand is better spent on probes. It showed during the introductions.
    const late = inBackups >= 0 || (inMain >= 0 && inMain >= allMain.length - 2);
    const reserve = late ? allBackups.slice(inBackups >= 0 ? inBackups + 1 : 0).find((q) => minutesOf(q) <= spare) : undefined;
    // Running over with a question to everyone still to come: a minute each
    // on it is the cut that keeps the running order, before skipping any.
    let quick: { q: QuestionItem; saves: number; both: boolean } | null = null;
    if (spare <= -1 && quickOf) {
      const toAll = ahead
        .map((q) => ({ q, saves: minutesOf(q) - (quickOf(q) ?? minutesOf(q)) }))
        .filter((x) => x.saves >= 1);
      if (toAll.length) {
        const one = toAll.find((x) => x.saves >= -spare);
        const all2 = toAll.reduce((n, x) => n + x.saves, 0);
        quick = one ? { q: one.q, saves: one.saves, both: false } : { q: toAll[0].q, saves: all2, both: toAll.length > 1 };
      }
    }
    // The whole slot, counting down, for the close.
    const remain = slotMin - gone;
    // The part on screen: its last minute, and past its end. Shown round the
    // edge of the screen, to be caught without looking for it.
    const partLeft = gone >= slot.start ? slot.end - gone : null;
    // Green with time in hand, yellow at 2 minutes left, orange at 1, red past.
    const edge: "ok" | "soon" | "near" | "past" =
      partLeft == null || partLeft > 2 ? "ok" : partLeft > 1 ? "soon" : partLeft >= 0 ? "near" : "past";
    return { gone, slot, delta, spare, reserve, quick, remain, partLeft, edge };
  };
  // Off the introductions too: going to question 1 from there left the
  // opening on screen, so the plan strip looked dead once the clock ran.
  const goTo = (q: QuestionItem) => {
    setShow("all");
    setMode("one");
    setIntroOpen(false);
    const order = [...all.filter((x) => !x.backup), ...all.filter((x) => x.backup)];
    setAt(Math.max(0, order.findIndex((x) => x.id === q.id)));
  };
  const mmss = (min: number) => {
    const t = Math.max(0, Math.round(min * 60));
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
  };

  const [mode, setMode] = useState<"one" | "all">("one");
  // The controls nobody needs mid-panel, folded under More.
  const [showMore, setShowMore] = useState(false);
  const [at, setAt] = useState(0);
  const [editingText, setEditingText] = useState(false);
  const [editingOpening, setEditingOpening] = useState(false);
  // The box last typed in, for the B and I buttons.
  const lastBox = useRef<HTMLTextAreaElement | null>(null);
  // Left or centred, theirs to choose, kept between visits.
  const [align, setAlign] = useState<"left" | "center">(() => {
    try {
      return localStorage.getItem("mp:ask-align") === "left" ? "left" : "center";
    } catch {
      return "center";
    }
  });
  // Text size and width, for fitting more on a line. Kept between visits.
  const [textSize, setTextSize] = useState<"s" | "m" | "l">(() => {
    try {
      const v = localStorage.getItem("mp:ask-size");
      return v === "s" || v === "l" ? v : "m";
    } catch {
      return "m";
    }
  });
  const [wide, setWide] = useState(() => {
    try {
      return localStorage.getItem("mp:ask-wide") === "1";
    } catch {
      return false;
    }
  });
  const keep = (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      // Only a preference.
    }
  };
  const sizeCls = textSize === "s" ? "text-lg sm:text-xl" : textSize === "l" ? "text-2xl sm:text-3xl" : "text-xl sm:text-2xl";
  const textW = wide ? "max-w-none" : "max-w-2xl";
  const pageW = wide ? "max-w-6xl" : "max-w-3xl";
  const setAlignTo = (a: "left" | "center") => {
    setAlign(a);
    try {
      localStorage.setItem("mp:ask-align", a);
    } catch {
      // Only a preference.
    }
  };
  const here = Math.max(0, Math.min(at, flow.length - 1));
  const cur = flow[here];
  const hasIntro = Boolean(minutesOf && slotMin);
  const onIntro = mode === "one" && introOpen && here === 0 && hasIntro;
  const clock = clockAt(onIntro ? undefined : cur?.id);
  const names = panel.length ? panel.join(", ").replace(/, ([^,]*)$/, " and $1") : "the panel";

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Typing in a box is typing: Enter is a new line, not Asked it.
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT")) return;
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
        if (here === 0 && hasIntro) setIntroOpen(true);
        else setAt((n) => Math.max(0, n - 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, flow.length, here, hasIntro, onClose]);

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col transition-colors duration-700 ${
        clock && !pausedAt && clock.edge === "past" ? "bg-red-100" : "bg-canvas"
      }`}
    >
      {/* Round the edge of the screen, for the part you're on: green with time
          in hand, yellow at 2 minutes left, orange at 1. Past its end the whole
          screen goes red. Seen without looking at the clock. */}
      {clock && !pausedAt && (
        <div
          aria-hidden
          className={`pointer-events-none absolute inset-0 z-[60] transition-colors duration-700 ${
            clock.edge === "past"
              ? "border-[12px] border-red-600"
              : clock.edge === "near"
                ? "border-[8px] border-orange-500"
                : clock.edge === "soon"
                  ? "border-[8px] border-yellow-400"
                  : "border-[6px] border-emerald-500"
          }`}
        />
      )}
      {/* One line: the clock and where you stand. Everything else is
          under More: it was five rows of controls above the question. */}
      <header className="shrink-0 border-b border-border bg-surface">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-2.5 px-4 py-2 text-xs">
          {minutesOf && slotMin ? (
            !clock ? (
              <Button size="sm" variant="secondary" onClick={() => startClock(true)}>
                <Play size={13} /> Start the clock
              </Button>
            ) : (
              <>
                {/* Time in, against the whole slot, amber with 5 minutes to go
                    and red with 2. */}
                <span
                  className={`whitespace-nowrap tabular-nums ${
                    pausedAt ? "text-muted" : clock.remain <= 2 ? "text-red-600" : clock.remain <= 5 ? "text-amber-600" : "text-ink"
                  }`}
                >
                  <span className="font-mono text-base font-semibold">{mmss(clock.gone)}</span>
                  <span className="text-muted"> of {slotMin}:00</span>
                </span>
                {pausedAt ? (
                  <button
                    type="button"
                    onClick={resumeClock}
                    aria-label="Resume the clock"
                    className="inline-flex items-center gap-1 rounded-lg bg-[var(--accent)] px-2 py-1 font-medium text-[var(--accent-fg)]"
                  >
                    <Play size={12} /> Resume
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={pauseClock}
                    aria-label="Pause the clock"
                    className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 font-medium text-ink hover:bg-canvas"
                  >
                    <Pause size={12} /> Pause
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => startClock(false)}
                  aria-label="Reset the clock to zero"
                  title="Back to 0:00, stopped"
                  className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-muted hover:text-ink"
                >
                  <RotateCcw size={12} /> Reset
                </button>
                <span
                  className={`whitespace-nowrap rounded-full px-2 py-0.5 font-semibold tabular-nums ${
                    clock.delta >= 0.5
                      ? "bg-emerald-50 text-emerald-800"
                      : clock.delta < 0
                        ? "bg-red-100 text-red-900"
                        : clock.edge === "near"
                          ? "bg-orange-100 text-orange-900"
                          : clock.edge === "soon"
                            ? "bg-yellow-100 text-yellow-900"
                            : "bg-emerald-50 text-emerald-800"
                  }`}
                  title={`The plan has this part from ${mmss(clock.slot.start)} to ${mmss(clock.slot.end)}.`}
                >
                  {clock.delta >= 0.5
                    ? `${mmss(clock.delta)} ahead`
                    : clock.delta < 0
                      ? `${mmss(-clock.delta)} behind`
                      : (clock.edge === "near" || clock.edge === "soon") && clock.partLeft != null
                        ? `${mmss(clock.partLeft)} left on this`
                        : "On time"}
                </span>
                {clock.reserve && (
                  <button type="button" onClick={() => goTo(clock.reserve!)} className="font-medium text-[var(--accent)] hover:underline">
                    A reserve fits: go to it
                  </button>
                )}
              </>
            )
          ) : (
            <span className="truncate font-semibold text-ink">{topic || title}</span>
          )}
          <button
            type="button"
            onClick={() => setShowMore((v) => !v)}
            aria-expanded={showMore}
            className="ml-auto shrink-0 rounded-lg border border-border px-2 py-1 font-medium text-muted hover:text-ink"
          >
            {showMore ? "Less" : "More"}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close ask mode"
            className="shrink-0 rounded-lg p-1.5 text-muted transition hover:bg-canvas hover:text-ink"
          >
            <X size={18} />
          </button>
        </div>
        {showMore && (
          <div className="mx-auto w-full max-w-3xl space-y-2 border-t border-border px-4 py-2.5 text-xs">
            <p className="text-muted">
              <span className="font-semibold text-ink">{topic || title}</span> · {main.length} questions
              {backups.length ? ` · ${backups.length} in reserve` : ""}
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              <div className="inline-flex rounded-lg border border-border bg-canvas p-0.5">
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
                    className={`rounded-md px-2 py-0.5 font-medium ${mode === k ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"}`}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
              <div className="inline-flex rounded-lg border border-border bg-canvas p-0.5">
                {(["left", "center"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={align === k}
                    onClick={() => setAlignTo(k)}
                    className={`rounded-md px-2 py-0.5 ${align === k ? "bg-surface font-medium text-ink shadow-sm" : "text-muted hover:text-ink"}`}
                  >
                    {k === "left" ? "Left" : "Centre"}
                  </button>
                ))}
              </div>
              <div className="inline-flex items-center rounded-lg border border-border bg-canvas p-0.5" aria-label="Text size">
                {(
                  [
                    ["s", "Smaller text", "text-[11px]"],
                    ["m", "Medium text", "text-[13px]"],
                    ["l", "Larger text", "text-[15px]"],
                  ] as const
                ).map(([k, lbl, cls]) => (
                  <button
                    key={k}
                    type="button"
                    title={lbl}
                    aria-label={lbl}
                    aria-pressed={textSize === k}
                    onClick={() => {
                      setTextSize(k);
                      keep("mp:ask-size", k);
                    }}
                    className={`rounded-md px-2 py-0.5 font-semibold leading-none ${cls} ${textSize === k ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"}`}
                  >
                    A
                  </button>
                ))}
              </div>
              <div className="inline-flex rounded-lg border border-border bg-canvas p-0.5">
                {(
                  [
                    [false, "Normal width"],
                    [true, "Wide"],
                  ] as const
                ).map(([k, lbl]) => (
                  <button
                    key={lbl}
                    type="button"
                    aria-pressed={wide === k}
                    onClick={() => {
                      setWide(k);
                      keep("mp:ask-wide", k ? "1" : "0");
                    }}
                    className={`rounded-md px-2 py-0.5 ${wide === k ? "bg-surface font-medium text-ink shadow-sm" : "text-muted hover:text-ink"}`}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
              {onPatch && mode === "one" && (
                <button
                  type="button"
                  onClick={() => setEditingText((v) => !v)}
                  className="rounded-lg border border-border px-2 py-0.5 text-muted hover:text-ink"
                >
                  {editingText ? "Done editing" : "Edit this question's text"}
                </button>
              )}
            </div>
            {filters.length > 1 && (
              <div className="flex flex-wrap items-center gap-1.5">
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
          </div>
        )}
        {minutesOf && slotMin ? (
          <PlanStrip
            parts={[
              {
                key: "intro",
                label: "Intros",
                start: 0,
                end: leadMin,
                onClick: () => {
                  setShow("all");
                  setMode("one");
                  setAt(0);
                  setIntroOpen(true);
                },
              },
              ...plan.map((p, i) => ({ key: p.q.id, label: `Q${i + 1}`, start: p.start, end: p.end, onClick: () => goTo(p.q) })),
              ...(slack >= 0.5 ? [{ key: "spare", label: "Spare", start: mainEnd, end: mainEnd + slack, quiet: true }] : []),
              { key: "close", label: endMin > 1.5 ? "Q&A, close" : "Close", start: slotMin - endMin, end: slotMin, quiet: true },
            ]}
            current={onIntro ? "intro" : cur && !cur.backup ? cur.id : ""}
            slotMin={slotMin}
            gone={clock?.gone ?? null}
          />
        ) : (
          <div className="h-1 bg-border">
            <div
              className="h-full bg-[var(--accent)] transition-all duration-300"
              style={{ width: `${flow.length && !onIntro ? ((here + 1) / flow.length) * 100 : 0}%` }}
            />
          </div>
        )}
      </header>
      {clock && clock.remain <= endMin && (
        <div
          role="status"
          className={`shrink-0 px-4 py-2 text-center text-sm font-semibold ${
            clock.remain <= 0 ? "bg-red-600 text-white" : "bg-red-50 text-red-900"
          }`}
        >
          {clock.remain <= 0
            ? `Time's up: thank ${names} and close.`
            : clock.remain > 1.05
              ? `${Math.ceil(clock.remain)} min left: time for audience questions, then the close at 1 min.`
              : `About a minute left: thank ${names} and close.`}
        </div>
      )}

      <main className="min-h-0 flex-1 overflow-y-auto">
        {!cur ? (
          <p className="mx-auto max-w-3xl px-5 py-16 text-center text-sm text-muted">
            Nothing picked yet.
          </p>
        ) : onIntro ? (
          // Introductions are a step of their own, before question 1, so the
          // clock knows when the questions really started.
          <div className={`mx-auto flex min-h-full w-full ${pageW} flex-col justify-center px-5 py-8 text-center`}>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--accent)]">Before the questions</p>
            <h2 className="mt-2 text-2xl font-medium text-ink">Opening and introductions</h2>
            {/* Their own words to open with, laid out and edited the way the
                questions are. */}
            {(opening.trim() || editingOpening) && (
              <div className={`mt-6 ${align === "center" ? "" : "text-left"}`}>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Say first</p>
                <div className={`mt-1.5 ${textW} ${sizeCls} leading-relaxed text-ink ${align === "center" ? "mx-auto" : ""}`}>
                  {editingOpening && onOpening ? (
                    <textarea
                      aria-label="Your opening"
                      autoFocus
                      value={opening}
                      placeholder="What you'll say to open, before the panel introduce themselves"
                      onChange={(e) => onOpening(e.target.value)}
                      onKeyDown={markKeys((el, m) => toggleMark(el, m, onOpening))}
                      onFocus={(e) => (lastBox.current = e.currentTarget)}
                      style={{ fieldSizing: "content" } as CSSProperties}
                      className={`block min-h-[4lh] w-full ${textW} resize-none rounded-sm bg-transparent p-0 text-ink outline-2 outline-offset-4 outline-dashed outline-[var(--accent)]/50 focus:outline-[var(--accent)] ${
                        align === "center" ? "mx-auto text-center" : ""
                      }`}
                    />
                  ) : (
                    paragraphs(opening, false).map((para, i) => (
                      <p key={i}>
                        {i > 0 && (
                          <span className="block" aria-hidden>
                            &nbsp;
                          </span>
                        )}
                        {para.map((line, j) => (
                          <span key={j} className="block">
                            <Spoken text={line} />
                          </span>
                        ))}
                      </p>
                    ))
                  )}
                </div>
                {editingOpening && onOpening && (
                  <>
                    <MarkButtons onMark={(m) => toggleMark(lastBox.current, m, onOpening)} />
                    <p className="mt-2 text-center text-xs text-muted">
                      Enter for a new line, a blank line for a gap.{" "}
                      <button type="button" onClick={() => setEditingOpening(false)} className="font-medium text-[var(--accent)] hover:underline">
                        Done
                      </button>
                    </p>
                  </>
                )}
              </div>
            )}
            <p className="mt-6 text-base text-ink/75">
              {opening.trim() ? "Then introduce" : "Welcome the room and introduce"}{" "}
              {names}. Plan: 0:00 to {mmss(leadMin)}.
              {onOpening && !editingOpening && (
                <>
                  {" "}
                  <button type="button" onClick={() => setEditingOpening(true)} className="font-medium text-[var(--accent)] hover:underline">
                    {opening.trim() ? "Edit the opening" : "Write your opening"}
                  </button>
                </>
              )}
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              {!startedAt && (
                <Button variant="secondary" onClick={() => startClock(true)}>
                  <Timer size={15} /> Start the clock
                </Button>
              )}
              <Button onClick={introsDone}>Intros done: first question</Button>
            </div>
            <p className="mt-3 text-xs text-muted">
              Start the clock as you open. From here, each question tells you if you need to ask for shorter answers.
            </p>
          </div>
        ) : mode === "one" ? (
          <div className={`mx-auto flex min-h-full w-full ${pageW} flex-col justify-center px-5 py-8`}>
            <p className={`text-xs text-muted ${align === "center" ? "text-center" : ""}`}>
              {cur.backup ? "In reserve" : `${here + 1} of ${main.length}`}
              {cur.askWho ? ` · ${asks(cur).join(", ")}` : cur.forWhom ? ` · ${cur.forWhom}` : ""}
              {onPatch && !editingText && (
                <>
                  {" · "}
                  <button type="button" onClick={() => setEditingText(true)} className="font-medium text-[var(--accent)] hover:underline">
                    Edit the text
                  </button>
                </>
              )}
            </p>
            {minutesOf && slotMin && (
              <p className={`mt-1 text-xs tabular-nums text-muted ${align === "center" ? "text-center" : ""}`}>
                {cur.backup
                  ? "Not in the plan: only if you're ahead"
                  : `Plan: ${mmss(slotFor(cur.id).start)} to ${mmss(slotFor(cur.id).end)}`}
              </p>
            )}

            {/* The time check, on the question it is about, with the words. */}
            {(() => {
              if (!clock || cur.backup || !minutesOf || clock.remain <= endMin) return null;
              const who = asks(cur);
              const name = who[0] || panel.find((n) => new RegExp(`\\b${n}\\b`, "i").test(cur.forWhom || "")) || "";
              const quick = quickOf?.(cur);
              if (clock.spare <= -1) {
                return (
                  <div className="mx-auto mt-4 w-full max-w-2xl rounded-xl bg-amber-50 px-4 py-3 text-center text-amber-950">
                    {quick != null ? (
                      <>
                        <p className="text-sm font-semibold">
                          {mmss(-clock.delta)} behind, with no spare left. Ask for a minute each, which saves about {Math.round(minutesOf(cur) - quick)} min:
                        </p>
                        <p className="mt-1 text-lg">&ldquo;A quick take from each of you, about a minute each, starting with {name || panel[0]}.&rdquo;</p>
                      </>
                    ) : (
                      <>
                        <p className="text-sm font-semibold">{mmss(-clock.delta)} behind, with no spare left. Keep this one short:</p>
                        <p className="mt-1 text-lg">&ldquo;{name ? `${name}, in` : "In"} a sentence or two:&rdquo;</p>
                      </>
                    )}
                  </div>
                );
              }
              if (clock.spare >= 3 && cur.followUp && clock.edge === "ok")
                return (
                  <p className="mx-auto mt-4 w-full max-w-2xl rounded-xl bg-emerald-50 px-4 py-2 text-center text-sm text-emerald-900">
                    {Math.round(clock.spare)} min in hand: use the probe on this one.
                  </p>
                );
              return null;
            })()}

            {/* Laid out the way they say it, and edited in the same place at
                the same size, so what they type is what they will see. Their
                own breaks win; without any, the setup goes a sentence a
                paragraph. Paragraphs are one blank line apart in both. */}
            {(() => {
              const setupShown = stripAskedQuestion(cur.setup, cur.text);
              // Their exact text once it has a break of its own, so an Enter at the end
              // of a line is not tidied away before the next word is typed.
              const setupEdit = /\n/.test(cur.setup || "") ? cur.setup || "" : sentences(setupShown).join("\n\n");
              const box = `block w-full ${textW} resize-none bg-transparent p-0 outline-2 outline-offset-4 outline-dashed outline-[var(--accent)]/50 rounded-sm focus:outline-[var(--accent)] ${
                align === "center" ? "mx-auto text-center" : ""
              }`;
              const grow = { fieldSizing: "content" } as CSSProperties;
              const editing = editingText && onPatch;
              // Bold or italic on the selected words: the marks go round
              // them, or come off if they are already there.
              const mark = (el: HTMLTextAreaElement | null, m: string) => {
                if (!onPatch) return;
                toggleMark(el, m, (next) =>
                  onPatch(cur, el?.getAttribute("aria-label") === "Say first" ? { setup: next } : { text: next }),
                );
              };
              const keys = markKeys(mark);
              return (
                <div className={align === "center" ? "text-center" : ""}>
                  {(setupShown || editing) && (
                    <div className="mt-4">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Say first</p>
                      <div className={`mt-1.5 ${textW} ${sizeCls} leading-relaxed text-ink/75 ${align === "center" ? "mx-auto" : ""}`}>
                        {editing ? (
                          <textarea
                            aria-label="Say first"
                            value={setupEdit}
                            placeholder="Setup, said first (optional)"
                            onChange={(e) => onPatch!(cur, { setup: e.target.value })}
                            onKeyDown={keys}
                            onFocus={(e) => (lastBox.current = e.currentTarget)}
                            style={grow}
                            className={`${box} min-h-[3lh] text-ink/75`}
                          />
                        ) : (
                          paragraphs(setupShown).map((para, i) => (
                            <p key={i}>
                              {i > 0 && (
                                <span className="block" aria-hidden>
                                  &nbsp;
                                </span>
                              )}
                              {para.map((line, j) => (
                                <span key={j} className="block">
                                  <Spoken text={line} />
                                </span>
                              ))}
                            </p>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                  <div className="mt-6">
                    {(setupShown || editing) && (
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--accent)]">Then ask</p>
                    )}
                    <div className={`mt-1.5 ${textW} ${sizeCls} leading-relaxed text-ink ${align === "center" ? "mx-auto" : ""}`}>
                      {editing ? (
                        <textarea
                          aria-label="Then ask"
                          value={cur.text}
                          onChange={(e) => onPatch!(cur, { text: e.target.value })}
                          onKeyDown={keys}
                          onFocus={(e) => (lastBox.current = e.currentTarget)}
                          style={grow}
                          className={`${box} min-h-[2lh] text-ink`}
                        />
                      ) : (
                        paragraphs(cur.text, false).map((para, i) => (
                          <p key={i}>
                            {i > 0 && (
                              <span className="block" aria-hidden>
                                &nbsp;
                              </span>
                            )}
                            {para.map((line, j) => (
                              <span key={j} className="block">
                                <Spoken text={line} names={i === 0 && j === 0 ? panel : []} />
                              </span>
                            ))}
                          </p>
                        ))
                      )}
                    </div>
                  </div>
                  {editing && <MarkButtons onMark={(m) => mark(lastBox.current, m)} />}
                  {editing && (
                    <p className="mt-2 text-xs text-muted">
                      Type straight into it. Enter for a new line, a blank line for a gap. Bold, italics and numbers show when you&apos;re done.{" "}
                      <button type="button" onClick={() => setEditingText(false)} className="font-medium text-[var(--accent)] hover:underline">
                        Done
                      </button>
                    </p>
                  )}
                </div>
              );
            })()}

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
            {/* For them, not for the room: who to bring in, how to move on,
                what to watch, and their own note. */}
            {onWriteTips && !cur.tips?.watch && (
              <button
                type="button"
                disabled={tipping}
                onClick={onWriteTips}
                className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-1.5 text-xs font-medium text-muted hover:text-ink disabled:opacity-70"
              >
                {tipping ? "Writing what to watch for on every question, about 20 seconds\u2026" : "Write what to watch for on every question"}
              </button>
            )}
            {(cur.tips?.watch || cur.note) && (
              <div className="mt-4 rounded-xl border border-dashed border-border bg-canvas/60 p-4 text-sm">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">For you, not to say</p>
                <dl className="mt-1.5 space-y-1.5">
                  {cur.tips?.watch && (
                    <div>
                      <dt className="inline font-semibold text-ink">Watch for: </dt>
                      <dd className="inline text-ink/80">{cur.tips.watch}</dd>
                    </div>
                  )}
                  {cur.note && (
                    <div>
                      <dt className="inline font-semibold text-ink">Your note: </dt>
                      <dd className="inline text-ink/80">{cur.note}</dd>
                    </div>
                  )}
                </dl>
              </div>
            )}

            {/* A backup if this one falls flat: there, but folded. */}
            {(cur.options || []).some((o) => o.keep && o.text.trim()) && (
              <details className="mt-4 text-sm">
                <summary className="cursor-pointer text-xs font-medium text-muted hover:text-ink">Or ask, if this one falls flat</summary>
                {(cur.options || [])
                  .filter((o) => o.keep && o.text.trim())
                  .map((o, i) => (
                    <div key={i} className="mt-2 rounded-lg border border-border bg-surface p-3">
                      {o.setup && <p className="text-sm leading-relaxed text-muted">{o.setup}</p>}
                      <p className="text-base leading-snug text-ink/80">{o.text}</p>
                      {onUseKept && (
                        <button
                          type="button"
                          onClick={() => onUseKept(cur, o)}
                          className="mt-1 text-xs font-medium text-[var(--accent)] hover:underline"
                        >
                          Use this one instead
                        </button>
                      )}
                    </div>
                  ))}
              </details>
            )}

            {cur.sourceNote && (
              <p className="mt-3 text-sm text-muted">Source: {cur.sourceNote}</p>
            )}

            <div className="mt-7 flex items-center gap-2">
              {/* Back from question 1 is the introductions. It used to be
                  greyed out there, with nowhere to go. */}
              <Button
                variant="secondary"
                disabled={here === 0 && !hasIntro}
                onClick={() => (here === 0 ? setIntroOpen(true) : setAt(here - 1))}
              >
                <ArrowLeft size={16} /> Back
              </Button>
              <span className="flex-1" />
              <Button disabled={here === flow.length - 1} onClick={() => setAt(here + 1)}>
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
                    i === here ? "bg-[var(--accent)]" : i < here ? "bg-[var(--accent)]/40" : "bg-border hover:bg-muted/50"
                  }`}
                />
              ))}
            </div>

            <p className="mt-4 hidden text-[11px] text-muted sm:block">
              Arrow keys or space to move, Esc to close.
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

// One question in the list view; tapping it opens it big.
function AskRow({
  q,
  n,
  onOpen,
}: {
  q: QuestionItem;
  n?: number;
  onOpen: () => void;
}) {
  return (
    <li className="flex items-start gap-3 rounded-xl border border-border bg-surface p-3 transition">
      <button
        type="button"
        onClick={onOpen}
        aria-label="Open this question"
        className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[var(--accent-soft)] text-xs font-semibold text-[var(--accent)] transition hover:brightness-95"
      >
        {n ?? <Star size={13} className="fill-current" />}
      </button>
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        {stripAskedQuestion(q.setup, q.text) && (
          <span className="mb-0.5 block text-sm leading-snug text-muted">{stripAskedQuestion(q.setup, q.text)}</span>
        )}
        <span className="block text-base leading-snug text-ink sm:text-lg">
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

/**
 * Paragraphs of lines, the way they will say it. Their own breaks first: a
 * line break is a new line and a blank line a new paragraph. With none, a
 * setup goes a sentence a paragraph and a question stays whole.
 */
// Bold or italic on the selected words: the marks go round them, or come off
// if they are already there.
function toggleMark(el: HTMLTextAreaElement | null, m: string, apply: (next: string) => void) {
  if (!el) return;
  const { selectionStart: a, selectionEnd: b, value } = el;
  if (a === b) return;
  const on = value.slice(a - m.length, a) === m && value.slice(b, b + m.length) === m;
  apply(
    on
      ? value.slice(0, a - m.length) + value.slice(a, b) + value.slice(b + m.length)
      : value.slice(0, a) + m + value.slice(a, b) + m + value.slice(b),
  );
  const from = on ? a - m.length : a + m.length;
  const to = on ? b - m.length : b + m.length;
  requestAnimationFrame(() => {
    el.focus();
    el.setSelectionRange(from, to);
  });
}

// The plan across the top: a block for each part, as wide as its time, and a
// line for now. The line past the end of the block you're on is behind; short
// of its start is ahead.
function PlanStrip({
  parts,
  current,
  slotMin,
  gone,
}: {
  parts: { key: string; label: string; start: number; end: number; quiet?: boolean; onClick?: () => void }[];
  current: string;
  slotMin: number;
  gone: number | null;
}) {
  const pct = (m: number) => `${Math.max(0, Math.min(100, (m / slotMin) * 100))}%`;
  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-2">
      <div className="relative h-6">
        {parts.map((p) => {
          const on = p.key === current;
          const done = gone != null && gone >= p.end;
          return (
            <button
              key={p.key}
              type="button"
              disabled={!p.onClick}
              onClick={p.onClick}
              title={`${p.label}: ${fmt(p.start)} to ${fmt(p.end)}`}
              style={{ left: pct(p.start), width: `calc(${pct(p.end - p.start)} - 2px)` }}
              className={`absolute top-0 flex h-full items-center justify-center overflow-hidden rounded text-[10px] font-semibold ${
                on
                  ? "bg-[var(--accent)] text-[var(--accent-fg)]"
                  : p.quiet
                    ? "border border-dashed border-border text-muted"
                    : done
                      ? "bg-[var(--accent)]/25 text-ink/70"
                      : "bg-border/70 text-ink/70 hover:bg-border"
              }`}
            >
              <span className="truncate px-0.5">{p.label}</span>
            </button>
          );
        })}
        {gone != null && (
          <div
            aria-hidden
            className="pointer-events-none absolute -bottom-1 -top-1 w-0.5 rounded-full bg-ink"
            style={{ left: pct(gone) }}
          />
        )}
      </div>
    </div>
  );
}

function fmt(min: number) {
  const t = Math.max(0, Math.round(min * 60));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

// Ctrl+B and Ctrl+I in a box.
function markKeys(mark: (el: HTMLTextAreaElement, m: string) => void) {
  return (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if (k === "b" || k === "i") {
      e.preventDefault();
      mark(e.currentTarget, k === "b" ? "**" : "*");
    }
  };
}

// The B and I buttons under a box being edited.
function MarkButtons({ onMark }: { onMark: (m: string) => void }) {
  return (
    <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
      {(
        [
          ["**", "B", "font-bold", "Bold (Ctrl+B)"],
          ["*", "I", "italic", "Italic (Ctrl+I)"],
        ] as const
      ).map(([m, label, cls, title]) => (
        <button
          key={m}
          type="button"
          title={title}
          aria-label={title}
          // Keep the words selected: a click would take the focus first.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onMark(m)}
          className={`h-7 w-7 rounded-md border border-border bg-surface text-sm text-ink hover:bg-canvas ${cls}`}
        >
          {label}
        </button>
      ))}
      <span className="text-xs text-muted">Select words, then B or I.</span>
    </div>
  );
}

function paragraphs(t: string, bySentence = true): string[][] {
  const text = t.trim();
  if (/\n/.test(text))
    return text
      .split(/\n\s*\n/)
      .map((p) => p.split("\n").map((l) => l.trim()).filter(Boolean))
      .filter((p) => p.length);
  return bySentence ? sentences(text).map((x) => [x]) : [[text]];
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
 * Words to be said, laid out to be said: a phrase a line, broken where you
 * would pause (after a comma, a colon or a semicolon), numbers in bold and
 * never split from their unit, and a panelist's name at the start in colour,
 * the cue to turn to them. One block of text was hard to keep your place in,
 * and "27" ended one line with "percent" starting the next.
 */
function Spoken({ text, names = [], lines = false }: { text: string; names?: string[]; lines?: boolean }) {
  const lead = names.find((n) => n && new RegExp(`^${n.replace(/[^A-Za-z]/g, "")}\\b`, "i").test(text));
  // Numbers bold, kept with their unit.
  const numbers = (t: string, k: string) =>
    t.split(/(\b\d[\d,.]*(?:\s?(?:percent|%|x|times|billion|million))?)/i).map((p, i) =>
      i % 2 ? (
        <strong key={`${k}n${i}`} className="whitespace-nowrap font-semibold text-ink">
          {p}
        </strong>
      ) : (
        <span key={`${k}n${i}`}>{p}</span>
      ),
    );
  // Their own marks: **bold** and *italic*.
  const styled = (t: string, k: string) =>
    t.split(/(\*\*.+?\*\*|\*.+?\*)/).map((p, i) =>
      /^\*\*.+\*\*$/.test(p) ? (
        <strong key={`${k}s${i}`} className="font-semibold text-ink">
          {p.slice(2, -2)}
        </strong>
      ) : /^\*.+\*$/.test(p) ? (
        <em key={`${k}s${i}`}>{p.slice(1, -1)}</em>
      ) : (
        <span key={`${k}s${i}`}>{numbers(p, `${k}s${i}`)}</span>
      ),
    );
  const marked = (chunk: string, key: string, offset: number) => {
    const nameEnd = lead && offset === 0 ? lead.length : 0;
    return (
      <span key={key}>
        {nameEnd > 0 && <span className="text-[var(--accent)]">{chunk.slice(0, nameEnd)}</span>}
        {styled(chunk.slice(nameEnd), key)}
      </span>
    );
  };
  if (!lines) return marked(text, "0", 0);
  // Phrases, with any of under three words joined to the one before, so a
  // line is never a lone "So," or "then".
  const raw = text.split(/(?<=[,;:])\s+/);
  const phrases: string[] = [];
  for (const r of raw) {
    if (phrases.length && r.split(/\s+/).length < 3) phrases[phrases.length - 1] += ` ${r}`;
    else if (phrases.length && phrases[phrases.length - 1].split(/\s+/).length < 3) phrases[phrases.length - 1] += ` ${r}`;
    else phrases.push(r);
  }
  let offset = 0;
  return (
    <>
      {phrases.map((p, i) => {
        const el = (
          <span key={i} className="block">
            {marked(p, String(i), offset)}
          </span>
        );
        offset += p.length + 1;
        return el;
      })}
    </>
  );
}

/** The time, for the clock's buttons; only ever called from a click. */
function clockNow(): number {
  return Date.now();
}
