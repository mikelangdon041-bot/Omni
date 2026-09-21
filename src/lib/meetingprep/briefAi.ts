// Writing a Meeting Prep brief.
//
// Lives here rather than inline in /api/meeting/ai so the prompt can be run
// against a real meeting outside the browser: the route and any check script
// call the same function, so a check exercises the prompt that ships.

import { anthropic, WRITER_MODEL } from "@/lib/anthropic";
import { stripHtml } from "@/lib/territory/utils";

export interface MeetingPayload {
  title?: string;
  meetingType?: string;
  date?: string;
  durationMin?: number | null;
  format?: string;
  location?: string;
  attendees?: { name?: string; role?: string; org?: string; notes?: string }[];
  explain?: string;
  objectives?: string;
  background?: string;
  concerns?: string;
  priorTranscript?: string;
  documents?: { name?: string; note?: string; text?: string }[];
}

export interface BriefSectionSpec {
  key: string;
  title: string;
  prompt: string;
}

export interface WrittenSection {
  key: string;
  title: string;
  content: string;
  // Set only on a section the model added on its own because this meeting
  // needed something the blueprint has no box for. `prompt` is what it was
  // asked to write, kept so a later redo of that box knows what it is for.
  prompt?: string;
  origin?: "ai";
}

export function meetingContext(m: MeetingPayload, kolBlock: string): string {
  const att = (m.attendees || [])
    .filter((a) => (a.name || "").trim())
    .map(
      (a) =>
        `- ${a.name}${a.role ? `, ${a.role}` : ""}${a.org ? ` (${a.org})` : ""}${a.notes ? ` — ${a.notes}` : ""}`,
    )
    .join("\n");
  return [
    m.title && `Meeting: ${m.title}`,
    m.meetingType && `Type: ${m.meetingType}`,
    m.date && `When: ${m.date}`,
    // Only a length the writer actually gave. An unset duration used to go
    // out as the column default ("30 minutes") and the brief built a
    // 30-minute run of show around a number nobody said.
    m.durationMin ? `Duration: ${m.durationMin} minutes` : "Duration: not given",
    m.format && `Format: ${m.format}`,
    m.location && `Location: ${m.location}`,
    att && `Attendees:\n${att}`,
    m.explain && `In the writer's own words:\n${stripHtml(m.explain)}`,
    m.objectives && `The writer's objectives:\n${stripHtml(m.objectives)}`,
    m.background && `Background:\n${stripHtml(m.background)}`,
    m.concerns && `Concerns / sensitivities:\n${stripHtml(m.concerns)}`,
    kolBlock && `Linked contact profile (from Territory Planning):\n${kolBlock}`,
    m.priorTranscript &&
      `Transcript/notes from a previous meeting with these people:\n${m.priorTranscript.slice(0, 20000)}`,
    ...(m.documents || [])
      .filter((d) => String(d.text || "").trim())
      .slice(0, 8)
      .map(
        (d) =>
          `Supporting document "${d.name || "untitled"}"${
            d.note ? ` — the writer says about it: "${d.note}"` : ""
          }:\n${String(d.text).slice(0, 15000)}`,
      ),
  ]
    .filter(Boolean)
    .join("\n\n");
}

// Formatting rule shared by every action that writes brief content — Claude's
// default house style leans on bold labels and headers; this app renders
// content as plain prose in a document, not a chat bubble.
export const NO_FORMATTING_RULE =
  "Plain prose. No bold, no markdown, no headers, no emoji. Use <b> only mid-sentence for a genuinely critical word or number, never to label a whole line or start a bullet. Write like a person handing over notes, not like an AI assistant's answer.";

// How a brief section's `content` is structured. A brief is read standing up,
// on the way into a room — it has to be scannable as an outline, so anything
// with more than one part comes back as a nested list rather than a wall of
// paragraphs. The app renders these as an indented tree.
const BRIEF_HTML_RULE = `Each section's content is an HTML fragment using ONLY these tags: <p>, <ul>, <li>, <b>, <i>. No headings, no <div>, no <br>, no markdown, no bullet characters typed into the text (the <li> is the bullet).

Structure it as a tree, not a wall of text:
- A section with several points is a <ul> of <li>. One <li> = one point, stated in a complete sentence.
- Detail that elaborates a point goes in a <ul> nested INSIDE that point's own <li>, never as a sibling. Two levels is the norm; three is the maximum; never more.
- Keep parent items short enough to scan on their own — the parent is the headline, the children carry the specifics (what to say, numbers, names, the reason).
- Use a <p> only for a genuinely single-thought section that has nothing to nest.`;

