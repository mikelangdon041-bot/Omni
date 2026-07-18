import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { openai } from "@/lib/openai";

export const runtime = "nodejs";
export const maxDuration = 180;

const MODEL = process.env.OPENAI_SUMMARY_MODEL || "gpt-4o";
const IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || "dall-e-3";

// Slide Studio AI. Actions:
//   outline        { topic, docText?, slideCount? (0 = auto), guidance? }
//                  → { title, subtitle, slides:[{title, points:[], layout}] }
//   refine_outline { outline, guidance, slideIndex? (-1 = whole outline), topic?, docText? }
//                  → { title?, slides:[{title, points:[], layout}] }
//   content        { outline:[{title,points,layout}], topic?, docText?, guidance? }
//                  → { subtitle, slides:[SlideSpec] }
//   refine_slide   { slide:{title,bullets,notes}, guidance, deckContext? }
//                  → { title, bullets:[], notes }
//   revise_deck    { slides:[{title,bullets,notes}], guidance, docText? }
//                  → { summary, slides:[{ basedOn, change, spec }] }
//   script         { slides:[{title,bullets}], guidance?, minutes? }
//                  → { notes:[] } (one per slide)
//   coach          { transcript, deckText, notesText?, metrics, timings }
//                  → { coaching }
//   image          { prompt } → { url } (stored in slide-images; falls back
//                  to a data URL if the bucket is unavailable)

const LAYOUTS = [
  "title",
  "section",
  "bullets",
  "twoCol",
  "stats",
  "quote",
  "imageRight",
  "closing",
] as const;
type Layout = (typeof LAYOUTS)[number];

const LAYOUT_GUIDE = `Layouts you can assign (pick what fits the content — vary them so the deck feels designed, not monotonous):
- "title": cover slide (slide 1 only).
- "section": a divider introducing a new part (title + optional one-line subtitle, no bullets).
- "bullets": classic title + 3-6 bullets.
- "twoCol": 2-3 labeled columns, each with a heading and 2-4 short bullets (comparisons, before/after, workstreams).
- "stats": 2-4 big numbers with labels (metrics, results) + optional supporting bullets. ONLY when real figures exist in the source — never invent numbers.
- "quote": one impactful quote with attribution (testimonials, guiding principles).
- "imageRight": title + bullets on the left, an image slot on the right; provide "imagePrompt" describing a clean professional illustration for it.
- "closing": final slide — thank you / next steps / asks.`;

interface RawOutlineSlide {
  title?: unknown;
  points?: unknown;
  layout?: unknown;
}

function cleanLayout(v: unknown, fallback: Layout = "bullets"): Layout {
  return LAYOUTS.includes(v as Layout) ? (v as Layout) : fallback;
}

function cleanOutline(arr: unknown): { title: string; points: string[]; layout: Layout }[] {
  return (Array.isArray(arr) ? arr : []).map((s: RawOutlineSlide, i: number) => ({
    title: String(s?.title || ""),
    points: (Array.isArray(s?.points) ? s.points : []).map(String).filter(Boolean),
    layout: cleanLayout(s?.layout, i === 0 ? "title" : "bullets"),
  }));
}

interface RawSpec {
  layout?: unknown;
  title?: unknown;
  subtitle?: unknown;
  bullets?: unknown;
  columns?: unknown;
  stats?: unknown;
  quote?: unknown;
  imagePrompt?: unknown;
  notes?: unknown;
}

function cleanSpec(s: RawSpec, i: number) {
  const quote = (s?.quote || {}) as { text?: unknown; attribution?: unknown };
  return {
    layout: cleanLayout(s?.layout, i === 0 ? "title" : "bullets"),
    title: String(s?.title || ""),
    subtitle: String(s?.subtitle || ""),
    bullets: (Array.isArray(s?.bullets) ? s.bullets : []).map(String).filter(Boolean),
    columns: (Array.isArray(s?.columns) ? s.columns : [])
      .map((c: { heading?: unknown; bullets?: unknown }) => ({
        heading: String(c?.heading || ""),
        bullets: (Array.isArray(c?.bullets) ? c.bullets : []).map(String).filter(Boolean),
      }))
      .filter((c) => c.heading || c.bullets.length),
    stats: (Array.isArray(s?.stats) ? s.stats : [])
      .map((t: { value?: unknown; label?: unknown }) => ({
        value: String(t?.value || ""),
        label: String(t?.label || ""),
      }))
      .filter((t) => t.value),
    quote: { text: String(quote?.text || ""), attribution: String(quote?.attribution || "") },
    imagePrompt: String(s?.imagePrompt || ""),
    notes: String(s?.notes || ""),
  };
}

