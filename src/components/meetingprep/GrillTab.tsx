"use client";

// Meeting Prep — Grill me: the AI plays the hardest version of the other
// side. Answer by typing or speaking; get coaching on YOUR answer, then see
// the model answer.

import { useState } from "react";
import { Flame, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Feedback";
import { TranscriptCapture } from "@/components/studio/TranscriptCapture";
import { htmlToPlain } from "@/lib/writer/types";
import {
  meetingContextText,
  type GrillItem,
  type MpMeeting,
} from "@/lib/meetingprep/types";

export function GrillTab({
  m,
  save,
  flush,
}: {
  m: MpMeeting;
  save: (p: Partial<MpMeeting>) => void;
  flush: () => Promise<void>;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [coachingId, setCoachingId] = useState<string | null>(null);

  const items: GrillItem[] = m.grill || [];

  const setItem = (id: string, partial: Partial<GrillItem>) =>
    save({ grill: items.map((g) => (g.id === id ? { ...g, ...partial } : g)) });

  async function generateQuestions() {
    setBusy(true);
    try {
      await flush();
      const briefText = (m.brief?.sections || [])
        .map((s) => `${s.title}:\n${htmlToPlain(s.content)}`)
        .join("\n\n");
      const res = await fetch("/api/meeting/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          action: "grill",
          context: meetingContextText(m),
          briefText,
          count: 8,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not generate questions");
      const grill: GrillItem[] = (json.questions || []).map(
        (q: { question: string; modelAnswer: string }, i: number) => ({
          id: `g${Date.now()}_${i}`,
          question: q.question,
          modelAnswer: q.modelAnswer,
          userAnswer: "",
          coaching: "",
          revealed: false,
        }),
      );
      save({ grill });
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function coach(g: GrillItem) {
    if (!g.userAnswer.trim()) return;
    setCoachingId(g.id);
    try {
      const res = await fetch("/api/meeting/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          action: "coach",
          question: g.question,
          modelAnswer: g.modelAnswer,
          userAnswer: g.userAnswer,
          context: meetingContextText(m),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Coaching failed");
      setItem(g.id, { coaching: json.coaching, revealed: true });
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setCoachingId(null);
    }
  }

  if (items.length === 0) {
    return (
      <div className="grid place-items-center rounded-xl border border-dashed border-border bg-surface px-6 py-16 text-center">
        <Flame size={24} className="mb-2 text-[var(--accent)]" />
        <p className="text-sm font-medium text-ink">Ready to be grilled?</p>
        <p className="mt-1 max-w-md text-sm text-muted">
          I&apos;ll ask the hardest questions the other side could realistically
          throw at you. Answer out loud or in writing — I&apos;ll coach your
          answer, then show you mine.
        </p>
        <Button className="mt-4" disabled={busy} onClick={generateQuestions}>
          <Sparkles size={16} /> {busy ? "Preparing the hard questions…" : "Grill me"}
        </Button>
      </div>
    );
  }

  const answered = items.filter((g) => g.revealed).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <p className="text-sm text-muted">
          {answered}/{items.length} tackled
        </p>
        <span className="flex-1" />
        <Button size="sm" variant="secondary" disabled={busy} onClick={generateQuestions}>
          <RefreshCw size={14} /> {busy ? "Regenerating…" : "New questions"}
        </Button>
      </div>

      {items.map((g, i) => (
        <section
          key={g.id}
          className="rounded-xl border border-border bg-surface p-4 shadow-sm"
        >
          <p className="mb-3 text-sm font-medium">
            <span className="mr-2 inline-grid h-6 w-6 place-items-center rounded-full bg-[var(--accent-soft)] text-xs font-bold text-[var(--accent)]">
              {i + 1}
            </span>
            {g.question}
          </p>

          {!g.revealed ? (
            <div className="space-y-2">
              <Textarea
                value={g.userAnswer}
                onChange={(e) => setItem(g.id, { userAnswer: e.target.value })}
                placeholder="Type your answer — or record it below and I'll transcribe it…"
                className="min-h-20"
              />
              <div className="flex flex-wrap items-center gap-2">
                <TranscriptCapture
                  compact
                  allowPaste={false}
                  recordLabel="Answer out loud"
                  onTranscript={(text) =>
                    setItem(g.id, { userAnswer: (g.userAnswer ? g.userAnswer + "\n" : "") + text })
                  }
                />
                <span className="flex-1" />
                <Button
                  size="sm"
                  disabled={!g.userAnswer.trim() || coachingId === g.id}
                  onClick={() => coach(g)}
                >
                  <Sparkles size={14} />
                  {coachingId === g.id ? "Coaching…" : "Coach my answer"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setItem(g.id, { revealed: true })}
                >
                  Skip to model answer
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {g.userAnswer && (
                <div className="rounded-lg bg-canvas px-3 py-2">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
                    Your answer
                  </p>
                  <p className="whitespace-pre-wrap text-sm">{g.userAnswer}</p>
                </div>
              )}
              {g.coaching && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                    Coaching
                  </p>
                  <p className="whitespace-pre-wrap text-sm text-amber-900">{g.coaching}</p>
                </div>
              )}
              <div className="rounded-lg border border-[var(--accent)]/30 bg-[var(--accent-soft)]/30 px-3 py-2">
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--accent)]">
                  A strong answer
                </p>
                <p className="whitespace-pre-wrap text-sm">{g.modelAnswer}</p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  setItem(g.id, { revealed: false, coaching: "", userAnswer: "" })
                }
              >
                Try again
              </Button>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
