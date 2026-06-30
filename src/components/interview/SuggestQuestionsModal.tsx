"use client";

import { useState } from "react";
import { Sparkles, Check, FileText, ListChecks } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/ui";

type Mode = "standard" | "resume" | "generate";

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
  onAddToInterview,
  onAddToBank,
}: {
  open: boolean;
  onClose: () => void;
  candidateId: string;
  hasResume: boolean;
  onAddToInterview: (texts: string[]) => Promise<unknown>;
  onAddToBank: (texts: string[]) => Promise<unknown>;
}) {
  const [mode, setMode] = useState<Mode>("standard");
  const [list, setList] = useState<string[]>(STANDARD);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [alsoBank, setAlsoBank] = useState(true);
  const [guidance, setGuidance] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function switchMode(m: Mode) {
    setMode(m);
    setSelected(new Set());
    setError(null);
    if (m === "standard") setList(STANDARD);
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

  async function add(toInterview: boolean) {
    const texts = [...selected].map((i) => list[i]).filter(Boolean);
    if (texts.length === 0) return;
    if (toInterview) await onAddToInterview(texts);
    if (!toInterview || alsoBank) await onAddToBank(texts);
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="Add questions" size="lg">
      <div className="space-y-4">
        {/* mode switch */}
        <div className="flex flex-wrap gap-1.5">
          {(
            [
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
              placeholder="Guidance — e.g. 'senior MSL, focus on stakeholder management'"
              className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
            />
            <Button
              size="sm"
              onClick={() => fetchAi("/api/interview/generate-questions", { topic: guidance })}
              disabled={loading || !guidance.trim()}
            >
              <Sparkles size={14} /> {loading ? "Thinking…" : list.length ? "Re-ask" : "Generate"}
            </Button>
          </div>
        )}

        {error && <p className="text-sm text-status-error">{error}</p>}

        {/* list */}
        {list.length > 0 && (
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

        {/* footer actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <label className="flex items-center gap-2 text-sm text-muted">
            <input
              type="checkbox"
              checked={alsoBank}
              onChange={(e) => setAlsoBank(e.target.checked)}
              className="h-4 w-4 accent-[var(--accent)]"
            />
            Also save to question bank
          </label>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => add(false)}
              disabled={selected.size === 0}
            >
              Save to bank
            </Button>
            <Button onClick={() => add(true)} disabled={selected.size === 0}>
              Add {selected.size || ""} to interview
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
