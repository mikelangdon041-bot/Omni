import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { openai } from "@/lib/openai";

export const runtime = "nodejs";
export const maxDuration = 180;

const MODEL = process.env.OPENAI_SUMMARY_MODEL || "gpt-4o";
const IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || "dall-e-3";

// Slide Studio AI. Actions:
//   outline      { topic, docText?, slideCount?, guidance? }
//                → { title, slides:[{title, points:[]}] }
//   content      { outline:[{title,points}], topic?, docText?, guidance? }
//                → { slides:[{title, bullets:[], notes}] }
//   refine_slide { slide:{title,bullets,notes}, guidance, deckContext? }
//                → { title, bullets:[], notes }
//   refine_deck  { slides:[{title,bullets,notes}], guidance }
//                → { slides:[{title,bullets:[],notes}] }
//   script       { slides:[{title,bullets}], guidance?, minutes? }
//                → { notes:[] } (one per slide)
//   coach        { transcript, deckText, notesText?, metrics, timings }
//                → { coaching }
//   image        { prompt } → { url }  (generated, stored in slide-images)
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const action: string = body?.action || "";

  try {
    if (action === "outline") {
      const topic = String(body?.topic || "").slice(0, 2000);
      const docText = String(body?.docText || "").slice(0, 50000);
      const slideCount = Math.min(30, Math.max(3, Number(body?.slideCount) || 8));
      const guidance = String(body?.guidance || "").slice(0, 2000);
      const res = await openai().chat.completions.create({
        model: MODEL,
        temperature: 0.5,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `You are an expert presentation designer. Propose a deck outline. Return ONLY JSON:
{"title":"deck title","slides":[{"title":"slide title","points":["what this slide covers", ...]}]}
- About ${slideCount} slides (including a title slide as slide 1 with points []).
- A clear narrative arc: context → substance → implications → close.
- Slide titles are assertions where possible ("X improves Y"), not labels.
- When a source document is provided, the outline must cover its actual content faithfully — no inventions.`,
          },
          {
            role: "user",
            content: `${topic ? `Topic / goal: ${topic}\n\n` : ""}${docText ? `Source document:\n${docText}\n\n` : ""}${guidance ? `Guidance: ${guidance}` : ""}`,
          },
        ],
      });
      const parsed = JSON.parse(res.choices[0]?.message?.content || "{}");
      return NextResponse.json({
        title: String(parsed.title || "Untitled deck"),
        slides: (Array.isArray(parsed.slides) ? parsed.slides : []).map(
          (s: { title?: unknown; points?: unknown }) => ({
            title: String(s?.title || ""),
            points: (Array.isArray(s?.points) ? s.points : []).map(String),
          }),
        ),
      });
    }

    if (action === "content") {
      const outline = Array.isArray(body?.outline) ? body.outline : [];
      const topic = String(body?.topic || "").slice(0, 2000);
      const docText = String(body?.docText || "").slice(0, 50000);
      const guidance = String(body?.guidance || "").slice(0, 2000);
      const res = await openai().chat.completions.create({
        model: MODEL,
        temperature: 0.5,
        max_tokens: 6000,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `You write the actual slide content for an approved outline. Return ONLY JSON:
{"slides":[{"title":"...","bullets":["..."],"notes":"..."}]} — one entry per outline slide, same order.
- bullets: 3-6 per content slide, each ≤ 12 words, specific and parallel in structure. Slide 1 (title slide) gets bullets [] .
- notes: 2-4 sentences of what the presenter says on this slide, spoken language.
- Ground everything in the source material when provided; never invent data, figures, or citations.`,
          },
          {
            role: "user",
            content: `Outline:\n${JSON.stringify(outline)}\n\n${topic ? `Topic: ${topic}\n` : ""}${docText ? `Source document:\n${docText}\n` : ""}${guidance ? `Guidance: ${guidance}` : ""}`,
          },
        ],
      });
      const parsed = JSON.parse(res.choices[0]?.message?.content || "{}");
      return NextResponse.json({
        slides: (Array.isArray(parsed.slides) ? parsed.slides : []).map(
          (s: { title?: unknown; bullets?: unknown; notes?: unknown }) => ({
            title: String(s?.title || ""),
            bullets: (Array.isArray(s?.bullets) ? s.bullets : []).map(String),
            notes: String(s?.notes || ""),
          }),
        ),
      });
    }

    if (action === "refine_slide" || action === "refine_deck") {
      const guidance = String(body?.guidance || "").slice(0, 3000);
      const single = action === "refine_slide";
      const payload = single ? body?.slide : body?.slides;
      const res = await openai().chat.completions.create({
        model: MODEL,
        temperature: 0.4,
        max_tokens: single ? 1200 : 6000,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: single
              ? `You revise ONE slide per the user's guidance. Return ONLY JSON {"title":"...","bullets":["..."],"notes":"..."}. Keep what wasn't asked to change. Bullets ≤ 12 words each. Never invent data.`
              : `You revise a whole deck's text per the user's guidance. Return ONLY JSON {"slides":[{"title":"...","bullets":["..."],"notes":"..."}]} with the SAME number of slides in the same order unless the guidance explicitly asks to add/remove/merge slides. Keep what wasn't asked to change. Never invent data.`,
          },
          {
            role: "user",
            content: `${single ? "Slide" : "Deck"}:\n${JSON.stringify(payload).slice(0, 40000)}\n\n${body?.deckContext ? `Deck context: ${String(body.deckContext).slice(0, 3000)}\n\n` : ""}Guidance: ${guidance}`,
          },
        ],
      });
      const parsed = JSON.parse(res.choices[0]?.message?.content || "{}");
      if (single) {
        return NextResponse.json({
          title: String(parsed.title || ""),
          bullets: (Array.isArray(parsed.bullets) ? parsed.bullets : []).map(String),
          notes: String(parsed.notes || ""),
        });
      }
      return NextResponse.json({
        slides: (Array.isArray(parsed.slides) ? parsed.slides : []).map(
          (s: { title?: unknown; bullets?: unknown; notes?: unknown }) => ({
            title: String(s?.title || ""),
            bullets: (Array.isArray(s?.bullets) ? s.bullets : []).map(String),
            notes: String(s?.notes || ""),
          }),
        ),
      });
    }

    if (action === "script") {
      const slides = Array.isArray(body?.slides) ? body.slides : [];
      const guidance = String(body?.guidance || "").slice(0, 2000);
      const minutes = Math.min(120, Math.max(1, Number(body?.minutes) || 10));
      const res = await openai().chat.completions.create({
        model: MODEL,
        temperature: 0.5,
        max_tokens: 6000,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `You write a spoken presenter script for a slide deck, targeted at ~${minutes} minutes total. Return ONLY JSON {"notes":["...","..."]} — one entry per slide, same order.
- Natural spoken language a person could read aloud verbatim: transitions between slides, signposting, no bullet fragments.
- Match depth to the slide's content; do not introduce facts that aren't on the slides.`,
          },
          {
            role: "user",
            content: `Slides:\n${JSON.stringify(slides).slice(0, 40000)}${guidance ? `\n\nGuidance: ${guidance}` : ""}`,
          },
        ],
      });
      const parsed = JSON.parse(res.choices[0]?.message?.content || "{}");
      return NextResponse.json({
        notes: (Array.isArray(parsed.notes) ? parsed.notes : []).map(String),
      });
    }

    if (action === "coach") {
      const transcript = String(body?.transcript || "").slice(0, 60000);
      const deckTextStr = String(body?.deckText || "").slice(0, 20000);
      const notesText = String(body?.notesText || "").slice(0, 20000);
      const metrics = body?.metrics || {};
      const timings = Array.isArray(body?.timings) ? body.timings : [];
      const res = await openai().chat.completions.create({
        model: MODEL,
        temperature: 0.4,
        max_tokens: 1500,
        messages: [
          {
            role: "system",
            content: `You are a supportive but demanding presentation coach reviewing a practice run (transcript + per-slide timings + computed metrics${notesText ? " + the presenter's own script" : ""}). Give plain-text coaching:

1. Overall: 2-3 sentences on the strongest and weakest aspects.
2. Delivery: pacing (use the wpm/timings), filler words (quote them), clarity, energy.
${notesText ? "3. Content vs. script: what they skipped, added, or garbled compared to their planned script — per slide where relevant.\n4." : "3."} Per-slide pointers: only for slides that need it, referenced by number.
${notesText ? "5." : "4."} Three concrete things to do differently on the next run.

Be specific — quote their actual words. No markdown headings; use "-" bullets sparingly.`,
          },
          {
            role: "user",
            content: `Slides:\n${deckTextStr}\n\n${notesText ? `Planned script:\n${notesText}\n\n` : ""}Metrics: ${JSON.stringify(metrics)}\nSlide timings (seconds): ${JSON.stringify(timings)}\n\nTranscript of the practice run:\n${transcript}`,
          },
        ],
      });
      return NextResponse.json({
        coaching: res.choices[0]?.message?.content?.trim() || "",
      });
    }

    if (action === "image") {
      const prompt = String(body?.prompt || "").slice(0, 2000);
      if (!prompt.trim())
        return NextResponse.json({ error: "Describe the image first" }, { status: 400 });
      const gen = await openai().images.generate({
        model: IMAGE_MODEL,
        prompt: `${prompt}. Professional presentation graphic, clean, no embedded text unless asked.`,
        n: 1,
        size: "1024x1024",
        ...(IMAGE_MODEL.startsWith("dall-e") ? { response_format: "b64_json" as const } : {}),
      });
      const b64 = gen.data?.[0]?.b64_json;
      if (!b64) throw new Error("Image generation returned nothing");
      const admin = createAdminClient();
      const path = `${user.id}/${crypto.randomUUID()}.png`;
      const { error: upErr } = await admin.storage
        .from("slide-images")
        .upload(path, Buffer.from(b64, "base64"), { contentType: "image/png" });
      if (upErr) throw new Error(upErr.message);
      const { data: pub } = admin.storage.from("slide-images").getPublicUrl(path);
      return NextResponse.json({ url: pub.publicUrl });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI request failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
