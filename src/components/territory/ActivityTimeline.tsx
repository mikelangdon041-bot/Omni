"use client";

import { useEffect, useState } from "react";
import { Plus, CheckCircle2 } from "lucide-react";
import {
  useActivities,
  useMeetings,
  useReminders,
} from "@/lib/territory/hooks";
import {
  STATUS_LABELS,
  STEPPER,
  ACTIVITY_TYPE_LABELS,
  activeCycle,
  latestStatus,
  getNextStep,
} from "@/lib/territory/activity";
import {
  METHOD_LABELS,
  calculateEngagementScore,
  cn,
} from "@/lib/territory/utils";
import { presetToDate, type Activity } from "@/lib/territory/types";
import { Button } from "@/components/ui/Button";
import { LogActivityModal } from "@/components/territory/LogActivityModal";
import {
  CompleteMeetingModal,
  type CompletedMeeting,
} from "@/components/territory/CompleteMeetingModal";

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
  const { activities, add, loading } = useActivities(kolId);
  const { meetings, add: addMeeting } = useMeetings(kolId);
  const { add: addReminder } = useReminders(userId);

  const [logOpen, setLogOpen] = useState(false);
  const [logStatus, setLogStatus] = useState<string | undefined>();
  const [meetOpen, setMeetOpen] = useState(false);

  // Recompute engagement from responses whenever activities change.
  useEffect(() => {
    const { score } = calculateEngagementScore(activities);
    if (score !== engagementScore) onEngagement(score);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activities]);

  const cycleNum = activeCycle(activities);
  const cycleActs = activities.filter((a) => a.meeting_cycle === cycleNum);
  const status = latestStatus(cycleActs);
  // New outreach starts a fresh cycle once a meeting is completed.
  const workingCycle = status === "meeting_completed" ? cycleNum + 1 : cycleNum;
  const next = getNextStep(status);
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
  async function onCompleteMeeting(m: CompletedMeeting) {
    const meetingNumber = meetings.length + 1;
    const act = await add({
      type: "meeting",
      status: "meeting_completed",
      meeting_cycle: cycleNum,
      outreach_method: m.meeting_method as Activity["outreach_method"],
      date: m.date,
      notes: m.topics_discussed,
    });
    await addMeeting({
      activity_id: act?.id ?? null,
      meeting_number: meetingNumber,
      date: m.date,
      meeting_method: m.meeting_method,
      topics_discussed: m.topics_discussed,
      topics_missed: m.topics_missed,
      follow_up_actions: m.follow_up_actions,
    });
    if (m.followUp !== "none") {
      await addReminder({
        title: `Follow up after meeting`,
        due_date: presetToDate(m.followUp),
        kol_id: kolId,
      });
    }
  }

  return (
    <div className="space-y-5">
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
                setLogStatus(undefined);
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

        {next && (
          <button
            onClick={() => {
              setLogStatus(next.status);
              setLogOpen(true);
            }}
            className="mt-3 text-sm font-medium text-[var(--accent)] hover:underline"
          >
            Next: {next.label} →
          </button>
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
                {cy === 0 ? "Special program" : `Cycle ${cy}`}
              </h4>
              <ol className="relative space-y-3 border-l border-border pl-6">
                {acts.map((a) => (
                  <li key={a.id} className="relative">
                    <span className="absolute -left-[31px] h-3 w-3 rounded-full border-2 border-surface bg-[var(--accent)]" />
                    <div className="rounded-lg border border-border bg-surface px-4 py-3 shadow-sm">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-medium">
                          {ACTIVITY_TYPE_LABELS[a.type] || a.type}
                        </span>
                        {a.outreach_method && (
                          <span className="text-muted">
                            · {METHOD_LABELS[a.outreach_method] || a.outreach_method}
                          </span>
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
                        <p className="mt-1.5 whitespace-pre-wrap text-sm text-ink/90">
                          {a.notes}
                        </p>
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
      />
      <CompleteMeetingModal
        open={meetOpen}
        onClose={() => setMeetOpen(false)}
        meetingNumber={meetings.length + 1}
        onComplete={onCompleteMeeting}
      />
    </div>
  );
}
