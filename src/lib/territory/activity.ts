import type { Activity } from "./types";

// Outreach statuses in cycle order.
export const OUTREACH_STATUSES = [
  "1st_outreach",
  "2nd_outreach",
  "3rd_outreach",
  "meeting_scheduled",
  "meeting_accepted",
  "meeting_completed",
] as const;

export const STATUS_LABELS: Record<string, string> = {
  no_outreach: "No outreach",
  "1st_outreach": "1st outreach",
  "2nd_outreach": "2nd outreach",
  "3rd_outreach": "3rd outreach",
  meeting_scheduled: "Meeting scheduled",
  meeting_accepted: "Meeting accepted",
  meeting_completed: "Meeting completed",
  non_responsive: "Non-responsive",
  other: "Other",
};

export const ACTIVITY_TYPE_LABELS: Record<string, string> = {
  outbound: "Outbound",
  inbound: "Inbound",
  unsolicited: "Unsolicited",
  meeting: "Meeting",
  note: "Note",
  status_change: "Status change",
};

// The visual stepper for a cycle.
export const STEPPER = [
  { key: "1st_outreach", label: "1st" },
  { key: "2nd_outreach", label: "2nd" },
  { key: "3rd_outreach", label: "3rd" },
  { key: "meeting_scheduled", label: "Scheduled" },
  { key: "meeting_accepted", label: "Accepted" },
  { key: "meeting_completed", label: "Met" },
];

// Highest meeting_cycle present (the active arc); defaults to 1.
export function activeCycle(activities: Activity[]): number {
  let max = 1;
  for (const a of activities) {
    if (a.meeting_cycle > max) max = a.meeting_cycle;
  }
  return max;
}

// Latest outbound status within a set of activities (the cycle's progress).
export function latestStatus(activities: Activity[]): string {
  let best = "no_outreach";
  let bestRank = -1;
  for (const a of activities) {
    const rank = OUTREACH_STATUSES.indexOf(
      a.status as (typeof OUTREACH_STATUSES)[number],
    );
    if (rank > bestRank) {
      bestRank = rank;
      best = a.status;
    }
  }
  return best;
}

// Suggest the next action given the current status.
export function getNextStep(status: string): {
  label: string;
  status: string;
} | null {
  switch (status) {
    case "no_outreach":
      return { label: "Log 1st outreach", status: "1st_outreach" };
    case "1st_outreach":
      return { label: "Log 2nd outreach", status: "2nd_outreach" };
    case "2nd_outreach":
      return { label: "Log 3rd outreach", status: "3rd_outreach" };
    case "3rd_outreach":
      return { label: "Mark meeting scheduled", status: "meeting_scheduled" };
    case "meeting_scheduled":
      return { label: "Mark meeting accepted", status: "meeting_accepted" };
    case "meeting_accepted":
      return { label: "Complete meeting", status: "meeting_completed" };
    default:
      return null;
  }
}
