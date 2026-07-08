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

// The visual stepper for a cycle. "meeting_accepted" was dropped from the
// flow — scheduling is the only step before completion now.
export const STEPPER = [
  { key: "1st_outreach", label: "1st" },
  { key: "2nd_outreach", label: "2nd" },
  { key: "3rd_outreach", label: "3rd" },
  { key: "meeting_scheduled", label: "Scheduled" },
  { key: "meeting_completed", label: "Met" },
];

// Legacy activities logged under the old scheduled→accepted flow collapse
// into "scheduled" so they still light up the stepper and the banner.
export function normalizeStatus(status: string): string {
  return status === "meeting_accepted" ? "meeting_scheduled" : status;
}

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
  return normalizeStatus(best);
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
    // Once a meeting is scheduled, the green "Meeting completed?" banner is
    // the call to action — no accepted/confirmed steps in between.
    default:
      return null;
  }
}
