"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  CalendarClock,
  Plus,
  Mic,
  StickyNote,
  ListChecks,
  User,
  PencilLine,
} from "lucide-react";
import {
  useInterviews,
  useCandidateRecordings,
  useInterviewNotes,
} from "@/lib/interview/hooks";
import {
  INTERVIEW_STAGES,
  INTERVIEW_STAGE_LABELS,
  INTERVIEW_STATUS_LABELS,
  INTERVIEW_STATUS_COLORS,
  type Interview,
  type InterviewNote,
} from "@/lib/interview/types";
import { cn } from "@/lib/ui";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input, Select } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { StatusChip } from "@/components/ui/StatusChip";
import { InterviewNotesEditor } from "@/components/interview/InterviewNotesEditor";

export function InterviewsTab({
  candidateId,
  userId,
}: {
  candidateId: string;
  userId: string | null;
}) {
  const { interviews, loading, add } = useInterviews(candidateId);
  const recordings = useCandidateRecordings(candidateId);
  const written = useInterviewNotes(candidateId, userId);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [openNote, setOpenNote] = useState<InterviewNote | null>(null);

  // Recordings not attached to any interview (legacy / ad-hoc uploads).
  const looseRecordings = recordings.recordings;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">
            Interviews
          </h3>
          <p className="text-sm text-muted">
            Schedule an interview, assign it to someone, then open it to run it live.
          </p>
        </div>
        <Button onClick={() => setScheduleOpen(true)}>
          <Plus size={16} /> Schedule interview
        </Button>
      </div>

      {loading ? (
        <p className="py-6 text-center text-sm text-muted">Loading…</p>
      ) : interviews.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-surface px-6 py-10 text-center text-sm text-muted">
          No interviews scheduled yet. Schedule one to plan questions, assign an
          interviewer, and take notes live.
        </div>
      ) : (
        <ul className="space-y-2">
          {interviews.map((iv) => (
            <li key={iv.id}>
              <Link
                href={`/interview-prep/interview/${iv.id}`}
                className="block rounded-xl border border-border bg-surface px-4 py-3 shadow-sm transition hover:border-[var(--accent)]/40"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{iv.title}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                      <span>{INTERVIEW_STAGE_LABELS[iv.stage] || "Interview"}</span>
                      {iv.scheduled_at && (
                        <span className="inline-flex items-center gap-1">
                          <CalendarClock size={12} />
                          {new Date(iv.scheduled_at).toLocaleString([], {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}
                        </span>
                      )}
                      {iv.assignee_id && (
                        <span className="inline-flex items-center gap-1">
                          <User size={12} /> Assigned
                        </span>
                      )}
                    </div>
                  </div>
                  <Badge className={INTERVIEW_STATUS_COLORS[iv.status]}>
                    {INTERVIEW_STATUS_LABELS[iv.status]}
                  </Badge>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {/* Standalone recordings (not tied to a scheduled interview) */}
      {looseRecordings.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-muted">Recordings</h3>
          <ul className="space-y-2">
            {looseRecordings.map((r) => (
              <li key={r.id} className="flex items-center gap-2">
                <Link
                  href={`/interview-prep/${r.id}`}
                  className="flex flex-1 items-center justify-between gap-4 rounded-xl border border-border bg-surface px-4 py-3 shadow-sm transition hover:border-[var(--accent)]/40"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Mic size={15} className="shrink-0 text-[var(--accent)]" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{r.title}</span>
                      <span className="text-xs text-muted">
                        {new Date(r.created_at).toLocaleString()}
                      </span>
                    </span>
                  </span>
                  <StatusChip status={r.status} />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Written notes */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-muted">Written notes</h3>
          <Button
            variant="secondary"
            size="sm"
            onClick={async () => {
              const n = await written.add();
              if (n) setOpenNote(n);
            }}
          >
            <PencilLine size={14} /> New note
          </Button>
        </div>
        {written.notes.length === 0 ? (
          <p className="text-sm text-muted">No written notes yet.</p>
        ) : (
          <ul className="space-y-2">
            {written.notes.map((n) => (
              <li key={n.id}>
                <button
                  onClick={() => setOpenNote(n)}
                  className="flex w-full items-center justify-between gap-4 rounded-xl border border-border bg-surface px-4 py-3 text-left shadow-sm transition hover:border-[var(--accent)]/40"
                >
                  <span className="flex items-center gap-2">
                    <StickyNote size={15} className="text-[var(--accent)]" />
                    <span className="font-medium">{n.title}</span>
                  </span>
                  <span className="text-xs text-muted">
                    {new Date(n.updated_at).toLocaleDateString()}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ScheduleModal
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        onCreate={async (draft, assigneeId) => {
          const created = await add(draft, userId);
          if (created && assigneeId) {
            await fetch("/api/interview/assign", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "same-origin",
              body: JSON.stringify({ interviewId: created.id, mode: "existing", assigneeId }),
            });
          }
          setScheduleOpen(false);
        }}
      />

      {openNote && (
        <InterviewNotesEditor
          open
          onClose={() => setOpenNote(null)}
          note={openNote}
          candidateId={candidateId}
          userId={userId}
          update={written.update}
          remove={written.remove}
        />
      )}
    </div>
  );
}

// ---- Schedule modal ------------------------------------------------
interface Member {
  id: string;
  username: string;
  display_name: string | null;
}

function ScheduleModal({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (draft: Partial<Interview>, assigneeId: string) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [stage, setStage] = useState("interview");
  const [when, setWhen] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    fetch("/api/org/members", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : { members: [] }))
      .then((d) => setMembers(d.members || []))
      .catch(() => {});
  }, [open]);

  async function submit() {
    setBusy(true);
    await onCreate(
      {
        title: title.trim() || INTERVIEW_STAGE_LABELS[stage] || "Interview",
        stage,
        scheduled_at: when ? new Date(when).toISOString() : null,
        status: "scheduled",
      },
      assigneeId,
    );
    setBusy(false);
    setTitle("");
    setWhen("");
    setAssigneeId("");
  }

  return (
    <Modal open={open} onClose={onClose} title="Schedule an interview">
      <div className="space-y-4">
        <Input
          label="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Hiring manager screen"
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select label="Stage" value={stage} onChange={(e) => setStage(e.target.value)}>
            {INTERVIEW_STAGES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-ink">When</span>
            <input
              type="datetime-local"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)]"
            />
          </label>
        </div>
        <Select
          label="Assign to (optional)"
          value={assigneeId}
          onChange={(e) => setAssigneeId(e.target.value)}
        >
          <option value="">Unassigned — assign later</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.display_name || m.username} (@{m.username})
            </option>
          ))}
        </Select>
        <div className="flex items-center justify-between border-t border-border pt-4">
          <span className="inline-flex items-center gap-1.5 text-xs text-muted">
            <ListChecks size={13} /> You can add questions after creating it.
          </span>
          <Button onClick={submit} disabled={busy}>
            {busy ? "Creating…" : "Create interview"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
