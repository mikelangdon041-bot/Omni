// The Reading tab: what to read before a meeting, what each piece actually
// says, and what about the subject is still unsettled. Also reads a piece of
// material the writer added, for the reason they gave, and looks a person up.
//
// Exists because the research behind the brief was written to be read by
// another prompt: squeezed to 400 words with the links stripped, so the
// writer saw "McKinsey, 2025" under a question and had no way to see what
// McKinsey had actually found.

import { anthropic, QUICK_MODEL, RESEARCH_MODEL } from "@/lib/anthropic";
import { meetingContext, type MeetingPayload } from "./briefAi";

export interface FoundSource {
  title: string;
  outlet: string;
  date: string;
  url: string;
  summary: string;
  findings: string[];
  why: string;
  priority: "must" | "skim";
}

export interface UnsettledPoint {
  point: string;
  sides: { position: string; who: string }[];
}

export interface ReadingOut {
  overview: string;
  sources: FoundSource[];
  unsettled: UnsettledPoint[];
}

type Block = { type: string; [k: string]: unknown };

// Every link the search handed back this turn, wherever the tool put it:
// result blocks and citations both carry them, so all of them are walked.
function seenLinks(content: unknown): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (v: unknown) => {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) return v.forEach(walk);
    const o = v as Record<string, unknown>;
    if (typeof o.url === "string" && /^https?:\/\//.test(o.url)) {
      const key = normUrl(o.url);
      if (!out.has(key)) out.set(key, typeof o.title === "string" ? o.title : "");
    }
    for (const k of Object.keys(o)) walk(o[k]);
  };
  walk(content);
  return out;
}

function normUrl(u: string): string {
  try {
    const x = new URL(u.trim());
    x.hash = "";
    for (const k of [...x.searchParams.keys()])
      if (/^utm_|^fbclid$|^gclid$/.test(k)) x.searchParams.delete(k);
    return `${x.host.replace(/^www\./, "")}${x.pathname.replace(/\/+$/, "")}${x.search}`.toLowerCase();
  } catch {
    return u.trim().toLowerCase();
  }
}

// Repositories and link services: one host, many unrelated publishers.
const REPOSITORIES = /(^|\.)(ncbi\.nlm\.nih\.gov|pubmed\.gov|doi\.org|europepmc\.org|researchgate\.net|semanticscholar\.org|sciencedirect\.com|springer\.com|wiley\.com|tandfonline\.com|sagepub\.com|frontiersin\.org|mdpi\.com|bmj\.com|nature\.com|jamanetwork\.com|linkedin\.com|medium\.com|youtube\.com|scholar\.google\.com)$/;

/** Who a piece is really from: its named outlet, and its site unless shared. */
function publisherKeys(outlet: string, url: string): string[] {
  const keys: string[] = [];
  const name = outlet
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/\b(via|the|inc|llc|ltd)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  // "PMC" or "PubMed" names the shelf, not who wrote it.
  if (name && !/^(pmc|pubmed|pubmed central|ncbi|doi|google scholar)$/.test(name)) keys.push(`o:${name}`);
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    if (host && !REPOSITORIES.test(host)) keys.push(`h:${host}`);
  } catch {
    // no site to key on
  }
  return keys;
}

// The text after the last tool block: everything before it is the model
// working out loud between searches.
function finalText(content: Block[]): string {
  const lastToolAt = content.reduce((found, b, i) => (b.type === "text" ? found : i), -1);
  return content
    .slice(lastToolAt + 1)
    .filter((b) => b.type === "text")
    .map((b) => String(b.text || ""))
    .join("\n")
    .trim();
}

function firstText(content: Block[]): string {
  const b = content.find((x) => x.type === "text");
  return String(b?.text || "").trim();
}

// A search turn cannot also be held to a JSON schema, so it is asked for JSON
// and read leniently. When it still comes back as prose, the quick model
// turns that prose into the shape, which is a rewrite, not a second search.
async function asJson<T>(text: string, schema: Record<string, unknown>, what: string): Promise<T | null> {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1)) as T;
    } catch {
      // fall through to the reshape
    }
  }
  if (!text.trim()) return null;
  const res = await anthropic().messages.create({
    model: QUICK_MODEL,
    max_tokens: 8000,
    output_config: { format: { type: "json_schema", schema } },
    system: `Convert the ${what} below into the JSON shape. Copy the content and every URL exactly; add nothing, invent nothing.`,
    messages: [{ role: "user", content: text.slice(0, 60000) }],
  });
  try {
    return JSON.parse(firstText(res.content as unknown as Block[]) || "{}") as T;
  } catch {
    return null;
  }
}

