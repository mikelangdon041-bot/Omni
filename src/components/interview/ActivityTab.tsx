"use client";

import { useState } from "react";
import Link from "next/link";
import {
  StickyNote,
  ArrowRightLeft,
  Mic,
  MessageCircleQuestion,
  Share2,
  Trash2,
  Mail,
  Phone,
  Headphones,
  Users,
  Plus,
  ArrowLeft,
} from "lucide-react";
import type { CandidateActivity } from "@/lib/interview/types";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";

interface InterviewItem {
  id: string;
  title: string;
  status: string;
  created_at: string;
}

const ICONS: Record<string, React.ElementType> = {
  note: StickyNote,
  status_change: ArrowRightLeft,
  recording: Mic,
  question_asked: MessageCircleQuestion,
  share: Share2,
  email: Mail,
  call: Phone,
  phone_screen: Headphones,
  interview: Users,
};

// Activity types in the picker. `interview` types jump to the Interviews tab.
const ADD_TYPES: {
  type: string;
  label: string;
  icon: React.ElementType;
  interview?: boolean;
}[] = [
  { type: "note", label: "Note", icon: StickyNote },
  { type: "email", label: "Email", icon: Mail },
  { type: "call", label: "Call", icon: Phone },
  { type: "phone_screen", label: "Phone screen", icon: Headphones, interview: true },
  { type: "interview", label: "Interview", icon: Users, interview: true },
];

const TYPE_LABEL: Record<string, string> = Object.fromEntries(
  ADD_TYPES.map((t) => [t.type, t.label]),
);

// When an activity happened (honors a backdated occurred_at; else when logged).
function actWhen(a: CandidateActivity): string {
  const o = (a.meta as { occurred_at?: unknown } | undefined)?.occurred_at;
  return typeof o === "string" ? o : a.created_at;
}

type Item =
  | { kind: "activity"; at: string; data: CandidateActivity }
  | { kind: "interview"; at: string; data: InterviewItem };

export function ActivityTab({
  activity,
  interviews = [],
  loading,
  userId,
  canEdit,
  log,
  remove,
  onGoToInterviews,
}: {
  activity: CandidateActivity[];
  interviews?: InterviewItem[];
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
  onGoToInterviews?: () => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 16));
  const [saving, setSaving] = useState(false);

  // Merge notes/status-changes with interviews into one reverse-chron timeline.
  const items: Item[] = [
    ...activity.map((a) => ({ kind: "activity" as const, at: actWhen(a), data: a })),
    ...interviews.map((r) => ({ kind: "interview" as const, at: r.created_at, data: r })),
  ].sort((a, b) => +new Date(b.at) - +new Date(a.at));

  function pick(t: { type: string; interview?: boolean }) {
    if (t.interview) {
      setPickerOpen(false);
      onGoToInterviews?.();
      return;
    }
    setChosen(t.type);
  }

  async function saveActivity() {
    if (!chosen) return;
    setSaving(true);
    await log(chosen, body.trim(), userId, {
      occurred_at: new Date(date).toISOString(),
    });
    setSaving(false);
    setBody("");
    setDate(new Date().toISOString().slice(0, 16));
    setChosen(null);
    setPickerOpen(false);
  }

  return (
    <div className="space-y-5">
      {canEdit && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted">
            Log calls, emails, and notes — recorded/written interviews live in the
            Interviews tab.
          </p>
          <Button onClick={() => { setChosen(null); setPickerOpen(true); }}>
            <Plus size={16} /> Add activity
          </Button>
        </div>
      )}

      <Modal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title={chosen ? `Log ${TYPE_LABEL[chosen]?.toLowerCase()}` : "Add activity"}
        size="sm"
      >
        {chosen ? (
          <div className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted">When</span>
              <input
                type="datetime-local"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted">Notes</span>
              <textarea
                autoFocus
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="What happened? Outcome, next steps…"
                className="min-h-28 w-full resize-y rounded-lg border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20"
              />
            </label>
            <div className="flex justify-between">
              <Button variant="secondary" onClick={() => setChosen(null)}>
                <ArrowLeft size={14} /> Back
              </Button>
              <Button onClick={saveActivity} disabled={saving || !body.trim()}>
                {saving ? "Saving…" : "Log it"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2.5">
            {ADD_TYPES.map((t) => (
              <button
                key={t.type}
                onClick={() => pick(t)}
                className="flex flex-col items-center gap-2 rounded-xl border border-border p-4 text-sm font-medium transition hover:border-[var(--accent)] hover:bg-[var(--accent-soft)]"
              >
                <t.icon size={20} className="text-[var(--accent)]" />
                {t.label}
                {t.interview && (
                  <span className="text-[10px] font-normal text-muted">
                    → Interviews
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </Modal>

      {loading ? (
        <p className="py-8 text-center text-sm text-muted">Loading…</p>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-surface px-6 py-12 text-center text-sm text-muted">
          No activity yet. Notes, status changes, and interviews will appear here.
        </div>
      ) : (
        <ol className="relative space-y-4 border-l border-border pl-6">
          {items.map((item) => {
            if (item.kind === "interview") {
              const r = item.data;
              return (
                <li key={`r-${r.id}`} className="relative">
                  <span className="absolute -left-[31px] grid h-6 w-6 place-items-center rounded-full border border-border bg-surface text-[var(--accent)]">
                    <Mic size={13} />
                  </span>
                  <Link
                    href={`/interview-prep/${r.id}`}
                    className="block rounded-lg border border-border bg-surface px-4 py-3 shadow-sm transition hover:border-[var(--accent)]/40"
                  >
                    <p className="text-sm font-medium text-ink">
                      Interview: {r.title}
                    </p>
                    <p className="mt-1 text-xs text-muted">
                      {r.status === "complete" ? "Summary ready" : r.status} ·{" "}
                      {new Date(r.created_at).toLocaleString()}
                    </p>
                  </Link>
                </li>
              );
            }
            const a = item.data;
            const Icon = ICONS[a.type] || StickyNote;
            return (
              <li key={a.id} className="relative">
                <span className="absolute -left-[31px] grid h-6 w-6 place-items-center rounded-full border border-border bg-surface text-[var(--accent)]">
                  <Icon size={13} />
                </span>
                <div className="group rounded-lg border border-border bg-surface px-4 py-3 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      {TYPE_LABEL[a.type] && (
                        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--accent)]">
                          {TYPE_LABEL[a.type]}
                        </p>
                      )}
                      {a.body && (
                        <p className="whitespace-pre-wrap text-sm text-ink">{a.body}</p>
                      )}
                    </div>
                    {canEdit && (
                      <button
                        onClick={() => remove(a.id)}
                        className="shrink-0 text-muted opacity-0 transition hover:text-status-error group-hover:opacity-100"
                        title="Delete"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {new Date(actWhen(a)).toLocaleString()}
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
