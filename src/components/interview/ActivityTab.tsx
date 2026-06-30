"use client";

import { useState } from "react";
import {
  StickyNote,
  ArrowRightLeft,
  Mic,
  MessageCircleQuestion,
  Share2,
  Trash2,
} from "lucide-react";
import type { CandidateActivity } from "@/lib/interview/types";
import { Button } from "@/components/ui/Button";

const ICONS: Record<string, React.ElementType> = {
  note: StickyNote,
  status_change: ArrowRightLeft,
  recording: Mic,
  question_asked: MessageCircleQuestion,
  share: Share2,
};

export function ActivityTab({
  activity,
  loading,
  userId,
  canEdit,
  log,
  remove,
}: {
  activity: CandidateActivity[];
  loading: boolean;
  userId: string | null;
  canEdit: boolean;
  log: (
    type: string,
    body: string,
    userId: string | null,
    meta?: Record<string, unknown>,
  ) => Promise<unknown>;
  remove: (id: string) => Promise<unknown>;
}) {
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  async function addNote() {
    const t = note.trim();
    if (!t) return;
    setSaving(true);
    await log("note", t, userId);
    setNote("");
    setSaving(false);
  }

  return (
    <div className="space-y-5">
      {canEdit && (
        <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Log a note — a call, an update, an impression…"
            className="w-full resize-y rounded-lg border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20"
          />
          <div className="mt-2 flex justify-end">
            <Button size="sm" onClick={addNote} disabled={saving || !note.trim()}>
              {saving ? "Adding…" : "Add note"}
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="py-8 text-center text-sm text-muted">Loading…</p>
      ) : activity.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-surface px-6 py-12 text-center text-sm text-muted">
          No activity yet. Notes, status changes, and interviews will appear here.
        </div>
      ) : (
        <ol className="relative space-y-4 border-l border-border pl-6">
          {activity.map((a) => {
            const Icon = ICONS[a.type] || StickyNote;
            return (
              <li key={a.id} className="relative">
                <span className="absolute -left-[31px] grid h-6 w-6 place-items-center rounded-full border border-border bg-surface text-[var(--accent)]">
                  <Icon size={13} />
                </span>
                <div className="group rounded-lg border border-border bg-surface px-4 py-3 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <p className="whitespace-pre-wrap text-sm text-ink">{a.body}</p>
                    {canEdit && (
                      <button
                        onClick={() => remove(a.id)}
                        className="text-muted opacity-0 transition hover:text-status-error group-hover:opacity-100"
                        title="Delete"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {new Date(a.created_at).toLocaleString()}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
