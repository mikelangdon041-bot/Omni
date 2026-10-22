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

import { useState } from "react";
import { ArrowLeftRight, Check, Loader2, MessageCircleQuestion, Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
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
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(true);
  const drafts = s.questions || [];

  /** Write onto this source's drafts, reading the meeting fresh. */
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

  async function write() {
    const m = getMeeting();
    if (!m) return;
    setBusy(true);
    setOpen(true);
    try {
      const live = liveQuestions(m);
      const piece = [
        `${s.title}${s.outlet ? ` (${s.outlet}${s.date ? `, ${s.date}` : ""})` : ""}`,
        s.summary,
        ...s.findings.map((f) => `- ${f}`),
      ]
        .filter(Boolean)
        .join("\n");
      const json = await post<{ questions: Partial<SourceDraft>[] }>({
        action: "questions",
        meeting: meetingPayload(m),
        kolId: m.kol_id || "",
        research: withReading(`THE SOURCE THIS BATCH IS BUILT ON:\n${piece}`, m),
        // Not the drafts being replaced: "write different ones" should not
        // be told the old batch is already in the bank.
        existing: live.map((q) => q.text),
        categories: [...new Set(live.map((q) => q.category))],
        count: 4,
        focus: `Every question in this batch is built on the one source marked THE SOURCE THIS BATCH IS BUILT ON: what it found, what it argues, and what it leaves open. Each one gets a setup that lays out the relevant finding or argument from it in plain words, without naming it, then asks what that means for the people answering. Three to five questions, no more; quality over count.${
          drafts.length
            ? ` The writer has already seen these and wants different ones, so do not repeat them: ${drafts.map((d) => d.text).join(" | ")}`
            : ""
        }`,
        guidance: m.questions?.guidance || "",
      });
      const got: SourceDraft[] = (json.questions || []).slice(0, 5).map((q) => ({
        id: newId("sd"),
        setup: String(q.setup || ""),
        text: String(q.text || ""),
        why: String(q.why || ""),
        followUp: String(q.followUp || ""),
        forWhom: String(q.forWhom || ""),
        category: String(q.category || "Questions"),
      }));
      if (!got.length) throw new Error("Nothing came back. Try again.");
      // Two drafts in one batch can ask the same thing as each other, which
      // the bank check cannot see. The later one of a pair is dropped.
      if (got.length > 1) {
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

      // Which of the questions already in the bank each draft repeats. Its
      // own quick check, so a draft can say which one it is like.
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
          // Without the check the drafts are still worth having; they just
          // cannot say which question they are like.
        }
      }
      // Kept drafts the writer already acted on stay in the record; the
      // untouched ones are what "different ones" replaces.
      setDrafts([...drafts.filter((d) => d.done), ...got]);
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setBusy(false);
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
    const m = getMeeting();
    const now = m?.reading?.sources?.find((x) => x.id === s.id)?.questions || drafts;
    setDrafts(now.map((x) => (x.id === id ? { ...x, done } : x)));
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

  if (!drafts.length || !open)
    return (
      <button
        type="button"
        onClick={() => (drafts.length ? setOpen(true) : void write())}
        disabled={busy}
        className="mt-2 inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs font-medium text-[var(--accent)] hover:bg-[var(--accent-soft)] disabled:opacity-60"
      >
        {busy ? <Loader2 size={13} className="animate-spin" /> : <MessageCircleQuestion size={13} />}
        {busy
          ? "Writing questions from it…"
          : drafts.length
            ? `Questions from this (${drafts.length})`
            : "Questions from this"}
      </button>
    );

  const m = getMeeting();
  const byId = new Map(m ? liveQuestions(m).map((q) => [q.id, q]) : []);

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

              <div className="mt-1.5 flex flex-wrap gap-1.5">
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
                    <Button size="sm" variant="secondary" onClick={() => add(d, like.picked ? "list" : "bank")}>
                      Keep both
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
              </div>
            </li>
          );
        })}
      </ul>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Hide
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void write()} disabled={busy}>
          {busy ? (
            <>
              <Loader2 size={12} className="animate-spin" /> Writing…
            </>
          ) : (
            "Write different ones"
          )}
        </Button>
      </div>
    </div>
  );
}
