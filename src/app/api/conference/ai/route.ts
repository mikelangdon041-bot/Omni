import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { openai } from "@/lib/openai";

export const runtime = "nodejs";
export const maxDuration = 120;

const MODEL = process.env.OPENAI_SUMMARY_MODEL || "gpt-4o";

// One endpoint for the module's text-AI actions. All prompts share the same
// philosophy: only genuine, actionable field intelligence; preserve every
// specific figure/name; never invent anything not stated.
//
// actions:
//   extract_insights  { text, guidance?, categories?: string[] }
//     → { insights: [{ title, bullets: string[], categories: string[] }] }
//   daily_summary     { text, guidance? }                → { content }
//   poster_summary    { title, abstract?, notes? }       → { background, data, conclusion }
//   meeting_summary   { text, guidance? }                → { content }
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const action: string = body?.action || "";

  try {
    if (action === "extract_insights") {
      const text: string = (body?.text || "").slice(0, 60000);
      const guidance: string = body?.guidance || "";
      const categories: string[] = Array.isArray(body?.categories) ? body.categories : [];
      if (!text.trim()) return NextResponse.json({ insights: [] });

      const res = await openai().chat.completions.create({
        model: MODEL,
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `You extract discrete pieces of field intelligence ("insights") from conference notes/transcripts for a field-medical team reporting back to headquarters.

Return ONLY JSON: {"insights":[{"title":"...","bullets":["..."],"categories":["..."]}]}.

Rules:
- Each insight is one distinct, actionable piece of intelligence (an opinion, a data point, competitive intel, an unmet need). Skip filler, logistics, and pleasantries.
- "title" is a short, complete-sentence headline of the insight.
- "bullets" are supporting specifics — numbers, names, populations, mechanisms, implications. Preserve every specific figure/name mentioned. Complete sentences.
- Group related points raised at different times into one insight; do not repeat.
- NEVER invent anything not stated in the source.
- "categories": zero or more from this exact list (never force a fit): ${categories.join("; ") || "(none configured)"}.`,
          },
          {
            role: "user",
            content: `${guidance ? `Reviewer guidance: ${guidance}\n\n` : ""}Source material:\n\n${text}`,
          },
        ],
      });
      const parsed = JSON.parse(res.choices[0]?.message?.content || "{}");
      const insights = Array.isArray(parsed.insights) ? parsed.insights : [];
      return NextResponse.json({ insights });
    }

    if (action === "daily_summary" || action === "meeting_summary") {
      const text: string = (body?.text || "").slice(0, 60000);
      const guidance: string = body?.guidance || "";
      if (!text.trim()) return NextResponse.json({ content: "" });

      const scope =
        action === "daily_summary"
          ? "one day of a conference (sessions, contact meetings, posters, booth activity, standalone insights)"
          : "everything captured about one key contact (meeting notes and insights)";
      const res = await openai().chat.completions.create({
        model: MODEL,
        temperature: 0.3,
        max_tokens: 3000,
        messages: [
          {
            role: "system",
            content: `You distill field intelligence captured across ${scope} into an executive summary for headquarters.

- Output a nested bullet outline: "- " bullets, 2-space indents, no headings/markdown bold, no preamble.
- Top-level bullets are the key themes/findings; nested bullets carry the supporting specifics (numbers, names, who said what).
- Include only genuine, actionable intelligence; group related ideas; no repetition.
- Preserve every specific figure and name. NEVER invent anything not in the source.`,
          },
          {
            role: "user",
            content: `${guidance ? `Guidance: ${guidance}\n\n` : ""}Source material:\n\n${text}`,
          },
        ],
      });
      return NextResponse.json({ content: res.choices[0]?.message?.content?.trim() || "" });
    }

    if (action === "poster_summary") {
      const title: string = body?.title || "";
      const abstract: string = (body?.abstract || "").slice(0, 30000);
      const notes: string = (body?.notes || "").slice(0, 30000);
      if (!abstract.trim() && !notes.trim()) {
        return NextResponse.json({ background: "", data: "", conclusion: "" });
      }
      const res = await openai().chat.completions.create({
        model: MODEL,
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `You summarize a research poster into three short sections for a slide. Return ONLY JSON: {"background":"...","data":"...","conclusion":"..."}. Each section is 1-3 complete sentences, faithful to the source, preserving specific figures. Never invent data.`,
          },
          {
            role: "user",
            content: `Poster: ${title}\n\nAbstract:\n${abstract || "(none)"}\n\nTeam notes:\n${notes || "(none)"}`,
          },
        ],
      });
      const parsed = JSON.parse(res.choices[0]?.message?.content || "{}");
      return NextResponse.json({
        background: parsed.background || "",
        data: parsed.data || "",
        conclusion: parsed.conclusion || "",
      });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || "AI request failed" },
      { status: 500 },
    );
  }
}
