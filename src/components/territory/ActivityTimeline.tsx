"use client";

import { useEffect, useState } from "react";
import { Plus, CheckCircle2 } from "lucide-react";
import { useMeetingFlow } from "@/lib/territory/meetingFlow";
import {
  STATUS_LABELS,
  STEPPER,
  ACTIVITY_TYPE_LABELS,
  getNextActions,
} from "@/lib/territory/activity";
import { useCategoryLabels } from "@/lib/territory/reports";
import { TextView } from "@/components/ui/RichText";
import {
  METHOD_LABELS,
  calculateEngagementScore,
  cn,
} from "@/lib/territory/utils";
import { presetToDate, type Activity } from "@/lib/territory/types";
import { Button } from "@/components/ui/Button";
import { LogActivityModal } from "@/components/territory/LogActivityModal";
import { CompleteMeetingModal } from "@/components/territory/CompleteMeetingModal";
import { MeetingCompletedBanner } from "@/components/territory/MeetingCompletedBanner";

export function ActivityTimeline({
  kolId,
  userId,
  engagementScore,
  onEngagement,
}: {
  kolId: string;
  userId: string | null;
  engagementScore: number;
  onEngagement: (score: number) => void;
}) {
  const {
    activitiesApi,
    remindersApi,
    cycleNum,
    status,
    workingCycle,
    scheduledActivity,
    meetingNumber,
    completeMeeting,
  } = useMeetingFlow(kolId, userId);
  const { activities, add, loading } = activitiesApi;
  const { add: addReminder } = remindersApi;

  const [logOpen, setLogOpen] = useState(false);
  const [logStatus, setLogStatus] = useState<string | undefined>();
  const [meetOpen, setMeetOpen] = useState(false);

  // Recompute engagement from responses whenever activities change.
  useEffect(() => {
    const { score } = calculateEngagementScore(activities);
    if (score !== engagementScore) onEngagement(score);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activities]);

  const { labels: categoryLabels } = useCategoryLabels();
  const nextActions = getNextActions(status);
  const stepIndex = STEPPER.findIndex((s) => s.key === status);

  // Group all activities by cycle (desc), each cycle's items by date asc.
  const cycles = [...new Set(activities.map((a) => a.meeting_cycle))].sort(
    (a, b) => b - a,
  );

  async function onLog(activity: Partial<Activity>) {
    await add(activity);
  }
  async function onFollowUp(title: string, dueDateISO: string) {
    await addReminder({ title, due_date: dueDateISO, kol_id: kolId });
  }

  return (
    <div className="space-y-5">
      {/* Scheduled meeting awaiting completion */}
      {scheduledActivity && (
        <MeetingCompletedBanner
          scheduledFor={scheduledActivity.date}
          method={scheduledActivity.outreach_method}
          meetingNumber={meetingNumber}
          onComplete={completeMeeting}
        />
      )}

      {/* Stepper + next action */}
      <div className="rounded-xl border border-border bg-surface p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">
            Cycle {cycleNum}
          </h3>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                // Default to the next logical step in the sequence instead of
                // always "1st outreach" (wrong once you've already met).
                setLogStatus(
                  status === "meeting_scheduled" ? "other" : nextActions[0]?.status,
                );
                setLogOpen(true);
              }}
            >
              <Plus size={14} /> Log activity
            </Button>
            <Button size="sm" onClick={() => setMeetOpen(true)}>
              <CheckCircle2 size={14} /> Complete meeting
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {STEPPER.map((s, i) => (
            <div key={s.key} className="flex items-center gap-1.5">
              <span
                className={cn(
                  "rounded-full px-2.5 py-1 text-xs font-medium",
                  i <= stepIndex
                    ? "bg-[var(--accent)] text-[var(--accent-fg)]"
                    : "bg-canvas text-muted",
                )}
              >
                {s.label}
              </span>
              {i < STEPPER.length - 1 && <span className="text-border">→</span>}
            </div>
          ))}
        </div>

        {/* Next actions — always visible green chips for what comes next.
            Once a meeting is scheduled the only option is completing it. */}
        {(status === "meeting_scheduled" || nextActions.length > 0) && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted">
              Next
            </span>
            {status === "meeting_scheduled" ? (
              <NextChip label="Meeting completed" onClick={() => setMeetOpen(true)} />
            ) : (
              nextActions.map((a) => (
                <NextChip
                  key={a.status}
                  label={
                    workingCycle !== cycleNum
                      ? `${a.label} · cycle ${workingCycle}`
                      : a.label
                  }
                  onClick={() => {
                    setLogStatus(a.status);
                    setLogOpen(true);
                  }}
                />
              ))
            )}
          </div>
        )}
      </div>

      {/* Timeline */}
      {loading ? (
        <p className="py-8 text-center text-sm text-muted">Loading…</p>
      ) : activities.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-surface px-6 py-12 text-center text-sm text-muted">
          No activity yet. Log your first outreach to start the cycle.
        </div>
      ) : (
        cycles.map((cy) => {
          const acts = activities
            .filter((a) => a.meeting_cycle === cy)
            .sort((a, b) => +new Date(a.date) - +new Date(b.date));
          return (
            <div key={cy}>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                {cy === 0 ? "Other" : `Cycle ${cy}`}
              </h4>
              <ol className="relative space-y-3 border-l border-border pl-6">
                {acts.map((a) => (
                  <li key={a.id} className="relative">
                    <span className="absolute -left-[31px] h-3 w-3 rounded-full border-2 border-surface bg-[var(--accent)]" />
                    <div className="rounded-lg border border-border bg-surface px-4 py-3 shadow-sm">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-medium">
                          {categoryLabels[a.type] || ACTIVITY_TYPE_LABELS[a.type] || a.type}
                        </span>
                        {a.outreach_method && (
                          <span className="text-muted">
                            · {METHOD_LABELS[a.outreach_method] || a.outreach_method}
                          </span>
                        )}
                        {a.attendees != null && a.attendees > 0 && (
                          <span className="text-muted">· {a.attendees} attendees</span>
                        )}
                        {a.status && a.status !== "no_outreach" && (
                          <span className="rounded-full bg-canvas px-2 py-0.5 text-xs text-muted">
                            {STATUS_LABELS[a.status] || a.status}
                          </span>
                        )}
                        <span className="ml-auto text-xs text-muted">
                          {new Date(a.date).toLocaleDateString()}
                        </span>
                      </div>
                      {a.notes && (
                        <div className="mt-1.5">
                          <TextView value={a.notes} />
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          );
        })
      )}

      <LogActivityModal
        key={logStatus || "log"}
        open={logOpen}
        onClose={() => setLogOpen(false)}
        cycle={workingCycle}
        defaultStatus={logStatus}
        onLog={onLog}
        onFollowUp={onFollowUp}
        categoryLabels={categoryLabels}
      />
      <CompleteMeetingModal
        key={scheduledActivity?.date || "complete"}
        open={meetOpen}
        onClose={() => setMeetOpen(false)}
        meetingNumber={meetingNumber}
        defaultDate={scheduledActivity?.date}
        defaultMethod={scheduledActivity?.outreach_method || undefined}
        onComplete={completeMeeting}
      />
    </div>
  );
}

function NextChip({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700"
    >
      {label}
    </button>
  );
}
