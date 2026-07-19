// The cross-module data catalog: what's visualizable, from which app, and how
// it can be grouped/measured. Pure metadata (no fetching) so it's safe to
// import from client components — the AI route and the data fetchers key off
// dataset.id to know what to actually query.
//
// To add a new module to the dashboard: add a DatasetDef here, then a matching
// fetcher in data.ts.

import type { DatasetDef } from "./types";

export const DASHBOARD_DATASETS: DatasetDef[] = [
  {
    id: "territory.kols",
    module: "territory-planning",
    moduleLabel: "Territory Planning",
    label: "KOLs",
    description:
      "Every KOL (contact) in a rep's territory roster — specialty, tier, relationship strength, institution, status, engagement score.",
    ownerScoped: true,
    dimensions: [
      { key: "specialty", label: "Specialty" },
      { key: "tier", label: "Tier" },
      { key: "relationship_level", label: "Relationship level" },
      { key: "institution", label: "Institution" },
      { key: "kol_status", label: "Status" },
      { key: "how_met", label: "How met" },
    ],
    measures: [
      { key: "*", label: "Number of KOLs", agg: "count" },
      { key: "engagement_score", label: "Average engagement score", agg: "avg" },
      { key: "priority", label: "Average priority", agg: "avg" },
    ],
  },
  {
    id: "territory.activities",
    module: "territory-planning",
    moduleLabel: "Territory Planning",
    label: "Outreach activity",
    description:
      "Outreach/engagement events logged against KOLs — type (outbound, inbound, meeting, etc.), status, method, and when they happened.",
    ownerScoped: true,
    dimensions: [
      { key: "type", label: "Activity type" },
      { key: "status", label: "Status" },
      { key: "outreach_method", label: "Outreach method" },
    ],
    measures: [{ key: "*", label: "Number of activities", agg: "count" }],
  },
  {
    id: "territory.meetings",
    module: "territory-planning",
    moduleLabel: "Territory Planning",
    label: "KOL meetings",
    description: "Detailed KOL meeting records — how they were held and whether confirmed.",
    ownerScoped: true,
    dimensions: [
      { key: "meeting_method", label: "Meeting method" },
      { key: "confirmed", label: "Confirmed" },
    ],
    measures: [{ key: "*", label: "Number of meetings", agg: "count" }],
  },
  {
    id: "insights.responses",
    module: "insights",
    moduleLabel: "Insights",
    label: "Survey responses",
    description:
      "KOL survey response progress — completion status, and the specialty/tier of the KOL surveyed.",
    ownerScoped: true,
    dimensions: [
      { key: "status", label: "Completion status" },
      { key: "specialty", label: "KOL specialty" },
      { key: "tier", label: "KOL tier" },
    ],
    measures: [{ key: "*", label: "Number of responses", agg: "count" }],
  },
  {
    id: "meeting_prep.meetings",
    module: "meeting-prep",
    moduleLabel: "Meeting Prep",
    label: "Prepped meetings",
    description: "Meetings a rep has prepped for — type, format, and how long they're booked for.",
    ownerScoped: true,
    dimensions: [
      { key: "meeting_type", label: "Meeting type" },
      { key: "format", label: "Format" },
    ],
    measures: [
      { key: "*", label: "Number of meetings", agg: "count" },
      { key: "duration_min", label: "Average duration (min)", agg: "avg" },
    ],
  },
  {
    id: "conference.contacts",
    module: "conference-planning",
    moduleLabel: "Conference Planning",
    label: "Key contacts",
    description:
      "VIP/key contacts tracked across your team's conferences — tier and institution.",
    ownerScoped: false,
    dimensions: [
      { key: "tier", label: "Tier" },
      { key: "institution", label: "Institution" },
    ],
    measures: [{ key: "*", label: "Number of contacts", agg: "count" }],
  },
  {
    id: "conference.events",
    module: "conference-planning",
    moduleLabel: "Conference Planning",
    label: "Schedule events",
    description:
      "Conference schedule items your team is covering — sessions, booth shifts, competitor events, etc. — by type and confirmed priority.",
    ownerScoped: false,
    dimensions: [
      { key: "event_type", label: "Event type" },
      { key: "confirmed_priority", label: "Confirmed priority" },
    ],
    measures: [{ key: "*", label: "Number of events", agg: "count" }],
  },
];

export function getDataset(id: string): DatasetDef | undefined {
  return DASHBOARD_DATASETS.find((d) => d.id === id);
}

// Compact text catalog for the AI prompt.
export function catalogText(): string {
  return DASHBOARD_DATASETS.map((d) => {
    const dims = d.dimensions.map((f) => f.key).join(", ");
    const measures = d.measures.map((m) => `${m.key} (${m.agg})`).join(", ");
    return `- id=${d.id} | app=${d.moduleLabel} | "${d.label}" — ${d.description}\n  dimensions: ${dims}\n  measures: ${measures}`;
  }).join("\n");
}
