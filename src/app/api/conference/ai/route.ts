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
//   parse_schedule    { text, guidance?, days, attendees } → { rows: ImportRow[] }
//   map_deck_template { slidesText, theme, guidance? }     → { proposal }
//   extract_insights_image { imageUrls, guidance?, categories? } → { insights }
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

    if (action === "extract_conference_meta") {
      // Read a workbook/schedule excerpt and pull out the conference identity
      // to prefill the "create conference" form.
      const text: string = (body?.text || "").slice(0, 20000);
      if (!text.trim()) return NextResponse.json({ meta: {} });

      const res = await openai().chat.completions.create({
        model: MODEL,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `You read an excerpt of a conference planning workbook or schedule document and extract the conference's identity for a "create conference" form.

Return ONLY JSON:
{"name":"...","location":"...","venue_address":"...","start_date":"YYYY-MM-DD","end_date":"YYYY-MM-DD","timezone":"IANA zone or \\"\\""}

Rules:
- "name": the conference/congress/meeting name, including the year when stated (e.g. "ENDO 2026"). The workbook file name and sheet names often carry it. "" if truly absent.
- "location": city + state/country when stated. "venue_address": only an actual venue/street address that appears in the source.
- "start_date"/"end_date": the overall first and last schedule day found. Resolve formats like "6/13/26" or "Saturday, June 13th" using any year present anywhere in the source; "" when unresolvable.
- "timezone": an IANA zone (e.g. "America/Chicago") ONLY when the host city is clearly identifiable; otherwise "".
- Never invent values — leave fields "" instead of guessing.`,
          },
          { role: "user", content: text },
        ],
      });
      const parsed = JSON.parse(res.choices[0]?.message?.content || "{}");
      return NextResponse.json({ meta: parsed });
    }

    if (action === "parse_schedule") {
      const text: string = (body?.text || "").slice(0, 80000);
      const guidance: string = body?.guidance || "";
      const days: string[] = Array.isArray(body?.days) ? body.days : [];
      const attendees: string[] = Array.isArray(body?.attendees) ? body.attendees : [];
      if (!text.trim()) return NextResponse.json({ rows: [] });

      // The user's own company: their sponsored talks are educational, every
      // other company's sponsored content is competitor material.
      let company = "";
      const { data: profile } = await supabase
        .from("profiles")
        .select("org_id")
        .eq("id", user.id)
        .single();
      if (profile?.org_id) {
        const { data: org } = await supabase
          .from("organizations")
          .select("name")
          .eq("id", profile.org_id)
          .single();
        company = (org?.name || "").trim();
      }

      const stream = await openai().chat.completions.create({
        model: MODEL,
        temperature: 0.1,
        response_format: { type: "json_object" },
        max_tokens: 12000,
        stream: true,
        messages: [
          {
            role: "system",
            content: `You convert a conference schedule (a spreadsheet grid or unstructured document) into normalized rows for import.

Return ONLY JSON: {"rows":[{...}]} where each row is:
{
  "kind": "event" | "poster",
  "event_type": "booth" | "educational" | "competitor" | "contact_meeting" | "session" | "custom",   // events only
  "title": "...",                       // required
  "description": "...",
  "location": "...",
  "date": "YYYY-MM-DD",                 // events: required; posters: use it when known, else ""
  "start_time": "HH:MM",               // 24h; events: required (default 09:00 only if truly absent)
  "end_time": "HH:MM",                 // 24h; if absent, one hour after start
  "people": ["Full Name", ...],        // reps assigned/covering, exactly as written in the source
  "authors": "...",                    // posters only
  "abstract": "...",                   // posters only
  "session_label": "...",              // posters only
  "priority": "high" | "medium" | "low" | null
}

Rules:
- The conference days are: ${days.join(", ") || "(unknown)"}. When the source has a day without a year (e.g. "April 22" or "Day 2" or "Wednesday"), resolve it to one of those dates. Never invent dates outside them unless the source is explicit.
- Booth-duty/staffing rows become ONE booth event per contiguous date+location block, with all covering people in "people" (do not emit one row per shift person unless times differ — separate time ranges may be separate rows).
- Classify each row's type deliberately — do NOT default everything to "session". Apply these cues in order:
  · "poster": anything whose title/label/type mentions poster (poster session, poster hall/walk, ePoster, abstract number) or that reads like an abstract listing (title + authors + number) → kind "poster".
  · Sponsored/industry content — product theaters, satellite symposia, industry-sponsored education, "Science & Innovation Theater", "Industry Connect", breakfast/lunch/dinner symposia, or rows with a sponsoring Company column: ${
    company
      ? `sponsored by "${company}" (the user's own company) → "educational"; sponsored by any OTHER company → "competitor". Mention the sponsoring company at the start of "description".`
      : `→ "competitor" (mention the sponsoring company at the start of "description"), unless the guidance says it is the user's own company's program — then "educational".`
  }
  · "educational": CME/CE-accredited or certified medical-education programs and courses.
  · "contact_meeting": meetings/1:1s with named external clinicians, KOLs, or VIPs — including meeting grids where a time row × day column cell holds the clinician's name.
  · "booth": booth duty, exhibit-hall staffing, in-booth activities.
  · "session": the official scientific program — plenaries, keynotes, general sessions, program symposia, "Meet the Professor", oral abstract sessions, panels, debates.
- When the source has a session-type/category column, trust it and map it with the rules above (e.g. "Plenary"/"General Session"/"Symposia" in the official program → "session"; "Satellite Symposia"/"IND Sponsored Edu" → the sponsored rule; "Poster" → poster).
- Team member names in the source should match this roster when possible (copy the source spelling; do NOT substitute): ${attendees.join(", ") || "(none)"}.
- Copy titles/locations/names exactly as written. Never fabricate rows, times, or people not in the source. Skip header/legend/blank rows.`,
          },
          {
            role: "user",
            content: `${guidance ? `Importer guidance: ${guidance}\n\n` : ""}Source schedule:\n\n${text}`,
          },
        ],
      });

      // Stream the raw model JSON as plain text so the client can count rows
      // as they are produced and render a real progress percentage.
      const encoder = new TextEncoder();
      const readable = new ReadableStream({
        async start(controller) {
          try {
            for await (const chunk of stream) {
              const delta = chunk.choices[0]?.delta?.content;
              if (delta) controller.enqueue(encoder.encode(delta));
            }
            controller.close();
          } catch (err) {
            controller.error(err);
          }
        },
      });
      return new Response(readable, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          "X-Accel-Buffering": "no",
        },
      });
    }

    if (action === "extract_insights_image") {
      const imageUrls: string[] = (Array.isArray(body?.imageUrls) ? body.imageUrls : []).slice(0, 6);
      const guidance: string = body?.guidance || "";
      const categories: string[] = Array.isArray(body?.categories) ? body.categories : [];
      if (!imageUrls.length) return NextResponse.json({ insights: [] });

      const res = await openai().chat.completions.create({
        model: MODEL,
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `You read photos of research posters and presentation slides and extract discrete pieces of field intelligence ("insights") for a field-medical team.

Return ONLY JSON: {"insights":[{"title":"...","bullets":["..."],"categories":["..."]}]}.

Rules:
- Each insight is one distinct, meaningful finding, data point, or conclusion visible in the image(s).
- "bullets" carry the supporting specifics — endpoints, effect sizes, populations, p-values, author conclusions. Preserve every legible figure exactly.
- If text is illegible, skip it — NEVER guess or invent values.
- "categories": zero or more from this exact list (never force a fit): ${categories.join("; ") || "(none configured)"}.`,
          },
          {
            role: "user",
            content: [
              {
                type: "text" as const,
                text: `${guidance ? `Reviewer guidance: ${guidance}\n\n` : ""}Extract insights from these photos:`,
              },
              ...imageUrls.map((url) => ({
                type: "image_url" as const,
                image_url: { url, detail: "high" as const },
              })),
            ],
          },
        ],
      });
      const parsed = JSON.parse(res.choices[0]?.message?.content || "{}");
      return NextResponse.json({
        insights: Array.isArray(parsed.insights) ? parsed.insights : [],
      });
    }

    if (action === "map_deck_template") {
      const slidesText: string[] = Array.isArray(body?.slidesText) ? body.slidesText : [];
      const theme = body?.theme || {};
      const guidance: string = body?.guidance || "";

      const res = await openai().chat.completions.create({
        model: MODEL,
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `A team uploaded their branded PowerPoint template. We extracted its theme and the text of each slide. The generator will CLONE this template file directly: it picks one existing slide as the model for the title slide, one for section dividers, and one for content slides, then fills them with post-conference content (title → booth activity per day → KOL meetings list → sessions by day → posters by day).

Decide which slides to use as models and describe the adoption. Return ONLY JSON:
{
  "description": "1-2 sentences: what this template looks like / is for",
  "titleSlideIndex": 1,        // 1-based slide number best suited as the title/cover model
  "dividerSlideIndex": 2,      // best suited as a section-divider model (big heading, little body)
  "contentSlideIndex": 3,      // best suited as a content model (heading + body text area)
  "colors": {"primary":"RRGGBB","secondary":"RRGGBB","text":"RRGGBB","bg":"RRGGBB"},
  "fonts": {"head":"...","body":"..."},
  "useLogo": true|false,
  "recommendations": ["short, specific observations about how content will sit in this template"]
}

Pick indices from the actual slides listed (a cover usually comes first; an agenda/section slide makes a good divider; a bulleted content slide makes the content model). Be decisive — pick actual values, don't hedge.`,
          },
          {
            role: "user",
            content: `Extracted theme: ${JSON.stringify(theme)}

Slide-by-slide text:
${slidesText.map((t, i) => `Slide ${i + 1}: ${t || "(no text)"}`).join("\n")}

${guidance ? `User guidance: ${guidance}` : "No user guidance given."}`,
          },
        ],
      });
      const parsed = JSON.parse(res.choices[0]?.message?.content || "{}");
      return NextResponse.json({ proposal: parsed });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || "AI request failed" },
      { status: 500 },
    );
  }
}
