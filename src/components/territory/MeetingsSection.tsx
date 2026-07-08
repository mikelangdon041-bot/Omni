"use client";

import { Trash2, CalendarDays } from "lucide-react";
import { useMeetingFlow } from "@/lib/territory/meetingFlow";
import { METHOD_LABELS } from "@/lib/territory/utils";
import { MeetingCompletedBanner } from "@/components/territory/MeetingCompletedBanner";

export function MeetingsSection({
  kolId,
  userId,
}: {
  kolId: string;
  userId: string | null;
}) {
  const { meetingsApi, scheduledActivity, meetingNumber, completeMeeting } =
    useMeetingFlow(kolId, userId);
  const { meetings, loading, remove } = meetingsApi;

  if (loading) {
    return <p className="py-8 text-center text-sm text-muted">Loading…</p>;
  }

  return (
    <div className="space-y-3">
      {/* Scheduled meeting awaiting completion — same banner as the Activity tab */}
      {scheduledActivity && (
        <MeetingCompletedBanner
          scheduledFor={scheduledActivity.date}
          method={scheduledActivity.outreach_method}
          meetingNumber={meetingNumber}
          onComplete={completeMeeting}
        />
      )}

      {meetings.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-surface px-6 py-12 text-center text-sm text-muted">
          No meetings yet. Log “Meeting scheduled” on the Activity tab — once
          it happens, mark it completed here or there.
        </div>
      ) : (
        meetings.map((m) => (
          <div
            key={m.id}
            className="rounded-xl border border-border bg-surface p-5 shadow-sm"
          >
            <div className="mb-2 flex items-center justify-between">
              <h3 className="flex items-center gap-2 font-semibold">
                <CalendarDays size={16} className="text-[var(--accent)]" />
                Meeting #{m.meeting_number}
              </h3>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted">
                  {new Date(m.date).toLocaleDateString()}
                  {m.meeting_method && ` · ${METHOD_LABELS[m.meeting_method] || m.meeting_method}`}
                </span>
                <button
                  onClick={() => remove(m.id)}
                  className="text-muted transition hover:text-status-error"
                  title="Delete meeting"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>

            {m.topics_discussed && (
              <Field label="Discussed" value={m.topics_discussed} />
            )}
            {m.topics_missed && (
              <Field label="To revisit" value={m.topics_missed} />
            )}
            {m.follow_up_actions && (
              <Field label="Follow-up actions" value={m.follow_up_actions} />
            )}
          </div>
        ))
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">
        {label}
      </p>
      <p className="whitespace-pre-wrap text-sm text-ink/90">{value}</p>
    </div>
  );
}
