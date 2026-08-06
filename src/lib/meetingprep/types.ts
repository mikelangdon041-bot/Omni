// Meeting Prep shared types + the default brief blueprint.

import { htmlToPlain } from "@/lib/writer/types";

export type MeetingType =
  | "kol_1on1"
  | "advisory_board"
  | "internal"
  | "congress"
  | "presentation"
  | "difficult"
  | "first_meeting"
  | "other";

export type MeetingFormat = "in_person" | "video_call" | "phone";

export interface Attendee {
  name: string;
  role: string;
  org: string;
  notes: string;
}

export interface BriefSection {
  key: string;
  title: string;
  content: string; // HTML
  // Snapshot of `content` taken right after the AI last (re)generated this
  // section. If `content` no longer matches, the user has hand-edited it —
  // that's what makes a plain "Redo" (no guidance) meaningful again.
  generatedContent?: string;
}

export interface Brief {
  sections?: BriefSection[];
  generatedAt?: string;
  // Fingerprint of the setup fields the brief was generated from, so the UI
  // can tell when the setup changed and the brief is stale. Only bumped by a
  // full regenerate/refine — a single section redo shouldn't mark the whole
  // brief "fresh" when the other sections weren't touched.
  sourceFingerprint?: string;
  // Section keys the user has collapsed, remembered per meeting.
  collapsed?: string[];
}

// A supporting document uploaded to the meeting, with the user's note on what
// the AI should look for in it / why it's relevant.
export interface MpDocument {
  id: string;
  name: string;
  note: string;
  text: string; // extracted plain text
}

// A brainstormed idea/angle the AI suggested; `added` = already in the brief.
export interface IdeaSuggestion {
  id: string;
  title: string;
  detail: string;
  added: boolean;
}

export interface GrillItem {
  id: string;
  question: string;
  modelAnswer: string;
  userAnswer: string;
  coaching: string;
  revealed: boolean;
}

export interface DebriefAction {
  text: string;
  done: boolean;
  taskId?: string;
  // Ticked follow-ups are the ones "Add to to-do list" will push. Defaults to
  // true when the AI extracts them — untick the ones you don't want tracked.
  selected?: boolean;
}

// One editable block of meeting notes. Same {key,title,content} shape as a
// brief section, so it gets the same rich-text editor and autosave.
export interface DebriefSection {
  key: string;
  title: string;
  content: string; // HTML
}

export interface Debrief {
  transcript?: string;
  // The notes as ONE nested-bullet HTML document. Replaced `sections`, which
  // rendered as separate cards you could only copy one at a time — these get
  // pasted wholesale into OneNote, so they have to be a single document.
  notesHtml?: string;
  // Renames the user has applied ("the manager" -> "Sarah Chen"). Kept so a
  // re-analysis, which regenerates the notes from the transcript, doesn't
  // undo their naming — the map is replayed over the fresh output.
  nameMap?: Record<string, string>;
  // Storage path of the recording, when the user chose to keep it. Absent
  // means the audio was deleted after transcription, which is the default.
  audioPath?: string;
  // Typed answers to the structured debrief questions, keyed by question key.
  notes?: Record<string, string>;
  // Notes split into editable sections. `summary` is the older single-blob
  // form (an indented "- " outline) — still rendered when a debrief predates
  // sections, so existing meetings don't lose their notes.
  sections?: DebriefSection[];
  summary?: string;
  actions?: DebriefAction[];
}

// Structured debrief questions the user can type answers into (alongside
// record/upload). Their answers feed the AI summary.
export const DEBRIEF_QUESTIONS: { key: string; label: string; placeholder: string }[] = [
  {
    key: "overall",
    label: "How did it go overall?",
    placeholder: "Your gut read — tone, energy, how they received you…",
  },
  {
    key: "wins",
    label: "What landed well?",
    placeholder: "Moments they responded positively to, agreements reached…",
  },
  {
    key: "pushback",
    label: "What pushback or hard questions came up?",
    placeholder: "Objections, skepticism, anything you struggled to answer…",
  },
  {
    key: "open",
    label: "What was left open or unresolved?",
    placeholder: "Topics you didn't get to, questions you couldn't answer, things to revisit…",
  },
  {
    key: "commitments",
    label: "Who committed to what?",
    placeholder: "What you promised, what they promised, deadlines mentioned…",
  },
];

