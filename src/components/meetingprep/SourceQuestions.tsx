"use client";

// "Questions from this": a few questions built on one source, with the setup
// that lays out what it found, each one offered to the bank or straight into
// the writer's list. Nothing lands anywhere until they say so.
//
// The drafts are kept on the source, so coming back to the Reading tab shows
// them as they were left rather than asking for a fresh batch. And each one
// is checked against the questions already in the bank when it is written:
// one that asks the same thing as a question they have says so, and they
// choose between the two rather than finding the pair later in their list.
//
// Every request back to the writer model says what the writer wants, because
// rewriting blind gives them another batch with the same problem and no way
// to name it: a new batch, more like one they liked, another version of one,
// or one fixed for what they did not like.

import { useState } from "react";
import { ArrowLeftRight, Check, Copy, MessageCircleQuestion, Plus, RefreshCw, ThumbsDown } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Working } from "@/components/ui/Progress";
import { useToast } from "@/components/ui/Feedback";
import { withReading } from "@/lib/meetingprep/reading";
import { meetingPayload, newId, type GetMeeting, type SaveMeeting } from "@/lib/meetingprep/material";
import type { MpMeeting, QuestionItem, ReadingSource, SourceDraft } from "@/lib/meetingprep/types";

async function post<T>(body: unknown): Promise<T> {
  const res = await fetch("/api/meeting/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Something went wrong");
  return json as T;
}

const liveQuestions = (m: MpMeeting) => (m.questions?.items || []).filter((q) => !q.deleted);

/** What the writer asked for. "batch" is a whole new set; the rest are about one draft. */
type Ask = { kind: "batch" } | { kind: "more" | "version" | "fix"; draft: SourceDraft };

// Measured on the writer's panel: a batch with both checks ran about 45s.
const SECONDS = { batch: 45, more: 40, version: 35, fix: 35 } as const;

const PICKS = {
  batch: ["Harder", "Shorter setups", "More on the data", "From a different angle", "Less like mine"],
  more: ["Same angle", "Harder", "For a specific panelist", "Shorter"],
  version: ["Blunter", "Shorter", "More personal", "Shorter setup"],
  fix: ["Too long", "Too vague", "Too leading", "Setup doesn't fit", "Already asked this"],
};

const PROMPTS = {
  batch: "What should be different? (optional)",
  more: "What do you like about it? (optional)",
  version: "What should change? (optional)",
  fix: "What's wrong with it?",
};

