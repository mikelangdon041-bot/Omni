// Writing a Meeting Prep brief.
//
// Lives here rather than inline in /api/meeting/ai so the prompt can be run
// against a real meeting outside the browser: the route and any check script
// call the same function, so a check exercises the prompt that ships.

import { anthropic, RESEARCH_MODEL, WRITER_MODEL } from "@/lib/anthropic";
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

// The rule the "never invent" rule kept eating. Told only not to invent, the
// model treated its own subject knowledge as an invention too, and wrote
// process advice with the substance left out: questions that restate the panel
// title, talking points about "tying points to what they care about". Nobody
// needs a brief to be told to ask a good question. They need the question that
// only someone who knows the field would ask.
const DOMAIN_RULE = `Bring what you know about the subject. "Never invent" governs facts about THIS meeting and THESE people, not the subject matter itself.
- On the field, the science, the market, the policy or the technology in play: be specific and current. Name the actual shifts, the real debates, the regulations, the metrics, the technologies and the numbers, in the terms practitioners use. Where research notes are provided, they are the freshest material you have: lead with them.
- Every question, talking point and objection must be one only someone who knows this field could have written. A question that restates the meeting's title back as a question ("what does the future of X look like?", "what does strategic leadership really mean?") is filler: replace it with one that names the specific tension, change, number or trade-off underneath it.
- Prefer the concrete disagreement to the abstraction: who is under pressure, what is being cut or funded, what changed in the last year or two, what people in this field argue about privately.
- Attribute what you draw from the research notes inline, briefly, as source plus year. Where you are working from your own knowledge and the fact is checkable and load-bearing, mark it "(worth checking)" so the writer verifies before saying it out loud. Never dress up a guess as a cited fact.`;

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

// Reading up on the subject before writing a word of the brief.
//
// This runs as its own plain-text call, the way Writing Studio's "Look it up"
// does: a search loop wants to think out loud across several turns, and the
// brief call is pinned to a JSON schema. The notes come back once and are
// then handed to the brief (and kept on the meeting, so a later single-box
// redo is written from the same material rather than searching again).
/**
 * Did the model spend its notes explaining that it could not search, rather
 * than on the subject? The giveaway is in the opening lines; a note that
 * mentions in passing that one fact could not be confirmed is still useful,
 * so only the opening and explicit tool-limit wording count.
 */