export type FolderKind = "person" | "topic";

// A person or topic a recording is filed under (see mp_folders). A meeting
// with folder_id null is "Uncategorized" — no separate flag needed, the
// absence is the state.
export interface MpFolder {
  id: string;
  user_id: string;
  kind: FolderKind;
  name: string;
  // Only meaningful for kind "person" — links this folder to a Territory
  // Planning KOL, so filing a meeting here also keeps kol_id in step.
  kol_id: string | null;
  created_at: string;
  updated_at: string;
}

// Patch to apply when a meeting is moved into (or out of) a folder. Carries
// the folder's KOL link along automatically — filing a recording under
// "Sam" keeps Territory Planning's kol_id in step without a second thing to
// set — but only when the folder actually has one; it never clears an
// existing kol_id a meeting already had for some other reason.
export function folderMovePatch(folder: MpFolder | null): Partial<MpMeeting> {
  return {
    folder_id: folder?.id ?? null,
    ...(folder?.kol_id ? { kol_id: folder.kol_id } : {}),
  };
}

export interface MpMeeting {
  id: string;
  user_id: string;
  title: string;
  meeting_type: MeetingType;
  date: string | null;
  duration_min: number;
  format: MeetingFormat;
  location: string;
  kol_id: string | null;
  folder_id: string | null;
  transcript_zip_path: string;
  attendees: Attendee[];
  // The fast path: describe the meeting in plain language; extraction fills
  // the structured fields below from it. Feeds the brief either way.
  explain: string;
  objectives: string;
  background: string;
  concerns: string;
  prior_transcript: string;
  documents: MpDocument[];
  ideas: IdeaSuggestion[];
  brief: Brief;
  grill: GrillItem[];
  debrief: Debrief;
  territory_logged: boolean;
  created_at: string;
  updated_at: string;
}

export interface CustomSection {
  key: string;
  title: string;
  prompt: string;
}

export interface MpSettings {
  user_id: string;
  custom_sections: CustomSection[];
  // The order the brief's boxes appear in, as section keys — the user's own
  // arrangement from "My brief". Keys missing from it (a new default section,
  // a one-off section added to a single brief) keep their natural position at
  // the end, so an order saved today still makes sense after the blueprint
  // changes. Empty/absent means the default order.
  section_order?: string[];
}

/**
 * Applies the user's saved order to a list of sections. Anything the order
 * doesn't mention keeps its original relative position, appended after the
 * ones it does.
 */
export function orderSections<T extends { key: string }>(
  items: T[],
  order: string[] | undefined,
): T[] {
  if (!order?.length) return items;
  const rank = new Map(order.map((k, i) => [k, i]));
  const known = items.filter((s) => rank.has(s.key));
  const rest = items.filter((s) => !rank.has(s.key));
  known.sort((a, b) => (rank.get(a.key) ?? 0) - (rank.get(b.key) ?? 0));
  return [...known, ...rest];
}

export const MEETING_TYPES: { key: MeetingType; label: string }[] = [
  { key: "kol_1on1", label: "KOL / HCP 1-on-1" },
  { key: "first_meeting", label: "First meeting / intro" },
  { key: "advisory_board", label: "Advisory board" },
  { key: "internal", label: "Internal / leadership" },
  { key: "congress", label: "Congress touchpoint" },
  { key: "presentation", label: "Presentation to a group" },
  { key: "difficult", label: "Difficult conversation" },
  { key: "other", label: "Other" },
];

export function meetingTypeLabel(t: MeetingType): string {
  return MEETING_TYPES.find((m) => m.key === t)?.label || "Meeting";
}

