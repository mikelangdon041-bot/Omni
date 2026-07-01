"use client";

import { useState } from "react";
import { Sparkles, Check, FileText, ListChecks, Library, Pencil } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/ui";

type Mode = "bank" | "write" | "standard" | "resume" | "generate";

const STANDARD: string[] = [
  "Walk me through your background and what brought you here.",
  "Why are you interested in this role?",
  "Tell me about the project you're most proud of.",
  "Describe a time you faced a major obstacle and how you handled it.",
  "How do you prioritize when everything feels urgent?",
  "Tell me about a time you disagreed with a teammate — what happened?",
  "What does success look like for you in this role?",
  "Describe a time you had to learn something quickly.",
  "How do you handle feedback?",
  "Tell me about a time you failed and what you took from it.",
  "What are you looking for in your next role?",
  "What questions do you have for us?",
];

export function SuggestQuestionsModal({
  open,
  onClose,
  candidateId,
  hasResume,
  bankItems,
  onAddToInterview,
  onAddToBank,
  interviews,
  onAddToInterviewId,
  onNeedInterview,
  addLabel = "Add to interview",
}: {
  open: boolean;
  onClose: () => void;
  candidateId: string;
  hasResume: boolean;
  bankItems: { id: string; text: string }[];
  onAddToInterview: (texts: string[]) => Promise<unknown>;
  onAddToBank: (texts: string[]) => Promise<unknown>;
  // When provided (candidate context), "Add to interview" asks which interview.
  interviews?: { id: string; title: string }[];
  onAddToInterviewId?: (interviewId: string, texts: string[]) => Promise<unknown>;
  onNeedInterview?: () => void;
  addLabel?: string;
}) {
  const [mode, setMode] = useState<Mode>("write");
  const [list, setList] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [writeText, setWriteText] = useState("");
  const [alsoBank, setAlsoBank] = useState(true);
  const [guidance, setGuidance] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [targetIv, setTargetIv] = useState("");

  function switchMode(m: Mode) {
    setMode(m);
    setSelected(new Set());
    setError(null);
    if (m === "bank") setList(bankItems.map((b) => b.text));
    else if (m === "standard") setList(STANDARD);
    else setList([]);
  }

  async function fetchAi(url: string, body: object) {
    setLoading(true);
    setError(null);
    setSelected(new Set());
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not generate");
      setList(data.questions || []);
      if ((data.questions || []).length === 0) setError("No questions returned.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  function toggle(i: number) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });
  }
  const allSelected = list.length > 0 && selected.size === list.length;

  function selectedTexts(): string[] {
    if (mode === "write") {
      return writeText
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
    }
    return [...selected].map((i) => list[i]).filter(Boolean);
  }

  async function add(toInterview: boolean) {
    const texts = selectedTexts();
    if (texts.length === 0) return;
    // Candidate context: adding "to interview" first asks which one.
    if (toInterview && interviews) {
      if (interviews.length === 0) {
        onNeedInterview?.();
        return;
      }
      setTargetIv(interviews[0].id);
      setPicking(true);
      return;
    }
    if (toInterview) await onAddToInterview(texts);
    if (mode !== "bank" && (!toInterview || alsoBank)) await onAddToBank(texts);
    onClose();
  }

  async function confirmPick() {
    const texts = selectedTexts();
    if (!targetIv || texts.length === 0 || !onAddToInterviewId) return;
    await onAddToInterviewId(targetIv, texts);
    if (mode !== "bank" && alsoBank) await onAddToBank(texts);
    setPicking(false);
    onClose();
  }

  const nothing =
    mode === "write" ? !writeText.trim() : selected.size === 0;

  return (
    <Modal open={open} onClose={onClose} title="Add questions" size="lg">
      <div className="space-y-4">
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              { m: "write", icon: Pencil, label: "Write your own" },
              { m: "bank", icon: Library, label: "Your bank" },
              { m: "standard", icon: ListChecks, label: "Standard" },
              { m: "resume", icon: FileText, label: "From resume" },
              { m: "generate", icon: Sparkles, label: "Generate with AI" },
            ] as const
          ).map(({ m, icon: Icon, label }) => (
            <button
              key={m}
              onClick={() => switchMode(m)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition",
                mode === m
                  ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                  : "border-border text-muted hover:text-ink",
              )}
            >
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>

        {mode === "write" && (
          <textarea
            autoFocus
            value={writeText}
            onChange={(e) => setWriteText(e.target.value)}
            placeholder="Type questions, one per line…"
            className="min-h-40 w-full resize-y rounded-lg border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20"
          />
        )}

        {mode === "resume" && (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => fetchAi("/api/interview/suggest-questions", { candidateId })}
              disabled={loading || !hasResume}
            >
              <Sparkles size={14} /> {loading ? "Scanning…" : "Scan resume for questions"}
            </Button>
            {!hasResume && (
              <span className="text-xs text-muted">Add a resume first (Overview tab).</span>
            )}
          </div>
        )}

        {mode === "generate" && (
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={guidance}
              onChange={(e) => setGuidance(e.target.value)}
              placeholder="Optional guidance — e.g. 'senior MSL, stakeholder management'"
              className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
            />
            <Button
              size="sm"
              onClick={() => fetchAi("/api/interview/generate-questions", { topic: guidance })}
              disabled={loading}
            >
              <Sparkles size={14} /> {loading ? "Thinking…" : list.length ? "Re-ask" : "Generate"}
            </Button>
          </div>
        )}

        {mode === "bank" && bankItems.length === 0 && (
          <p className="text-sm text-muted">
            Your bank is empty — save questions from Standard, From-resume, or
            Generate, then they&apos;ll show here.
          </p>
        )}
        {error && <p className="text-sm text-status-error">{error}</p>}

        {mode !== "write" && list.length > 0 && (
          <>
            <div className="flex items-center justify-between">
              <button
                onClick={() =>
                  setSelected(allSelected ? new Set() : new Set(list.map((_, i) => i)))
                }
                className="text-xs font-medium text-[var(--accent)] hover:underline"
              >
                {allSelected ? "Clear all" : "Select all"}
              </button>
              <span className="text-xs text-muted">{selected.size} selected</span>
            </div>
            <ul className="max-h-72 space-y-1.5 overflow-y-auto">
              {list.map((q, i) => (
                <li key={i} className="flex items-start gap-2 rounded-lg border border-border p-2.5">
                  <button
                    onClick={() => toggle(i)}
                    className={cn(
                      "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded border transition",
                      selected.has(i)
                        ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                        : "border-border",
                    )}
                  >
                    {selected.has(i) && <Check size={13} />}
                  </button>
                  <input
                    value={q}
                    onChange={(e) =>
                      setList((prev) => prev.map((x, idx) => (idx === i ? e.target.value : x)))
                    }
                    className="flex-1 bg-transparent text-sm outline-none"
                  />
                </li>
              ))}
            </ul>
          </>
        )}

        {picking ? (
          <div className="space-y-3 border-t border-border pt-4">
            <p className="text-sm font-medium">Add to which interview?</p>
            <select
              value={targetIv}
              onChange={(e) => setTargetIv(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)]"
            >
              {(interviews || []).map((iv) => (
                <option key={iv.id} value={iv.id}>
                  {iv.title}
                </option>
              ))}
            </select>
            <div className="flex justify-between">
              <Button variant="secondary" onClick={() => setPicking(false)}>
                Back
              </Button>
              <Button onClick={confirmPick} disabled={!targetIv}>
                Add to this interview
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            {mode === "bank" ? (
              <span />
            ) : (
              <label className="flex items-center gap-2 text-sm text-muted">
                <input
                  type="checkbox"
                  checked={alsoBank}
                  onChange={(e) => setAlsoBank(e.target.checked)}
                  className="h-4 w-4 accent-[var(--accent)]"
                />
                Also save to question bank
              </label>
            )}
            <div className="flex gap-2">
              {mode !== "bank" && (
                <Button variant="secondary" onClick={() => add(false)} disabled={nothing}>
                  Save to bank
                </Button>
              )}
              <Button onClick={() => add(true)} disabled={nothing}>
                {addLabel}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
