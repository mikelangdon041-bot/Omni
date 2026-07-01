"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Mail, Phone, MapPin, Pencil } from "lucide-react";
import { BackButton } from "@/components/BackButton";
import {
  useCandidate,
  useCandidateActivity,
  useCandidateRecordings,
  useUserId,
} from "@/lib/interview/hooks";
import {
  CANDIDATE_STATUSES,
  STATUS_COLORS,
  STATUS_LABELS,
  candidateInitials,
  candidateName,
  type Candidate,
  type CandidateStatus,
} from "@/lib/interview/types";
import { cn } from "@/lib/ui";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Tabs } from "@/components/ui/Tabs";
import { Input } from "@/components/ui/Input";
import { AutoRichField } from "@/components/ui/AutoRichField";
import { InterviewsTab } from "@/components/interview/InterviewsTab";
import { QuestionsTab } from "@/components/interview/QuestionsTab";
import { ActivityTab } from "@/components/interview/ActivityTab";
import { ResumeCard } from "@/components/interview/ResumeCard";
import { ScorecardTab } from "@/components/interview/ScorecardTab";

const TABS = ["Overview", "Activity", "Interviews", "Questions", "Scorecard"] as const;
type Tab = (typeof TABS)[number];

export default function CandidateDetailPage() {
  const params = useParams<{ id: string }>();
  const { userId } = useUserId();
  const { candidate, loading, update } = useCandidate(params.id);
  const activity = useCandidateActivity(params.id);
  const recordings = useCandidateRecordings(params.id);
  const [tab, setTab] = useState<Tab>("Overview");

  const canEdit = !!candidate && candidate.user_id === userId;

  // Update a field, and log status changes to the activity timeline.
  async function updateAndLog(partial: Partial<Candidate>) {
    if (partial.status && candidate && partial.status !== candidate.status) {
      await activity.log(
        "status_change",
        `Status changed to "${STATUS_LABELS[partial.status]}".`,
        userId,
        { status: partial.status },
      );
    }
    await update(partial);
  }

  if (loading) {
    return <p className="py-12 text-center text-sm text-muted">Loading…</p>;
  }
  if (!candidate) {
    return (
      <div className="py-12 text-center">
        <p className="text-sm text-muted">Candidate not found.</p>
        <Link href="/interview-prep" className="mt-2 inline-block text-sm text-[var(--accent)]">
          ← Back to Interview Prep
        </Link>
      </div>
    );
  }

  return (
    <>
      <BackButton />

      <Header candidate={candidate} update={updateAndLog} canEdit={canEdit} />

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {tab === "Overview" && (
        <Overview
          candidate={candidate}
          update={update}
          canEdit={canEdit}
          userId={userId}
        />
      )}
      {tab === "Activity" && (
        <ActivityTab
          activity={activity.activity}
          interviews={recordings.recordings}
          loading={activity.loading}
          userId={userId}
          canEdit={canEdit}
          log={activity.log}
          remove={activity.remove}
          onGoToInterviews={() => setTab("Interviews")}
        />
      )}
      {tab === "Interviews" && (
        <InterviewsTab candidateId={candidate.id} userId={userId} />
      )}
      {tab === "Questions" && (
        <QuestionsTab candidate={candidate} userId={userId} />
      )}
      {tab === "Scorecard" && (
        <ScorecardTab
          candidateId={candidate.id}
          userId={userId}
          isOwner={canEdit}
        />
      )}
    </>
  );
}