// Plain-text meeting context for client-composed AI calls (grill, coach,
// debrief). The brief action builds its own richer context server-side.
export function meetingContextText(m: MpMeeting): string {
  const att = (m.attendees || [])
    .filter((a) => a.name.trim())
    .map((a) => `- ${[a.name, a.role, a.org].filter(Boolean).join(", ")}${a.notes ? ` — ${a.notes}` : ""}`)
    .join("\n");
  return [
    m.title && `Meeting: ${m.title}`,
    `Type: ${meetingTypeLabel(m.meeting_type)}`,
    m.date && `When: ${new Date(m.date).toLocaleString()}`,
    `Duration: ${m.duration_min} minutes`,
    att && `Attendees:\n${att}`,
    htmlToPlain(m.explain) && `In the writer's own words:\n${htmlToPlain(m.explain)}`,
    htmlToPlain(m.objectives) && `Objectives:\n${htmlToPlain(m.objectives)}`,
    htmlToPlain(m.background) && `Background:\n${htmlToPlain(m.background)}`,
    htmlToPlain(m.concerns) && `Concerns:\n${htmlToPlain(m.concerns)}`,
    m.prior_transcript && `Previous meeting notes:\n${m.prior_transcript.slice(0, 8000)}`,
    ...(m.documents || [])
      .filter((d) => (d.text || "").trim())
      .map(
        (d) =>
          `Supporting document "${d.name}"${d.note ? ` (why it matters: ${d.note})` : ""}:\n${d.text.slice(0, 6000)}`,
      ),
  ]
    .filter(Boolean)
    .join("\n\n");
}

// Fingerprint of everything the brief is generated from — lets the UI detect
// when the setup changed after the brief was written (stale brief).
export function setupFingerprint(m: MpMeeting): string {
  const src = JSON.stringify([
    m.title,
    m.meeting_type,
    m.date,
    m.duration_min,
    m.format,
    m.location,
    m.kol_id,
    m.attendees,
    m.explain,
    m.objectives,
    m.background,
    m.concerns,
    m.prior_transcript,
    (m.documents || []).map((d) => [d.name, d.note, (d.text || "").length]),
  ]);
  let h = 5381;
  for (let i = 0; i < src.length; i++) h = ((h << 5) + h + src.charCodeAt(i)) | 0;
  return String(h);
}

// The default brief blueprint — every brief carries these sections, in this
// order, plus whatever custom sections the user saved to their profile.
//
// "How the meeting should go" leads, because that is the thing you actually
// want in front of you: the shape of the meeting, start to finish. Everything
// after it is depth on one part of that run-of-show. The user can reorder all
// of this in My brief → Order of the brief.
export const DEFAULT_BRIEF_SECTIONS: { key: string; title: string; prompt: string }[] = [
  {
    key: "agenda",
    title: "How the meeting should go",
    prompt:
      "The run of show, start to finish, as a nested outline. Each top-level item is one phase of the meeting with a rough timing in parentheses (e.g. \"Opening and rapport (0-5 min)\"), sequenced so the meeting reaches the objective, and fitting the stated duration. Nested under each phase: what to actually cover or say in it, and what a good outcome of that phase looks like before moving on. This is the section the writer reads walking in — make it the shape of the whole meeting, not a list of topics.",
  },
  {
    key: "objective",
    title: "Objective & what success looks like",
    prompt:
      "The writer's objective(s) restated sharply, plus 2-3 concrete markers of what a successful meeting produces.",
  },
  {
    key: "attendees",
    title: "Who's in the room",
    prompt:
      "One short block per attendee: who they are, what they care about, and one tailored talking point or connection to make with them.",
  },
  {
    key: "talking_points",
    title: "Key talking points",
    prompt:
      "4-7 prioritized, specific points to land, grounded only in the provided background. No inventions.",
  },
  {
    key: "questions_theyll_ask",
    title: "Questions they'll likely ask you",
    prompt:
      "The 4-6 most probable questions the other side will ask, each with a crisp suggested answer based on the background.",
  },
  {
    key: "questions_to_ask",
    title: "Smart questions to ask them",
    prompt: "4-6 questions the writer should ask that advance the objective and build the relationship.",
  },
  {
    key: "objections",
    title: "Objections & how to handle them",
    prompt: "Likely pushback or sensitive moments, each with a suggested handling approach.",
  },
  {
    key: "checklist",
    title: "Pre-meeting checklist",
    prompt:
      "A short checkable list of things to do or bring before the meeting (materials, data to look up, logistics).",
  },
  {
    key: "follow_up",
    title: "Follow-up plan",
    prompt: "What to send or do within 48 hours after the meeting, depending on how it goes.",
  },
];
