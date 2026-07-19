import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { openai } from "@/lib/openai";
import { stripHtml } from "@/lib/territory/utils";

export const runtime = "nodejs";
export const maxDuration = 120;

const MODEL = process.env.OPENAI_SUMMARY_MODEL || "gpt-4o";

// Meeting Prep AI. Actions:
//   brief    { meeting, sections:[{key,title,prompt}], kolId?, guidance?,
//              previousSections? }             → { sections:[{key,title,content}] }
//   autofill { meeting }                       → { title, location, durationMin,
//              date, attendees:[], objectives, concerns } (only what's stated)
//   ideas    { context, focus?, count? }       → { ideas:[{title,detail}] }
//   grill    { context, briefText?, count? }   → { questions:[{question,modelAnswer}] }
//   coach    { question, modelAnswer, userAnswer, context } → { coaching }
//   debrief  { transcript, context }           → { summary, actions:[] }

interface MeetingPayload {
  title?: string;
  meetingType?: string;
  date?: string;
  durationMin?: number;
  format?: string;
  location?: string;
  attendees?: { name?: string; role?: string; org?: string; notes?: string }[];
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
      const res = await openai().chat.completions.create({
        model: MODEL,
        temperature: 0.4,
        max_tokens: 4000,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `You are a world-class chief of staff writing a pre-meeting brief. Return ONLY JSON:
{"sections":[{"key":"...","title":"...","content":"..."}]} — one entry per requested section, same keys and titles, in the same order.

"content" is simple HTML: <p> paragraphs, <ul>/<ol>/<li> lists, <b> sparingly. No headings (the title is rendered separately), no markdown.

Rules:
- Ground everything in the provided context. NEVER invent facts, names, data, or commitments not present. When the context is thin, give the best genuinely useful general guidance for this meeting type instead of fabricating specifics.
- Be concrete and practical — things you could actually say or do, not platitudes.
- Suggested answers must be usable verbatim as a starting point.
- Keep each section tight; this is read on the way into the room.`,
          },
          {
            role: "user",
            content: `Meeting context:\n${context || "(minimal context provided)"}\n\nSections to write (key — title — what it should contain):\n${wanted
              .map((s) => `- ${s.key} — ${s.title} — ${s.prompt}`)
              .join("\n")}${
              previous
                ? `\n\nA previous version of the brief exists. Revise it per this guidance, keeping what wasn't asked to change:\n${JSON.stringify(previous).slice(0, 20000)}\n\nGuidance: ${guidance || "(light general improvement)"}`
                : guidance
                  ? `\n\nExtra guidance from the writer: ${guidance}`
                  : ""
            }`,
          },
        ],
      });
      const parsed = JSON.parse(res.choices[0]?.message?.content || "{}");
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
      const res = await openai().chat.completions.create({
        model: MODEL,
        temperature: 0.1,
        max_tokens: 1500,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `You extract structured meeting details from free-form background text, notes, and documents the writer provided. Return ONLY JSON:
{"title":"","location":"","durationMin":0,"date":"","attendees":[{"name":"","role":"","org":"","notes":""}],"objectives":"","concerns":""}

Rules:
- Extract ONLY what is explicitly stated or unambiguously implied in the provided context. Never invent or guess.
- attendees: every person stated or implied to be AT this meeting (e.g. "Melissa, the head of the company, will be there" → {"name":"Melissa","role":"Head of the company"}). Do not include the writer themself. Put anything else known about a person in "notes".
- title: a short natural meeting title, only if the purpose is clear.
- date: ISO 8601 datetime, only if a specific date (and ideally time) is stated. Otherwise "".
- durationMin: only if a duration is stated, else 0.
- objectives: the writer's goals for the meeting, in their voice, plain text. "" if not stated.
- concerns: worries/sensitivities stated, plain text. "" if none.
- Use "" / [] / 0 for anything not present.`,
          },
          { role: "user", content: `Context:\n${context || "(empty)"}` },
        ],
      });
      const parsed = JSON.parse(res.choices[0]?.message?.content || "{}");
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
      const res = await openai().chat.completions.create({
        model: MODEL,
        temperature: 0.8,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `You are a creative, experienced strategist brainstorming for an upcoming meeting. The writer wants ideas for what ELSE they could bring up, showcase, or prepare — the things the sharpest people in their position would do. Return ONLY JSON {"ideas":[{"title":"...","detail":"..."}]} with exactly ${count} items.

- Draw on what high performers typically present in this kind of meeting: relevant KPIs and metrics, wins worth showcasing, stories, data, pre-empting questions, smart asks.
- title: a short punchy label (3-8 words).
- detail: 1-3 sentences making it concrete — if you suggest "showcase KPIs", NAME the specific KPIs someone in their role would show. It's fine to suggest ideas beyond the provided context here (they are suggestions, clearly framed as such), but tailor everything to the meeting type, audience, and objectives.
- No duplicates of what's obviously already in their plan; add angles they haven't thought of.`,
          },
          {
            role: "user",
            content: `Meeting context:\n${context}${focus ? `\n\nThe writer wants ideas about: ${focus}` : ""}`,
          },
        ],
      });
      const parsed = JSON.parse(res.choices[0]?.message?.content || "{}");
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
      const res = await openai().chat.completions.create({
        model: MODEL,
        temperature: 0.6,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `You play the toughest realistic version of the other side of an upcoming meeting. Return ONLY JSON {"questions":[{"question":"...","modelAnswer":"..."}]} with exactly ${count} items.

- Questions: the hardest things they could genuinely ask given the context — skeptical, specific, occasionally uncomfortable. No softballs. Vary the angle (data, motives, competition, logistics, past failures).
- modelAnswer: a strong, honest answer the writer could give, grounded only in the provided context (2-5 sentences, spoken language). Where the context lacks the needed fact, show how to answer gracefully without making things up.`,
          },
          {
            role: "user",
            content: `Meeting context:\n${context}${briefText ? `\n\nThe prepared brief:\n${briefText}` : ""}`,
          },
        ],
      });
      const parsed = JSON.parse(res.choices[0]?.message?.content || "{}");
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
      const res = await openai().chat.completions.create({
        model: MODEL,
        temperature: 0.4,
        max_tokens: 800,
        messages: [
          {
            role: "system",
            content: `You are a sharp, supportive speaking coach. The user practiced answering a hard meeting question out loud (you see the transcript) or in writing. Give coaching as short plain text:

1. One sentence on what worked.
2. 2-4 specific improvements (structure, evidence, confidence, length, hedging, filler) — quote their words where useful.
3. A one-line stronger version of their core message.

Be direct and specific to THEIR answer, never generic. No markdown headings, no bullets symbols other than "-".`,
          },
          {
            role: "user",
            content: `Meeting context:\n${context}\n\nQuestion asked: ${question}\n\nTheir answer:\n${userAnswer}\n\n(For your reference, a strong model answer: ${modelAnswer})`,
          },
        ],
      });
      return NextResponse.json({
        coaching: res.choices[0]?.message?.content?.trim() || "",
      });
    }

    if (action === "debrief") {
      const transcript = String(body?.transcript || "").slice(0, 60000);
      const context = String(body?.context || "").slice(0, 10000);
      if (!transcript.trim())
        return NextResponse.json({ error: "No transcript provided" }, { status: 400 });
      const res = await openai().chat.completions.create({
        model: MODEL,
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `You distill a meeting transcript/notes into a debrief. Return ONLY JSON:
{"summary":"...","actions":["...","..."]}

- summary: a nested bullet outline as plain text ("- " bullets, 2-space indents): what was discussed, decisions, positions taken, open items. Complete sentences, preserve names/figures, never invent.
- actions: every concrete follow-up action implied or promised, each a single imperative sentence with owner if stated (e.g. "Send Dr. Chen the phase 3 subgroup data by Friday").`,
          },
          {
            role: "user",
            content: `${context ? `Meeting context:\n${context}\n\n` : ""}Transcript/notes:\n${transcript}`,
          },
        ],
      });
      const parsed = JSON.parse(res.choices[0]?.message?.content || "{}");
      return NextResponse.json({
        summary: String(parsed.summary || ""),
        actions: (Array.isArray(parsed.actions) ? parsed.actions : []).map(String),
      });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI request failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
