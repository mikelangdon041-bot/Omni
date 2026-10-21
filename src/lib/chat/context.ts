// What each kind of record looks like when the chat reads it.
//
// Pages hand the chat plain text rather than their own objects, for two
// reasons: the model reads it better than JSON, and a page can say what matters
// about a record without exposing every column of it. Kept here rather than in
// the pages so the same record reads the same way wherever it is opened from.

import { htmlToPlain } from "@/lib/writer/types";
import type { KOL } from "@/lib/territory/types";
import type { MpMeeting } from "@/lib/meetingprep/types";
import { meetingTypeLabel } from "@/lib/meetingprep/types";

const line = (label: string, value: unknown, max = 1200): string => {
  const text = htmlToPlain(String(value ?? "")).trim().slice(0, max);
  return text ? `${label}: ${text}` : "";
};

export function kolContext(k: KOL): string {
  return [
    `Person: ${`${k.first_name} ${k.last_name}`.trim()}`,
    line("Role", k.title_position),
    line("Specialty", k.specialty),
    line("Institution", k.institution),
    k.tier && `Tier: ${k.tier}`,
    k.relationship_level &&
      `Relationship: ${String(k.relationship_level).replace(/_/g, " ")}`,
    k.how_met && `How they met: ${String(k.how_met).replace(/_/g, " ")}`,
    k.engagement_score ? `Engagement score: ${k.engagement_score}` : "",
    line("Email", k.email),
    line("Phone", k.phone),
    line("What I'm trying to achieve with them", k.primary_objective),
    line("Areas of interest", k.areas_of_interest),
    line("Possible collaborations", k.potential_collaborations),
    line("Societies", k.society_associations),
    line("Leadership", k.leadership_appointments),
    line("Publications", k.publications, 800),
    line("Other notes", k.other_info, 2000),
    line("Backup questions", k.backup_questions, 800),
    "\n(Their meeting and outreach history is not on this page. Look it up by name if it matters.)",
  ]
    .filter(Boolean)
    .join("\n");
}

/** A row in a list: enough to answer "who haven't I touched?" without the lot. */
export function kolRow(k: KOL): string {
  return [
    `${k.first_name} ${k.last_name}`.trim(),
    k.title_position || k.specialty,
    k.institution,
    k.tier && `tier ${k.tier}`,
    k.relationship_level && String(k.relationship_level).replace(/_/g, " "),
    k.kol_status && k.kol_status !== "active" ? k.kol_status : "",
  ]
    .filter(Boolean)
    .join(" | ");
}

export function meetingContext(m: MpMeeting): string {
  const attendees = (m.attendees || [])
    .filter((a) => a.name?.trim())
    .map((a) =>
      [a.name, a.role, a.org].filter(Boolean).join(", ") + (a.notes ? ` — ${a.notes}` : ""),
    );
  const sections = (m.brief?.sections || [])
    .map((s) => `  ${s.title}: ${htmlToPlain(s.content).slice(0, 600)}`)
    .filter((s) => s.trim().length > 20);
  const grill = (m.grill || []).map((g) => `  Q: ${g.question}`);

  // The question bank, which this left out entirely. Asked about their own
  // questions while looking straight at them, the chat said it could not see
  // the screen, because nothing had ever put them in front of it. The list
  // they carry in comes first and in order, since that is the one they mean
  // by "my questions"; the rest of the bank follows as the pool it is.
  const live = (m.questions?.items || []).filter((q) => !q.deleted);
  const carried = live
    .filter((q) => q.picked)
    .sort((a, b) => a.order - b.order)
    .map(
      (q, i) =>
        `  ${i + 1}. ${q.setup ? `[setup: ${q.setup}] ` : ""}${q.text}${q.backup ? " [held as a backup]" : ""}${
          q.forWhom ? ` [for ${q.forWhom}]` : ""
        }${q.followUp ? `\n     probe: ${q.followUp}` : ""}`,
    );
  const pool = live
    .filter((q) => !q.picked)
    .map((q) => `  (${q.category}) ${q.text}`);

  return [
    `Meeting: ${m.title || "(untitled)"}`,
    // The subject in the writer's own words, which beats the meeting's name
    // wherever the two point different ways. Everything else in the app
    // treats it as decisive and this was the one place that never saw it.
    m.topic && `THE SUBJECT OF THIS SESSION, in their own words: ${m.topic}`,
    `Type: ${meetingTypeLabel(m.meeting_type)}`,
    m.date && `When: ${new Date(m.date).toLocaleString()}`,
    m.duration_min && `Duration: ${m.duration_min} minutes`,
    m.location && `Where: ${m.location}`,
    attendees.length && `Attendees:\n${attendees.map((a) => `  ${a}`).join("\n")}`,
    line("In their own words", m.explain, 3000),
    line("Objectives", m.objectives, 1500),
    line("Background", m.background, 2000),
    line("Concerns", m.concerns, 1500),
    (m.documents || []).length &&
      `Documents attached: ${(m.documents || []).map((d) => d.name).join(", ")}`,
    sections.length ? `The brief so far:\n${sections.join("\n")}` : "No brief generated yet.",
    carried.length
      ? `THE QUESTIONS THEY ARE CARRYING IN, in the order they will ask them. This is what they mean by "my questions" or "my list":\n${carried
          .join("\n")
          .slice(0, 8000)}`
      : "",
    pool.length
      ? `Other questions in the bank, written but not picked:\n${pool.join("\n").slice(0, 6000)}`
      : "",
    m.questions?.guidance &&
      `Their standing instruction on how their questions must be written: ${m.questions.guidance}`,
    // What the brief was built from. Without it the chat answers about the
    // subject from memory while the app has fresher material sitting on the
    // same record.
    m.brief?.research?.notes &&
      `What was looked up about the subject for this meeting:\n${m.brief.research.notes.slice(0, 6000)}`,
    grill.length && `Questions they're being drilled on (the Practice tab, questions put TO them):\n${grill.join("\n")}`,
    m.debrief?.summary && line("Debrief", m.debrief.summary, 1500),
  ]
    .filter(Boolean)
    .join("\n");
}

/** A list of anything, capped so a big territory doesn't fill the window. */
export function listContext(
  heading: string,
  rows: string[],
  limit = 60,
): string {
  if (!rows.length) return `${heading}: nothing here yet.`;
  const shown = rows.slice(0, limit);
  return `${heading} (${rows.length}${
    rows.length > shown.length ? `, showing the first ${shown.length}` : ""
  }):\n${shown.map((r) => `- ${r}`).join("\n")}`;
}