export function researchIsAnApology(notes: string): boolean {
  const opener = notes.slice(0, 400);
  return (
    /\b(search|web search|the tool)\b[^.]{0,60}\b(was|is|has been|were)\b[^.]{0,40}\b(unavailable|down|blocked|failing|not available)/i.test(
      opener,
    ) ||
    /\b(unable|not able|could ?n[o\u2019']t|failed) to (search|retrieve|access|reach)/i.test(opener) ||
    /\btool[- ]limit\b|\busage limit\b|\bmax_uses_exceeded\b/i.test(notes)
  );
}

export async function researchMeeting(
  meeting: MeetingPayload,
  kolBlock = "",
): Promise<string> {
  const searchTools = [
    { type: "web_search_20260209" as const, name: "web_search" as const, max_uses: 8 },
  ];
  const system = `You are the researcher for a meeting brief. Someone is about to walk into this meeting; your job is to find what they should know about the SUBJECT, so the brief can be specific instead of generic.

What to search for, in priority order:
- The subject matter itself: what is actually happening in this field right now, the live debates, what changed in the last year or two, the numbers people cite, the terms of art. This is most of the value.
- The named people and organizations in the context, if any: their role, their recent work, positions they have taken publicly, anything that shapes how to talk to them.
- The event, venue or programme, if one is named.

Rules:
- Search before answering. Never answer from memory alone.
- Do NOT narrate the searching. No "let me look that up", no commentary on what came back. Only the findings.
- Return plain text. No markdown of any kind: no headings, no asterisks, no bold. Under 400 words, as short labelled lines or a tight list.
- Start with the first finding. No preamble, no "here is your briefing", no sign-off.
- Lead with what changes the content of the brief: the specific developments, tensions and figures the writer could name out loud in the room.
- Attribute every substantive claim inline as a source plus year ("McKinsey, 2025"). No bare URLs, no footnotes.
- Where sources disagree, say so in a line rather than picking a winner.
- End with two or three lines headed "Open questions in the field" naming what practitioners genuinely argue about, since those make the sharpest questions.
- If a search turns up nothing solid on something, say so plainly rather than filling the gap with plausible invention.
- If a search fails, move on to the next one. Do not retry the same search repeatedly.
- You are writing notes that another program will read, not talking to a person. Never address the reader, never ask them anything, never offer to do more.`;

  const question = `Research the subject of this meeting so the brief can be specific.\n\n${meetingContext(
    meeting,
    kolBlock,
  ) || "(minimal context)"}`;

  // Low effort on a fast model: this step searches and condenses, it does
  // not reason, and it has to come back inside the route's 300s ceiling.
  const params = {
    model: RESEARCH_MODEL,
    max_tokens: 6000,
    output_config: { effort: "low" as const },
    tools: searchTools,
    system,
  };
  let res = await anthropic().messages.create({
    ...params,
    messages: [{ role: "user", content: question }],
  });
  // A server-side tool loop can stop for breath partway through; re-send so it
  // can finish, carrying the system prompt along or the second half is written
  // without any of the rules above.
  for (let i = 0; i < 3 && res.stop_reason === "pause_turn"; i++) {
    res = await anthropic().messages.create({
      ...params,
      messages: [
        { role: "user", content: question },
        { role: "assistant", content: res.content },
      ],
    });
  }
  if (res.stop_reason === "refusal") return "";

  // Only the text after the last tool block is the answer; the text between
  // tool calls is the model working out loud. Matching on "not text" rather
  // than naming the block types, because this tool version filters results
  // through code execution and the turn comes back as an interleaving of
  // several kinds of tool block.
  const lastToolAt = res.content.reduce(
    (found, block, i) => (block.type === "text" ? found : i),
    -1,
  );
  const notes = res.content
    .slice(lastToolAt + 1)
    .filter((b) => b.type === "text")
    .map((b) => ("text" in b ? b.text || "" : ""))
    .join("\n")
    .trim();
  // A search tool that errors (a usage limit, an outage) leaves the model
  // writing about the tool instead of the subject. Those notes are worse than
  // none — one brief opened its landscape section with "Search was down when
  // this brief was written" — so they are thrown away and the brief is written
  // from the model's own knowledge of the field instead.
  //
  // Two checks, because neither alone caught it: a result block can come back
  // with rows while the searches that mattered still failed, and the giveaway
  // is then in the notes, which open by apologising for the tool.
  const searched = res.content.some(
    (b) =>
      b.type === "web_search_tool_result" &&
      Array.isArray((b as { content?: unknown }).content) &&
      (b as { content: unknown[] }).content.length > 0,
  );
  if (!searched || researchIsAnApology(notes)) return "";
  return notes
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/^#{1,6}\s*/gm, "")
    .trim();
}

export async function writeBrief({
  meeting,
  sections,
  kolBlock = "",
  guidance = "",
  previous,
  onlyKey = "",
  research = "",
}: {
  meeting: MeetingPayload;
  sections: BriefSectionSpec[];
  kolBlock?: string;
  guidance?: string;
  previous?: unknown;
  onlyKey?: string;
  /** Findings from researchMeeting(), treated as the freshest facts available. */
  research?: string;
}): Promise<WrittenSection[]> {
  const context = [
    meetingContext(meeting, kolBlock),
    research &&
      `Research notes, from a web search run just now for this brief. Treat these as current fact and use them — this is the material that makes the brief worth reading:\n${research.slice(0, 20000)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
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

${DOMAIN_RULE}
${allowExtras ? `\n${EXTRA_SECTIONS_RULE}\n` : ""}
Hard rules:
- NEVER invent facts, names, data or commitments about this meeting or these people that the context doesn't give. That restriction is about them, not about the subject — see the rule above on bringing what you know.
- When the context is thin on the people, do NOT fall back to advice about how to have a meeting. Fill the space with substance about the subject instead: the real questions, the live debates, what is actually changing. Process advice with no subject matter in it is the one thing this brief must never be.
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
