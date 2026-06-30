"use client";

import { useEffect, useState } from "react";
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
  CalendarClock,
  ShieldCheck,
  Plus,
  ArrowLeft,
  Clock,
} from "lucide-react";
import type { CandidateActivity } from "@/lib/interview/types";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useConfirm } from "@/components/ui/Feedback";

interface InterviewItem {
  id: string;
  title: string;
  status: string;
  created_at: string;
}

const ADD_TYPES: {
  type: string;
  label: string;
  icon: React.ElementType;
  interview?: boolean;
}[] = [
  { type: "note", label: "Note", icon: StickyNote },
  { type: "call", label: "Call", icon: Phone },
  { type: "email", label: "Email", icon: Mail },
  { type: "meeting", label: "Meeting", icon: CalendarClock },
  { type: "phone_screen", label: "Phone screen", icon: Headphones, interview: true },
  { type: "interview", label: "Interview", icon: Users, interview: true },
  { type: "reference_check", label: "Reference check", icon: ShieldCheck },
];

const ICONS: Record<string, React.ElementType> = {
  note: StickyNote,
  call: Phone,
  email: Mail,
  meeting: CalendarClock,
  phone_screen: Headphones,
  interview: Users,
  reference_check: ShieldCheck,
  status_change: ArrowRightLeft,
  recording: Mic,
  question_asked: MessageCircleQuestion,
  share: Share2,
};

const TYPE_LABEL: Record<string, string> = Object.fromEntries(
  ADD_TYPES.map((t) => [t.type, t.label]),
);
const isInterviewType = (t: string) =>
  t === "interview" || t === "phone_screen";

const CHANNELS = ["In person", "Video", "Phone", "Email", "Other"];

