import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { openai } from "@/lib/openai";

export const runtime = "nodejs";
export const maxDuration = 120;

const MODEL = process.env.OPENAI_SUMMARY_MODEL || "gpt-4o";

// Writing Studio's text AI. Actions:
//   generate      — create/edit/refine a piece of writing. Sends the full
//                   intake (chips + free text + styles). When `previous` is
//                   present it's a refine pass over the current output.
//                   → { variants: [{ html, subject }] }
//   analyze_voice — distill pasted writing samples into a voice profile.
//                   → { profile }
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

      const res = await openai().chat.completions.create({
        model: MODEL,
        temperature: 0.3,
        messages: [
          {
            role: "system",
            content: `You analyze writing samples and produce a compact "voice profile" another writer could follow to imitate the author.

Cover, as short labelled lines (plain text, no markdown headings):
- Sentence style (length, rhythm, fragments?)
- Formality and warmth
- Vocabulary habits (favorite phrases, words they avoid)
- Punctuation habits (dashes, exclamation points, emoji?)
- Greetings and sign-offs they actually use
- Structure habits (short paragraphs? bullets? one-liners?)
- Anything distinctive worth imitating

Be specific and quote short examples from the samples. Under 250 words.`,
          },
          { role: "user", content: `Writing samples:\n\n${samples}` },
        ],
      });
      return NextResponse.json({
        profile: res.choices[0]?.message?.content?.trim() || "",
      });
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

      const intake = [
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
        .join("\n");

      const task = previous
        ? `Here is the current draft you produced earlier. Revise it according to the new guidance while keeping everything that wasn't asked to change.\n\nCurrent draft:\n${previous}\n\nNew guidance: ${guidance || "(none — light general polish)"}`
        : mode === "edit"
          ? `Here is the user's own draft. Improve it per the intake. Preserve their meaning, facts, and anything specific; do not invent content.\n\nUser's draft:\n${original}`
          : `Write it from scratch based on the intake. If key points are given, include every one. Never invent specific facts, numbers, or commitments the user didn't provide.`;

      const res = await openai().chat.completions.create({
        model: MODEL,
        temperature: previous ? 0.4 : 0.6,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `You are an elite writing partner. You produce polished, natural writing that sounds like a real person — never like AI filler.

Hard rules:
- Return ONLY JSON: {"variants":[{"subject":"...","html":"..."}]} with exactly ${variants} variant(s).${variants > 1 ? " Make the variants genuinely different in angle/structure, not reworded copies." : ""}
- "html" is the piece itself as simple HTML: <p> for paragraphs, <br> only inside a paragraph, <ul>/<ol>/<li> for lists, <b>/<i> sparingly. No inline styles, no headings unless the piece truly needs them, no markdown.
- "subject" is only meaningful for emails; otherwise return "".
- No preamble, no explanations, no placeholder brackets unless the user's input truly lacks a needed fact (then use [square brackets]).
- Avoid AI tells: no "I hope this email finds you well", no "delve", no exclamation stacking, no needless bullet lists.
${typeNotes[docType] || typeNotes.other}
${styleBlock ? `\n${styleBlock}` : ""}${signature ? `\n(The user's emails get this signature appended automatically after your body — never write your own sign-off block with contact details.)` : ""}`,
          },
          {
            role: "user",
            content: `${intake ? `Intake:\n${intake}\n\n` : ""}${task}`,
          },
        ],
      });

      const parsed = JSON.parse(res.choices[0]?.message?.content || "{}");
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
