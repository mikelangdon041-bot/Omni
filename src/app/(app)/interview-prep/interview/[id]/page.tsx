"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  CalendarClock,
  UserPlus,
  Sparkles,
  ChevronUp,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  Trash2,
  Check,
  Play,
} from "lucide-react";
import { BackButton } from "@/components/BackButton";
import { createClient } from "@/lib/supabase/client";
import {
  useInterview,
  useCandidate,
  useCandidateQuestions,
  useQuestionBank,
  useInterviewRecordings,
  useUserId,
} from "@/lib/interview/hooks";
import {
  INTERVIEW_STATUS_LABELS,
  INTERVIEW_STAGE_LABELS,
  candidateName,
  type Interview,
  type InterviewStatus,
} from "@/lib/interview/types";
import { cn } from "@/lib/ui";
import { Button } from "@/components/ui/Button";
import { RichText } from "@/components/ui/RichText";
import { SuggestQuestionsModal } from "@/components/interview/SuggestQuestionsModal";
import { AssignInterviewModal } from "@/components/interview/AssignInterviewModal";
import { RecordingPanel } from "@/components/interview/RecordingPanel";
import { NewRecording } from "@/app/(app)/interview-prep/NewRecording";

const supabase = createClient();
const STATUSES: InterviewStatus[] = ["scheduled", "in_progress", "complete", "canceled"];
const Q_OPEN_KEY = "omni_iv_questions_open";

export default function InterviewWorkspacePage() {
  const params = useParams<{ id: string }>();
  const { userId } = useUserId();
  const { interview, loading, update } = useInterview(params.id);
  const { candidate } = useCandidate(interview?.candidate_id || "");
  const recordings = useInterviewRecordings(params.id);
  const [interviewer, setInterviewer] = useState("");
  const [qOpen, setQOpen] = useState(true);

  // Restore the questions panel open/closed preference.
  useEffect(() => {
    const v = localStorage.getItem(Q_OPEN_KEY);
    if (v !== null) setQOpen(v === "1");
  }, []);
  function toggleQ() {
    setQOpen((v) => {
      localStorage.setItem(Q_OPEN_KEY, v ? "0" : "1");
      return !v;
    });
  }

  // Interviewer name for the default recording title.
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const m = data.user?.user_metadata as { display_name?: string; username?: string } | undefined;
      setInterviewer(m?.display_name || m?.username || "Interviewer");
    });
  }, []);

  if (loading) {
    return <p className="py-12 text-center text-sm text-muted">Loading…</p>;
  }
  if (!interview) {
    return (
      <div className="py-12 text-center">
        <p className="text-sm text-muted">Interview not found.</p>
        <Link href="/interview-prep" className="mt-2 inline-block text-sm text-[var(--accent)]">
          ← Back to Interview Prep
        </Link>
      </div>
    );
  }

  const cName = candidate ? candidateName(candidate) : "";
  const defaultTitle = `${cName || "Candidate"} | ${interviewer} · ${new Date().toLocaleDateString()}`;

  return (
    <>
      <BackButton />
      <Header
        interview={interview}
        update={update}
        candidateNameStr={cName}
        candidateRole={candidate?.role_title || ""}
        candidateId={interview.candidate_id}
        defaultTitle={defaultTitle}
        onUploaded={() => recordings.refresh()}
      />

      <div className={cn("grid grid-cols-1 gap-5", qOpen && "lg:grid-cols-[1.6fr_1fr]")}>
        <div className="space-y-5">
          <NotesCard interview={interview} update={update} />
          <NextStepsCard interview={interview} update={update} />
          {/* Recordings render inline — no separate page. */}
          {recordings.recordings.map((r) => (
            <RecordingPanel
              key={r.id}
              recordingId={r.id}
              embedded
              onDeleted={() => recordings.refresh()}
            />
          ))}
        </div>

        {qOpen ? (
          <div className="space-y-5">
            <QuestionsCard
              candidateId={interview.candidate_id}
              interviewId={interview.id}
              userId={userId}
              onCollapse={toggleQ}
            />
          </div>
        ) : (
          <button
            onClick={toggleQ}
            className="fixed bottom-6 right-6 z-20 inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-4 py-2.5 text-sm font-medium shadow-lg transition hover:border-[var(--accent)]"
          >
            <ChevronLeft size={15} /> Questions
          </button>
        )}
      </div>
    </>
  );
}