function Header({
  candidate,
  update,
  canEdit,
}: {
  candidate: Candidate;
  update: (p: Partial<Candidate>) => Promise<void>;
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Partial<Candidate>>({});
  const [saving, setSaving] = useState(false);
  const v = (k: keyof Candidate) => (draft[k] ?? candidate[k] ?? "") as string;
  const set = (k: keyof Candidate, val: string) =>
    setDraft((d) => ({ ...d, [k]: val }));

  async function save() {
    setSaving(true);
    await update(draft);
    setSaving(false);
    setEditing(false);
    setDraft({});
  }

  if (editing) {
    return (
      <div className="mb-6 rounded-xl border border-border bg-surface p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
            Edit candidate
          </h2>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => { setEditing(false); setDraft({}); }}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input label="First name" value={v("first_name")} onChange={(e) => set("first_name", e.target.value)} />
          <Input label="Last name" value={v("last_name")} onChange={(e) => set("last_name", e.target.value)} />
          <Input label="Role / position" value={v("role_title")} onChange={(e) => set("role_title", e.target.value)} />
          <Input label="Email" value={v("email")} onChange={(e) => set("email", e.target.value)} />
          <Input label="Phone" value={v("phone")} onChange={(e) => set("phone", e.target.value)} />
          <Input label="Location" value={v("location")} onChange={(e) => set("location", e.target.value)} />
        </div>
      </div>
    );
  }

  return (
    <div className="mb-6 flex items-start gap-4 rounded-xl border border-border bg-surface p-5 shadow-sm">
      <Avatar initials={candidateInitials(candidate)} size={56} />
      <div className="min-w-0 flex-1">
        <h1 className="text-xl font-semibold tracking-tight">{candidateName(candidate)}</h1>
        {candidate.role_title && (
          <p className="text-sm text-muted">{candidate.role_title}</p>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {canEdit ? (
            <select
              value={candidate.status}
              onChange={(e) => update({ status: e.target.value as CandidateStatus })}
              className={cn(
                "rounded-full border-0 px-2.5 py-1 text-xs font-medium outline-none",
                STATUS_COLORS[candidate.status],
              )}
            >
              {CANDIDATE_STATUSES.map((s) => (
                <option key={s} value={s}>{STATUS_LABELS[s]}</option>
              ))}
            </select>
          ) : (
            <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium", STATUS_COLORS[candidate.status])}>
              {STATUS_LABELS[candidate.status]}
            </span>
          )}
          {candidate.location && (
            <span className="inline-flex items-center gap-1.5 text-sm text-muted">
              <MapPin size={14} /> {candidate.location}
            </span>
          )}
          {candidate.email && (
            <a href={`mailto:${candidate.email}`} className="text-muted transition hover:text-[var(--accent)]" title={candidate.email}>
              <Mail size={15} />
            </a>
          )}
          {candidate.phone && (
            <a href={`tel:${candidate.phone}`} className="text-muted transition hover:text-[var(--accent)]" title={candidate.phone}>
              <Phone size={15} />
            </a>
          )}
        </div>
      </div>

      {canEdit && (
        <Button variant="secondary" size="sm" onClick={() => setEditing(true)} className="shrink-0">
          <Pencil size={14} /> Edit
        </Button>
      )}
    </div>
  );
}

function Overview({
  candidate,
  update,
  canEdit,
  userId,
}: {
  candidate: Candidate;
  update: (p: Partial<Candidate>) => Promise<void>;
  canEdit: boolean;
  userId: string | null;
}) {
  return (
    <div className="space-y-5">
      {canEdit ? (
        <ResumeCard candidate={candidate} userId={userId} updateCandidate={update} />
      ) : (
        candidate.resume_text && (
          <div className="rounded-xl border border-border bg-surface p-5 shadow-sm">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
              Resume
            </h3>
            <p className="whitespace-pre-wrap text-sm text-ink/90">
              {candidate.resume_text}
            </p>
          </div>
        )
      )}
      <NotesCard candidate={candidate} update={update} canEdit={canEdit} />
    </div>
  );
}

function NotesCard({
  candidate,
  update,
  canEdit,
}: {
  candidate: Candidate;
  update: (p: Partial<Candidate>) => Promise<void>;
  canEdit: boolean;
}) {
  const fields: { key: keyof Candidate; label: string; placeholder: string }[] = [
    { key: "overall_impressions", label: "Overall impressions", placeholder: "Your overall read on the candidate…" },
    { key: "strengths", label: "Strengths", placeholder: "What stood out positively…" },
    { key: "opportunities", label: "Opportunities", placeholder: "Gaps, risks, areas to probe…" },
  ];
  const hasAny = fields.some((f) => (candidate[f.key] as string)?.trim());
  if (!canEdit && !hasAny) return null;

  return (
    <div className="space-y-5 rounded-xl border border-border bg-surface p-5 shadow-sm">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">
        Notes
      </h3>
      {fields.map((f) => (
        <AutoRichField
          key={f.key}
          label={f.label}
          canEdit={canEdit}
          placeholder={f.placeholder}
          initialHtml={(candidate[f.key] as string) || ""}
          onSave={(html) => update({ [f.key]: html } as Partial<Candidate>)}
        />
      ))}
    </div>
  );
}
