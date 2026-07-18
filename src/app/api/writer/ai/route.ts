import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { anthropic, WRITER_MODEL } from "@/lib/anthropic";
import { AUDIENCE_CHIPS, TONE_CHIPS } from "@/lib/writer/types";

export const runtime = "nodejs";
export const maxDuration = 120;

// Writing Studio's text AI — powered by Claude. Actions:
//   generate      — create/edit/refine a piece of writing. The free-text brief
//                   is the primary input (it may contain a pasted email plus
//                   "reply saying X"); chips + detail fields refine it. When
//                   `previous` is present it's a refine pass over the current
//                   output. → { variants: [{ html, subject }] }
//   extract       — read the free-text brief and pull out structured intake
//                   fields (recipient, ask, key points, tone, …) so typing
//                   alone fills the doc. → { extracted: {...} }
//   analyze_voice — distill pasted writing samples into a voice profile.
//                   → { profile }

const GENERATE_SCHEMA = {
  type: "object" as const,
  properties: {
    variants: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          subject: { type: "string" as const },
          html: { type: "string" as const },
        },
        required: ["subject", "html"],
        additionalProperties: false,
      },
    },
  },
  required: ["variants"],
  additionalProperties: false,
};

function firstText(res: {
  content: { type: string; text?: string }[];
}): string {
  const block = res.content.find((b) => b.type === "text");
  return (block?.text || "").trim();
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
    if (action === "analyze_voice") {
      const samples = String(body?.samples || "").slice(0, 60000);
      if (!samples.trim())
        return NextResponse.json({ error: "No samples provided" }, { status: 400 });

      const res = await anthropic().messages.create({
        model: WRITER_MODEL,
        max_tokens: 2000,
        system: `You analyze writing samples and produce a compact "voice profile" another writer could follow to imitate the author.

Cover, as short labelled lines (plain text, no markdown headings):
- Sentence style (length, rhythm, fragments?)
- Formality and warmth
- Vocabulary habits (favorite phrases, words they avoid)
- Punctuation habits (dashes, exclamation points, emoji?)
- Greetings and sign-offs they actually use
- Structure habits (short paragraphs? bullets? one-liners?)
- Anything distinctive worth imitating

Be specific and quote short examples from the samples. Under 250 words. Return only the profile, no preamble.`,
        messages: [{ role: "user", content: `Writing samples:\n\n${samples}` }],
      });
      return NextResponse.json({ profile: firstText(res) });
    }

    if (action === "extract") {
      const brief = String(body?.brief || "").slice(0, 30000);
      const docType = String(body?.docType || "email");
      if (!brief.trim())
        return NextResponse.json({ error: "Nothing to extract" }, { status: 400 });

      const EXTRACT_SCHEMA = {
        type: "object" as const,
        properties: {
          title: { type: "string" as const },
          recipient: { type: "string" as const },
          ask: { type: "string" as const },
          keyPoints: { type: "string" as const },
          background: { type: "string" as const },
          tone: {
            type: "array" as const,
            items: { type: "string" as const, enum: TONE_CHIPS },
          },
          audience: {
            type: "array" as const,
            items: { type: "string" as const, enum: AUDIENCE_CHIPS },
          },
        },
        required: ["title", "recipient", "ask", "keyPoints", "background", "tone", "audience"],
        additionalProperties: false,
      };

      const res = await anthropic().messages.create({
        model: WRITER_MODEL,
        max_tokens: 2000,
        output_config: { format: { type: "json_schema", schema: EXTRACT_SCHEMA } },
        system: `The user is drafting a ${docType} in a writing tool. They typed a free-text brief — possibly including a pasted email or message they're responding to. Extract structured intake details from it so the tool can file them into the right fields.

Rules:
- Only extract what is clearly present or safely inferable. Use "" (or [] for arrays) when unsure — never guess or invent.
- title: a short 3–7 word working name for this piece (e.g. "Re: Quarterly Meeting Participation").
- recipient: the person being written to — name and role if inferable (e.g. from the pasted email's sender).
- ask: what the writer wants to happen, one sentence, in plain words.
- keyPoints: points that must be included, one per line. Empty if none stated.
- background: a compact summary of relevant context from pasted source material (who said what, dates, history). Empty if the brief has no source material.
- tone / audience: pick ONLY from the allowed values, and only when the brief clearly implies them. Usually 0–2 picks.
Return only the JSON.`,
        messages: [{ role: "user", content: `Brief:\n\n${brief}` }],
      });

      const extracted = JSON.parse(firstText(res) || "{}");
      return NextResponse.json({ extracted });
    }

    if (action === "generate") {
      const docType = String(body?.docType || "email");
      const mode = String(body?.mode || "create");
      const original = String(body?.original || "").slice(0, 30000);
      const previous = String(body?.previous || "").slice(0, 30000);
      const guidance = String(body?.guidance || "").slice(0, 4000);
      const ctx = body?.context || {};
      const styles: { name: string; text: string }[] = Array.isArray(body?.styles)
        ? body.styles
        : [];
      const signature = String(body?.signature || "");
      const variants = Math.min(4, Math.max(1, Number(body?.variants) || 1));

      const typeNotes: Record<string, string> = {
        email:
          "This is an email. Also produce a subject line (concise, specific, no clickbait). Do NOT include the signature in the body — it is appended separately.",
        document: "This is a document/memo. Use clear structure; headings only if genuinely helpful.",
        message: "This is a short message (Teams/Slack/text). Keep it tight; no greetings unless natural.",
        social: "This is a LinkedIn/social post. Strong hook in the first line, skimmable, no hashtag spam.",
        summary: "This is a summary/abstract. Faithful, complete, no invention, as tight as possible.",
        other: "Follow the user's description of what this should be.",
      };

      const styleBlock = styles.length
        ? `Writing styles to follow (treat these as binding rules):\n${styles
            .map((s) => `--- Style "${s.name}" ---\n${s.text}`)
            .join("\n")}`
        : "";

      const list = (v: unknown) => (Array.isArray(v) && v.length ? v.join("; ") : "");

      const brief = String(ctx.brief || "").slice(0, 30000);

      const intake = [
        brief && `The user's brief (their own words — this is the primary instruction; it may include source material like an email to respond to):\n${brief}`,
        list(ctx.actions) && `Requested edits: ${list(ctx.actions)}`,
        list(ctx.tone) && `Tone: ${list(ctx.tone)}`,
        list(ctx.audience) && `Audience: ${list(ctx.audience)}`,
        ctx.length && ctx.length !== "as_is" && `Length: make it ${String(ctx.length).replace("_", " ")}`,
        ctx.recipient && `Recipient: ${ctx.recipient}`,
        ctx.ask && `What the writer is asking for / wants to happen: ${ctx.ask}`,
        ctx.keyPoints && `Key points that MUST be included:\n${ctx.keyPoints}`,
        ctx.background && `Background / context:\n${ctx.background}`,
      ]
        .filter(Boolean)
        .join("\n\n");

      const task = previous
        ? `Here is the current draft you produced earlier. Revise it according to the new guidance while keeping everything that wasn't asked to change.\n\nCurrent draft:\n${previous}\n\nNew guidance: ${guidance || "(none — light general polish)"}`
        : mode === "edit"
          ? `Here is the user's own draft. Improve it per the intake. Preserve their meaning, facts, and anything specific; do not invent content.\n\nUser's draft:\n${original}`
          : `Write it from scratch based on the intake. If key points are given, include every one. Never invent specific facts, numbers, or commitments the user didn't provide.`;

      const res = await anthropic().messages.create({
        model: WRITER_MODEL,
        max_tokens: 16000,
        output_config: {
          format: { type: "json_schema", schema: GENERATE_SCHEMA },
        },
        system: `You are an elite writing partner. You produce polished, natural writing that sounds like a real person — never like AI filler.

Hard rules:
- Return JSON: {"variants":[{"subject":"...","html":"..."}]} with exactly ${variants} variant(s).${variants > 1 ? " Make the variants genuinely different in angle/structure, not reworded copies." : ""}
- "html" is the piece itself as simple HTML: <p> for paragraphs, <br> only inside a paragraph, <ul>/<ol>/<li> for lists, <b>/<i> sparingly. No inline styles, no headings unless the piece truly needs them, no markdown.
- "subject" is only meaningful for emails; otherwise return "".
- Work out the situation yourself from the brief. If the brief contains a pasted email or message, understand it and do what the user asked with it (reply, decline, forward, summarize…). Pull the recipient's name, the topic, dates, and any commitments straight from that source material.
- Names: address the recipient by name whenever it can be inferred from anything provided (the pasted email's sender, the recipient field, the background). NEVER output a placeholder like [Name] or [Recipient]. If no name is inferable, open naturally without one (e.g. "Hi," / "Hi there,") or skip the greeting if the format doesn't need it.
- Only use [square brackets] for a genuinely missing hard fact (a date, a number) the user must fill in — never for names or things you can infer.
- No preamble, no explanations.
- Avoid AI tells: no "I hope this email finds you well", no "delve", no exclamation stacking, no needless bullet lists.
${typeNotes[docType] || typeNotes.other}
${styleBlock ? `\n${styleBlock}` : ""}${signature ? `\n(The user's emails get this signature appended automatically after your body — never write your own sign-off block with contact details.)` : ""}`,
        messages: [
          {
            role: "user",
            content: `${intake ? `Intake:\n${intake}\n\n` : ""}${task}`,
          },
        ],
      });

      if (res.stop_reason === "refusal")
        return NextResponse.json(
          { error: "The model declined this request — try rephrasing." },
          { status: 502 },
        );

      const parsed = JSON.parse(firstText(res) || "{}");
      const out = (Array.isArray(parsed.variants) ? parsed.variants : [])
        .slice(0, variants)
        .map((v: { subject?: unknown; html?: unknown }) => ({
          subject: String(v?.subject || ""),
          html: String(v?.html || ""),
        }))
        .filter((v: { html: string }) => v.html.trim());
      if (!out.length)
        return NextResponse.json({ error: "The model returned nothing usable — try again." }, { status: 502 });
      return NextResponse.json({ variants: out });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI request failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
