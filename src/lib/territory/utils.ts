import type { Activity, RelationshipLevel } from "./types";

// Shared classnames helper (re-exported so existing territory imports keep working).
export { cn } from "@/lib/ui";

// ------------------------------------------------------------------
// Labels & colors
// ------------------------------------------------------------------
export const RELATIONSHIP_LABELS: Record<RelationshipLevel, string> = {
  not_yet_established: "Not yet established",
  infancy: "Infancy",
  hesitant: "Hesitant",
  moderate: "Moderate",
  strong: "Strong",
  advocate: "Advocate",
};

// Badge classes (Tailwind static colors — semantic, not theme tokens).
export const RELATIONSHIP_COLORS: Record<RelationshipLevel, string> = {
  not_yet_established: "bg-slate-100 text-slate-600",
  infancy: "bg-sky-100 text-sky-700",
  hesitant: "bg-amber-100 text-amber-700",
  moderate: "bg-indigo-100 text-indigo-700",
  strong: "bg-teal-100 text-teal-700",
  advocate: "bg-emerald-100 text-emerald-700",
};

// "How did you meet?" options (migration 0016 renames the stored values).
// Legacy keys are kept in the label map so old rows still display before
// the migration runs.
export const HOW_MET_OPTIONS = [
  "conference",
  "responded_emails",
  "commercial_introduction",
  "clinical_trial_site",
  "meets_regularly",
  "other",
] as const;

export const HOW_MET_LABELS: Record<string, string> = {
  conference: "Conference",
  responded_emails: "Responded to emails",
  unresponsive_emails: "Responded to emails", // legacy value, pre-0016
  commercial_introduction: "Commercial introduction",
  clinical_trial_site: "Clinical trial site",
  meets_regularly: "Meets regularly",
  special_program: "Other", // legacy value, pre-0016
  other: "Other",
};

export const METHOD_LABELS: Record<string, string> = {
  email: "Email",
  phone: "Phone",
  in_person: "In person",
  video_call: "Video call",
  text: "Text",
  other: "Other",
};

export const METHOD_COLORS: Record<string, string> = {
  email: "#6366f1",
  phone: "#0ea5e9",
  in_person: "#16a34a",
  video_call: "#a855f7",
  text: "#f59e0b",
  other: "#64748b",
};

// Rich-text fields store sanitized HTML; flatten to plain text for exports
// and AI prompts.
export function stripHtml(html: string): string {
  return (html || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export function kolFullName(k: { first_name: string; last_name: string }) {
  return `${k.first_name} ${k.last_name}`.trim();
}

export function kolInitials(k: { first_name: string; last_name: string }) {
  return `${k.first_name?.[0] || ""}${k.last_name?.[0] || ""}`.toUpperCase();
}

// ------------------------------------------------------------------
// Engagement scoring (response-based, no cap). Only inbound &
// unsolicited activities score; outbound outreach does not.
// ------------------------------------------------------------------
const METHOD_POINTS: Record<string, number> = {
  email: 5,
  text: 5,
  phone: 10,
  video_call: 15,
  in_person: 20,
  other: 5,
};

export interface ScoreBreakdownRow {
  label: string;
  count: number;
  points: number;
}

export function calculateEngagementScore(activities: Activity[]): {
  score: number;
  breakdown: ScoreBreakdownRow[];
} {
  const rows = new Map<string, ScoreBreakdownRow>();
  let score = 0;

  for (const a of activities) {
    if (a.type !== "inbound" && a.type !== "unsolicited") continue;
    const method = a.outreach_method || "other";
    const base = METHOD_POINTS[method] ?? 5;
    const bonus = a.type === "unsolicited" ? 3 : 0;
    const points = base + bonus;
    score += points;

    const key = `${a.type}:${method}`;
    const label = `${a.type === "unsolicited" ? "Unsolicited" : "Inbound"} · ${
      METHOD_LABELS[method] || method
    }`;
    const existing = rows.get(key);
    if (existing) {
      existing.count += 1;
      existing.points += points;
    } else {
      rows.set(key, { label, count: 1, points });
    }
  }

  return { score, breakdown: [...rows.values()] };
}

export function getAdvocateLevel(score: number): {
  label: string;
  color: string;
} {
  if (score >= 100) return { label: "Champion", color: "text-emerald-600" };
  if (score >= 60) return { label: "Engaged", color: "text-teal-600" };
  if (score >= 30) return { label: "Developing", color: "text-indigo-600" };
  if (score >= 10) return { label: "Early", color: "text-sky-600" };
  return { label: "New", color: "text-slate-500" };
}

// ------------------------------------------------------------------
// US state extraction from a free-text address (for the state filter).
// ------------------------------------------------------------------
const STATE_ABBR: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS",
  missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK",
  oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI",
  wyoming: "WY", "district of columbia": "DC",
};
const ABBR_SET = new Set(Object.values(STATE_ABBR));

export function extractState(address: string): string | null {
  if (!address) return null;
  // Try "City, ST 12345" style first.
  const m = address.match(/,\s*([A-Z]{2})\s*\d{0,5}\s*$/);
  if (m && ABBR_SET.has(m[1])) return m[1];
  // Any standalone 2-letter token that's a real state code.
  const tokens = address.toUpperCase().match(/\b[A-Z]{2}\b/g) || [];
  for (const t of tokens) if (ABBR_SET.has(t)) return t;
  // Full state name anywhere.
  const lower = ` ${address.toLowerCase()} `;
  for (const [name, abbr] of Object.entries(STATE_ABBR)) {
    if (lower.includes(` ${name} `)) return abbr;
  }
  return null;
}