// The failure this exists for: a brief that says "ask one sharp opening
// question" and never asks it, or "set the room in two sentences" and never
// writes them. Direction without the words is the part the writer could have
// come up with alone; the words are what they opened the brief for.
const SCRIPT_RULE = `Write the words, not just the move. This is the most important rule in the brief.
- Whenever you tell the writer to say, ask, open, introduce, frame, transition, redirect, interrupt, answer or close, nest the actual words directly under that point as an <i> sub-bullet, written to be spoken aloud as is. Give the question, not "ask a sharp question". Give the two sentences, not "set the room in two sentences". Give the intro line, not "introduce each person briefly".
- Where you give several of something (questions, intros, transitions), write every one of them out. "Have three backup questions ready" means three written questions.
- When the right words depend on a fact you don't have (a name, a title, a number), still write the line and put a bracketed placeholder where the fact goes, e.g. <i>[Panelist name] leads [function] at [organization]; I asked them here because...</i>. Never skip the line because a detail is missing.
- A scripted line is something the writer will say out loud in front of people, so it may only state facts the context gives. How many people are on the panel or in the room, the time of day, and how long the session runs are NOT given unless the context says so: write "our panel", "welcome", "today", never a number or "good afternoon".
- Keep each scripted line short enough to say in one breath or glance at on a card.`;

// The blueprint's section titles are written for someone sitting across a
// table from one person. A moderator, a presenter or an interviewer is in a
// different seat, and reading "questions to ask them" literally produced a
// brief with nothing a moderator could use.
const SEAT_RULE = `Work out the writer's seat before writing anything: are they meeting one person, moderating or chairing a group, presenting, interviewing, negotiating, or attending? Write every section from that seat. The section titles are fixed, but read each one for what it means in this meeting: for a moderator, "questions to ask them" is the question bank for the panel, "questions they'll likely ask you" is what the audience and panelists will throw at the moderator, "who's in the room" includes how to introduce each person.`;

// When the fixed boxes can't hold what this meeting needs, the model adds its
// own. A moderator needs a question bank per panelist; a keynote speaker needs
// the opening written out; a negotiator needs a walk-away table. None of those
// belong in every brief, so none of them are blueprint sections.
const EXTRA_SECTIONS_RULE = `Improvise when the meeting needs it. The requested sections are a standard blueprint. If this particular meeting needs something substantial that none of them has room for, add it in "extraSections" (at most 3). Examples: a question bank for the panelists, with which panelist each question is for and a follow-up probe, when the writer is moderating; the opening remarks written out word for word when they have to open a session; a line-by-line introduction for each person they must introduce; a walk-away table for a negotiation.
- Start from what the writer explicitly asked for help with. Anything they asked for by name (transitions, an opening, intros, a closing, how to handle a specific moment) that has no natural home in the requested sections gets its own box, written out in full.
- Only add a section that carries real content the writer will use in the room, and that would be cramped or missing inside the requested sections. Most one-on-one meetings need none; return an empty array then.
- Never add a section that repeats a requested section, and never one whose title matches an existing section.
- key: short snake_case, unique. title: a plain box heading (3-7 words). prompt: one or two sentences describing what the section contains, written as an instruction, so it can be rewritten later. content: the section itself, following every rule above.`;

const SECTION_ITEM = {
  type: "object" as const,
  properties: {
    key: { type: "string" as const },
    title: { type: "string" as const },
    content: { type: "string" as const },
  },
  required: ["key", "title", "content"],
  additionalProperties: false,
};

const BRIEF_SCHEMA = {
  type: "object" as const,
  properties: {
    sections: { type: "array" as const, items: SECTION_ITEM },
  },
  required: ["sections"],
  additionalProperties: false,
};

const BRIEF_WITH_EXTRAS_SCHEMA = {
  type: "object" as const,
  properties: {
    sections: { type: "array" as const, items: SECTION_ITEM },
    extraSections: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          key: { type: "string" as const },
          title: { type: "string" as const },
          prompt: { type: "string" as const },
          content: { type: "string" as const },
        },
        required: ["key", "title", "prompt", "content"],
        additionalProperties: false,
      },
    },
  },
  required: ["sections", "extraSections"],
  additionalProperties: false,
};

export class BriefRefusal extends Error {}

function firstText(res: { content: { type: string; text?: string }[] }): string {
  const block = res.content.find((b) => b.type === "text");
  return (block?.text || "").trim();
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);