interface Meta {
  occurred_at?: string;
  duration_min?: number;
  channel?: string;
  participants?: string[];
}
const metaOf = (a: CandidateActivity): Meta => (a.meta as Meta) || {};
const whenOf = (a: CandidateActivity) => metaOf(a).occurred_at || a.created_at;

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
  const confirm = useConfirm();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const [detail, setDetail] = useState<CandidateActivity | null>(null);
  const [members, setMembers] = useState<{ username: string; display_name: string | null }[]>([]);

  // form fields
  const [when, setWhen] = useState(() => new Date().toISOString().slice(0, 16));
  const [duration, setDuration] = useState("");
  const [channel, setChannel] = useState("");
  const [participants, setParticipants] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/org/members", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : { members: [] }))
      .then((d) => setMembers(d.members || []))
      .catch(() => {});
  }, []);

  const items: Item[] = [
    ...activity.map((a) => ({ kind: "activity" as const, at: whenOf(a), data: a })),
    ...interviews.map((r) => ({ kind: "interview" as const, at: r.created_at, data: r })),
  ].sort((a, b) => +new Date(b.at) - +new Date(a.at));

  function openForm(type: string) {
    setChosen(type);
    setWhen(new Date().toISOString().slice(0, 16));
    setDuration("");
    setChannel(type === "email" ? "Email" : "");
    setParticipants(new Set());
    setNotes("");
  }

  async function save() {
    if (!chosen) return;
    setSaving(true);
    const meta: Meta = {
      occurred_at: new Date(when).toISOString(),
      ...(duration ? { duration_min: Number(duration) } : {}),
      ...(channel ? { channel } : {}),
      ...(participants.size ? { participants: [...participants] } : {}),
    };
    await log(chosen, notes.trim(), userId, meta as Record<string, unknown>);
    setSaving(false);
    setChosen(null);
    setPickerOpen(false);
  }

  return (
    <div className="space-y-5">
      {canEdit && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted">
            Calls, screens, interviews, notes — the full history with this candidate.
          </p>
          <Button onClick={() => { setChosen(null); setPickerOpen(true); }}>
            <Plus size={16} /> Add activity
          </Button>
        </div>
      )}

      {/* Add-activity modal */}
      <Modal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title={chosen ? `Log: ${TYPE_LABEL[chosen]}` : "Add activity"}
      >
        {chosen ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="When">
                <input
                  type="datetime-local"
                  value={when}
                  onChange={(e) => setWhen(e.target.value)}
                  className={inputCls}
                />
              </Field>
              <Field label="Duration (min)">
                <input
                  type="number"
                  min={0}
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  placeholder="e.g. 30"
                  className={inputCls}
                />
              </Field>
              <Field label="Channel">
                <select value={channel} onChange={(e) => setChannel(e.target.value)} className={inputCls}>
                  <option value="">—</option>
                  {CHANNELS.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </Field>
              <Field label="Who was involved">
                <ParticipantPicker
                  members={members}
                  selected={participants}
                  onToggle={(u) =>
                    setParticipants((prev) => {
                      const n = new Set(prev);
                      if (n.has(u)) n.delete(u);
                      else n.add(u);
                      return n;
                    })
                  }
                />
              </Field>
            </div>
            <Field label="Notes">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="What happened? Outcome, next steps…"
                className={`${inputCls} min-h-24 resize-y`}
              />
            </Field>
            {isInterviewType(chosen) && (
              <p className="rounded-lg bg-[var(--accent-soft)] px-3 py-2 text-xs text-muted">
                Logging the basics here. To write up the interview or attach a
                recording, open it from the timeline or the Interviews tab.
              </p>
            )}
            <div className="flex justify-between border-t border-border pt-4">
              <Button variant="secondary" onClick={() => setChosen(null)}>
                <ArrowLeft size={14} /> Back
              </Button>
              <Button onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Log activity"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {ADD_TYPES.map((t) => (
              <button
                key={t.type}
                onClick={() => openForm(t.type)}
                className="flex flex-col items-center gap-2 rounded-xl border border-border p-4 text-sm font-medium transition hover:border-[var(--accent)] hover:bg-[var(--accent-soft)]"
              >
                <t.icon size={20} className="text-[var(--accent)]" />
                {t.label}
              </button>
            ))}
          </div>
        )}
      </Modal>

      {/* Detail modal */}
      <Modal
        open={!!detail}
        onClose={() => setDetail(null)}
        title={detail ? TYPE_LABEL[detail.type] || "Activity" : ""}
        size="sm"
      >
        {detail && (
          <div className="space-y-3 text-sm">
            <DetailRow label="When" value={new Date(whenOf(detail)).toLocaleString()} />
            {metaOf(detail).duration_min != null && (
              <DetailRow label="Duration" value={`${metaOf(detail).duration_min} min`} />
            )}
            {metaOf(detail).channel && (
              <DetailRow label="Channel" value={metaOf(detail).channel!} />
            )}
            {(metaOf(detail).participants?.length ?? 0) > 0 && (
              <DetailRow label="Involved" value={metaOf(detail).participants!.map((p) => `@${p}`).join(", ")} />
            )}
            {detail.body && (
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted">Notes</p>
                <p className="whitespace-pre-wrap text-ink">{detail.body}</p>
              </div>
            )}
            <div className="flex items-center justify-between border-t border-border pt-3">
              {canEdit && (
                <button
                  onClick={async () => {
                    if (await confirm({ title: "Delete activity?", danger: true, confirmLabel: "Delete" })) {
                      remove(detail.id);
                      setDetail(null);
                    }
                  }}
                  className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-status-error"
                >
                  <Trash2 size={14} /> Delete
                </button>
              )}
              {isInterviewType(detail.type) && onGoToInterviews && (
                <Button size="sm" onClick={() => { setDetail(null); onGoToInterviews(); }}>
                  Open interview →
                </Button>
              )}
            </div>
          </div>
        )}
      </Modal>

      {loading ? (
        <p className="py-8 text-center text-sm text-muted">Loading…</p>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-surface px-6 py-12 text-center text-sm text-muted">
          No activity yet. Log a call, screen, or note to start the history.
        </div>
      ) : (
        <ol className="relative space-y-3 border-l border-border pl-6">
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
                    <p className="text-sm font-medium text-ink">Recorded interview: {r.title}</p>
                    <p className="mt-1 text-xs text-muted">
                      {r.status === "complete" ? "Summary ready" : r.status} ·{" "}
                      {new Date(r.created_at).toLocaleString()}
                    </p>
                  </Link>
                </li>
              );
            }
            const a = item.data;
            const m = metaOf(a);
            const Icon = ICONS[a.type] || StickyNote;
            return (
              <li key={a.id} className="relative">
                <span className="absolute -left-[31px] grid h-6 w-6 place-items-center rounded-full border border-border bg-surface text-[var(--accent)]">
                  <Icon size={13} />
                </span>
                <button
                  onClick={() => setDetail(a)}
                  className="block w-full rounded-lg border border-border bg-surface px-4 py-3 text-left shadow-sm transition hover:border-[var(--accent)]/40"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">
                      {TYPE_LABEL[a.type] || a.type}
                    </span>
                    <span className="text-xs text-muted">
                      {new Date(whenOf(a)).toLocaleDateString()}
                    </span>
                  </div>
                  {a.body && (
                    <p className="mt-1 line-clamp-2 text-sm text-ink/90">{a.body}</p>
                  )}
                  <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted">
                    {m.duration_min != null && (
                      <span className="inline-flex items-center gap-1">
                        <Clock size={11} /> {m.duration_min}m
                      </span>
                    )}
                    {m.channel && <span>{m.channel}</span>}
                    {(m.participants?.length ?? 0) > 0 && (
                      <span>{m.participants!.length} involved</span>
                    )}
                  </div>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-[var(--accent)]";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted">{label}</span>
      <span className="text-right text-ink">{value}</span>
    </div>
  );
}

function ParticipantPicker({
  members,
  selected,
  onToggle,
}: {
  members: { username: string; display_name: string | null }[];
  selected: Set<string>;
  onToggle: (u: string) => void;
}) {
  const [q, setQ] = useState("");
  const filtered = members.filter(
    (m) =>
      m.username.includes(q.toLowerCase()) ||
      (m.display_name || "").toLowerCase().includes(q.toLowerCase()),
  );
  if (members.length === 0) {
    return <p className="text-xs text-muted">Add teammates in Admin to tag them.</p>;
  }
  return (
    <div className="rounded-lg border border-border">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search teammates…"
        className="w-full border-b border-border bg-surface px-2 py-1.5 text-xs outline-none"
      />
      <div className="max-h-28 space-y-0.5 overflow-y-auto p-1">
        {filtered.map((m) => (
          <button
            key={m.username}
            onClick={() => onToggle(m.username)}
            className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs transition ${
              selected.has(m.username) ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "hover:bg-canvas"
            }`}
          >
            <span className="grid h-4 w-4 place-items-center rounded border border-border">
              {selected.has(m.username) && <span className="h-2 w-2 rounded-sm bg-[var(--accent)]" />}
            </span>
            {m.display_name || m.username}
          </button>
        ))}
      </div>
    </div>
  );
}