// ---- Header --------------------------------------------------------
function Header({
  interview,
  update,
  candidateNameStr,
  candidateRole,
  candidateId,
  defaultTitle,
  onUploaded,
}: {
  interview: Interview;
  update: (p: Partial<Interview>) => Promise<void>;
  candidateNameStr: string;
  candidateRole: string;
  candidateId: string;
  defaultTitle: string;
  onUploaded: () => void;
}) {
  const [assignOpen, setAssignOpen] = useState(false);
  const [title, setTitle] = useState(interview.title);
  const scheduled = interview.scheduled_at
    ? new Date(interview.scheduled_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
    : "Not scheduled";

  return (
    <div className="mb-5 rounded-xl border border-border bg-surface p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/interview-prep/candidate/${candidateId}`}
            className="text-sm font-medium text-[var(--accent)] hover:underline"
          >
            {candidateNameStr || "Candidate"}
          </Link>
          {candidateRole && <span className="text-sm text-muted"> · {candidateRole}</span>}
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => title !== interview.title && update({ title: title.trim() || "Interview" })}
            className="mt-1 block w-full max-w-lg rounded-md border border-transparent bg-transparent text-xl font-semibold tracking-tight outline-none hover:border-border focus:border-[var(--accent)]"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted">
            <span className="inline-flex items-center gap-1.5">
              <CalendarClock size={14} /> {scheduled}
            </span>
            <span>· {INTERVIEW_STAGE_LABELS[interview.stage] || "Interview"}</span>
          </div>
        </div>

        {/* Actions — visually distinct: status (select), Start (filled),
            Upload (outline), Assign (ghost) so nothing looks the same. */}
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={interview.status}
            onChange={(e) => update({ status: e.target.value as InterviewStatus })}
            className="rounded-lg border border-border bg-canvas px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {INTERVIEW_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          {interview.status === "scheduled" && (
            <button
              onClick={() => update({ status: "in_progress" })}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
            >
              <Play size={14} /> Start
            </button>
          )}
          <NewRecording
            candidateId={candidateId}
            interviewId={interview.id}
            defaultTitle={defaultTitle}
            onUploaded={onUploaded}
            compact
          />
          <button
            onClick={() => setAssignOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-muted transition hover:bg-canvas hover:text-ink"
          >
            <UserPlus size={14} /> Assign
          </button>
        </div>
      </div>

      <AssignInterviewModal
        open={assignOpen}
        onClose={() => setAssignOpen(false)}
        interviewId={interview.id}
        currentAssignee={interview.assignee_id}
        onAssigned={(id) => update({ assignee_id: id })}
      />
    </div>
  );
}

// ---- Notes ---------------------------------------------------------
function NotesCard({ interview, update }: { interview: Interview; update: (p: Partial<Interview>) => Promise<void> }) {
  const [html, setHtml] = useState(interview.notes || "");
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");

  function onChange(next: string) {
    setHtml(next);
    setStatus("saving");
    clearTimeout((onChange as unknown as { t?: ReturnType<typeof setTimeout> }).t);
    (onChange as unknown as { t?: ReturnType<typeof setTimeout> }).t = setTimeout(async () => {
      await update({ notes: next });
      setStatus("saved");
    }, 800);
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">Interview notes</h3>
        {status !== "idle" && (
          <span className="text-xs text-muted">{status === "saving" ? "Saving…" : "Saved"}</span>
        )}
      </div>
      <RichText value={html} onChange={onChange} minHeight="min-h-48" placeholder="Notes as you go — saves automatically…" />
    </div>
  );
}