async function searchTurn(system: string, question: string, maxUses: number, maxTokens: number) {
  const params = {
    model: RESEARCH_MODEL,
    max_tokens: maxTokens,
    output_config: { effort: "low" as const },
    // The plain search tool, not the one that filters results through code
    // execution: measured on the same panel meeting, 71s against 304s for a
    // full reading list, which put the newer tool past the route's 300s
    // ceiling with no better sources to show for it.
    tools: [{ type: "web_search_20250305" as const, name: "web_search" as const, max_uses: maxUses }],
    system,
  };
  let res = await anthropic().messages.create({
    ...params,
    messages: [{ role: "user", content: question }],
  });
  // A server-side tool loop can stop for breath partway; re-send so it can
  // finish, with the system prompt, or the rest is written without the rules.
  const all: unknown[] = [res.content];
  for (let i = 0; i < 3 && res.stop_reason === "pause_turn"; i++) {
    res = await anthropic().messages.create({
      ...params,
      messages: [
        { role: "user", content: question },
        { role: "assistant", content: res.content },
      ],
    });
    all.push(res.content);
  }
  return { res, links: seenLinks(all) };
}

const SIDE = {
  type: "object" as const,
  properties: { position: { type: "string" as const }, who: { type: "string" as const } },
  required: ["position", "who"],
  additionalProperties: false,
};

const SOURCE = {
  type: "object" as const,
  properties: {
    title: { type: "string" as const },
    outlet: { type: "string" as const },
    date: { type: "string" as const },
    url: { type: "string" as const },
    summary: { type: "string" as const },
    findings: { type: "array" as const, items: { type: "string" as const } },
    why: { type: "string" as const },
    priority: { type: "string" as const, enum: ["must", "skim"] },
  },
  required: ["title", "outlet", "date", "url", "summary", "findings", "why", "priority"],
  additionalProperties: false,
};

const READING_SCHEMA = {
  type: "object" as const,
  properties: {
    overview: { type: "string" as const },
    sources: { type: "array" as const, items: SOURCE },
    unsettled: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          point: { type: "string" as const },
          sides: { type: "array" as const, items: SIDE },
        },
        required: ["point", "sides"],
        additionalProperties: false,
      },
    },
  },
  required: ["overview", "sources", "unsettled"],
  additionalProperties: false,
};

const SOURCE_RULES = `What makes a good source here:
- A real, specific piece someone can open and read: a paper, a report, a survey, a guideline, a serious article, a talk or interview with a named person. Not a vendor landing page, a listicle, a press-release echo of something you could cite directly, or a search page.
- Recent where the subject moves; the canonical piece where it does not.
- Every piece from a DIFFERENT publisher or organisation. Never two from the same society, firm, journal, website or author, and never two papers written up from the same study, survey or dataset (a "companion paper" counts as the same source). The list is a range of voices, not one voice twice.
- A mix of kinds: peer-reviewed research, industry or survey data, a practitioner's or trade-press view, and at least one piece that is critical of or argues against the prevailing view. A list that agrees with itself is half a list.
- Where the field has camps, the reading list covers more than one.
- Tied to THIS meeting's subject, not the broad field around it.

For each source:
- url: copied exactly from a search result you actually saw this turn. Never write a URL from memory and never guess one. If you cannot point to the page, leave the source out.
- title: the piece's own title. outlet: the publisher, journal or author. date: as the source dates itself ("2025", "March 2026"), or "" if it does not say.
- summary: two or three plain sentences: what it is and what it argues or found.
- findings: 2-5 lines, each one figure, finding or position from the piece, stated as the piece states it, with the number where there is one ("62% of medical affairs leaders say ... (n=410)"). Only what the source says; if you only saw a snippet, only what the snippet says.
- why: one line on why this is worth the writer's time for this meeting specifically.
- priority: "must" for the two or three pieces the writer should not walk in without having read; "skim" for the rest.`;

