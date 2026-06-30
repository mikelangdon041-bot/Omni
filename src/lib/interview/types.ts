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

export function candidateName(c: { first_name: string; last_name: string }) {
  return `${c.first_name} ${c.last_name}`.trim();
}

export function candidateInitials(c: { first_name: string; last_name: string }) {
  return `${c.first_name?.[0] || ""}${c.last_name?.[0] || ""}`.toUpperCase();
}
