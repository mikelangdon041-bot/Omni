// Reminders and follow-ups from the Outlook pane. Shared by the pane
// (components/outlook/FollowupCard.tsx), the drafting route
// (/api/outlook/followup) and the PC runner's route (/api/outlook/runner).
// See supabase/migrations/0040_email_followups.sql for how the pieces fit.

export interface FollowupRow {
  id: string;
  message_id: string;
  thread_subject: string;
  to_people: { name: string; email: string }[];
  subject: string;
  reminder_at: string | null;
  reminder_body: string;
  reminder_status: "none" | "pending" | "scheduled" | "failed" | "cancelled";
  followup_at: string | null;
  followup_body: string;
  followup_mode: "draft" | "send";
  followup_status:
    | "none"
    | "waiting"
    | "replied"
    | "drafted"
    | "sent"
    | "failed"
    | "cancelled";
  result: string;
  created_at: string;
}

/** Local "YYYY-MM-DD" and "HH:MM" for a date input pair. */
export function toInputs(d: Date): { date: string; time: string } {
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

/** Back from a date input pair, in local time. Null when unreadable. */
export function fromInputs(date: string, time: string): Date | null {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = (time || "09:00").split(":").map(Number);
  const out = new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0);
  return Number.isNaN(out.getTime()) || !y ? null : out;
}

/** Weekends move to the Monday. Mail that lands on a Saturday sits unread. */
export function onWorkingDay(d: Date): Date {
  const out = new Date(d);
  while (out.getDay() === 0 || out.getDay() === 6) out.setDate(out.getDate() + 1);
  return out;
}

/** "In a week", at 9:00, on a working day. The default the pane offers. */
export function aWeekFrom(now: Date): Date {
  const d = new Date(now);
  d.setDate(d.getDate() + 7);
  d.setHours(9, 0, 0, 0);
  return onWorkingDay(d);
}

/** N working days after a moment, at the same time of day. */
export function workingDaysAfter(from: Date, days: number): Date {
  const d = new Date(from);
  let left = days;
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) left--;
  }
  return d;
}

/** "Tue, Dec 9, 9:00 AM" */
export function whenLabel(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** The thread's subject as a reply carries it: one "RE:" and no stacking. */
export function replySubject(subject: string): string {
  const bare = subject.replace(/^((re|fw|fwd)\s*:\s*)+/i, "").trim();
  return bare ? `RE: ${bare}` : "";
}
