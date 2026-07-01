"use client";

import { useEffect, useMemo, useRef, useCallback } from "react";
import { CheckCircle2 } from "lucide-react";
import { useSurveyAnswers } from "@/lib/insights/hooks";
import {
  applicableQuestions,
  completion,
  isAnswered,
} from "@/lib/insights/survey";
import { QuestionInput } from "./QuestionInput";
import type { AnswerValue, QuestionNode, ResponseStatus } from "@/lib/insights/types";

export function SurveyRunner({
  responseId,
  tree,
  initialStatus,
  onProgress,
}: {
  responseId: string;
  tree: QuestionNode[];
  initialStatus: ResponseStatus;
  onProgress?: (pct: number) => void;
}) {
  const { answerMap, loading, saveAnswer, setStatus } =
    useSurveyAnswers(responseId);
  const statusRef = useRef<ResponseStatus>(initialStatus);

  const applicable = useMemo(
    () => applicableQuestions(tree, answerMap),
    [tree, answerMap],
  );
  const comp = useMemo(
    () => completion(applicable, answerMap),
    [applicable, answerMap],
  );

  // Keep the response status in sync with progress.
  useEffect(() => {
    onProgress?.(comp.pct);
    let next: ResponseStatus = statusRef.current;
    if (comp.total > 0 && comp.answered === comp.total) next = "complete";
    else if (comp.answered > 0) next = "in_progress";
    if (next !== statusRef.current) {
      statusRef.current = next;
      void setStatus(next);
    }
  }, [comp, onProgress, setStatus]);

  // saveAnswer updates local state optimistically (instant UI) then upserts.
  const handleChange = useCallback(
    (node: QuestionNode, v: AnswerValue) => {
      void saveAnswer(node.id, v);
    },
    [saveAnswer],
  );

  if (loading) {
    return <p className="py-12 text-center text-sm text-muted">Loading…</p>;
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Progress */}
      <div className="sticky top-14 z-10 rounded-xl border border-border bg-surface/95 p-4 shadow-sm backdrop-blur">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="font-medium">
            {comp.answered} of {comp.total} answered
          </span>
          <span
            className={
              comp.pct === 100
                ? "flex items-center gap-1 font-semibold text-emerald-600"
                : "font-semibold text-[var(--accent)]"
            }
          >
            {comp.pct === 100 && <CheckCircle2 size={15} />}
            {comp.pct}%
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-border">
          <div
            className="h-full rounded-full bg-[var(--accent)] transition-all"
            style={{ width: `${comp.pct}%` }}
          />
        </div>
      </div>

      {/* Questions (only applicable ones — branches expand as answers change) */}
      <div className="flex flex-col gap-3">
        {applicable.map((node, i) => {
          const answered = isAnswered(node, answerMap.get(node.id));
          return (
            <div
              key={node.id}
              className="rounded-xl border border-border bg-surface p-5 shadow-sm"
            >
              <div className="mb-3 flex items-start gap-3">
                <span
                  className={
                    answered
                      ? "mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-600"
                      : "mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-[var(--accent)]"
                  }
                >
                  {answered ? <CheckCircle2 size={15} /> : i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink">
                    {node.text}
                    {node.required && (
                      <span className="ml-1 text-status-error">*</span>
                    )}
                  </p>
                  {node.help_text && (
                    <p className="mt-0.5 text-xs text-muted">{node.help_text}</p>
                  )}
                </div>
              </div>
              <div className="pl-9">
                <QuestionInput
                  node={node}
                  value={answerMap.get(node.id)}
                  onChange={(v) => handleChange(node, v)}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
