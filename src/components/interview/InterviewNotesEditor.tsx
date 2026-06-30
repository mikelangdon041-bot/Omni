"use client";

import { useState } from "react";
import { Check, Plus, Library, Trash2 } from "lucide-react";
import { useCandidateQuestions, useQuestionBank } from "@/lib/interview/hooks";
import type { InterviewNote } from "@/lib/interview/types";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { AutoRichField } from "@/components/ui/AutoRichField";
import { cn } from "@/lib/ui";

export function InterviewNotesEditor({
  open,
  onClose,
  note,
  candidateId,
  userId,
  update,
  remove,
}: {
  open: boolean;
  onClose: () => void;
  note: InterviewNote;
  candidateId: string;
  userId: string | null;
  update: (id: string, partial: Partial<InterviewNote>) => Promise<void>;
  remove: (id: string) => Promise<void>;
}) {
  const [title, setTitle] = useState(note.title);

  return (
    <Modal open={open} onClose={onClose} title="Interview notes" size="lg">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_18rem]">
        {/* notes */}
        <div className="space-y-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => title !== note.title && update(note.id, { title })}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium outline-none focus:border-[var(--accent)]"
          />
          <AutoRichField
            label="Notes"
            canEdit
            initialHtml={note.content || ""}
            placeholder="Type your interview notes — bold, bullets, and indents all work. Saves automatically."
            onSave={(html) => update(note.id, { content: html })}
          />
          <div className="flex justify-end">
            <button
              onClick={() => {
                if (window.confirm("Delete these interview notes?")) {
                  remove(note.id);
                  onClose();
                }
              }}
              className="inline-flex items-center gap-1.5 text-sm text-muted transition hover:text-status-error"
            >
              <Trash2 size={14} /> Delete
            </button>
          </div>
        </div>

        {/* linked questions */}
        <QuestionsPanel candidateId={candidateId} userId={userId} />
      </div>
    </Modal>
  );
}

// The candidate's planned questions, live-linked to the Questions tab + bank.
function QuestionsPanel({
  candidateId,
  userId,
}: {
  candidateId: string;
  userId: string | null;
}) {
  const { questions, add, addMany, update } = useCandidateQuestions(candidateId);
  const bank = useQuestionBank(userId);
  const [draft, setDraft] = useState("");
  const [bankOpen, setBankOpen] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());

  return (
    <div className="rounded-xl border border-border bg-canvas p-4">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">
          Questions
        </h4>
        <button
          onClick={() => setBankOpen(true)}
          className="inline-flex items-center gap-1 text-xs font-medium text-[var(--accent)] hover:underline"
        >
          <Library size={13} /> Bank
        </button>
      </div>

      <div className="mb-3 flex gap-1.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && draft.trim()) {
              add({ text: draft.trim(), source: "manual" });
              setDraft("");
            }
          }}
          placeholder="Add a question…"
          className="flex-1 rounded-md border border-border bg-surface px-2 py-1.5 text-xs outline-none focus:border-[var(--accent)]"
        />
        <button
          onClick={() => {
            if (draft.trim()) {
              add({ text: draft.trim(), source: "manual" });
              setDraft("");
            }
          }}
          className="rounded-md bg-[var(--accent)] px-2 text-white"
        >
          <Plus size={14} />
        </button>
      </div>

      {questions.length === 0 ? (
        <p className="text-xs text-muted">
          No questions planned. Add one or pull from your bank.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {questions.map((q) => (
            <li key={q.id} className="flex items-start gap-2 text-xs">
              <button
                onClick={() => update(q.id, { asked: !q.asked })}
                className={cn(
                  "mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border transition",
                  q.asked
                    ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                    : "border-border",
                )}
                title={q.asked ? "Asked" : "Mark asked"}
              >
                {q.asked && <Check size={11} />}
              </button>
              <span className={q.asked ? "text-muted line-through" : ""}>
                {q.text}
              </span>
            </li>
          ))}
        </ul>
      )}

      <Modal open={bankOpen} onClose={() => setBankOpen(false)} title="Pull from bank">
        {bank.items.length === 0 ? (
          <p className="text-sm text-muted">Your bank is empty.</p>
        ) : (
          <>
            <ul className="space-y-1.5">
              {bank.items.map((b) => {
                const on = sel.has(b.id);
                return (
                  <li key={b.id}>
                    <button
                      onClick={() =>
                        setSel((prev) => {
                          const n = new Set(prev);
                          if (n.has(b.id)) n.delete(b.id);
                          else n.add(b.id);
                          return n;
                        })
                      }
                      className={cn(
                        "flex w-full items-start gap-2 rounded-lg border p-2.5 text-left text-sm transition",
                        on ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-border",
                      )}
                    >
                      <span className={cn("mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded border", on ? "border-[var(--accent)] bg-[var(--accent)] text-white" : "border-border")}>
                        {on && <Check size={13} />}
                      </span>
                      <span className="flex-1">{b.text}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="mt-4 flex justify-end">
              <Button
                size="sm"
                onClick={async () => {
                  const items = bank.items.filter((b) => sel.has(b.id));
                  await addMany(
                    items.map((b) => ({ text: b.text, source: "bank", bank_id: b.id })),
                  );
                  setSel(new Set());
                  setBankOpen(false);
                }}
                disabled={sel.size === 0}
              >
                Add {sel.size || ""}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