export async function writeBrief({
  meeting,
  sections,
  kolBlock = "",
  guidance = "",
  previous,
  onlyKey = "",
}: {
  meeting: MeetingPayload;
  sections: BriefSectionSpec[];
  kolBlock?: string;
  guidance?: string;
  previous?: unknown;
  onlyKey?: string;
}): Promise<WrittenSection[]> {
  const context = meetingContext(meeting, kolBlock);
  const wanted = onlyKey ? sections.filter((s) => s.key === onlyKey) : sections;
  // Extra boxes are only offered when the whole brief is being written, so
  // there is a whole picture to judge the gap against. A single-box redo (or
  // "Add section", which sends exactly one) stays exactly that.
  const allowExtras = !onlyKey && wanted.length > 1;

  const res = await anthropic().messages.create({
    model: WRITER_MODEL,
    max_tokens: 16000,
    output_config: {
      format: {
        type: "json_schema",
        schema: allowExtras ? BRIEF_WITH_EXTRAS_SCHEMA : BRIEF_SCHEMA,
      },
    },
    system: `You are a sharp, experienced chief of staff writing a pre-meeting brief for someone about to walk into the room. Produce sections a real person would hand another person, not an AI-generated report.

${NO_FORMATTING_RULE}

${BRIEF_HTML_RULE}

${SCRIPT_RULE}

${SEAT_RULE}
${allowExtras ? `\n${EXTRA_SECTIONS_RULE}\n` : ""}
Hard rules:
- Ground everything in the provided meeting context. NEVER invent facts, names, data, or commitments not present. When context is thin for a section, give genuinely useful general guidance for this type of meeting instead of fabricating specifics — say less rather than make things up.
- Never state a length, date, time of day or headcount that the context doesn't give, including in scripted lines: not "these four panelists", not "good afternoon", not "over the next thirty minutes". Write around it ("our panel", "welcome") or use a placeholder. If the duration is "not given", don't assume one: express timings as a share of the time and say once that they firm up when the slot length is confirmed.
- When a previous version of a section is provided, that is the user's own current text (possibly hand-edited). Build on it and extend it — keep everything in it that the guidance didn't ask you to change. Do not silently rewrite it into your own voice or drop details it already has. Only make the specific change the guidance asks for; if no guidance is given, make the smallest improvement that adds real value (fix a gap, sharpen something vague, write out words the section only describes) rather than a wholesale rewrite.
- Be concrete and practical — things you could actually say or do, not platitudes.
- Suggested answers must be usable verbatim as a starting point.
- Keep each section tight; this is read on the way into the room. Cut commentary before you cut scripted lines.
- Return one entry in "sections" per requested section, same keys and titles, in the same order.`,
    messages: [
      {
        role: "user",
        content: `Meeting context:\n${context || "(minimal context provided)"}\n\nSections to write (key — title — what it should contain):\n${wanted
          .map((s) => `- ${s.key} — ${s.title} — ${s.prompt}`)
          .join("\n")}${
          previous
            ? `\n\nThe user's current version of ${Array.isArray(previous) && previous.length === 1 ? "this section" : "these sections"} (build on it, don't discard it):\n${JSON.stringify(previous).slice(0, 30000)}\n\nGuidance: ${guidance || "(no specific guidance — make only a small, genuinely useful improvement)"}`
            : guidance
              ? `\n\nExtra guidance from the writer: ${guidance}`
              : ""
        }`,
      },
    ],
  });
  if (res.stop_reason === "refusal")
    throw new BriefRefusal("The model declined this request — try rephrasing.");
  if (res.stop_reason === "max_tokens")
    throw new Error("The brief ran too long to finish — try again, or refine it section by section.");

  const parsed = JSON.parse(firstText(res) || "{}");
  const out: WrittenSection[] = (Array.isArray(parsed.sections) ? parsed.sections : []).map(
    (s: { key?: unknown; title?: unknown; content?: unknown }) => ({
      key: String(s?.key || ""),
      title: String(s?.title || ""),
      content: String(s?.content || ""),
    }),
  );
  if (!allowExtras) return out;

  const taken = new Set(sections.map((s) => s.key));
  const takenTitles = new Set(sections.map((s) => s.title.trim().toLowerCase()));
  for (const e of (Array.isArray(parsed.extraSections) ? parsed.extraSections : []).slice(0, 3)) {
    const title = String(e?.title || "").trim();
    const content = String(e?.content || "").trim();
    if (!title || !content || takenTitles.has(title.toLowerCase())) continue;
    // Namespaced so a model-chosen key can never collide with a blueprint or
    // saved custom section, now or after the blueprint grows.
    let key = `ai_${slug(String(e?.key || "") || title) || "section"}`;
    while (taken.has(key)) key += "_";
    taken.add(key);
    takenTitles.add(title.toLowerCase());
    out.push({ key, title, content, prompt: String(e?.prompt || "").trim(), origin: "ai" });
  }
  return out;
}
