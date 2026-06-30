"use client";

import { useRef, useState } from "react";
import {
  Sparkles,
  Plus,
  Trash2,
  BookmarkPlus,
  Library,
  Upload,
  Check,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  useCandidateQuestions,
  useQuestionBank,
} from "@/lib/interview/hooks";
import type { Candidate } from "@/lib/interview/types";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";

const supabase = createClient();

export function QuestionsTab({
  candidate,
  userId,
  updateCandidate,
}: {
  candidate: Candidate;
  userId: string | null;
  updateCandidate: (p: Partial<Candidate>) => Promise<void>;
}) {
  const { questions, add, addMany, update, remove } = useCandidateQuestions(
    candidate.id,
  );
  const bank = useQuestionBank(userId);

  return (
    <div className="space-y-5">
      <ResumeCard candidate={candidate} userId={userId} updateCandidate={updateCandidate} />

      <AiSuggestions
        candidateId={candidate.id}
        hasResume={!!candidate.resume_text?.trim()}
        onAdd={(texts) =>
          addMany(texts.map((t) => ({ text: t, source: "ai" })))
        }
        onSaveToBank={(t) => bank.add({ text: t, source: "ai" })}
      />

      <PlannedQuestions
        questions={questions}
        add={add}
        update={update}
        remove={remove}
        onSaveToBank={(t) => bank.add({ text: t, source: "manual" })}
        bank={bank.items}
        onAddFromBank={(items) =>
          addMany(
            items.map((b) => ({ text: b.text, source: "bank", bank_id: b.id })),
          )
        }
      />
    </div>
  );
}

// ---- Resume -------------------------------------------------------
function ResumeCard({
  candidate,
  userId,
  updateCandidate,
}: {
  candidate: Candidate;
  userId: string | null;
  updateCandidate: (p: Partial<Candidate>) => Promise<void>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(candidate.resume_text || "");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [fileName, setFileName] = useState(
    candidate.resume_url ? candidate.resume_url.split("/").pop() || "" : "",
  );

  async function save() {
    setSaving(true);
    await updateCandidate({ resume_text: text });
    setSaving(false);
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !userId) return;
    setUploading(true);
    // Text files: read straight into the resume text for AI use.
    if (/\.(txt|md|csv)$/i.test(file.name) || file.type.startsWith("text/")) {
      const content = await file.text();
      setText(content);
      await updateCandidate({ resume_text: content });
    }
    // Always store the original file for the record.
    const path = `${userId}/${candidate.id}/${Date.now()}-${file.name}`;
    const { error } = await supabase.storage
      .from("resumes")
      .upload(path, file, { upsert: true });
    if (!error) {
      setFileName(file.name);
      await updateCandidate({ resume_url: path });
    }
    setUploading(false);
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">
          Resume
        </h3>
        <input
          ref={fileRef}
          type="file"
          accept=".txt,.md,.csv,.pdf,.doc,.docx"
          onChange={onFile}
          className="hidden"
        />
        <Button
          variant="secondary"
          size="sm"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
        >
          <Upload size={14} /> {uploading ? "Uploading…" : "Upload file"}
        </Button>
      </div>
      {fileName && (
        <p className="mb-2 text-xs text-muted">Attached: {fileName}</p>
      )}
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Paste the candidate's resume / background here. The AI uses this text to tailor questions. (PDFs are stored but paste the text here for AI.)"
        className="min-h-32"
      />
      <div className="mt-2 flex justify-end">
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save resume text"}
        </Button>
      </div>
    </div>
  );
}

