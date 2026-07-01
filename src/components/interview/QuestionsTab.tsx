"use client";

import { useState } from "react";
import Link from "next/link";
import { Sparkles, Trash2, BookmarkPlus, Library, Check } from "lucide-react";
import {
  useCandidateQuestions,
  useQuestionBank,
  useInterviews,
} from "@/lib/interview/hooks";
import type { Candidate } from "@/lib/interview/types";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { SuggestQuestionsModal } from "@/components/interview/SuggestQuestionsModal";

const supabase = createClient();

export function QuestionsTab({
  candidate,
  userId,
  onGoToInterviews,
}: {
  candidate: Candidate;
  userId: string | null;
  onGoToInterviews?: () => void;
}) {
  const { questions, addMany, update, remove } = useCandidateQuestions(
    candidate.id,
  );
  const bank = useQuestionBank(userId);
  const { interviews } = useInterviews(candidate.id);
  const [suggestOpen, setSuggestOpen] = useState(false);

  // Add questions to a specific interview (rows carry that interview_id).
  async function addToInterview(interviewId: string, texts: string[]) {
    const rows = texts.map((t, i) => ({
      candidate_id: candidate.id,
      interview_id: interviewId,
      text: t,
      source: "manual",
      sort_order: i,
    }));
    await supabase.from("candidate_questions").insert(rows);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href="/interview-prep/question-bank">
          <Button variant="secondary">
            <Library size={15} /> Question bank
          </Button>
        </Link>
        <Button onClick={() => setSuggestOpen(true)}>
          <Sparkles size={15} /> Add questions
        </Button>
      </div>

      <PlannedQuestions
        questions={questions}
        update={update}
        remove={remove}
        onSaveToBank={(t) => bank.add({ text: t, source: "manual" })}
      />

      <SuggestQuestionsModal
        open={suggestOpen}
        onClose={() => setSuggestOpen(false)}
        candidateId={candidate.id}
        hasResume={!!candidate.resume_text?.trim()}
        bankItems={bank.items}
        interviews={interviews.map((iv) => ({ id: iv.id, title: iv.title }))}
        addLabel="Add to interview"
        onAddToInterviewId={addToInterview}
        onNeedInterview={() => {
          setSuggestOpen(false);
          onGoToInterviews?.();
        }}
        onAddToInterview={(texts) =>
          addMany(texts.map((t) => ({ text: t, source: "ai" })))
        }
        onAddToBank={(texts) =>
          Promise.all(texts.map((t) => bank.add({ text: t, source: "ai" })))
        }
      />
    </div>
  );
}

type CQ = ReturnType<typeof useCandidateQuestions>["questions"][number];

function PlannedQuestions({
  questions,
  update,
  remove,
  onSaveToBank,
}: {
  questions: CQ[];
  update: (id: string, p: Partial<CQ>) => Promise<unknown>;
  remove: (id: string) => Promise<unknown>;
  onSaveToBank: (text: string) => Promise<unknown>;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
        Questions for this interview
      </h3>

      {questions.length === 0 ? (
        <p className="text-sm text-muted">
          No questions yet. Use “Add questions” to write your own, pull from your
          bank, or generate with AI.
        </p>
      ) : (
        <ul className="space-y-2">
          {questions.map((q) => (
            <li key={q.id} className="rounded-lg border border-border p-3">
              <div className="flex items-start gap-2.5">
                <button
                  onClick={() => update(q.id, { asked: !q.asked })}
                  className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded border transition ${
                    q.asked
                      ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                      : "border-border"
                  }`}
                  title={q.asked ? "Asked" : "Mark as asked"}
                >
                  {q.asked && <Check size={13} />}
                </button>
                <span
                  className={`flex-1 text-sm ${q.asked ? "text-muted line-through" : ""}`}
                >
                  {q.text}
                </span>
                <button
                  onClick={() => onSaveToBank(q.text)}
                  title="Save to bank"
                  className="text-muted transition hover:text-[var(--accent)]"
                >
                  <BookmarkPlus size={15} />
                </button>
                <button
                  onClick={() => remove(q.id)}
                  title="Remove"
                  className="text-muted transition hover:text-status-error"
                >
                  <Trash2 size={15} />
                </button>
              </div>
              <textarea
                defaultValue={q.answer_notes}
                onBlur={(e) =>
                  e.target.value !== q.answer_notes &&
                  update(q.id, { answer_notes: e.target.value })
                }
                placeholder="Answer notes…"
                className="mt-2 w-full resize-y rounded-lg border border-border bg-canvas px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