// ---- Next steps ----------------------------------------------------
function NextStepsCard({ interview, update }: { interview: Interview; update: (p: Partial<Interview>) => Promise<void> }) {
  const [next, setNext] = useState(interview.next_steps || "");
  const followUp = interview.follow_up_at ? interview.follow_up_at.slice(0, 10) : "";

  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Next steps &amp; follow-up</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_12rem]">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted">Next step</span>
          <input
            value={next}
            onChange={(e) => setNext(e.target.value)}
            onBlur={() => next !== interview.next_steps && update({ next_steps: next })}
            placeholder="e.g. Move to onsite, send take-home…"
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-muted">Follow-up by</span>
          <input
            type="date"
            value={followUp}
            onChange={(e) => update({ follow_up_at: e.target.value ? new Date(e.target.value).toISOString() : null })}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
          />
        </label>
      </div>
    </div>
  );
}

// ---- Questions -----------------------------------------------------
function QuestionsCard({
  candidateId,
  interviewId,
  userId,
  onCollapse,
}: {
  candidateId: string;
  interviewId: string;
  userId: string | null;
  onCollapse: () => void;
}) {
  const { questions, addMany, update, remove, move } = useCandidateQuestions(candidateId, interviewId);
  const bank = useQuestionBank(userId);
  const [addOpen, setAddOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-sm lg:sticky lg:top-20">
      <div className="mb-3 flex items-center justify-between">
        <button onClick={onCollapse} className="inline-flex items-center gap-1 text-sm font-semibold uppercase tracking-wide text-muted transition hover:text-ink" title="Collapse">
          <ChevronRight size={15} /> Questions
        </button>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Sparkles size={14} /> Add
        </Button>
      </div>

      {questions.length === 0 ? (
        <p className="text-sm text-muted">
          No questions yet. Add your own, pull from your bank, or generate with AI —
          then reorder and take answer notes here during the interview.
        </p>
      ) : (
        <ul className="space-y-2">
          {questions.map((q, i) => (
            <li key={q.id} className="rounded-lg border border-border">
              <div className="flex items-start gap-2 p-2.5">
                <div className="flex flex-col">
                  <button onClick={() => move(q.id, -1)} disabled={i === 0} className="text-muted transition hover:text-ink disabled:opacity-30" title="Move up">
                    <ChevronUp size={14} />
                  </button>
                  <button onClick={() => move(q.id, 1)} disabled={i === questions.length - 1} className="text-muted transition hover:text-ink disabled:opacity-30" title="Move down">
                    <ChevronDown size={14} />
                  </button>
                </div>
                <button
                  onClick={() => update(q.id, { asked: !q.asked })}
                  className={cn("mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded border transition", q.asked ? "border-[var(--accent)] bg-[var(--accent)] text-white" : "border-border")}
                  title={q.asked ? "Asked" : "Mark asked"}
                >
                  {q.asked && <Check size={13} />}
                </button>
                <button onClick={() => setExpanded(expanded === q.id ? null : q.id)} className={cn("flex-1 text-left text-sm", q.asked && "text-muted line-through")}>
                  {q.text}
                </button>
                <button onClick={() => remove(q.id)} className="text-muted transition hover:text-status-error" title="Remove">
                  <Trash2 size={14} />
                </button>
              </div>
              {expanded === q.id && (
                <div className="border-t border-border p-2.5">
                  <AnswerNotes initial={q.answer_notes} onSave={(html) => update(q.id, { answer_notes: html })} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <SuggestQuestionsModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        candidateId={candidateId}
        hasResume
        bankItems={bank.items}
        onAddToInterview={(texts) => addMany(texts.map((t) => ({ text: t, source: "ai" })))}
        onAddToBank={(texts) => Promise.all(texts.map((t) => bank.add({ text: t, source: "ai" })))}
      />
    </div>
  );
}

function AnswerNotes({ initial, onSave }: { initial: string; onSave: (html: string) => void }) {
  const [html, setHtml] = useState(initial || "");
  function onChange(next: string) {
    setHtml(next);
    clearTimeout((onChange as unknown as { t?: ReturnType<typeof setTimeout> }).t);
    (onChange as unknown as { t?: ReturnType<typeof setTimeout> }).t = setTimeout(() => onSave(next), 700);
  }
  return (
    <>
      <p className="mb-1 text-xs font-medium text-muted">Answer notes</p>
      <RichText value={html} onChange={onChange} minHeight="min-h-20" placeholder="What did they say?" />
    </>
  );
}
