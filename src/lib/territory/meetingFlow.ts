"use client";

// Shared meeting-cycle state for the Activity and Meetings tabs: where the
// active cycle stands, whether a scheduled meeting is awaiting completion
// (drives the green "Meeting completed?" banner on both tabs), and the
// one-shot completion routine (activity + meeting record + optional reminder).

import { useCallback } from "react";
import { useActivities, useMeetings, useReminders } from "./hooks";
import { activeCycle, latestStatus, normalizeStatus } from "./activity";
import { presetToDate, type Activity } from "./types";
import type { CompletedMeeting } from "@/components/territory/CompleteMeetingModal";

export function useMeetingFlow(kolId: string, userId: string | null) {
  const activitiesApi = useActivities(kolId);
  const meetingsApi = useMeetings(kolId);
  const remindersApi = useReminders(userId);

  const { activities } = activitiesApi;
  const cycleNum = activeCycle(activities);
  const cycleActs = activities.filter((a) => a.meeting_cycle === cycleNum);
  const status = latestStatus(cycleActs);
  // New outreach starts a fresh cycle once a meeting is completed.
  const workingCycle = status === "meeting_completed" ? cycleNum + 1 : cycleNum;

  // The scheduled-but-not-yet-completed meeting for the active cycle, if any.
  const scheduledActivity =
    status === "meeting_scheduled"
      ? cycleActs
          .filter((a) => normalizeStatus(a.status) === "meeting_scheduled")
          .sort((a, b) => +new Date(b.date) - +new Date(a.date))[0] || null
      : null;

  const meetingNumber = meetingsApi.meetings.length + 1;

  const { add: addActivity } = activitiesApi;
  const { add: addMeeting } = meetingsApi;
  const { add: addReminder } = remindersApi;

  const completeMeeting = useCallback(
    async (m: CompletedMeeting) => {
      const act = await addActivity({
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
          title: "Follow up after meeting",
          due_date: presetToDate(m.followUp),
          kol_id: kolId,
        });
      }
    },
    [addActivity, addMeeting, addReminder, cycleNum, meetingNumber, kolId],
  );

  return {
    activitiesApi,
    meetingsApi,
    remindersApi,
    cycleNum,
    status,
    workingCycle,
    scheduledActivity,
    meetingNumber,
    completeMeeting,
  };
}
