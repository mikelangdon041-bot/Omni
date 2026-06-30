"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Sparkles,
  Plus,
  Star,
  Trash2,
  Check,
  X,
  Pencil,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { useQuestionBank, useUserId } from "@/lib/interview/hooks";

export default function QuestionBankPage() {
  const { userId } = useUserId();
  const bank = useQuestionBank(userId);

  // AI generation
  const [topic, setTopic] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<string[]>([]);

  // manual add + inline edit
  const [manual, setManual] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  async function generate() {
    setError(null);
    setLoading(true);
    setDrafts([]);
    try {
      const res = await fetch("/api/interview/generate-questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ topic }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not generate");
      setDrafts(data.questions || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  function editDraft(i: number, value: string) {
    setDrafts((prev) => prev.map((d, idx) => (idx === i ? value : d)));
  }
  async function saveDraft(i: number) {
    const text = drafts[i]?.trim();
    if (text) await bank.add({ text, source: "ai", category: topic });
    setDrafts((prev) => prev.filter((_, idx) => idx !== i));
  }

  return (
    <>
      <Link
        href="/interview-prep"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink"
      >
        <ArrowLeft size={15} /> Interview Prep
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">Question bank</h1>
      <p className="mt-1 text-sm text-muted">
        Save good questions to reuse. Generate new ones with AI, tweak them, and
        keep the ones you like.
      </p>

      {/* AI generate */}
      <div className="mt-6 rounded-xl border border-border bg-surface p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
          Generate with AI
        </h2>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && generate()}
            placeholder="Topic or role — e.g. 'Senior MSL, oncology' or 'behavioral / leadership'"
            className="flex-1 rounded-lg border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20"
          />
          <Button onClick={generate} disabled={loading}>
            <Sparkles size={15} /> {loading ? "Thinking…" : "Generate"}
          </Button>
        </div>
        {error && <p className="mt-3 text-sm text-status-error">{error}</p>}

        {drafts.length > 0 && (
          <ul className="mt-4 space-y-2">
            {drafts.map((d, i) => (
              <li key={i} className="flex items-start gap-2 rounded-lg border border-border p-2.5">
                <textarea
                  value={d}
                  onChange={(e) => editDraft(i, e.target.value)}
                  className="min-h-9 flex-1 resize-y rounded-md border border-transparent bg-transparent px-1 py-0.5 text-sm outline-none focus:border-border"
                  rows={1}
                />
                <button
                  onClick={() => saveDraft(i)}
                  title="Save to bank"
                  className="mt-0.5 rounded-md p-1 text-status-complete transition hover:bg-canvas"
                >
                  <Check size={16} />
                </button>
                <button
                  onClick={() => setDrafts((prev) => prev.filter((_, idx) => idx !== i))}
                  title="Dismiss"
                  className="mt-0.5 rounded-md p-1 text-muted transition hover:bg-canvas hover:text-status-error"
                >
                  <X size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* manual add */}
      <div className="mt-5 flex gap-2">
        <input
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && manual.trim()) {
              bank.add({ text: manual.trim(), source: "manual" });
              setManual("");
            }
          }}
          placeholder="Add your own question…"
          className="flex-1 rounded-lg border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20"
        />
        <Button
          onClick={() => {
            if (manual.trim()) {
              bank.add({ text: manual.trim(), source: "manual" });
              setManual("");
            }
          }}
        >
          <Plus size={15} /> Add
        </Button>
      </div>

      {/* saved questions */}
      <h2 className="mb-3 mt-8 text-sm font-semibold text-muted">
        Saved questions ({bank.items.length})
      </h2>
      {bank.loading ? (
        <p className="py-8 text-center text-sm text-muted">Loading…</p>
      ) : bank.items.length === 0 ? (
        <EmptyState
          title="Your bank is empty"
          hint="Generate questions above or add your own, then save the good ones."
        />
      ) : (
        <ul className="space-y-2">
          {bank.items.map((q) => (
            <li
              key={q.id}
              className="flex items-start gap-2 rounded-xl border border-border bg-surface px-4 py-3 shadow-sm"
            >
              <button
                onClick={() => bank.toggleFavorite(q.id, !q.favorite)}
                title="Favorite"
                className={q.favorite ? "text-amber-500" : "text-muted hover:text-amber-500"}
              >
                <Star size={16} fill={q.favorite ? "currentColor" : "none"} />
              </button>
              {editingId === q.id ? (
                <>
                  <input
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    className="flex-1 rounded-md border border-border bg-surface px-2 py-1 text-sm outline-none focus:border-[var(--accent)]"
                  />
                  <button
                    onClick={() => {
                      bank.update(q.id, editText.trim());
                      setEditingId(null);
                    }}
                    className="rounded-md p-1 text-status-complete hover:bg-canvas"
                  >
                    <Check size={15} />
                  </button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm">{q.text}</span>
                  <button
                    onClick={() => {
                      setEditingId(q.id);
                      setEditText(q.text);
                    }}
                    className="text-muted transition hover:text-[var(--accent)]"
                    title="Edit"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => bank.remove(q.id)}
                    className="text-muted transition hover:text-status-error"
                    title="Delete"
                  >
                    <Trash2 size={15} />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
