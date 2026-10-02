// Meeting Prep shared types + the default brief blueprint.

import { htmlToPlain } from "@/lib/writer/types";

export type MeetingType =
  | "kol_1on1"
  | "advisory_board"
  | "internal"
  | "congress"
  | "presentation"
  | "panel"
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
  // What this box is for, when it isn't a blueprint or saved custom section:
  // the model added it because this meeting needed it (origin "ai"). Kept so
  // a redo of the box, or a later whole-brief update, writes the same thing.
  prompt?: string;
  origin?: "ai";
}

// How good the writing engine was when a piece of this meeting was written.
// Bumped by hand whenever the prompts behind the brief or the question bank
// get materially better.
//
// It exists because of a real afternoon lost: the prompts were rewritten, the
// app shipped, and the meeting still showed the old brief with nothing to say
// so. The setup fingerprint can only notice the user changing something; it
// has no way to notice US changing something. This does.
//
// Raise BRIEF_ENGINE when the brief's prompt improves, QUESTIONS_ENGINE when
// the question bank's does. Anything stored below the current number offers
// itself for a rewrite.
// 3: the lines in a brief that get said out loud, questions boxes above all,
// no longer carry a source inside them, and a standing instruction given on
// the Questions tab now reaches them too.
export const BRIEF_ENGINE = 3;
// 3: the question prompt no longer inherits the brief's "cite the source in
// the line" rule, which was quietly overriding the writer when they asked it
// to stop opening every question with a consultancy's name.
// 4: asking was not enough. Every batch is now checked for a named source in
// the question itself, the failures are sent back to be rewritten, and
// anything that still names one is dropped before the writer sees it.
export const QUESTIONS_ENGINE = 4;

