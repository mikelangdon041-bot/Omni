// Territory Planning domain types — mirror the Supabase schema (0002_territory).

export type RelationshipLevel =
  | "not_yet_established"
  | "infancy"
  | "hesitant"
  | "moderate"
  | "strong"
  | "advocate";

export type HowMet =
  | "conference"
  | "unresponsive_emails"
  | "commercial_introduction"
  | "clinical_trial_site"
  | "meets_regularly"
  | "special_program"
  | "other";

export type ActivityType =
  | "outbound"
  | "inbound"
  | "unsolicited"
  | "meeting"
  | "note"
  | "status_change";

export type OutreachMethod =
  | "email"
  | "phone"
  | "in_person"
  | "video_call"
  | "text"
  | "other";

export interface KOL {
  id: string;
  user_id: string;
  first_name: string;
  last_name: string;
  specialty: string;
  address: string;
  phone: string;
  email: string;
  institution: string;
  is_product_a_user: boolean;
  is_product_b_user: boolean;
  website_office: string;
  website_pubmed: string;
  website_other: string;
  photo_url: string;
  title_position: string;
  clinician_type: string;
  society_associations: string;
  leadership_appointments: string;
  publications: string;
  how_met: HowMet;
  how_met_other: string;
  relationship_level: RelationshipLevel;
  other_info: string;
  areas_of_interest: string;
  potential_collaborations: string;
  primary_objective: string;
  backup_questions: string;
  engagement_score: number;
  priority: number;
  tier: string;
  kol_status: string;
  list_name: string;
  latitude: number | null;
  longitude: number | null;
  created_at: string;
  updated_at: string;
}

export interface Activity {
  id: string;
  kol_id: string;
  type: ActivityType;
  status: string;
  outreach_method: OutreachMethod | null;
  outreach_number: number;
  meeting_cycle: number;
  date: string;
  notes: string;
  status_other: string;
  program_product: string | null;
  program_indication: string | null;
  program_manager: string | null;
  program_agreed_to_meeting: boolean | null;
  program_training_date: string | null;
  created_at: string;
}

export interface MaterialShared {
  type: string;
  description: string;
}

export interface Meeting {
  id: string;
  kol_id: string;
  activity_id: string | null;
  meeting_number: number;
  date: string;
  meeting_method: string | null;
  topics_discussed: string;
  topics_missed: string;
  materials_shared: MaterialShared[];
  follow_up_actions: string;
  confirmed: boolean;
  ai_summary: string;
  created_at: string;
}

export interface QuarterlyGoal {
  id: string;
  kol_id: string;
  year: number;
  quarter: number;
  goal: string;
  discussed: boolean;
  carried_from_quarter: number | null;
  carried_from_year: number | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface Reminder {
  id: string;
  user_id: string;
  kol_id: string | null;
  meeting_id: string | null;
  title: string;
  description: string;
  due_date: string;
  sent: boolean;
  dismissed: boolean;
  completed_at: string | null;
  created_at: string;
}

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------
export type DueDatePreset = "1_week" | "1_month" | "3_months" | "custom";

export function presetToDate(preset: DueDatePreset, customISO?: string): string {
  const d = new Date();
  if (preset === "1_week") d.setDate(d.getDate() + 7);
  if (preset === "1_month") d.setMonth(d.getMonth() + 1);
  if (preset === "3_months") d.setMonth(d.getMonth() + 3);
  if (preset === "custom" && customISO) return new Date(customISO).toISOString();
  return d.toISOString();
}
