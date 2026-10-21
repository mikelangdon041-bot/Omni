"use client";

// "Questions from this": a few questions built on one source, with the setup
// that lays out what it found, each one offered to the bank or straight into
// the writer's list. Nothing lands anywhere until they say so.

import { useState } from "react";
import { Check, Loader2, MessageCircleQuestion, Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Feedback";
import { withReading } from "@/lib/meetingprep/reading";
import { meetingPayload, newId, type GetMeeting, type SaveMeeting } from "@/lib/meetingprep/material";
import type { QuestionItem, ReadingSource } from "@/lib/meetingprep/types";

interface Draft {
  setup: string;
  text: string;
  why: string;
  followUp: string;
  forWhom: string;
  category: string;
  /** Where it went, once it went somewhere. */
  added?: "bank" | "list";
}

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
  const [drafts, setDrafts] = useState<Draft[]>([]);

  async function write() {
    const m = getMeeting();
    if (!m) return;
    setBusy(true);
    try {
      const live = (m.questions?.items || []).filter((q) => !q.deleted);
      const piece = [
        `${s.title}${s.outlet ? ` (${s.outlet}${s.date ? `, ${s.date}` : ""})` : ""}`,
        s.summary,
        ...s.findings.map((f) => `- ${f}`),
      ]
        .filter(Boolean)
        .join("\n");
      const res = await fetch("/api/meeting/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          action: "questions",
          meeting: meetingPayload(m),
          kolId: m.kol_id || "",
          research: withReading(`THE SOURCE THIS BATCH IS BUILT ON:\n${piece}`, m),
          existing: live.map((q) => q.text),
          categories: [...new Set(live.map((q) => q.category))],
          count: 4,
          focus: `Every question in this batch is built on the one source marked THE SOURCE THIS BATCH IS BUILT ON: what it found, what it argues, and what it leaves open. Each one gets a setup that lays out the relevant finding or argument from it in plain words, without naming it, then asks what that means for the people answering. Three to five questions, no more; quality over count.`,
          guidance: m.questions?.guidance || "",
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not write questions from it");
      const got: Draft[] = (json.questions || []).slice(0, 5).map((q: Partial<Draft>) => ({
        setup: String(q.setup || ""),
        text: String(q.text || ""),
        why: String(q.why || ""),
        followUp: String(q.followUp || ""),
        forWhom: String(q.forWhom || ""),
        category: String(q.category || "Questions"),
      }));
      if (!got.length) throw new Error("Nothing came back. Try again.");
      setDrafts(got);
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function add(i: number, where: "bank" | "list") {
    const m = getMeeting();
    const d = drafts[i];
    if (!m || !d || d.added) return;
    const items = m.questions?.items || [];
    const item: QuestionItem = {
      id: newId("q"),
      setup: d.setup,
      text: d.text,
      why: d.why,
      followUp: d.followUp,
      forWhom: d.forWhom,
      category: d.category,
      // Backed by the piece it came from, so the source line under it links
      // straight back here.
      sourceNote: `${[s.outlet, s.date].filter(Boolean).join(", ")}${s.outlet || s.date ? ": " : ""}${s.title}`,
      rank: items.reduce((n, q) => Math.max(n, q.rank), 0) + 1,
      picked: where === "list",
      backup: false,
      asked: false,
      order: where === "list" ? items.filter((q) => q.picked).reduce((n, q) => Math.max(n, q.order + 1), 0) : 0,
      source: "ai",
    };
    save({ questions: { ...(m.questions || {}), items: [...items, item] } });
    setDrafts((ds) => ds.map((x, j) => (j === i ? { ...x, added: where } : x)));
  }

  if (!drafts.length)
    return (
      <button
        type="button"
        onClick={() => void write()}
        disabled={busy}
        className="mt-2 inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs font-medium text-[var(--accent)] hover:bg-[var(--accent-soft)] disabled:opacity-60"
      >
        {busy ? <Loader2 size={13} className="animate-spin" /> : <MessageCircleQuestion size={13} />}
        {busy ? "Writing questions from it…" : "Questions from this"}
      </button>
    );

  return (
    <div className="mt-3 space-y-2 rounded-lg bg-canvas p-3">
      <p className="text-xs font-semibold">Questions from this</p>
      <ul className="space-y-3">
        {drafts.map((d, i) => (
          <li key={i} className="text-sm">
            {d.setup && <p className="mb-1 leading-relaxed text-ink/70">{d.setup}</p>}
            <p className="font-medium">{d.text}</p>
            {d.followUp && <p className="mt-0.5 text-xs italic text-muted">Probe: {d.followUp}</p>}
            <div className="mt-1.5 flex gap-1.5">
              {d.added ? (
                <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
                  <Check size={12} /> {d.added === "list" ? "In your list" : "In the bank"}
                </span>
              ) : (
                <>
                  <Button size="sm" onClick={() => add(i, "list")}>
                    <Plus size={12} /> Add to my list
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => add(i, "bank")}>
                    Add to bank
                  </Button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => setDrafts([])}>
          Done
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void write()} disabled={busy}>
          {busy ? "Writing…" : "Write different ones"}
        </Button>
      </div>
    </div>
  );
}
