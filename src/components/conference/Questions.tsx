"use client";

// Organizer-editable question lists (conference settings). One editor modal
// serves both the session post-event questions and the KOL profile questions:
// rename, reorder-by-position, delete, and add — built-in questions keep
// their legacy column keys so existing answers stay attached.

import { useEffect, useState } from "react";
import { GripVertical, Plus, Settings2, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import type { QuestionDef } from "@/lib/conference/types";

export function EditQuestionsButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] font-medium text-muted transition hover:text-ink"
      title="Edit these questions (conference organizer)"
    >
      <Settings2 size={12} /> Edit questions
    </button>
  );
}

export function QuestionsEditorModal({
  open,
  onClose,
  title,
  questions,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  questions: QuestionDef[];
  // Resolves to an error message on failure, null on success.
  onSave: (questions: QuestionDef[]) => Promise<string | null>;
}) {
  const [rows, setRows] = useState<QuestionDef[]>(questions);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setRows(questions);
      setError("");
    }
  }, [open, questions]);

  function setLabel(i: number, label: string) {
    setRows((prev) => prev.map((q, j) => (j === i ? { ...q, label } : q)));
  }
  function move(i: number, dir: -1 | 1) {
    setRows((prev) => {
      const next = [...prev];
      const j = i + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }
  function addRow() {
    setRows((prev) => [
      ...prev,
      { key: `q_${crypto.randomUUID().slice(0, 8)}`, label: "" },
    ]);
  }

  async function save() {
    const cleaned = rows
      .map((q) => ({ ...q, label: q.label.trim() }))
      .filter((q) => q.label);
    setSaving(true);
    setError("");
    const err = await onSave(cleaned);
    setSaving(false);
    if (err) {
      setError(
        err.includes("settings")
          ? "Saving needs the 0018_conference_settings migration applied in Supabase."
          : err,
      );
      return;
    }
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title={title} size="sm">
      <div className="space-y-3">
        <p className="text-xs text-muted">
          Everyone on this conference sees these questions. Deleting one hides
          it (and its answers) — adding it back with the same wording restores
          nothing for custom questions, so rename rather than delete when
          possible.
        </p>
        <div className="space-y-1.5">
          {rows.map((q, i) => (
            <div key={q.key} className="flex items-center gap-1.5">
              <div className="flex flex-col">
                <button
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  className="text-muted disabled:opacity-30"
                  aria-label="Move up"
                >
                  <GripVertical size={12} className="rotate-90" />
                </button>
                <button
                  onClick={() => move(i, 1)}
                  disabled={i === rows.length - 1}
                  className="text-muted disabled:opacity-30"
                  aria-label="Move down"
                >
                  <GripVertical size={12} className="-rotate-90" />
                </button>
              </div>
              <div className="min-w-0 flex-1">
                <Input
                  value={q.label}
                  onChange={(e) => setLabel(i, e.target.value)}
                  placeholder="Question label…"
                />
              </div>
              <button
                onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
                className="rounded p-1.5 text-muted transition hover:text-red-600"
                title="Delete question"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
        <Button size="sm" variant="secondary" onClick={addRow}>
          <Plus size={13} /> Add question
        </Button>
        {error && <p className="text-xs text-amber-700">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save questions"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
