"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Mail, Phone, MapPin, Pencil } from "lucide-react";
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
import { Input, Textarea } from "@/components/ui/Input";
import { CandidateRecordings } from "@/components/interview/CandidateRecordings";
import { QuestionsTab } from "@/components/interview/QuestionsTab";
import { ActivityTab } from "@/components/interview/ActivityTab";
import { ResumeCard } from "@/components/interview/ResumeCard";

const TABS = ["Overview", "Activity", "Interviews", "Questions"] as const;
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
      <Link
        href="/interview-prep"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink"
      >
        <ArrowLeft size={15} /> Interview Prep
      </Link>

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
        />
      )}
      {tab === "Interviews" && <CandidateRecordings candidateId={candidate.id} />}
      {tab === "Questions" && (
        <QuestionsTab candidate={candidate} userId={userId} />
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
  return (
    <div className="mb-6 flex items-start gap-4 rounded-xl border border-border bg-surface p-5 shadow-sm">
      <Avatar initials={candidateInitials(candidate)} size={60} />
      <div className="min-w-0 flex-1">
        <h1 className="text-xl font-semibold tracking-tight">
          {candidateName(candidate)}
        </h1>
        {candidate.role_title && (
          <p className="text-sm text-muted">{candidate.role_title}</p>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {canEdit ? (
            <select
              value={candidate.status}
              onChange={(e) =>
                update({ status: e.target.value as CandidateStatus })
              }
              className={cn(
                "rounded-full border-0 px-2.5 py-1 text-xs font-medium outline-none",
                STATUS_COLORS[candidate.status],
              )}
            >
              {CANDIDATE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          ) : (
            <span
              className={cn(
                "rounded-full px-2.5 py-1 text-xs font-medium",
                STATUS_COLORS[candidate.status],
              )}
            >
              {STATUS_LABELS[candidate.status]}
            </span>
          )}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {candidate.email && (
            <a href={`mailto:${candidate.email}`}>
              <Button variant="secondary" size="sm">
                <Mail size={14} /> Email
              </Button>
            </a>
          )}
          {candidate.phone && (
            <a href={`tel:${candidate.phone}`}>
              <Button variant="secondary" size="sm">
                <Phone size={14} /> Call
              </Button>
            </a>
          )}
          {candidate.location && (
            <span className="inline-flex items-center gap-1.5 text-sm text-muted">
              <MapPin size={14} /> {candidate.location}
            </span>
          )}
        </div>
      </div>
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
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Partial<Candidate>>({});
  const [saving, setSaving] = useState(false);

  const val = (k: keyof Candidate) => (draft[k] ?? candidate[k] ?? "") as string;

  async function save() {
    setSaving(true);
    await update(draft);
    setSaving(false);
    setEditing(false);
    setDraft({});
  }

  return (
    <div className="space-y-5">
      {canEdit && (
        <div className="flex justify-end">
          {editing ? (
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setEditing(false);
                  setDraft({});
                }}
              >
                Cancel
              </Button>
              <Button size="sm" onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          ) : (
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              <Pencil size={14} /> Edit
            </Button>
          )}
        </div>
      )}

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

      <div className="rounded-xl border border-border bg-surface p-5 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted">
          Details
        </h3>
        {editing ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label="Role / position" value={val("role_title")} onChange={(e) => setDraft((d) => ({ ...d, role_title: e.target.value }))} />
            <Input label="Email" value={val("email")} onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))} />
            <Input label="Phone" value={val("phone")} onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))} />
            <Input label="Location" value={val("location")} onChange={(e) => setDraft((d) => ({ ...d, location: e.target.value }))} />
          </div>
        ) : (
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Role" value={candidate.role_title} />
            <Field label="Email" value={candidate.email} />
            <Field label="Phone" value={candidate.phone} />
            <Field label="Location" value={candidate.location} />
          </dl>
        )}
      </div>

      <div className="rounded-xl border border-border bg-surface p-5 shadow-sm">
        <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted">
          Notes & summary
        </h3>
        {editing ? (
          <Textarea
            value={val("summary")}
            onChange={(e) => setDraft((d) => ({ ...d, summary: e.target.value }))}
            placeholder="Overall impressions, strengths, concerns…"
            className="min-h-32"
          />
        ) : candidate.summary ? (
          <p className="whitespace-pre-wrap text-sm text-ink">{candidate.summary}</p>
        ) : (
          <p className="text-sm text-muted">No notes yet.</p>
        )}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-sm text-ink">{value}</dd>
    </div>
  );
}