const SPEC_SHAPE = `Each slide object:
{"layout":"...", "title":"...", "subtitle":"...", "bullets":["..."], "columns":[{"heading":"...","bullets":["..."]}], "stats":[{"value":"87%","label":"..."}], "quote":{"text":"...","attribution":"..."}, "imagePrompt":"...", "notes":"..."}
Only fill the fields the chosen layout uses; leave the rest out or empty.
- bullets: ≤ 12 words each, specific, parallel structure.
- notes: 2-4 sentences of what the presenter says, spoken language.
- Ground everything in the provided material; never invent data, figures, or citations.`;

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
      const requested = Number(body?.slideCount) || 0; // 0 = let the model decide
      const slideCount = requested ? Math.min(30, Math.max(3, requested)) : 0;
      const guidance = String(body?.guidance || "").slice(0, 2000);
      const res = await openai().chat.completions.create({
        model: MODEL,
        temperature: 0.5,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `You are an expert presentation designer. Propose a deck outline. Return ONLY JSON:
{"title":"deck title","subtitle":"one-line subtitle for the cover","slides":[{"title":"slide title","points":["what this slide covers", ...],"layout":"..."}]}
- ${slideCount ? `Exactly about ${slideCount} slides` : "Choose the number of slides that best serves the material — typically 6-12, fewer for a simple story, more for a dense document"} (including a title slide as slide 1 with layout "title" and points []).
- A clear narrative arc: context → substance → implications → close (last slide layout "closing").
- Slide titles are assertions where possible ("X improves Y"), not labels.
- ${LAYOUT_GUIDE}
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
        subtitle: String(parsed.subtitle || ""),
        slides: cleanOutline(parsed.slides),
      });
    }

    if (action === "refine_outline") {
      const outline = Array.isArray(body?.outline) ? body.outline : [];
      const guidance = String(body?.guidance || "").slice(0, 3000);
      const slideIndex = Number.isInteger(body?.slideIndex) ? Number(body.slideIndex) : -1;
      const topic = String(body?.topic || "").slice(0, 2000);
      const docText = String(body?.docText || "").slice(0, 40000);
      const scope =
        slideIndex >= 0
          ? `Apply the guidance ONLY to slide ${slideIndex + 1}; return every slide, keeping the others verbatim.`
          : `Apply the guidance across the outline. You may add, remove, merge, split, or reorder slides if asked or clearly beneficial.`;
      const res = await openai().chat.completions.create({
        model: MODEL,
        temperature: 0.4,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `You revise a presentation outline per the user's guidance. Return ONLY JSON:
{"title":"deck title","slides":[{"title":"...","points":["..."],"layout":"..."}]}
- ${scope}
- ${LAYOUT_GUIDE}
- Keep what wasn't asked to change. Never invent data.`,
          },
          {
            role: "user",
            content: `Current outline:\n${JSON.stringify(outline).slice(0, 30000)}\n\n${topic ? `Deck topic: ${topic}\n` : ""}${docText ? `Source document:\n${docText}\n\n` : ""}Guidance: ${guidance}`,
          },
        ],
      });
      const parsed = JSON.parse(res.choices[0]?.message?.content || "{}");
      return NextResponse.json({
        title: String(parsed.title || ""),
        slides: cleanOutline(parsed.slides),
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
        max_tokens: 8000,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `You write the actual slide content for an approved outline, honoring each slide's assigned layout. Return ONLY JSON:
{"subtitle":"cover subtitle","slides":[ ... ]} — one entry per outline slide, same order.
${SPEC_SHAPE}
${LAYOUT_GUIDE}`,
          },
          {
            role: "user",
            content: `Outline:\n${JSON.stringify(outline)}\n\n${topic ? `Topic: ${topic}\n` : ""}${docText ? `Source document:\n${docText}\n` : ""}${guidance ? `Guidance: ${guidance}` : ""}`,
          },
        ],
      });
      const parsed = JSON.parse(res.choices[0]?.message?.content || "{}");
      return NextResponse.json({
        subtitle: String(parsed.subtitle || ""),
        slides: (Array.isArray(parsed.slides) ? parsed.slides : []).map(cleanSpec),
      });
    }

    if (action === "refine_slide") {
      const guidance = String(body?.guidance || "").slice(0, 3000);
      const res = await openai().chat.completions.create({
        model: MODEL,
        temperature: 0.4,
        max_tokens: 1200,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `You revise ONE slide per the user's guidance. Return ONLY JSON {"title":"...","bullets":["..."],"notes":"..."}. Keep what wasn't asked to change. Bullets ≤ 12 words each. Never invent data.`,
          },
          {
            role: "user",
            content: `Slide:\n${JSON.stringify(body?.slide).slice(0, 20000)}\n\n${body?.deckContext ? `Deck context: ${String(body.deckContext).slice(0, 3000)}\n\n` : ""}Guidance: ${guidance}`,
          },
        ],
      });
      const parsed = JSON.parse(res.choices[0]?.message?.content || "{}");
      return NextResponse.json({
        title: String(parsed.title || ""),
        bullets: (Array.isArray(parsed.bullets) ? parsed.bullets : []).map(String),
        notes: String(parsed.notes || ""),
      });
    }

    if (action === "revise_deck") {
      const slides = Array.isArray(body?.slides) ? body.slides : [];
      const guidance = String(body?.guidance || "").slice(0, 4000);
      const docText = String(body?.docText || "").slice(0, 50000);
      const res = await openai().chat.completions.create({
        model: MODEL,
        temperature: 0.4,
        max_tokens: 8000,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `You propose a revision of a slide deck per the user's guidance${docText ? " and a newly attached document" : ""}. Return ONLY JSON:
{"summary":"2-4 sentences describing what you changed and why","slides":[{"basedOn":0,"change":"...","spec":{...}}]}
- "slides" is the COMPLETE deck after the revision, in order.
- "basedOn": the 0-based index of the original slide this one derives from, or -1 for brand-new slides.
- "change": "unchanged" | short description of the edit ("tightened bullets", "new slide covering X", "merged former slides 3-4").
- For UNCHANGED slides, set change to exactly "unchanged" (their content will be preserved as-is; you may leave spec minimal).
- "spec" for changed/new slides: ${SPEC_SHAPE}
${LAYOUT_GUIDE}
- You may add, remove, merge, split, or reorder slides when the guidance calls for it. When a document is attached, work its relevant content into the right slides rather than dumping it all in one place.`,
          },
          {
            role: "user",
            content: `Current deck:\n${JSON.stringify(slides).slice(0, 40000)}\n\n${docText ? `Attached document:\n${docText}\n\n` : ""}Guidance: ${guidance}`,
          },
        ],
      });
      const parsed = JSON.parse(res.choices[0]?.message?.content || "{}");
      const out = (Array.isArray(parsed.slides) ? parsed.slides : []).map(
        (s: { basedOn?: unknown; change?: unknown; spec?: unknown }, i: number) => ({
          basedOn: Number.isInteger(s?.basedOn) ? Number(s.basedOn) : -1,
          change: String(s?.change || ""),
          spec: cleanSpec((s?.spec || {}) as RawSpec, i),
        }),
      );
      return NextResponse.json({
        summary: String(parsed.summary || ""),
        slides: out,
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
        // gpt-image-* models always return b64 and reject response_format.
        ...(IMAGE_MODEL.startsWith("dall-e") ? { response_format: "b64_json" as const } : {}),
      });
      const b64 = gen.data?.[0]?.b64_json;
      if (!b64) throw new Error("Image generation returned nothing");
      // Prefer storage (small deck JSON); fall back to a data URL if the
      // bucket is missing so the button still works.
      try {
        const admin = createAdminClient();
        const path = `${user.id}/${crypto.randomUUID()}.png`;
        const { error: upErr } = await admin.storage
          .from("slide-images")
          .upload(path, Buffer.from(b64, "base64"), { contentType: "image/png" });
        if (upErr) throw new Error(upErr.message);
        const { data: pub } = admin.storage.from("slide-images").getPublicUrl(path);
        return NextResponse.json({ url: pub.publicUrl });
      } catch {
        return NextResponse.json({ url: `data:image/png;base64,${b64}` });
      }
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI request failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
