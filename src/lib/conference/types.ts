// Conference Planning domain types — mirror the Supabase schema (0013_conference).

export type EventType =
  | "booth"
  | "educational"
  | "symposium"
  | "cme"
  | "competitor"
  | "contact_meeting"
  | "session"
  | "poster"
  | "custom";

export type Priority = "high" | "medium" | "low";
export type ConfirmedPriority = Priority | "not_relevant";
export type Tier = "high" | "medium" | "low";
export type Meal = "breakfast" | "lunch" | "dinner" | "snack" | "coffee";
export type FoodStatus = "open" | "closed" | "ordered" | "delivered";
export type PinType = "meeting_point" | "team_hub" | "custom";

export interface Conference {
  id: string;
  org_id: string;
  name: string;
  slug: string;
  location: string;
  venue_address: string;
  start_date: string; // YYYY-MM-DD
  end_date: string;   // YYYY-MM-DD
  timezone: string;
  floor_plan_url: string;
  active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Attendee {
  id: string;
  conference_id: string;
  user_id: string | null;
  name: string;
  email: string;
  phone: string;
  role: string;
  department: string;
  color: string;
  is_lead: boolean;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ConfEvent {
  id: string;
  conference_id: string;
  title: string;
  event_type: EventType;
  custom_label: string;
  description: string;
  location: string;
  starts_at: string;
  ends_at: string;
  cancelled: boolean;
  show_in_sessions: boolean;
  is_private: boolean;
  created_by: string | null;
  suspected_priority: Priority | null;
  confirmed_priority: ConfirmedPriority | null;
  priority_set_by: string | null;
  priority_set_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface EventAssignment {
  id: string;
  conference_id: string;
  event_id: string;
  attendee_id: string;
}

export interface EventShift {
  id: string;
  conference_id: string;
  event_id: string;
  attendee_id: string | null;
  starts_at: string;
  ends_at: string;
  sort_order: number;
}

export interface SessionNote {
  id: string;
  conference_id: string;
  event_id: string;
  user_id: string;
  notes: string;
  images: string[];
  attendance: string;
  questions_asked: string;
  impact: string;
  created_at: string;
  updated_at: string;
}

export interface QuickLink {
  label: string;
  url: string;
}

export interface Contact {
  id: string;
  conference_id: string;
  kol_id: string | null; // link into the shared territory `kols` directory
  name: string;
  tier: Tier;
  institution: string;
  title: string;
  email: string;
  phone: string;
  photo_url: string;
  interests: string[];
  background: string;
  engagement_activities: string;
  meeting_objectives: string;
  links: QuickLink[];
  custom_fields: Record<string, string>;
  ai_summary: string;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface ContactMeeting {
  id: string;
  conference_id: string;
  contact_id: string;
  event_id: string | null;
  meeting_date: string; // YYYY-MM-DD
  meeting_time: string;
  location: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface Poster {
  id: string;
  conference_id: string;
  parent_id: string | null;
  is_session: boolean;
  sub_index: number | null;
  session_label: string;
  date: string; // free text — guard all parsing
  time: string; // free text
  title: string;
  authors: string;
  location: string;
  abstract: string;
  ai_summary: string;
  suspected_priority: Priority | null;
  confirmed_priority: ConfirmedPriority | null;
  priority_set_by: string | null;
  priority_set_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PosterRep {
  id: string;
  conference_id: string;
  poster_id: string;
  attendee_id: string;
}

export interface PosterNote {
  id: string;
  conference_id: string;
  poster_id: string;
  user_id: string;
  notes: string;
  images: string[];
  created_at: string;
  updated_at: string;
}

export type InsightStatus =
  | "uploading"
  | "transcribing"
  | "summarizing"
  | "complete"
  | "error";

export interface Insight {
  id: string;
  conference_id: string;
  user_id: string | null;
  parent_id: string | null;
  sort_order: number;
  title: string;
  notes: string;
  transcription: string;
  summary: string;
  status: InsightStatus;
  source_type: string;
  event_id: string | null;
  contact_id: string | null;
  poster_id: string | null;
  categories: string[];
  focus_areas: string[];
  product_lines: string[];
  insight_date: string | null;
  suspected_priority: Priority | null;
  confirmed_priority: ConfirmedPriority | null;
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: string;
  conference_id: string;
  name: string;
  color: string;
  sort_order: number;
}

export interface DailySummary {
  id: string;
  conference_id: string;
  date: string;
  content: string;
  guidance: string;
  updated_at: string;
}

export interface BoothLog {
  id: string;
  conference_id: string;
  date: string;
  attendee_count: string;
  patterns: string;
  standout: string;
  custom: string;
  updated_at: string;
}

export interface FoodOrder {
  id: string;
  conference_id: string;
  order_date: string;
  meal: Meal;
  restaurant: string;
  menu_url: string;
  group_order_url: string;
  deadline: string | null;
  status: FoodStatus;
  orderer_attendee_id: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface FoodItem {
  id: string;
  conference_id: string;
  order_id: string;
  attendee_id: string | null;
  item: string;
  instructions: string;
  created_at: string;
}

export interface FoodMessage {
  id: string;
  conference_id: string;
  order_id: string;
  sender_id: string | null;
  recipient_id: string | null;
  message: string;
  created_at: string;
}

export interface FoodAssignment {
  id: string;
  conference_id: string;
  date: string;
  attendee_ids: string[];
  skipped: boolean;
  updated_at: string;
}

export interface VenuePin {
  id: string;
  conference_id: string;
  label: string;
  pin_type: PinType;
  description: string;
  x: number;
  y: number;
  color: string;
  active: boolean;
  created_at: string;
}

export interface Announcement {
  id: string;
  conference_id: string;
  sender_id: string | null;
  message: string;
  created_at: string;
}

// ------------------------------------------------------------------
// Constants
// ------------------------------------------------------------------

// Nine event types, each with a fixed color. Red is reserved for competitor
// sessions; booth and contact-meeting colors are distinct from priority hues.
// (symposium/cme require migration 0017 on the conf_events check constraint.)
export const EVENT_TYPES: Record<
  EventType,
  { label: string; color: string; soft: string }
> = {
  booth: { label: "Booth", color: "#0d9488", soft: "#ccfbf1" },
  educational: { label: "Educational Session", color: "#4f46e5", soft: "#e0e7ff" },
  symposium: { label: "Symposium", color: "#db2777", soft: "#fce7f3" },
  cme: { label: "CME", color: "#65a30d", soft: "#ecfccb" },
  competitor: { label: "Competitor Session", color: "#dc2626", soft: "#fee2e2" },
  contact_meeting: { label: "KOL Meeting", color: "#7c3aed", soft: "#ede9fe" },
  session: { label: "Session", color: "#0284c7", soft: "#e0f2fe" },
  poster: { label: "Poster", color: "#d97706", soft: "#fef3c7" },
  custom: { label: "Custom", color: "#475569", soft: "#e2e8f0" },
};

export const EVENT_TYPE_ORDER: EventType[] = [
  "booth",
  "educational",
  "symposium",
  "cme",
  "competitor",
  "contact_meeting",
  "session",
  "poster",
  "custom",
];

// Session-like types that get a note-taking detail page.
export const SESSION_TYPES: EventType[] = [
  "session",
  "educational",
  "symposium",
  "cme",
  "competitor",
];

export const PRIORITIES: Record<
  ConfirmedPriority,
  { label: string; short: string; color: string; soft: string; rank: number }
> = {
  high: { label: "High", short: "H", color: "#dc2626", soft: "#fee2e2", rank: 0 },
  medium: { label: "Medium", short: "M", color: "#d97706", soft: "#fef3c7", rank: 1 },
  low: { label: "Low", short: "L", color: "#0284c7", soft: "#e0f2fe", rank: 2 },
  not_relevant: { label: "Not relevant", short: "N", color: "#6c6982", soft: "#eeedf5", rank: 4 },
};

// Resolved priority: confirmed wins, else suspected, else none (rank 3).
export function resolvePriority(
  suspected: Priority | null,
  confirmed: ConfirmedPriority | null,
): ConfirmedPriority | null {
  return confirmed ?? suspected ?? null;
}

export function priorityRank(
  suspected: Priority | null,
  confirmed: ConfirmedPriority | null,
): number {
  const r = resolvePriority(suspected, confirmed);
  return r ? PRIORITIES[r].rank : 3;
}

export const MEALS: Record<Meal, { label: string; color: string; emoji: string }> = {
  breakfast: { label: "Breakfast", color: "#d97706", emoji: "🥐" },
  lunch: { label: "Lunch", color: "#0d9488", emoji: "🥪" },
  dinner: { label: "Dinner", color: "#7c3aed", emoji: "🍽️" },
  snack: { label: "Snack", color: "#0284c7", emoji: "🍎" },
  coffee: { label: "Coffee", color: "#78350f", emoji: "☕" },
};

export const FOOD_STATUSES: Record<FoodStatus, { label: string; color: string }> = {
  open: { label: "Open", color: "#10b981" },
  closed: { label: "Closed", color: "#d97706" },
  ordered: { label: "Ordered", color: "#0284c7" },
  delivered: { label: "Delivered", color: "#6c6982" },
};

export const SOURCE_TYPES = [
  "Physician / decision-maker",
  "Assistant",
  "Nurse",
  "Pharmacist",
  "Competitor",
  "Internal",
  "Other",
];

// Default insight-category taxonomy seeded per conference ("Other" sorts last).
export const DEFAULT_CATEGORIES: { name: string; color: string }[] = [
  { name: "Efficacy", color: "#10b981" },
  { name: "Safety / Tolerability", color: "#dc2626" },
  { name: "Treatment approach", color: "#0284c7" },
  { name: "Screening / Diagnosis / Monitoring", color: "#7c3aed" },
  { name: "Education gaps / unmet needs", color: "#d97706" },
  { name: "Competitive intelligence", color: "#be123c" },
  { name: "Pipeline / emerging data", color: "#0d9488" },
  { name: "Contact sentiment", color: "#8b5cf6" },
  { name: "Ops-related", color: "#475569" },
  { name: "Other", color: "#6c6982" },
];

export const ATTENDEE_COLORS = [
  "#e11d48", "#d97706", "#10b981", "#0284c7", "#7c3aed",
  "#0d9488", "#be123c", "#4f46e5", "#ca8a04", "#db2777",
];

export const PIN_TYPES: Record<PinType, string> = {
  meeting_point: "Meeting Point",
  team_hub: "Team Hub",
  custom: "Custom",
};

export const TIERS: Record<Tier, { label: string; color: string; soft: string }> = {
  high: { label: "High", color: "#dc2626", soft: "#fee2e2" },
  medium: { label: "Medium", color: "#d97706", soft: "#fef3c7" },
  low: { label: "Low", color: "#0284c7", soft: "#e0f2fe" },
};

export const COMMON_TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Toronto",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "Europe/Rome",
  "Europe/Amsterdam",
  "Europe/Stockholm",
  "Asia/Tokyo",
  "Asia/Singapore",
  "Asia/Shanghai",
  "Asia/Dubai",
  "Australia/Sydney",
];
