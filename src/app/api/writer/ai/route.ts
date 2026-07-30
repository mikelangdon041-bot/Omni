import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { anthropic, WRITER_MODEL } from "@/lib/anthropic";
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

    // Ask-me-anything about the piece you're working on. Read-only on purpose:
    // it answers, suggests and critiques but never edits the draft, so the
    // Generate/Refine buttons stay the only things that change your text.
    if (action === "chat") {
      const turns: { role: string; content: string }[] = Array.isArray(body?.turns)
        ? body.turns.slice(-12)
        : [];
      if (!turns.length)
        return NextResponse.json({ error: "Nothing to answer" }, { status: 400 });
      const docType = String(body?.docType || "email");
      const draft = String(body?.draft || "").slice(0, 20000);
      const output = String(body?.output || "").slice(0, 20000);
      const notes = String(body?.notes || "").slice(0, 8000);

      const context = [
        draft && `What they put in the draft box:\n${draft}`,
        output && `The current version in the output pane:\n${output}`,
        notes && `Their note about it:\n${notes}`,
      ]
        .filter(Boolean)
        .join("\n\n---\n\n");

      // Two fields, not one: the answer to read, and the same change written as
      // an instruction the refine pass can take verbatim. Having the model
      // phrase its own suggestion is the point — retyping "make it punchier, and
      // move the ask up" by hand is where the intent gets lost.
      const CHAT_SCHEMA = {
        type: "object" as const,
        properties: {
          reply: { type: "string" as const },
          instruction: { type: "string" as const },
        },
        required: ["reply", "instruction"],
        additionalProperties: false,
      };

      const res = await anthropic().messages.create({
        model: WRITER_MODEL,
        max_tokens: 4000,
        output_config: { format: { type: "json_schema", schema: CHAT_SCHEMA } },
        system: `You are the writing partner sitting beside someone working on a ${docType} in a writing tool. They can see their draft and the current version on screen; you can see both too (below). Answer their questions about it.

Return JSON: {"reply": "...", "instruction": "..."}.
- "reply" is what they read. Everything below is about this field.
- "instruction" is the change you just proposed, rewritten as a direct order to a writing assistant that already has the piece in front of it — "Move the ask into the first paragraph and cut the closing sentence." Self-contained, imperative, no preamble, no explanation, no quoting of the whole piece. It gets applied verbatim, so it has to be complete on its own.
- If you did not propose a specific change to the text — you answered a question, gave an opinion, said it's fine as is, or need more from them — "instruction" is an empty string. Do not invent a change to fill it.
- If they asked you to choose between options and you picked one, "instruction" is the change that makes their piece match the option you picked.

How to answer:
- Be short. Two or three sentences for most questions, and a tight list when they ask for options.
- Be concrete and specific to THEIR text. Quote the line you mean. "Your second paragraph buries the ask" beats "consider improving clarity".
- Have an opinion. If they ask whether something works, say yes or no and why, then what you'd do.
- You cannot edit their draft from here, and you should not hand back a full rewritten version. Point at what to change, or tell them what to type into the refine box. If they want the change made, tell them to hit Refine with that instruction.
- Never use an em dash, an en dash, or a double hyphen. Use a comma, a period, a colon, or parentheses.
- No preamble, no "great question", no restating what they asked.
- If something isn't in what you can see, say so instead of guessing.
- They can attach screenshots and files to a question. Those arrive transcribed inline in their message under a "--- Attached: name ---" line. Treat that as something they are showing you to explain the question, not as part of the piece they are writing, unless they say to use it.

${context ? `What they are working on:\n\n${context}` : "They have not written anything yet."}`,
        messages: turns.map((t) => ({
          role: t.role === "assistant" ? ("assistant" as const) : ("user" as const),
          content: String(t.content || "").slice(0, 8000),
        })),
      });

      if (res.stop_reason === "refusal")
        return NextResponse.json(
          { error: "The model declined that one — try rephrasing." },
          { status: 502 },
        );
      const chat = JSON.parse(firstText(res) || "{}");
      return NextResponse.json({
        reply: stripEmDashes(String(chat.reply || "")),
        instruction: stripEmDashes(String(chat.instruction || "")),
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
- actions: the specific fixes they asked for, mapped onto the allowed values ("fix the spelling" → "Fix grammar & typos"; "cut it down" → "Tighten / shorten"; "make it less harsh" → "Softer / more diplomatic"). [] if they asked for nothing specific.
- length: "shorter", "much_shorter" or "longer" ONLY if they asked about length ("cut it down" → shorter, "way too long, halve it" → much_shorter, "flesh it out" → longer). Otherwise "as_is".
- fidelity: how much license they are giving you. "light" if they want a proofread or only the specific fixes they named (this is the safe default). "polish" if they want it improved but still theirs. "rewrite" if they asked for a rewrite of a real draft. "draft" when what they gave you is shorthand rather than prose — fragments, bullets, a few notes plus context — and they plainly expect you to write the actual piece from it.
- noGreeting: true only if they said not to open with a greeting ("no hi", "skip the pleasantries", "get straight to it"). Otherwise false.
- research: true only if they asked for something to be looked up or checked that you would otherwise have to invent — "find out how others are doing this", "look up the guidance", "get the rationale", "what's the current recommendation", "check what the data says". False when they only want their own material written better.
- researchQuestion: if research is true, the one question a researcher should go and answer, written as a standalone search-ready question with the specifics filled in from their material (e.g. "How are pharma field teams structuring KOL advisory boards for rare disease launches in 2026?"). Empty string when research is false.
Return only the JSON.`,
        messages: [{ role: "user", content: `Brief:\n\n${brief}` }],
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
      const styles: { name: string; text: string }[] = Array.isArray(body?.styles)
        ? body.styles
        : [];
      const signature = String(body?.signature || "");
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

      const res = await anthropic().messages.create({
        model: WRITER_MODEL,
        max_tokens: 16000,
        output_config: {
          format: { type: "json_schema", schema: GENERATE_SCHEMA },
        },
        system,
        messages: [{ role: "user", content: userMessage }],
      });

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
    const message = err instanceof Error ? err.message : "AI request failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
