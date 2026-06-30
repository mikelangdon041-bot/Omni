// Interview Prep candidate module — domain types (mirror 0003_interview).

export type CandidateStatus =
  | "active"
  | "screening"
  | "interviewing"
  | "offer"
  | "hired"
  | "rejected"
  | "on_hold"
  | "archived";

export const CANDIDATE_STATUSES: CandidateStatus[] = [
  "active",
  "screening",
  "interviewing",
  "offer",
  "hired",
  "rejected",
  "on_hold",
  "archived",
];

export const STATUS_LABELS: Record<CandidateStatus, string> = {
  active: "Active",
  screening: "Screening",
  interviewing: "Interviewing",
  offer: "Offer",
  hired: "Hired",
  rejected: "Rejected",
  on_hold: "On hold",
  archived: "Archived",
};

export const STATUS_COLORS: Record<CandidateStatus, string> = {
  active: "bg-slate-100 text-slate-600",
  screening: "bg-sky-100 text-sky-700",
  interviewing: "bg-indigo-100 text-indigo-700",
  offer: "bg-violet-100 text-violet-700",
  hired: "bg-emerald-100 text-emerald-700",
  rejected: "bg-rose-100 text-rose-700",
  on_hold: "bg-amber-100 text-amber-700",
  archived: "bg-slate-100 text-slate-500",
};

export interface Candidate {
  id: string;
  user_id: string;
  first_name: string;
  last_name: string;
  role_title: string;
  email: string;
  phone: string;
  location: string;
  status: CandidateStatus;
  resume_url: string;
  resume_text: string;
  summary: string;
  overall_impressions: string;
  strengths: string;
  opportunities: string;
  created_at: string;
  updated_at: string;
}

export interface QuestionBankItem {
  id: string;
  user_id: string;
  text: string;
  category: string;
  favorite: boolean;
  source: string;
  created_at: string;
}

export interface CandidateQuestion {
  id: string;
  candidate_id: string;
  text: string;
  asked: boolean;
  answer_notes: string;
  sort_order: number;
  source: string;
  bank_id: string | null;
  created_at: string;
}

export interface CandidateActivity {
  id: string;
  candidate_id: string;
  user_id: string | null;
  type: string;
  body: string;
  meta: Record<string, unknown>;
  created_at: string;
}

export interface CandidateShare {
  id: string;
  candidate_id: string;
  shared_with: string;
  scope: { all?: boolean; sections?: string[] };
  created_by: string | null;
  created_at: string;
}

// ------------------------------------------------------------------
// Scorecards / structured feedback
// ------------------------------------------------------------------
export interface FeedbackRating {
  competency: string;
  rating: number; // 1–4
  comment?: string;
}

export interface InterviewFeedback {
  id: string;
  candidate_id: string;
  user_id: string;
  recommendation: "strong_no" | "no" | "yes" | "strong_yes" | null;
  ratings: FeedbackRating[];
  notes: string;
  submitted: boolean;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
}

export const SCORECARD_COMPETENCIES = [
  "Communication",
  "Domain expertise",
  "Problem solving",
  "Culture & values",
  "Motivation",
];

export const RATING_LABELS: Record<number, string> = {
  1: "Poor",
  2: "Mixed",
  3: "Good",
  4: "Excellent",
};

export const RECOMMENDATIONS = [
  { value: "strong_no", label: "Strong no", color: "bg-rose-100 text-rose-700" },
  { value: "no", label: "No", color: "bg-amber-100 text-amber-700" },
  { value: "yes", label: "Yes", color: "bg-sky-100 text-sky-700" },
  { value: "strong_yes", label: "Strong yes", color: "bg-emerald-100 text-emerald-700" },
] as const;

export const RECOMMENDATION_LABEL: Record<string, string> = Object.fromEntries(
  RECOMMENDATIONS.map((r) => [r.value, r.label]),
);
export const RECOMMENDATION_COLOR: Record<string, string> = Object.fromEntries(
  RECOMMENDATIONS.map((r) => [r.value, r.color]),
);

export function candidateName(c: { first_name: string; last_name: string }) {
  return `${c.first_name} ${c.last_name}`.trim();
}

export function candidateInitials(c: { first_name: string; last_name: string }) {
  return `${c.first_name?.[0] || ""}${c.last_name?.[0] || ""}`.toUpperCase();
}
