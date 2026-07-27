import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { anthropic, WRITER_MODEL } from "@/lib/anthropic";
import { stripHtml } from "@/lib/territory/utils";

export const runtime = "nodejs";
export const maxDuration = 120;

// Meeting Prep AI — powered by Claude (same model as Writing Studio). Actions:
//   brief    { meeting, sections:[{key,title,prompt}], kolId?, guidance?,
//              previousSections? }             → { sections:[{key,title,content}] }
//   autofill { meeting }                       → { title, location, durationMin,
//              date, attendees:[], objectives, concerns } (only what's stated)
//   ideas    { context, focus?, count? }       → { ideas:[{title,detail}] }
//   grill    { context, briefText?, count? }   → { questions:[{question,modelAnswer}] }
//   coach    { question, modelAnswer, userAnswer, context } → { coaching }
//   debrief  { transcript, context }           → { summary, actions:[] }
//   capture  { transcript, hint? }             → { title, summary, actions:[] }

function firstText(res: { content: { type: string; text?: string }[] }): string {
  const block = res.content.find((b) => b.type === "text");
  return (block?.text || "").trim();
}

interface MeetingPayload {
  title?: string;
  meetingType?: string;
  date?: string;
  durationMin?: number;
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

function meetingContext(m: MeetingPayload, kolBlock: string): string {
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
    m.durationMin && `Duration: ${m.durationMin} minutes`,
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

async function kolBlockFor(
  supabase: Awaited<ReturnType<typeof createClient>>,
  kolId: string,
): Promise<string> {
  if (!kolId) return "";
  const { data: kol } = await supabase.from("kols").select("*").eq("id", kolId).maybeSingle();
  if (!kol) return "";
  const { data: goals } = await supabase
    .from("quarterly_goals")
    .select("goal")
    .eq("kol_id", kolId)
    .eq("discussed", false);
  const { data: meetings } = await supabase
    .from("meetings")
    .select("topics_discussed, topics_missed, follow_up_actions, date")
    .eq("kol_id", kolId)
    .order("meeting_number", { ascending: false })
    .limit(1);
  const last = meetings?.[0];
  return [
    `Name: ${kol.first_name} ${kol.last_name}`,
    kol.specialty && `Specialty: ${kol.specialty}`,
    kol.institution && `Institution: ${kol.institution}`,
    kol.title_position && `Title: ${kol.title_position}`,
    kol.relationship_level && `Relationship level: ${kol.relationship_level}`,
    stripHtml(kol.areas_of_interest) && `Areas of interest: ${stripHtml(kol.areas_of_interest)}`,
    stripHtml(kol.potential_collaborations) &&
      `Potential collaborations: ${stripHtml(kol.potential_collaborations)}`,
    stripHtml(kol.other_info) && `Other background: ${stripHtml(kol.other_info)}`,
    stripHtml(kol.primary_objective) && `Primary objective: ${stripHtml(kol.primary_objective)}`,
    (goals || []).length &&
      `Open quarterly goals:\n${(goals || []).map((g) => `- ${g.goal}`).join("\n")}`,
    last &&
      `Last meeting (${last.date ? new Date(last.date).toDateString() : "date unknown"}): discussed ${stripHtml(
        last.topics_discussed,
      )}; to revisit ${stripHtml(last.topics_missed)}; follow-ups ${stripHtml(last.follow_up_actions)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

// Formatting rule shared by every action that writes brief content — Claude's
// default house style leans on bold labels and headers; this app renders
// content as plain prose in a document, not a chat bubble.
const NO_FORMATTING_RULE =
  "Plain prose. No bold, no markdown, no headers, no emoji. Use <b> only mid-sentence for a genuinely critical word or number, never to label a whole line or start a bullet. Write like a person handing over notes, not like an AI assistant's answer.";

const BRIEF_SCHEMA = {
  type: "object" as const,
  properties: {
    sections: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          key: { type: "string" as const },
          title: { type: "string" as const },
          content: { type: "string" as const },
        },
        required: ["key", "title", "content"],
        additionalProperties: false,
      },
    },
  },
  required: ["sections"],
  additionalProperties: false,
};

const AUTOFILL_SCHEMA = {
  type: "object" as const,
  properties: {
    title: { type: "string" as const },
    location: { type: "string" as const },
    durationMin: { type: "number" as const },
    date: { type: "string" as const },
    attendees: {
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
    objectives: { type: "string" as const },
    concerns: { type: "string" as const },
  },
  required: ["title", "location", "durationMin", "date", "attendees", "objectives", "concerns"],
  additionalProperties: false,
};

const IDEAS_SCHEMA = {
  type: "object" as const,
  properties: {
    ideas: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: { title: { type: "string" as const }, detail: { type: "string" as const } },
        required: ["title", "detail"],
        additionalProperties: false,
      },
    },
  },
  required: ["ideas"],
  additionalProperties: false,
};

const GRILL_SCHEMA = {
  type: "object" as const,
  properties: {
    questions: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          question: { type: "string" as const },
          modelAnswer: { type: "string" as const },
        },
        required: ["question", "modelAnswer"],
        additionalProperties: false,
      },
    },
  },
  required: ["questions"],
  additionalProperties: false,
};

const DEBRIEF_SCHEMA = {
  type: "object" as const,
  properties: {
    summary: { type: "string" as const },
    actions: { type: "array" as const, items: { type: "string" as const } },
  },
  required: ["summary", "actions"],
  additionalProperties: false,
};

// A captured recording has no meeting row to take its name from, and its
// notes are split into sections rather than one blob — each section becomes
// an independently editable, deletable rich-text block in the UI.
const CAPTURE_SCHEMA = {
  type: "object" as const,
  properties: {
    title: { type: "string" as const },
    sections: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          title: { type: "string" as const },
          content: { type: "string" as const },
        },
        required: ["title", "content"],
        additionalProperties: false,
      },
    },
    actions: { type: "array" as const, items: { type: "string" as const } },
    // Meetings routinely open with several minutes of greetings and travel
    // chat before anyone says anything worth keeping. The notes never include
    // it; this lets the UI offer to drop it from the stored transcript too.
    smallTalk: {
      type: "object" as const,
      properties: {
        found: { type: "boolean" as const },
        description: { type: "string" as const },
        firstSubstantiveLine: { type: "string" as const },
      },
      required: ["found", "description", "firstSubstantiveLine"],
      additionalProperties: false,
    },
  },
  required: ["title", "sections", "actions", "smallTalk"],
  additionalProperties: false,
};

const OUTLINE_RULE = `- summary: a nested bullet outline as plain text. Every line starts with "- ", and each level of nesting is indented exactly 2 more spaces than its parent. Go 2-3 levels deep: top-level bullets are the topics that came up, children are the specifics said about them (positions taken, decisions, numbers, objections, names). Complete sentences. Preserve names, figures, drug/product names and dates exactly as spoken. Never invent anything that wasn't said. No bold, no markdown, no headers.
- actions: every concrete follow-up the recording implies or someone promised, each as one imperative sentence, with the owner and any deadline when stated (e.g. "Send Dr. Chen the phase 3 subgroup data by Friday"). Only real commitments and next steps — not topics, not general observations. Empty array if there genuinely are none.`;

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const action: string = body?.action || "";

  try {
    if (action === "brief") {
      const meeting: MeetingPayload = body?.meeting || {};
      const sections: { key: string; title: string; prompt: string }[] = Array.isArray(
        body?.sections,
      )
        ? body.sections
        : [];
      const guidance = String(body?.guidance || "").slice(0, 4000);
      const previous = body?.previousSections;
      const onlyKey = String(body?.onlyKey || "");
      const kolBlock = await kolBlockFor(supabase, String(body?.kolId || ""));
      const context = meetingContext(meeting, kolBlock);

      const wanted = onlyKey ? sections.filter((s) => s.key === onlyKey) : sections;
      const res = await anthropic().messages.create({
        model: WRITER_MODEL,
        max_tokens: 6000,
        output_config: { format: { type: "json_schema", schema: BRIEF_SCHEMA } },
        system: `You are a sharp, experienced chief of staff writing a pre-meeting brief for someone about to walk into the room. Produce sections a real person would hand another person, not an AI-generated report.

${NO_FORMATTING_RULE}

Hard rules:
- Ground everything in the provided meeting context. NEVER invent facts, names, data, or commitments not present. When context is thin for a section, give genuinely useful general guidance for this type of meeting instead of fabricating specifics — say less rather than make things up.
- When a previous version of a section is provided, that is the user's own current text (possibly hand-edited). Build on it and extend it — keep everything in it that the guidance didn't ask you to change. Do not silently rewrite it into your own voice or drop details it already has. Only make the specific change the guidance asks for; if no guidance is given, make the smallest improvement that adds real value (fix a gap, sharpen something vague) rather than a wholesale rewrite.
- Be concrete and practical — things you could actually say or do, not platitudes.
- Suggested answers must be usable verbatim as a starting point.
- Keep each section tight; this is read on the way into the room.
- Return one entry per requested section, same keys and titles, in the same order.`,
        messages: [
          {
            role: "user",
            content: `Meeting context:\n${context || "(minimal context provided)"}\n\nSections to write (key — title — what it should contain):\n${wanted
              .map((s) => `- ${s.key} — ${s.title} — ${s.prompt}`)
              .join("\n")}${
              previous
                ? `\n\nThe user's current version of ${previous.length === 1 ? "this section" : "these sections"} (build on it, don't discard it):\n${JSON.stringify(previous).slice(0, 20000)}\n\nGuidance: ${guidance || "(no specific guidance — make only a small, genuinely useful improvement)"}`
                : guidance
                  ? `\n\nExtra guidance from the writer: ${guidance}`
                  : ""
            }`,
          },
        ],
      });
      if (res.stop_reason === "refusal")
        return NextResponse.json(
          { error: "The model declined this request — try rephrasing." },
          { status: 502 },
        );
      const parsed = JSON.parse(firstText(res) || "{}");
      const out = (Array.isArray(parsed.sections) ? parsed.sections : []).map(
        (s: { key?: unknown; title?: unknown; content?: unknown }) => ({
          key: String(s?.key || ""),
          title: String(s?.title || ""),
          content: String(s?.content || ""),
        }),
      );
      return NextResponse.json({ sections: out });
    }

    if (action === "autofill") {
      const meeting: MeetingPayload = body?.meeting || {};
      const context = meetingContext(meeting, "");
      const res = await anthropic().messages.create({
        model: WRITER_MODEL,
        max_tokens: 1500,
        output_config: { format: { type: "json_schema", schema: AUTOFILL_SCHEMA } },
        system: `You extract structured meeting details from free-form background text, notes, and documents the writer provided.

Rules:
- Extract ONLY what is explicitly stated or unambiguously implied in the provided context. Never invent or guess.
- attendees: every person stated or implied to be AT this meeting (e.g. "Melissa, the head of the company, will be there" → {"name":"Melissa","role":"Head of the company"}). Do not include the writer themself. Put anything else known about a person in "notes".
- title: a short natural meeting title, only if the purpose is clear.
- date: ISO 8601 datetime, only if a specific date (and ideally time) is stated. Otherwise "".
- durationMin: only if a duration is stated, else 0.
- objectives: the writer's goals for the meeting, in their voice, plain text. "" if not stated.
- concerns: worries/sensitivities stated, plain text. "" if none.
- Use "" / [] / 0 for anything not present.`,
        messages: [{ role: "user", content: `Context:\n${context || "(empty)"}` }],
      });
      const parsed = JSON.parse(firstText(res) || "{}");
      return NextResponse.json({
        title: String(parsed.title || ""),
        location: String(parsed.location || ""),
        durationMin: Number(parsed.durationMin) || 0,
        date: String(parsed.date || ""),
        attendees: (Array.isArray(parsed.attendees) ? parsed.attendees : []).map(
          (a: { name?: unknown; role?: unknown; org?: unknown; notes?: unknown }) => ({
            name: String(a?.name || ""),
            role: String(a?.role || ""),
            org: String(a?.org || ""),
            notes: String(a?.notes || ""),
          }),
        ),
        objectives: String(parsed.objectives || ""),
        concerns: String(parsed.concerns || ""),
      });
    }

    if (action === "ideas") {
      const context = String(body?.context || "").slice(0, 30000);
      const focus = String(body?.focus || "").slice(0, 2000);
      const count = Math.min(12, Math.max(4, Number(body?.count) || 8));
      const res = await anthropic().messages.create({
        model: WRITER_MODEL,
        max_tokens: 3000,
        output_config: { format: { type: "json_schema", schema: IDEAS_SCHEMA } },
        system: `You are a creative, experienced strategist brainstorming for an upcoming meeting. The writer wants ideas for what ELSE they could bring up, showcase, or prepare — the things the sharpest people in their position would do. Produce exactly ${count} items.

${NO_FORMATTING_RULE}

- Draw on what high performers typically present in this kind of meeting: relevant KPIs and metrics, wins worth showcasing, stories, data, pre-empting questions, smart asks.
- title: a short punchy label (3-8 words).
- detail: 1-3 sentences making it concrete — if you suggest "showcase KPIs", NAME the specific KPIs someone in their role would show. It's fine to suggest ideas beyond the provided context here (they are suggestions, clearly framed as such), but tailor everything to the meeting type, audience, and objectives.
- No duplicates of what's obviously already in their plan; add angles they haven't thought of.`,
        messages: [
          {
            role: "user",
            content: `Meeting context:\n${context}${focus ? `\n\nThe writer wants ideas about: ${focus}` : ""}`,
          },
        ],
      });
      const parsed = JSON.parse(firstText(res) || "{}");
      const ideas = (Array.isArray(parsed.ideas) ? parsed.ideas : []).map(
        (i: { title?: unknown; detail?: unknown }) => ({
          title: String(i?.title || ""),
          detail: String(i?.detail || ""),
        }),
      );
      return NextResponse.json({ ideas });
    }

    if (action === "grill") {
      const context = String(body?.context || "").slice(0, 30000);
      const briefText = String(body?.briefText || "").slice(0, 20000);
      const count = Math.min(12, Math.max(3, Number(body?.count) || 8));
      const res = await anthropic().messages.create({
        model: WRITER_MODEL,
        max_tokens: 4000,
        output_config: { format: { type: "json_schema", schema: GRILL_SCHEMA } },
        system: `You play the toughest realistic version of the other side of an upcoming meeting. Produce exactly ${count} items.

${NO_FORMATTING_RULE}

- Questions: the hardest things they could genuinely ask given the context — skeptical, specific, occasionally uncomfortable. No softballs. Vary the angle (data, motives, competition, logistics, past failures).
- modelAnswer: a strong, honest answer the writer could give, grounded only in the provided context (2-5 sentences, spoken language). Where the context lacks the needed fact, show how to answer gracefully without making things up.`,
        messages: [
          {
            role: "user",
            content: `Meeting context:\n${context}${briefText ? `\n\nThe prepared brief:\n${briefText}` : ""}`,
          },
        ],
      });
      const parsed = JSON.parse(firstText(res) || "{}");
      const questions = (Array.isArray(parsed.questions) ? parsed.questions : []).map(
        (q: { question?: unknown; modelAnswer?: unknown }) => ({
          question: String(q?.question || ""),
          modelAnswer: String(q?.modelAnswer || ""),
        }),
      );
      return NextResponse.json({ questions });
    }

    if (action === "coach") {
      const question = String(body?.question || "");
      const modelAnswer = String(body?.modelAnswer || "");
      const userAnswer = String(body?.userAnswer || "").slice(0, 8000);
      const context = String(body?.context || "").slice(0, 20000);
      const res = await anthropic().messages.create({
        model: WRITER_MODEL,
        max_tokens: 800,
        system: `You are a sharp, supportive speaking coach. The user practiced answering a hard meeting question out loud (you see the transcript) or in writing. Give coaching as short plain text:

1. One sentence on what worked.
2. 2-4 specific improvements (structure, evidence, confidence, length, hedging, filler) — quote their words where useful.
3. A one-line stronger version of their core message.

Be direct and specific to THEIR answer, never generic. No markdown headings, no bold, no bullet symbols other than "-".`,
        messages: [
          {
            role: "user",
            content: `Meeting context:\n${context}\n\nQuestion asked: ${question}\n\nTheir answer:\n${userAnswer}\n\n(For your reference, a strong model answer: ${modelAnswer})`,
          },
        ],
      });
      return NextResponse.json({ coaching: firstText(res) });
    }

    if (action === "debrief") {
      const transcript = String(body?.transcript || "").slice(0, 60000);
      const context = String(body?.context || "").slice(0, 10000);
      if (!transcript.trim())
        return NextResponse.json({ error: "No transcript provided" }, { status: 400 });
      const res = await anthropic().messages.create({
        model: WRITER_MODEL,
        max_tokens: 4000,
        output_config: { format: { type: "json_schema", schema: DEBRIEF_SCHEMA } },
        system: `You distill a meeting transcript/notes into a debrief.

${OUTLINE_RULE}`,
        messages: [
          {
            role: "user",
            content: `${context ? `Meeting context:\n${context}\n\n` : ""}Transcript/notes:\n${transcript}`,
          },
        ],
      });
      const parsed = JSON.parse(firstText(res) || "{}");
      return NextResponse.json({
        summary: String(parsed.summary || ""),
        actions: (Array.isArray(parsed.actions) ? parsed.actions : []).map(String),
      });
    }

    // A recording captured with no meeting set up beforehand: the transcript
    // is all we have, so the model also names the thing.
    if (action === "capture") {
      const transcript = String(body?.transcript || "").slice(0, 120000);
      if (!transcript.trim())
        return NextResponse.json({ error: "No transcript provided" }, { status: 400 });
      const hint = String(body?.hint || "").slice(0, 2000);
      // The writer's own notes, and whether they want them treated as the
      // priority signal rather than as one more piece of context.
      const ownNotes = String(body?.ownNotes || "").slice(0, 20000);
      const emphasizeNotes = body?.emphasizeNotes !== false;
      const res = await anthropic().messages.create({
        model: WRITER_MODEL,
        max_tokens: 8000,
        output_config: { format: { type: "json_schema", schema: CAPTURE_SCHEMA } },
        system: `You turn the transcript of a meeting into usable notes. It may come from automatic speech recognition — expect missing punctuation and mis-heard words — or be an exported transcript. Infer sensibly from context but never invent content.

Attribution, which matters and is easy to get wrong:
- If the transcript has speaker labels ("Dr. Chen:", "Speaker 1:", "Speaker A:"), USE them. Attribute positions, objections and commitments to the person who actually said them, and carry that through into the follow-ups ("Dr. Chen asked for…", not "someone asked for…").
- Labels like "Speaker A" come from voice separation, which knows there are distinct people but not their names. If the conversation makes a speaker's identity clear — they are greeted or thanked by name, they introduce themselves, someone answers a question put to them by name — use the real name and stop saying "Speaker A". Only do this when the transcript genuinely settles it; if you are unsure, keep the label as-is rather than guessing.
- If it has NO speaker labels, you cannot tell who spoke. Write the notes impersonally ("the dosing schedule was questioned"). Do NOT guess who said what, do NOT invent speaker names, and do NOT assume it was all one person — a single unlabelled block is usually several people talking in turn.
- Line breaks often mark a change of speaker even when nobody is named — Apple Voice Memos and several other tools put each turn on its own line. Treat a line-broken transcript as a multi-party conversation with turns, and let that shape the notes ("this was pushed back on", "the two sides landed on…"). Use the turn structure; still don't invent who owns which turn.

- title: a short, specific name for this meeting as a person would write it in a calendar (5-8 words, no quotes). Use real names/topics from the transcript when they're clear, e.g. "Dr. Patel — dosing concerns and advisory board". If the transcript is too thin to tell, use a plain descriptive title.
- sections: the meeting broken into 3-7 topic sections, in the order they came up. Each section is a distinct subject someone would want to find later — not "Introduction" / "Discussion" / "Conclusion" filler.
  - section title: 2-5 words naming the topic ("Dosing concerns", "Advisory board timing").
  - section content: HTML using ONLY <ul>, <li>, <b>, <i>, and <p>. Use a nested <ul> inside an <li> for detail under a point, 2-3 levels deep. Complete sentences. Preserve names, figures, product names and dates exactly as spoken. Never invent anything that wasn't said. No headings, no styling attributes, no markdown.
- actions: every concrete follow-up the recording implies or someone promised, each as one imperative sentence, with the owner and any deadline when stated (e.g. "Send Dr. Chen the phase 3 subgroup data by Friday"). Only real commitments and next steps — not topics, not general observations. Empty array if there genuinely are none.
- smallTalk: meetings usually open with pleasantries — greetings, travel, weather, weekend plans, waiting for people to join, tech checks — before anyone says anything substantive. Never make a section for it.
  - found: true only when there is a genuine run of opening pleasantries. A one-line "hi, how are you" before real content does not count.
  - description: what it was, 3-8 words ("greetings and weekend plans", "waiting for Dr. Ruiz to join").
  - firstSubstantiveLine: the first 8-15 words of the first sentence that carries real content, copied VERBATIM from the transcript — exact characters, including any speaker label. It is used to locate the cut point, so a paraphrase is useless. Empty string when found is false.${
          ownNotes
            ? emphasizeNotes
              ? `

THE WRITER'S OWN NOTES — the highest-signal input you have. They took the trouble to write these down, which means they judged it mattered: the transcript is everything that was said, their notes are what was worth saying. Concretely:
- Every point in their notes must appear in the sections. None may be dropped for being thinly covered in the transcript.
- Lead the relevant section with their point, and prefer their framing and wording where it is clear.
- Where their notes and the transcript cover the same ground, their emphasis decides what matters; the transcript supplies the specifics, names and figures around it.
- If they noted something the transcript barely covers, still include it, worded as their note — but never invent transcript detail to prop it up.
- A follow-up they wrote down is a real commitment even where the transcript is vague about it.`
              : `

THE WRITER'S OWN NOTES are background context. Use them to understand the meeting and resolve ambiguity, but weight them no more heavily than the transcript — build the notes from what was actually said.`
            : ""
        }`,
        messages: [
          {
            role: "user",
            content: `${hint ? `What the recording is (from the person who recorded it): ${hint}\n\n` : ""}${
              ownNotes ? `The writer's own notes:\n${ownNotes}\n\n` : ""
            }Transcript:\n${transcript}`,
          },
        ],
      });
      if (res.stop_reason === "refusal")
        return NextResponse.json(
          { error: "The model declined this recording." },
          { status: 502 },
        );
      const parsed = JSON.parse(firstText(res) || "{}");
      return NextResponse.json({
        title: String(parsed.title || "").slice(0, 200),
        sections: (Array.isArray(parsed.sections) ? parsed.sections : []).map(
          (s: { title?: unknown; content?: unknown }, i: number) => ({
            key: `capture_${i}`,
            title: String(s?.title || "Notes"),
            content: String(s?.content || ""),
          }),
        ),
        actions: (Array.isArray(parsed.actions) ? parsed.actions : []).map(String),
        smallTalk: {
          found: Boolean(parsed.smallTalk?.found),
          description: String(parsed.smallTalk?.description || ""),
          firstSubstantiveLine: String(parsed.smallTalk?.firstSubstantiveLine || ""),
        },
      });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI request failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