// ---- AI suggestions ----------------------------------------------
function AiSuggestions({
  candidateId,
  hasResume,
  onAdd,
  onSaveToBank,
}: {
  candidateId: string;
  hasResume: boolean;
  onAdd: (texts: string[]) => Promise<unknown>;
  onSaveToBank: (text: string) => Promise<unknown>;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  async function suggest() {
    setLoading(true);
    setError(null);
    setSuggestions([]);
    setSelected(new Set());
    try {
      const res = await fetch("/api/interview/suggest-questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ candidateId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not suggest");
      setSuggestions(data.questions || []);
      if ((data.questions || []).length === 0)
        setError("No suggestions returned. Add resume text and try again.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  function toggle(i: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  async function addSelected() {
    const texts = [...selected].map((i) => suggestions[i]).filter(Boolean);
    if (texts.length === 0) return;
    await onAdd(texts);
    setSuggestions((prev) => prev.filter((_, i) => !selected.has(i)));
    setSelected(new Set());
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">
          AI suggestions
        </h3>
        <Button size="sm" onClick={suggest} disabled={loading || !hasResume}>
          <Sparkles size={14} /> {loading ? "Thinking…" : "Suggest from resume"}
        </Button>
      </div>

      {!hasResume && (
        <p className="mt-3 text-sm text-muted">
          Add the candidate&apos;s resume above to generate tailored questions.
        </p>
      )}
      {error && <p className="mt-3 text-sm text-status-error">{error}</p>}

      {suggestions.length > 0 && (
        <>
          <ul className="mt-4 space-y-1.5">
            {suggestions.map((q, i) => (
              <li
                key={i}
                className="flex items-start gap-2 rounded-lg border border-border p-2.5"
              >
                <button
                  onClick={() => toggle(i)}
                  className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded border transition ${
                    selected.has(i)
                      ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                      : "border-border"
                  }`}
                  aria-label="Select"
                >
                  {selected.has(i) && <Check size={13} />}
                </button>
                <span className="flex-1 text-sm">{q}</span>
                <button
                  onClick={() => onSaveToBank(q)}
                  title="Save to question bank"
                  className="text-muted transition hover:text-[var(--accent)]"
                >
                  <BookmarkPlus size={15} />
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex justify-end">
            <Button size="sm" onClick={addSelected} disabled={selected.size === 0}>
              <Plus size={14} /> Add {selected.size || ""} to candidate
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

// ---- Planned questions -------------------------------------------
type CQ = ReturnType<typeof useCandidateQuestions>["questions"][number];

function PlannedQuestions({
  questions,
  add,
  update,
  remove,
  onSaveToBank,
  bank,
  onAddFromBank,
}: {
  questions: CQ[];
  add: (p: Partial<CQ>) => Promise<unknown>;
  update: (id: string, p: Partial<CQ>) => Promise<unknown>;
  remove: (id: string) => Promise<unknown>;
  onSaveToBank: (text: string) => Promise<unknown>;
  bank: { id: string; text: string; favorite: boolean }[];
  onAddFromBank: (items: { id: string; text: string }[]) => Promise<unknown>;
}) {
  const [draft, setDraft] = useState("");
  const [bankOpen, setBankOpen] = useState(false);
  const [bankSel, setBankSel] = useState<Set<string>>(new Set());

  async function addManual() {
    const t = draft.trim();
    if (!t) return;
    await add({ text: t, source: "manual" });
    setDraft("");
  }

  async function confirmBank() {
    const items = bank.filter((b) => bankSel.has(b.id));
    if (items.length) await onAddFromBank(items);
    setBankSel(new Set());
    setBankOpen(false);
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">
          Questions for this interview
        </h3>
        <Button variant="secondary" size="sm" onClick={() => setBankOpen(true)}>
          <Library size={14} /> Add from bank
        </Button>
      </div>

      <div className="mb-4 flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addManual()}
          placeholder="Add a question…"
          className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20"
        />
        <Button size="sm" onClick={addManual}>
          <Plus size={14} /> Add
        </Button>
      </div>

      {questions.length === 0 ? (
        <p className="text-sm text-muted">
          No questions yet. Add your own, pull from your bank, or generate from the resume.
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

      <Modal open={bankOpen} onClose={() => setBankOpen(false)} title="Your question bank">
        {bank.length === 0 ? (
          <p className="text-sm text-muted">
            Your bank is empty. Save questions with the bookmark icon to reuse them later.
          </p>
        ) : (
          <>
            <ul className="space-y-1.5">
              {bank.map((b) => {
                const sel = bankSel.has(b.id);
                return (
                  <li key={b.id}>
                    <button
                      onClick={() =>
                        setBankSel((prev) => {
                          const n = new Set(prev);
                          if (n.has(b.id)) n.delete(b.id);
                          else n.add(b.id);
                          return n;
                        })
                      }
                      className={`flex w-full items-start gap-2 rounded-lg border p-2.5 text-left text-sm transition ${
                        sel ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-border"
                      }`}
                    >
                      <span
                        className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded border ${
                          sel ? "border-[var(--accent)] bg-[var(--accent)] text-white" : "border-border"
                        }`}
                      >
                        {sel && <Check size={13} />}
                      </span>
                      <span className="flex-1">{b.text}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="mt-4 flex justify-end">
              <Button size="sm" onClick={confirmBank} disabled={bankSel.size === 0}>
                <Plus size={14} /> Add {bankSel.size || ""} selected
              </Button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