export function SourceQuestions({
  s,
  getMeeting,
  save,
}: {
  s: ReadingSource;
  getMeeting: GetMeeting;
  save: SaveMeeting;
}) {
  const toast = useToast();
  /** "batch" or the id of the draft being worked on. */
  const [busy, setBusy] = useState<string>("");
  const [open, setOpen] = useState(true);
  /** The feedback box that is open, if any. */
  const [asking, setAsking] = useState<Ask | null>(null);
  const [note, setNote] = useState("");
  const drafts = s.questions || [];

  /** The drafts as they are now, read fresh: another save may have landed. */
  const current = () => getMeeting()?.reading?.sources?.find((x) => x.id === s.id)?.questions || drafts;

  function setDrafts(next: SourceDraft[]) {
    const m = getMeeting();
    if (!m) return;
    const r = m.reading || {};
    save({
      reading: {
        ...r,
        sources: (r.sources || []).map((x) => (x.id === s.id ? { ...x, questions: next } : x)),
      },
    });
  }

  function focusFor(ask: Ask, note: string, seen: SourceDraft[]): { focus: string; count: number } {
    const base =
      "Every question here is built on the one source marked THE SOURCE THIS BATCH IS BUILT ON: what it found, what it argues, and what it leaves open. Each one gets a setup that lays out the relevant finding or argument from it in plain words, without naming it, then asks what that means for the people answering.";
    const said = note ? `\nThe writer says, and this outranks everything above: ${note}` : "";
    if (ask.kind === "batch")
      return {
        count: 4,
        focus: `${base} Three to five questions, no more; quality over count.${
          seen.length
            ? ` The writer has already seen these and wants different ones, so do not repeat them: ${seen.map((d) => d.text).join(" | ")}`
            : ""
        }${said}`,
      };
    const q = `${ask.draft.setup ? `Setup: ${ask.draft.setup}\n` : ""}Question: ${ask.draft.text}`;
    if (ask.kind === "more")
      return {
        // Five asked, three kept: a single source has only so many distinct
        // points, and the ones that repeat a draft already here are dropped.
        count: 5,
        focus: `${base} The writer liked this one and wants five more of the same kind: the same angle, register and kind of setup, each asking something genuinely different, never a rewording of it or of each other.\n${q}${said}`,
      };
    if (ask.kind === "version")
      return {
        count: 3,
        focus: `${base} Rewrite this ONE question exactly two ways. Same job in the conversation, same thing being asked, but far enough apart that choosing between them is a real choice. Return exactly two.\n${q}${said}`,
      };
    return {
      count: 3,
      focus: `${base} The writer did not like this question. Write three replacements. All three ask about the SAME thing the original asks about, the same subject and the same point; only how it is asked changes, fixed for what the writer says is wrong with it. A replacement about a different point is not a fix.\n${q}${said}`,
    };
  }

  async function generate(ask: Ask, note = "") {
    const m = getMeeting();
    if (!m || busy) return;
    setBusy(ask.kind === "batch" ? "batch" : ask.draft.id);
    setOpen(true);
    try {
      const live = liveQuestions(m);
      const seen = current();
      const piece = [
        `${s.title}${s.outlet ? ` (${s.outlet}${s.date ? `, ${s.date}` : ""})` : ""}`,
        s.summary,
        ...s.findings.map((f) => `- ${f}`),
      ]
        .filter(Boolean)
        .join("\n");
      const { focus, count } = focusFor(ask, note, seen);
      const json = await post<{ questions: Partial<SourceDraft>[] }>({
        action: "questions",
        meeting: meetingPayload(m),
        kolId: m.kol_id || "",
        research: withReading(`THE SOURCE THIS BATCH IS BUILT ON:\n${piece}`, m),
        // The bank and every draft on this source, the one being worked from
        // included: without them "another version" handed the original back
        // word for word and "more like this" rewrote drafts already here.
        existing: [...live.map((q) => q.text), ...seen.map((d) => d.text)],
        categories: [...new Set(live.map((q) => q.category))],
        count,
        focus,
        guidance: m.questions?.guidance || "",
      });
      const cap = ask.kind === "batch" ? 5 : ask.kind === "more" ? 3 : 2;
      let got: SourceDraft[] = (json.questions || []).map((q) => ({
        id: newId("sd"),
        setup: String(q.setup || ""),
        text: String(q.text || ""),
        why: String(q.why || ""),
        followUp: String(q.followUp || ""),
        forWhom: String(q.forWhom || ""),
        category: String(q.category || "Questions"),
      }));
      if (!got.length) throw new Error("Nothing came back. Try again.");

      // A fix that wandered onto a different point is not a fix. Keep the
      // replacements judged to ask what the original asked; if none are,
      // keep what came back rather than nothing.
      if (ask.kind === "fix" && got.length > 1) {
        try {
          const { matches } = await post<{ matches: number[] }>({
            action: "similar",
            drafts: got.map((d) => d.text),
            existing: [ask.draft.text],
          });
          const onPoint = got.filter((_, i) => matches?.[i] === 0);
          if (onPoint.length) got = onPoint;
        } catch {
          // Keep them all.
        }
      }

      // Two new drafts that ask the same thing as each other: keep the first.
      // Not for versions, which are meant to be the same question.
      if (got.length > 1 && (ask.kind === "batch" || ask.kind === "more")) {
        try {
          const { matches } = await post<{ matches: number[] }>({
            action: "similar",
            drafts: got.map((d) => d.text),
            existing: got.map((d) => d.text),
            within: true,
          });
          const dupes = new Set(
            (matches || []).map((k, i) => (typeof k === "number" && k >= 0 && k < i ? i : -1)).filter((i) => i > 0),
          );
          for (const i of [...dupes].sort((a, b) => b - a)) got.splice(i, 1);
        } catch {
          // Keep them all rather than lose the batch.
        }
      }

      // One that asks what a draft already on this source asks adds nothing.
      // Not for versions, which are meant to ask the same thing.
      const others = seen.filter((d) => ask.kind === "batch" ? d.done : true).map((d) => d.text);
      if (got.length && others.length && ask.kind !== "version") {
        try {
          const { matches } = await post<{ matches: number[] }>({
            action: "similar",
            drafts: got.map((d) => d.text),
            existing: others,
          });
          // A fix is checked against everything but the one it replaces.
          const fixing = ask.kind === "fix" ? ask.draft.text : "";
          for (let i = got.length - 1; i >= 0; i--) {
            const k = matches?.[i];
            if (typeof k === "number" && k >= 0 && others[k] !== fixing) got.splice(i, 1);
          }
        } catch {
          // Keep them rather than lose the batch.
        }
        if (!got.length) throw new Error("Everything it wrote repeated a question already here. Try saying what you want differently.");
      }

      got = got.slice(0, cap);

      // Which question already in the bank each one repeats, so it can say so.
      if (live.length) {
        try {
          const { matches } = await post<{ matches: number[] }>({
            action: "similar",
            drafts: got.map((d) => d.text),
            existing: live.map((q) => q.text),
          });
          got.forEach((d, i) => {
            const k = matches?.[i];
            if (typeof k === "number" && k >= 0 && live[k]) d.similarTo = live[k].id;
          });
        } catch {
          // Without the check the drafts are still worth having.
        }
      }

      const now = current();
      if (ask.kind === "batch") {
        // The ones already acted on stay; the untouched ones are replaced.
        setDrafts([...now.filter((d) => d.done), ...got]);
      } else {
        // Next to the one they came from. A fix takes its place.
        const at = now.findIndex((d) => d.id === ask.draft.id);
        const keep = ask.kind === "fix" ? 0 : 1;
        const next = [...now];
        next.splice(at < 0 ? next.length : at + (keep ? 1 : 0), at < 0 ? 0 : 1 - keep, ...got);
        setDrafts(next);
      }
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setBusy("");
    }
  }

  function toItem(d: SourceDraft, items: QuestionItem[], place?: QuestionItem): QuestionItem {
    return {
      id: newId("q"),
      setup: d.setup,
      text: d.text,
      why: d.why,
      followUp: d.followUp,
      forWhom: d.forWhom,
      category: place ? place.category : d.category,
      // Backed by the piece it came from, so the source line under it links
      // straight back here.
      sourceNote: `${[s.outlet, s.date].filter(Boolean).join(", ")}${s.outlet || s.date ? ": " : ""}${s.title}`,
      rank: place ? place.rank : items.reduce((n, q) => Math.max(n, q.rank), 0) + 1,
      picked: place ? place.picked : false,
      backup: place ? place.backup : false,
      asked: false,
      order: place ? place.order : 0,
      source: "ai",
    };
  }

  function mark(id: string, done: SourceDraft["done"]) {
    setDrafts(current().map((x) => (x.id === id ? { ...x, done } : x)));
  }

  function add(d: SourceDraft, where: "bank" | "list") {
    const m = getMeeting();
    if (!m) return;
    const items = m.questions?.items || [];
    const item = toItem(d, items);
    if (where === "list") {
      item.picked = true;
      item.order = items.filter((q) => q.picked).reduce((n, q) => Math.max(n, q.order + 1), 0);
    }
    save({ questions: { ...(m.questions || {}), items: [...items, item] } });
    mark(d.id, where);
  }

  /** The new one takes the old one's place: its slot in the list, its order. */
  function replace(d: SourceDraft, old: QuestionItem) {
    const m = getMeeting();
    if (!m) return;
    const items = m.questions?.items || [];
    const item = toItem(d, items, old);
    // Binned, not gone: the bin on the Questions tab can bring it back.
    const next = items.flatMap((q) => (q.id === old.id ? [{ ...q, deleted: true, picked: false }, item] : [q]));
    save({ questions: { ...(m.questions || {}), items: next } });
    mark(d.id, "replaced");
    toast("success", "Swapped in. The old one is in the bin on the Questions tab.");
  }

  function openAsk(ask: Ask) {
    setAsking(ask);
    setNote("");
  }

  // The feedback box for whichever request is open. A function that returns
  // markup, not a component: one declared in here would be a new component
  // every render, and the box would lose its caret on every keystroke.
  function askBox(ask: Ask) {
    const required = ask.kind === "fix";
    return (
      <form
        className="mt-2 space-y-2 rounded-md border border-border bg-surface p-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (required && !note.trim()) return;
          setAsking(null);
          void generate(ask, note.trim());
        }}
      >
        <p className="text-xs font-medium">{PROMPTS[ask.kind]}</p>
        <div className="flex flex-wrap gap-1.5">
          {PICKS[ask.kind].map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setNote((f) => (f.includes(p) ? f : f ? `${f}; ${p}` : p))}
              className="rounded-full border border-border px-2.5 py-0.5 text-xs text-muted hover:text-ink"
            >
              {p}
            </button>
          ))}
        </div>
        <Input
          autoFocus
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={required ? "Say what you didn't like" : "Or say it in your own words"}
        />
        <div className="flex justify-end gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={() => setAsking(null)}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={Boolean(busy) || (required && !note.trim())}>
            {ask.kind === "batch"
              ? "Write them"
              : ask.kind === "more"
                ? "Write more"
                : ask.kind === "version"
                  ? "Write 2 versions"
                  : "Fix it"}
          </Button>
        </div>
      </form>
    );
  }

  if (!drafts.length || !open)
    return (
      <div className="mt-2">
        {busy === "batch" ? (
          <Working active seconds={SECONDS.batch} label="Writing questions from this source" />
        ) : (
          <button
            type="button"
            onClick={() => (drafts.length ? setOpen(true) : void generate({ kind: "batch" }))}
            className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs font-medium text-[var(--accent)] hover:bg-[var(--accent-soft)]"
          >
            <MessageCircleQuestion size={13} />
            {drafts.length ? `Questions from this (${drafts.length})` : "Questions from this"}
          </button>
        )}
      </div>
    );

  const m = getMeeting();
  const byId = new Map(m ? liveQuestions(m).map((q) => [q.id, q]) : []);
  const askingDraft = asking && asking.kind !== "batch" ? asking.draft.id : "";

  return (
    <div className="mt-3 space-y-2 rounded-lg bg-canvas p-3">
      <p className="text-xs font-semibold">Questions from this</p>
      <ul className="space-y-4">
        {drafts.map((d) => {
          const like = d.similarTo ? byId.get(d.similarTo) : undefined;
          return (
            <li key={d.id} className={`text-sm ${d.done === "kept" ? "opacity-50" : ""}`}>
              {d.setup && <p className="mb-1 leading-relaxed text-ink/70">{d.setup}</p>}
              <p className="font-medium">{d.text}</p>
              {d.followUp && <p className="mt-0.5 text-xs italic text-muted">Probe: {d.followUp}</p>}

              {/* Asks what one of theirs already asks. Shown before any
                  button, so the choice is made with both in view. */}
              {like && !d.done && (
                <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-2 text-xs text-amber-900">
                  <p className="font-semibold">
                    You have one like this{like.picked ? " in your list" : " in the bank"}:
                  </p>
                  {like.setup && <p className="mt-0.5 text-amber-900/80">{like.setup}</p>}
                  <p className="mt-0.5">{like.text}</p>
                </div>
              )}

              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {d.done ? (
                  <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
                    <Check size={12} />
                    {d.done === "list"
                      ? "In your list"
                      : d.done === "bank"
                        ? "In the bank"
                        : d.done === "replaced"
                          ? "Used instead of yours"
                          : "Kept yours"}
                  </span>
                ) : like ? (
                  <>
                    <Button size="sm" onClick={() => replace(d, like)}>
                      <ArrowLeftRight size={12} /> Use this one instead
                    </Button>
                    {/* Keeping both used to put the new one wherever yours
                        lived, with no say in it. Where it goes is the choice. */}
                    <Button size="sm" variant="secondary" onClick={() => add(d, "list")}>
                      <Plus size={12} /> Add to my list too
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => add(d, "bank")}>
                      Add to bank
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => mark(d.id, "kept")}>
                      Keep mine
                    </Button>
                  </>
                ) : (
                  <>
                    <Button size="sm" onClick={() => add(d, "list")}>
                      <Plus size={12} /> Add to my list
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => add(d, "bank")}>
                      Add to bank
                    </Button>
                  </>
                )}
                {/* Working from this one: more of the kind, another way to
                    ask it, or a fix for what is wrong with it. */}
                {!busy && (
                  <span className="ml-auto flex flex-wrap gap-0.5">
                    <button
                      type="button"
                      onClick={() => openAsk({ kind: "more", draft: d })}
                      className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs text-muted hover:bg-surface hover:text-ink"
                    >
                      <Copy size={12} /> More like this
                    </button>
                    <button
                      type="button"
                      onClick={() => openAsk({ kind: "version", draft: d })}
                      className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs text-muted hover:bg-surface hover:text-ink"
                    >
                      <RefreshCw size={12} /> Another version
                    </button>
                    {!d.done && (
                      <button
                        type="button"
                        onClick={() => openAsk({ kind: "fix", draft: d })}
                        className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs text-muted hover:bg-surface hover:text-ink"
                      >
                        <ThumbsDown size={12} /> What&apos;s wrong?
                      </button>
                    )}
                  </span>
                )}
              </div>
              {askingDraft === d.id && asking && askBox(asking)}
              {busy === d.id && asking === null && (
                <Working
                  active
                  seconds={SECONDS.more}
                  label="Writing from this question"
                  className="mt-2"
                />
              )}
            </li>
          );
        })}
      </ul>

      {busy === "batch" && <Working active seconds={SECONDS.batch} label="Writing different ones" />}

      {asking?.kind === "batch" ? (
        askBox(asking)
      ) : (
        !busy && (
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Hide
            </Button>
            <Button size="sm" variant="ghost" onClick={() => openAsk({ kind: "batch" })}>
              Write different ones
            </Button>
          </div>
        )
      )}
    </div>
  );
}