const PLAIN = `Plain text inside every field. No markdown, no asterisks, no headings, no emoji, no em dashes.`;

/**
 * Build the reading list, or add to it.
 *
 * `more` is a "find more" request: existing sources are named so none comes
 * back, and only new sources are returned (no overview, no unsettled points).
 */
export async function buildReading({
  meeting,
  kolBlock = "",
  frame,
  steer = "",
  ask = "",
  existing = [],
  rejected = [],
  more = false,
  count = 6,
}: {
  meeting: MeetingPayload;
  kolBlock?: string;
  /** How the unsettled-points section reads for this seat. */
  frame: { title: string; hint: string };
  /** The writer's standing preference for sources. */
  steer?: string;
  /** What they want from this particular search. */
  ask?: string;
  existing?: { title: string; url: string; outlet?: string }[];
  rejected?: { title: string; url: string; reason: string }[];
  more?: boolean;
  count?: number;
}): Promise<ReadingOut> {
  const n = Math.max(1, Math.min(8, count));
  const system = `You build the reading list for someone about to walk into a meeting. They want to understand the subject well enough to hold their own: what it is, what to read, and what each piece actually says, with the data and the opinions in it, not just its name.

Search before answering; never answer from memory alone. Do not narrate the searching. If a search fails, move on.

${SOURCE_RULES}

${
  more
    ? `This is a request for MORE sources. Return up to ${n} new ones that are not already on the list. Return "" for overview and [] for unsettled.`
    : `Return:
- overview: the subject in brief, for someone who knows the general field but not this corner of it. Two or three short paragraphs separated by a blank line: what the subject is, why it matters right now, and the terms practitioners use. Concrete, current, no throat-clearing.
- sources: ${n + 2} sources, "must" ones first, every one from a different publisher.
- unsettled: the section headed "${frame.title}". ${frame.hint} 2-4 points. Each point is one line naming what is unsettled; each side is a position stated in a sentence and who holds it (a named person, organisation or camp from the sources; for the people in the meeting, say "likely" and why). Only genuinely contested or undecided things. If nothing about this subject is genuinely unsettled, return [].`
}

${PLAIN}

Finish with the JSON object and nothing after it: {"overview": string, "sources": [{"title","outlet","date","url","summary","findings":[string],"why","priority"}], "unsettled": [{"point","sides":[{"position","who"}]}]}`;

  const question = [
    `The meeting:\n${meetingContext(meeting, kolBlock) || "(minimal context)"}`,
    steer.trim() && `What the writer wants from sources, always:\n${steer.trim()}`,
    ask.trim() && `What they want from this search:\n${ask.trim()}`,
    existing.length &&
      `Already on the reading list, so do not return these again:\n${existing
        .map((s) => `- ${s.title}${s.url ? ` (${s.url})` : ""}`)
        .join("\n")}`,
    rejected.length &&
      `The writer turned these down. Do not return them, and do not return others like them for the same reason:\n${rejected
        .map((r) => `- ${r.title}${r.url ? ` (${r.url})` : ""}: "${r.reason || "not useful"}"`)
        .join("\n")}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  // Eight searches for a full list: holding it to one piece per publisher
  // needs a wider net than six, and it still lands well inside the route's
  // ceiling with the plain search tool.
  const { res, links } = await searchTurn(system, question, more ? 4 : 8, 12000);
  if (res.stop_reason === "refusal") return { overview: "", sources: [], unsettled: [] };
  const parsed = await asJson<Partial<ReadingOut>>(
    finalText(res.content as unknown as Block[]),
    READING_SCHEMA,
    "reading list",
  );

  const taken = new Set([...existing, ...rejected].map((s) => normUrl(s.url)).filter(Boolean));
  // One piece per publisher, checked here rather than trusted to the prompt:
  // the first list for the writer's panel had two from the same society and
  // two companion papers from one survey. Keyed on the outlet as named and on
  // the site, except the big repositories, where one host carries papers
  // from hundreds of unrelated journals.
  const publishers = new Set(existing.flatMap((s) => publisherKeys(s.outlet || "", s.url)));
  const sources: FoundSource[] = [];
  for (const raw of Array.isArray(parsed?.sources) ? parsed!.sources : []) {
    const url = String(raw?.url || "").trim();
    const key = normUrl(url);
    // The whole point of the list is that you can open it. A link the search
    // never returned was written from memory and may not exist.
    if (!url || !links.has(key) || taken.has(key)) continue;
    const keys = publisherKeys(String(raw.outlet || ""), url);
    if (keys.some((k) => publishers.has(k))) continue;
    keys.forEach((k) => publishers.add(k));
    taken.add(key);
    sources.push({
      title: String(raw.title || links.get(key) || "").trim() || url,
      outlet: String(raw.outlet || "").trim(),
      date: String(raw.date || "").trim(),
      url,
      summary: String(raw.summary || "").trim(),
      findings: (Array.isArray(raw.findings) ? raw.findings : [])
        .map((f) => String(f || "").trim())
        .filter(Boolean)
        .slice(0, 6),
      why: String(raw.why || "").trim(),
      priority: raw.priority === "must" ? "must" : "skim",
    });
  }

  return {
    overview: more ? "" : String(parsed?.overview || "").trim(),
    sources: sources.slice(0, n),
    unsettled: more
      ? []
      : (Array.isArray(parsed?.unsettled) ? parsed!.unsettled : [])
          .map((u) => ({
            point: String(u?.point || "").trim(),
            sides: (Array.isArray(u?.sides) ? u.sides : [])
              .map((s) => ({
                position: String(s?.position || "").trim(),
                who: String(s?.who || "").trim(),
              }))
              .filter((s) => s.position),
          }))
          .filter((u) => u.point && u.sides.length)
          .slice(0, 5),
  };
}

const MATERIAL_SCHEMA = {
  type: "object" as const,
  properties: {
    title: { type: "string" as const },
    outlet: { type: "string" as const },
    date: { type: "string" as const },
    summary: { type: "string" as const },
    findings: { type: "array" as const, items: { type: "string" as const } },
    why: { type: "string" as const },
    people: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          name: { type: "string" as const },
          role: { type: "string" as const },
          org: { type: "string" as const },
          notes: { type: "string" as const },
        },
        required: ["name", "role", "org", "notes"],
        additionalProperties: false,
      },
    },
    session: {
      type: "object" as const,
      properties: {
        topic: { type: "string" as const },
        durationMin: { type: "number" as const },
        date: { type: "string" as const },
        location: { type: "string" as const },
      },
      required: ["topic", "durationMin", "date", "location"],
      additionalProperties: false,
    },
  },
  required: ["title", "outlet", "date", "summary", "findings", "why", "people", "session"],
  additionalProperties: false,
};

export interface MaterialOut {
  title: string;
  outlet: string;
  date: string;
  summary: string;
  findings: string[];
  why: string;
  people: { name: string; role: string; org: string; notes: string }[];
  session: { topic: string; durationMin: number; date: string; location: string };
}

const PURPOSE_TASK: Record<string, string> = {
  agenda:
    "It is an agenda, programme or attendee list. The job is who is speaking or attending and the session details. Put the people in the writer's own session in `people` (use their note to find which session is theirs; if the document is only their session, everyone in it). Put that session's title, length, start date-time and room in `session`. Findings: the run of the session and anything else on the agenda that bears on it (what comes before and after, a keynote on the same subject).",
  background:
    "It is background reading. The job is what it argues and what it found: summary, and findings with every figure that matters.",
  figures:
    "The writer wants the numbers. Findings: every figure, statistic and result that bears on what they asked for, each with what it measures, the sample or base where given, and where in the document it is (page or section) when you can tell.",
  from_them:
    "It came from the other side of the meeting. Read it as theirs: summary is what they want and what they are asking for; findings are their stated positions, requests, deadlines and anything left open. People: anyone named as attending.",
  other: "Do what the writer's note asks of it.",
};

/** Read one piece of material, for the reason the writer gave. */
export async function digestMaterial({
  meeting,
  doc,
}: {
  meeting: MeetingPayload;
  doc: { name: string; text: string; purpose: string; note: string; url?: string };
}): Promise<MaterialOut> {
  const res = await anthropic().messages.create({
    model: RESEARCH_MODEL,
    max_tokens: 4000,
    output_config: { format: { type: "json_schema", schema: MATERIAL_SCHEMA } },
    system: `The writer added a piece of material to their meeting prep and told you why. Read it for that reason.

${PURPOSE_TASK[doc.purpose] || PURPOSE_TASK.other}

The writer's note on what they want out of it is the instruction that matters most. Answer it.

Fields:
- title: the document's own title, or a plain name for it. outlet: who published or wrote it, "" if unknown. date: as it dates itself, "" if it does not.
- summary: two or three plain sentences.
- findings: 2-8 lines, each one specific thing from the document, as the document states it. Nothing it does not say.
- why: one line tying it to what the writer asked for.
- people: only for an agenda, an attendee list, or something from the other side naming who will attend; otherwise []. Never the writer themself. role and org as stated; notes is the one line about them the document gives (their talk title, their panel role). Never invent a role.
- session: for an agenda only; otherwise topic "", durationMin 0, date "", location "". date as ISO 8601 when a date and time are both stated, else "". durationMin from stated start and end times when both are given.

${PLAIN}`,
    messages: [
      {
        role: "user",
        content: [
          `The meeting:\n${meetingContext({ ...meeting, documents: [] }, "") || "(minimal context)"}`,
          `What the writer says about this material: "${doc.note}"`,
          `Material "${doc.name}"${doc.url ? ` (${doc.url})` : ""}:\n${doc.text.slice(0, 60000)}`,
        ].join("\n\n"),
      },
    ],
  });
  const p = JSON.parse(firstText(res.content as unknown as Block[]) || "{}") as Partial<MaterialOut>;
  return {
    title: String(p.title || "").trim(),
    outlet: String(p.outlet || "").trim(),
    date: String(p.date || "").trim(),
    summary: String(p.summary || "").trim(),
    findings: (p.findings || []).map((f) => String(f || "").trim()).filter(Boolean),
    why: String(p.why || "").trim(),
    people: (p.people || [])
      .map((x) => ({
        name: String(x?.name || "").trim(),
        role: String(x?.role || "").trim(),
        org: String(x?.org || "").trim(),
        notes: String(x?.notes || "").trim(),
      }))
      .filter((x) => x.name),
    session: {
      topic: String(p.session?.topic || "").trim(),
      durationMin: Number(p.session?.durationMin) || 0,
      date: String(p.session?.date || "").trim(),
      location: String(p.session?.location || "").trim(),
    },
  };
}

/**
 * Who someone is, for the person about to meet them. Three searches at most:
 * this runs once per person added, and most of what matters is on the first
 * page of results.
 */
export async function lookupPerson({
  person,
  subject,
}: {
  person: { name: string; role?: string; org?: string; notes?: string };
  subject: string;
}): Promise<{ text: string; sources: { title: string; url: string }[] }> {
  const who = [person.name, person.role, person.org].filter(Boolean).join(", ");
  const system = `You look up one person for someone about to be in a meeting with them. Search, then write what the writer needs to know.

Write 50-110 words of plain text, no markdown, no em dashes: their current role and organisation; what they work on; anything they have said or published that bears on the meeting's subject, with the year; and, if it shows, how they come across (a practitioner, a sceptic, a vendor's voice). Only what the results say. If the results are about several people with this name, use the one whose role and organisation match, and if none clearly does, say you could not confirm which person it is rather than blending them.

Then, on the last line, "SOURCES:" followed by the one to three URLs you relied on, separated by " | ", copied exactly from the search results.`;
  const { res, links } = await searchTurn(
    system,
    `Person: ${who}${person.notes ? `\nWhat the writer knows: ${person.notes}` : ""}\nThe meeting's subject: ${subject || "(not given)"}`,
    3,
    2000,
  );
  const text = finalText(res.content as unknown as Block[]);
  const [body, tail = ""] = text.split(/\n?SOURCES:\s*/i);
  const sources = tail
    .split("|")
    .map((u) => u.trim())
    .filter((u) => links.has(normUrl(u)))
    .slice(0, 3)
    .map((url) => ({ url, title: links.get(normUrl(url)) || url }));
  return {
    text: body
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/\s*—\s*/g, ", ")
      .trim(),
    sources,
  };
}