export interface Brief {
  sections?: BriefSection[];
  generatedAt?: string;
  /** The BRIEF_ENGINE value in force when this brief was written. */
  engine?: number;
  // Fingerprint of the setup fields the brief was generated from, so the UI
  // can tell when the setup changed and the brief is stale. Only bumped by a
  // full regenerate/refine — a single section redo shouldn't mark the whole
  // brief "fresh" when the other sections weren't touched.
  sourceFingerprint?: string;
  // Section keys the user has collapsed, remembered per meeting.
  collapsed?: string[];
  // What the web search turned up about the subject, kept so the user can see
  // what the brief was built from and so a single-box redo is written from the
  // same material instead of searching again.
  /**
   * What the web search turned up, kept so a later redo of one box is written
   * from the same material.
   *
   * `fingerprint` is the setup it was gathered for. Without it, changing the
   * subject of the meeting left every question still being written from
   * research about the old one: the writer moved their panel to value
   * communication and kept getting questions about AI, because AI was what
   * the search had found back when the meeting was called "the future of
   * medical affairs".
   */
  research?: { notes: string; at: string; fingerprint?: string };
  // The last read-through of the whole pack, and what it found. Lives on the
  // brief because that is where it is acted on.
  review?: Review;
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

// One question in the bank. The model writes text/category/why/followUp/
// forWhom/rank; the writer owns picked/backup/asked/order — which is why a
// regenerate adds to the list rather than replacing it.
export interface QuestionItem {
  id: string;
  text: string;
  category: string;
  /** At most a dozen words on what the question gets you. */
  why: string;
  /** The probe for when the first answer is thin. */
  followUp: string;
  /** Who to put it to, when that matters. Empty = anyone. */
  forWhom: string;
  /** The model's ranking across the batch it came from; 1 is strongest. */
  rank: number;
  /** In the writer's own list, the one they carry in. */
  picked: boolean;
  /** Picked, but held back for if the room goes quiet. */
  backup: boolean;
  /** Ticked off during the meeting. */
  asked: boolean;
  // Hands off. A rewrite re-writes everything the model wrote, which is right
  // when the batch is wrong and wrong when one question in it was perfect.
  // Locking a question takes it out of every future rewrite; questions the
  // writer typed themselves are always treated as locked.
  locked?: boolean;
  // Binned, not gone. Deleting used to drop the question out of the array,
  // and a question you bin while skimming is exactly the one you want back
  // twenty minutes later. It stays here, out of every list, until it is
  // either restored or deleted for good.
  deleted?: boolean;
  /** Position within the picked list; the writer arranges this. */
  order: number;
  source: "ai" | "user";
}

export interface QuestionBank {
  items?: QuestionItem[];
  generatedAt?: string;
  /** The QUESTIONS_ENGINE value in force when these were written. */
  engine?: number;
  /** Setup these were written from, so a changed topic can flag them stale. */
  sourceFingerprint?: string;
  // What the writer told the model to do differently ("stop opening every
  // question with a consultancy's name"). Kept so every later batch obeys it
  // too, rather than the correction lasting exactly one regenerate.
  guidance?: string;
  // What they want the bank to cover ("something on AI, and on how anyone
  // measures this"). Separate from `guidance` because it is checked
  // differently: guidance is a rule every question must pass, coverage is a
  // floor the bank as a whole has to clear, with no quota attached.
  coverage?: string;
}

// One piece of advice from a read-through of the whole prep pack. The point
// is to catch what is wrong when nothing has changed — a brief can be fully
// up to date and still have the agenda in the wrong order, or three questions
// that ask the same thing.
export interface ReviewNote {
  id: string;
  /** The advice itself, one line, written as something to do. */
  title: string;
  /** Why it matters and what good looks like. */
  detail: string;
  /** "section:<key>" | "questions" | "setup" | "" — what it is about. */
  target: string;
  /** How to say that target to a person ("Agenda", "Your questions"). */
  targetLabel: string;
  /** Written as an instruction, so "Fix it" can hand it straight to the writer. */
  fix: string;
  severity: "high" | "medium" | "low";
  /** Dealt with, by the AI or by hand. Crossed off, kept for the record. */
  done: boolean;
  /** Not worth doing. Gone from the list entirely. */
  dismissed: boolean;
}

export interface Review {
  notes?: ReviewNote[];
  at?: string;
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
// with neither slot set is "Uncategorized" — no separate flag needed, the
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

// Patch to apply when a meeting is moved into (or out of) one of its two
// slots. `kind` rather than reading it off the folder, because clearing a slot
// passes null and the null still has to know which of the two it is emptying.
//
// Carries the folder's KOL link along automatically — filing a recording under
// "Sam" keeps Territory Planning's kol_id in step without a second thing to
// set — but only when the folder actually has one; it never clears an
// existing kol_id a meeting already had for some other reason.
export function folderMovePatch(
  kind: FolderKind,
  folder: MpFolder | null,
): Partial<MpMeeting> {
  const slot: Partial<MpMeeting> =
    kind === "person" ? { person_folder_id: folder?.id ?? null } : { topic_folder_id: folder?.id ?? null };
  return {
    ...slot,
    ...(folder?.kol_id ? { kol_id: folder.kol_id } : {}),
  };
}

// Filed nowhere at all. Uncategorized is the absence of both slots, not a
// folder of its own, so this is the one place that spelling lives.
export function isUnfiled(m: Pick<MpMeeting, "person_folder_id" | "topic_folder_id">): boolean {
  return !m.person_folder_id && !m.topic_folder_id;
}

// Filed nowhere AND never asked about. Uncategorized is only a gap while the
// writer hasn't answered; once they pick "No person" / "No topic" they have
// answered, and the amber "file this" nagging has to stop.
export function needsFiling(
  m: Pick<MpMeeting, "person_folder_id" | "topic_folder_id" | "filing_reviewed">,
): boolean {
  return isUnfiled(m) && !m.filing_reviewed;
}

// Done with. Either the writer said so, or the clock did.
export function isHeld(m: Pick<MpMeeting, "held_at" | "date">): boolean {
  if (m.held_at) return true;
  return Boolean(m.date && new Date(m.date).getTime() < Date.now() - 3600_000);
}

// Whether a meeting belongs to one folder, in either slot — a person folder's
// view and a topic folder's view ask the same question of the same meeting.
export function inFolder(
  m: Pick<MpMeeting, "person_folder_id" | "topic_folder_id">,
  folderId: string,
): boolean {
  return m.person_folder_id === folderId || m.topic_folder_id === folderId;
}

export interface MpMeeting {
  id: string;
  user_id: string;
  title: string;
  // What the session itself is about, when that isn't the same as its name:
  // a panel's published title, the agenda line, the question on the table.
  // Shown at the top of every tab and treated as the subject the research,
  // the brief and the question bank all have to serve.
  topic: string;
  meeting_type: MeetingType;
  date: string | null;
  // "We had this one." A meeting used to leave Upcoming only by having a date
  // in the past, which left every undated meeting there forever.
  held_at: string | null;
  // "There is no date, on purpose" — the difference between not having
  // answered yet and having answered none. Stops the app asking.
  no_date: boolean;
  // The person/topic folders were set deliberately, including to neither.
  filing_reviewed: boolean;
  // null until the writer (or the Explain pre-pass) gives a length.
  duration_min: number | null;
  format: MeetingFormat;
  location: string;
  kol_id: string | null;
  // The two slots a meeting is filed under: who it was with, and what it was
  // about. Independent — either, both, or neither (Uncategorized).
  person_folder_id: string | null;
  topic_folder_id: string | null;
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
  questions: QuestionBank;
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
  { key: "panel", label: "Moderating a panel" },
  { key: "difficult", label: "Difficult conversation" },
  { key: "other", label: "Other" },
];

export function meetingTypeLabel(t: MeetingType): string {
  return MEETING_TYPES.find((m) => m.key === t)?.label || "Meeting";
}

// Plain-text meeting context for client-composed AI calls (grill, coach,
// debrief). The brief action builds its own richer context server-side.
/**
 * Plain letters.
 *
 * A title or topic pasted off a conference flyer or a LinkedIn post arrives
 * as mathematical bold Unicode: the writer's own panel subject was stored as
 * the styled variants of "Value Communication in Medical Affairs", not the
 * letters themselves. It reads identically to a person and is a completely
 * different string to a model — separate rare tokens with none of the word's
 * meaning attached to them, which is a bad start for every question written
 * about it. NFKC folds each of those variants back to the letter it is
 * imitating.
 */
export function plainLetters(s: string): string {
  return (s || "").normalize("NFKC").replace(/[ \t]+/g, " ").trim();
}

export function meetingContextText(m: MpMeeting): string {
  const att = (m.attendees || [])
    .filter((a) => a.name.trim())
    .map((a) => `- ${[a.name, a.role, a.org].filter(Boolean).join(", ")}${a.notes ? ` — ${a.notes}` : ""}`)
    .join("\n");
  return [
    m.title && `Meeting: ${m.title}`,
    m.topic && `What the session is about (the subject itself): ${m.topic}`,
    `Type: ${meetingTypeLabel(m.meeting_type)}`,
    m.date && `When: ${new Date(m.date).toLocaleString()}`,
    m.duration_min && `Duration: ${m.duration_min} minutes`,
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

/**
 * Is this brief (or bank) older than the engine that would write it now?
 * A piece written before the stamp existed counts as behind, because it was.
 */
export function engineBehind(stored: number | undefined, current: number): boolean {
  return (stored ?? 0) < current;
}

// Fingerprint of everything the brief is generated from — lets the UI detect
// when the setup changed after the brief was written (stale brief).
export function setupFingerprint(m: MpMeeting): string {
  const src = JSON.stringify([
    m.title,
    m.topic,
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
// A box's name is whatever the blueprint calls it TODAY. Briefs store the
// title they were written with, so without this a brief generated last month
// would keep the old wording for good — and renaming these for clarity would
// only reach briefs nobody has written yet.
export function sectionTitle(key: string, stored: string): string {
  return DEFAULT_BRIEF_SECTIONS.find((s) => s.key === key)?.title || stored;
}

export const DEFAULT_BRIEF_SECTIONS: { key: string; title: string; prompt: string }[] = [
  {
    key: "agenda",
    title: "Agenda: how to run it",
    prompt:
      "The run of show, start to finish, as a nested outline. Each top-level item is one phase of the meeting with a rough timing in parentheses (e.g. \"Opening and rapport (0-5 min)\"), sequenced so the meeting reaches the objective. If a duration is given, fit it in minutes; if not, give each phase its share of the time (e.g. \"(about a fifth of the time)\") and never state a total. Nested under each phase: what to do in it, with the actual words to say or ask written out beneath each move, and what a good outcome of that phase looks like before moving on. This is the section the writer reads walking in — make it the shape of the whole meeting, not a list of topics.",
  },
  {
    key: "objective",
    title: "Your goal",
    prompt:
      "The writer's objective(s) restated sharply, plus 2-3 concrete markers of what a successful meeting produces.",
  },
  {
    key: "attendees",
    title: "Who's in the room",
    prompt:
      "One short block per attendee: who they are, what they care about, and one tailored talking point or connection to make with them, written out as the line to say. If the writer has to introduce people, include each introduction word for word.",
  },
  {
    key: "landscape",
    title: "What's new in this space",
    prompt:
      "The state of the subject itself, built from the research notes: 3-5 developments, debates, figures or changes that are live right now, each named specifically with its source and year, and nested under each one the line about why it matters for THIS meeting and how the writer can use it. This is the section that makes the writer sound like they have been paying attention. No generic observations about the industry; if the research notes are empty, use what you know of the field and mark anything checkable.",
  },
  {
    key: "talking_points",
    title: "Key talking points",
    prompt:
      "4-7 prioritized, specific points to land, grounded only in the provided background. No inventions.",
  },
  {
    key: "questions_theyll_ask",
    title: "Questions you'll get asked",
    prompt:
      "The 4-6 most probable questions the writer will be asked (by the other side, or by the audience or group if they are presenting or moderating), each with a crisp suggested answer written out in full.",
  },
  {
    key: "questions_to_ask",
    title: "Questions to ask",
    prompt:
      "4-6 questions the writer should ask that advance the objective and build the relationship, each written out in full exactly as they would say it. When there are several people to ask, say who each question is for, and nest a follow-up probe under the ones worth pushing on.",
  },
  {
    key: "objections",
    title: "Pushback to expect",
    prompt:
      "Likely pushback or sensitive moments, each with how to handle it and the actual words to say.",
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
