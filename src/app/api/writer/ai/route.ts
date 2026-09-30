import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { anthropic, QUICK_MODEL, WRITER_MODEL } from "@/lib/anthropic";
import {
  ACTION_CHIPS,
  AUDIENCE_CHIPS,
  FIDELITY_OPTIONS,
  LENGTHS,
  TONE_CHIPS,
} from "@/lib/writer/types";
import { stripEmDashes } from "@/lib/writer/sanitize";
import { buildGeneratePrompt } from "@/lib/writer/prompt";

export const runtime = "nodejs";
// Generate thinks before it writes now, so the ceiling that fit a straight
// completion no longer fits the slowest piece it is asked for.
export const maxDuration = 300;

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

    /**
     * "Did the person who wrote these write this one too?"
     *
     * The guard on the voice, for everything the exact check cannot see: a
     * reply drafted in ChatGPT, or in Copilot, or by a colleague. Asked this
     * way round on purpose. "Is this AI?" in the abstract does not work —
     * general detectors are unreliable, worst of all at email length, and the
     * writer prompt here already forbids the phrases they look for, so its own
     * output is scrubbed of the evidence. Measured: a pattern check caught
     * none of five generated replies. Asked as authorship, with real examples
     * of the person to compare against, the same five rows came out 5/7 with
     * no false rejections.
     *
     * A small model, because this runs per candidate and the judgement is a
     * comparison rather than a composition.
     */
    if (action === "authorship") {
      const samples: string[] = (Array.isArray(body?.samples) ? body.samples : [])
        .slice(0, 6)
        .map((s: unknown) => String(s).slice(0, 3000))
        .filter(Boolean);
      const candidate = String(body?.candidate || "").slice(0, 6000);
      if (!candidate.trim() || samples.length < 2)
        return NextResponse.json({ sameAuthor: true, confidence: "low", reason: "" });

      const res = await anthropic().messages.create({
        model: QUICK_MODEL,
        max_tokens: 700,
        output_config: {
          format: {
            type: "json_schema",
            schema: {
              type: "object",
              properties: {
                sameAuthor: { type: "boolean" as const },
                confidence: { type: "string" as const, enum: ["low", "medium", "high"] },
                reason: { type: "string" as const },
              },
              required: ["sameAuthor", "confidence", "reason"],
              additionalProperties: false,
            },
          },
        },
        system: `You compare writing. You are given several emails known to be written by one person, and one more email. Decide whether the same person wrote the last one.

Judge on HOW it is written, never on what it is about: sentence length and how much it varies, contractions, how they open and close, hedging, punctuation habits, whether they explain themselves or assume you already know.

The usual reason for a mismatch is that the last email was drafted by an AI and lightly edited. Those read smoother and more even than a person in a hurry: every sentence a similar length, every paragraph balanced, nothing left implicit, no abruptness.

Subject matter, names and dates are worthless evidence. Two emails about the same meeting are not therefore by the same person.

"reason" is one short sentence naming the habit that decided it, addressed to the person themselves ("longer, more even sentences than you write").`,
        messages: [
          {
            role: "user",
            content: `Known to be by this person:\n\n${samples
              .map((s, i) => `<known ${i + 1}>\n${s}\n</known ${i + 1}>`)
              .join("\n\n")}\n\nThe email in question:\n\n<candidate>\n${candidate}\n</candidate>`,
          },
        ],
      });
      const parsed = JSON.parse(firstText(res) || "{}");
      return NextResponse.json({
        sameAuthor: parsed.sameAuthor !== false,
        confidence: String(parsed.confidence || "low"),
        reason: String(parsed.reason || ""),
      });
    }

    // "Look it up" — the one thing the writer genuinely could not do before.
    // Runs as its own call rather than inside `generate`: the generate call is
    // pinned to a JSON schema, and a search loop wants plain text and its own
    // progress bar. The findings come back as sourced notes that generate then
    // treats as fact.
    if (action === "research") {
      const question = String(body?.question || "").slice(0, 4000);
      const docType = String(body?.docType || "email");
      if (!question.trim())
        return NextResponse.json({ error: "Nothing to look up" }, { status: 400 });

      const searchTools = [
        { type: "web_search_20260209" as const, name: "web_search" as const, max_uses: 8 },
      ];
      const researchSystem = `You research a question for someone about to write a ${docType}. Search the web, then hand back what they can actually use.

Rules:
- Search before answering. Never answer from memory alone: the point of this step is current, checkable information.
- Do NOT narrate the searching. No "let me look that up", no "I'll check another source", no commentary on what the tools returned. Only the findings are shown to the user.
- Return plain text, no markdown headings, under 250 words. Short labelled lines or a tight list.
- Lead with the findings that change what they should write. If the question is "how do others do this", give the concrete patterns you found, with who does it that way.
- Attribute every substantive claim to its source inline, as a name plus the year or date where there is one (e.g. "Mayo Clinic guidance, 2025"). No bare URLs, no footnotes.
- Where sources disagree, say so in a line rather than picking a winner.
- If the search turns up nothing solid, say exactly that. Never fill the gap with plausible-sounding invention.`;

      let res = await anthropic().messages.create({
        model: WRITER_MODEL,
        max_tokens: 8000,
        tools: searchTools,
        system: researchSystem,
        messages: [{ role: "user", content: question }],
      });

      // A server-side tool loop can stop for breath partway through; re-send to
      // let it finish. The system prompt has to come along on the resume, or the
      // second half of the answer is written without any of the rules above.
      for (let i = 0; i < 3 && res.stop_reason === "pause_turn"; i++) {
        res = await anthropic().messages.create({
          model: WRITER_MODEL,
          max_tokens: 8000,
          tools: searchTools,
          system: researchSystem,
          messages: [
            { role: "user", content: question },
            { role: "assistant", content: res.content },
          ],
        });
      }

      if (res.stop_reason === "refusal")
        return NextResponse.json(
          { error: "The model declined that search — try rephrasing it." },
          { status: 502 },
        );

      // Only the text after the last tool block is the answer. The text blocks
      // in between are the model working out loud ("those came back empty, let
      // me retry"), which is not what anyone asked to read. Matching on "not
      // text" rather than on tool-block names on purpose: this tool version
      // filters results through code execution, so a search turn comes back as
      // an interleaving of server_tool_use, web_search_tool_result AND
      // code_execution_tool_result, and naming them individually missed one.
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
      if (!notes)
        return NextResponse.json(
          { error: "The search came back empty — try a more specific question." },
          { status: 502 },
        );
      return NextResponse.json({ notes: stripEmDashes(notes) });
    }

    if (action === "extract") {
      const brief = String(body?.brief || "").slice(0, 30000);
      const docType = String(body?.docType || "email");
      if (!brief.trim())
        return NextResponse.json({ error: "Nothing to extract" }, { status: 400 });
      // The Outlook pane also wants the email it is answering summed up in a
      // line or two, and it is already paying for this call when it opens. Opt
      // in, so the workspace's own extract is untouched. `thread` is only sent
      // when it is not already the brief — a half-written draft in Outlook is
      // the brief, and the thread under it is what the summary is about.
      const summarize = body?.summarize === true;
      const thread = summarize ? String(body?.thread || "").slice(0, 30000) : "";

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
          actions: {
            type: "array" as const,
            items: { type: "string" as const, enum: ACTION_CHIPS },
          },
          length: {
            type: "string" as const,
            enum: LENGTHS.map((l) => l.key),
          },
          fidelity: {
            type: "string" as const,
            enum: FIDELITY_OPTIONS.map((f) => f.key),
          },
          noGreeting: { type: "boolean" as const },
          research: { type: "boolean" as const },
          researchQuestion: { type: "string" as const },
          ...(summarize ? { summary: { type: "string" as const } } : {}),
        },
        required: [
          "title",
          "recipient",
          "ask",
          "keyPoints",
          "background",
          "tone",
          "audience",
          "actions",
          "length",
          "fidelity",
          "noGreeting",
          "research",
          "researchQuestion",
          ...(summarize ? ["summary"] : []),
        ],
        additionalProperties: false,
      };

      const res = await anthropic().messages.create({
        model: WRITER_MODEL,
        max_tokens: 2000,
        output_config: { format: { type: "json_schema", schema: EXTRACT_SCHEMA } },
        system: `The user is drafting a ${docType} in a writing tool. They typed into one box — it may be a rough draft of their own, a pasted email or message they're responding to plus an instruction, or just a description of what they want. Extract structured intake details from it so the tool can file them into the right fields and flip the right switches on their behalf.

Rules:
- Only extract what is clearly present or safely inferable. Use "" (or [] for arrays) when unsure — never guess or invent.
- title: a short 3–7 word working name for this piece (e.g. "Re: Quarterly Meeting Participation").
- recipient: the person being written to — name and role if inferable (e.g. from the pasted email's sender).
- ask: what the writer wants to happen, one sentence, in plain words.
- keyPoints: points that must be included, one per line. Empty if none stated.
- background: a compact summary of relevant context from pasted source material (who said what, dates, history). Empty if the brief has no source material.
- tone / audience: pick ONLY from the allowed values, and only when the brief clearly implies them. Usually 0–2 picks.
- Sentences the user addressed to YOU ("make it shorter", "this is going to my VP", "she hates long emails") outrank anything implied by the material they pasted. If they say who it is going to, that is the audience and the recipient, whatever the pasted draft is addressed to.
- actions: the specific fixes they asked for, mapped onto the allowed values ("fix the spelling" → "Fix grammar & typos"; "make it less harsh" → "Softer / more diplomatic"). [] if they asked for nothing specific. Length is NOT an action — it has its own field below, and putting a length request in both sends the same instruction twice.
- length: "shorter", "much_shorter" or "longer" ONLY if they asked about length ("cut it down" → shorter, "way too long, halve it" → much_shorter, "flesh it out" → longer). Otherwise "as_is". This is the only place a length request belongs.
- fidelity: how much license they are giving you. "light" if they want a proofread or only the specific fixes they named (this is the safe default). "polish" if they want it improved but still theirs. "rewrite" if they asked for a rewrite of a real draft. "draft" when what they gave you is shorthand rather than prose — fragments, bullets, a few notes plus context — and they plainly expect you to write the actual piece from it.
- noGreeting: true only if they said not to open with a greeting ("no hi", "skip the pleasantries", "get straight to it"). Otherwise false.
- research: true only if they asked for something to be looked up or checked that you would otherwise have to invent — "find out how others are doing this", "look up the guidance", "get the rationale", "what's the current recommendation", "check what the data says". False when they only want their own material written better.
- researchQuestion: if research is true, the one question a researcher should go and answer, written as a standalone search-ready question with the specifics filled in from their material (e.g. "How are pharma field teams structuring KOL advisory boards for rare disease launches in 2026?"). Empty string when research is false.${
          summarize
            ? `
- summary: what the email being answered says, for the writer to glance at before replying. One to three short plain sentences, at most 60 words, addressed to the writer and naming people ("Shane can do the 14th or the 21st and wants to know which, and whether Glenn should be invited."). Lead with what they are asking for or need, then any dates, numbers or decisions. On a thread, summarise the message marked as the one being answered, bringing in earlier messages only where they change what it means. Leave out greetings, sign-offs, signatures, disclaimers and quoted boilerplate. "" if there is no email being answered.`
            : ""
        }
Return only the JSON.`,
        messages: [
          {
            role: "user",
            content: thread
              ? `Brief:\n\n${brief}\n\nThe email being answered. Use it ONLY for "summary"; every other field comes from the brief above:\n\n${thread}`
              : `Brief:\n\n${brief}`,
          },
        ],
      });

      const extracted = JSON.parse(firstText(res) || "{}");
      return NextResponse.json({ extracted });
    }

    if (action === "generate") {
      const docType = String(body?.docType || "email");
      // `input` is the one box the user fills in: a draft to polish, source
      // material plus an instruction, or just a description. The model works
      // out which — there is no polish/from-scratch mode any more.
      const input = String(body?.original || "").slice(0, 30000);
      const previous = String(body?.previous || "").slice(0, 30000);
      const guidance = String(body?.guidance || "").slice(0, 4000);
      const ctx = body?.context || {};
      const styles: { name: string; text: string; samples?: string }[] = Array.isArray(
        body?.styles,
      )
        ? body.styles
        : [];
      const signature = String(body?.signature || "");
      // A short "Cheers, Zak" is written by the model as the last lines of the
      // piece; a block of letterhead is stapled on afterwards by whoever copies
      // or inserts it. The caller decides which, because the caller is the one
      // that knows whether it will be doing any stapling.
      const signOff = !!body?.signOff;
      const wordSwaps: { avoid: string; prefer: string }[] = Array.isArray(body?.wordSwaps)
        ? body.wordSwaps
            .slice(0, 40)
            .map((w: { avoid?: unknown; prefer?: unknown }) => ({
              avoid: String(w?.avoid || "").slice(0, 80),
              prefer: String(w?.prefer || "").slice(0, 80),
            }))
            .filter((w: { avoid: string }) => !!w.avoid.trim())
        : [];
      const variants = Math.min(4, Math.max(1, Number(body?.variants) || 1));

      const { system, user: userMessage } = buildGeneratePrompt({
        docType,
        input,
        previous,
        guidance,
        fidelity: String(body?.fidelity || "light"),
        noGreeting: !!body?.noGreeting,
        ctx,
        styles,
        signature,
        signOff,
        wordSwaps,
        variants,
        priorInstructions: Array.isArray(body?.priorInstructions)
          ? body.priorInstructions.slice(-12).map((s: unknown) => String(s).slice(0, 500))
          : [],
        priorVersions: Array.isArray(body?.priorVersions)
          ? body.priorVersions.slice(0, 3).map((v: { instructions?: unknown; text?: unknown }) => ({
              instructions: String(v?.instructions || "").slice(0, 300),
              text: String(v?.text || "").slice(0, 8000),
            }))
          : [],
      });

      // Thinking is ON for this one call, and it is the difference between the
      // studio's output and what the same model gives you if you just ask it in
      // a chat. This model family does not think unless asked: omit the
      // parameter and every piece is written first-token-to-last with no plan,
      // which shows up exactly where you would expect — refines that miss the
      // point, and openings that go nowhere. Adaptive lets it spend the thought
      // on the hard ones and skip it on "fix the typos".
      //
      // Streamed because thinking and the piece share the max_tokens budget, and
      // a two-thousand-word memo with reasoning in front of it is long enough on
      // one non-streaming request to hit the SDK's own timeout before the model
      // is finished. Nothing is streamed on to the browser; the route still
      // answers once, with the finished JSON.
      const stream = anthropic().messages.stream({
        model: WRITER_MODEL,
        max_tokens: 32000,
        thinking: { type: "adaptive" },
        output_config: {
          effort: "high",
          format: { type: "json_schema", schema: GENERATE_SCHEMA },
        },
        system,
        messages: [{ role: "user", content: userMessage }],
      });
      const res = await stream.finalMessage();

      if (res.stop_reason === "refusal")
        return NextResponse.json(
          { error: "The model declined this request — try rephrasing." },
          { status: 502 },
        );

      const parsed = JSON.parse(firstText(res) || "{}");
      const out = (Array.isArray(parsed.variants) ? parsed.variants : [])
        .slice(0, variants)
        // The prompt asks for no em dashes; this guarantees it.
        .map((v: { subject?: unknown; html?: unknown }) => ({
          subject: stripEmDashes(String(v?.subject || ""), { asSubject: true }),
          html: stripEmDashes(String(v?.html || "")),
        }))
        .filter((v: { html: string }) => v.html.trim());
      if (!out.length)
        return NextResponse.json({ error: "The model returned nothing usable — try again." }, { status: 502 });
      return NextResponse.json({ variants: out });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: readableError(err) }, { status: 500 });
  }
}

/**
 * A sentence someone can act on. The SDK's own message is the HTTP status
 * followed by the raw JSON body, which lands in a toast as
 * `400 {"type":"error","error":{...}}` — technically accurate and no use to
 * anyone looking at it.
 */
function readableError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  // The SDK message starts with the status code; matching it loose would let a
  // digit inside a request id decide the wording.
  const status = Number(raw.match(/^(\d{3})/)?.[1] ?? 0);
  if (/content filtering|blocked by/i.test(raw))
    return "That one was declined by the safety filter. Try rephrasing it, or removing the part it's likely reacting to.";
  if (status === 429 || /rate_limit_error/.test(raw))
    return "Too many requests at once — give it a moment and try again.";
  if (status === 529 || status >= 500 || /overloaded_error/.test(raw))
    return "The model is busy right now. Try that again in a moment.";
  if (status === 413 || /request_too_large|too many tokens|context window/i.test(raw))
    return "There's too much text here to process in one go — try trimming it.";
  return "That didn't go through. Try again.";
}
