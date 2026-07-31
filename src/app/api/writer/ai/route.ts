import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { anthropic, WRITER_MODEL } from "@/lib/anthropic";
import {
  ACTION_CHIPS,
  AUDIENCE_CHIPS,
  DOC_TYPES,
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

// The types a new piece of writing can be created as. Read off the same list
// the rest of the studio uses, so adding a type there doesn't leave the chat
// unable to suggest it.
const DOC_TYPE_KEYS: string[] = DOC_TYPES.map((d) => d.key);

// Where the chat can send work that doesn't belong to the piece on screen. Only
// the apps the studio can actually start something in from here: the rest of
// Omni gets named in the answer instead, which is honest about what the button
// would and wouldn't do.
const HANDOFF_APPS = ["writing-studio", "meeting-prep"];

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

    // Ask-me-anything about the piece you're working on. Answering never edits
    // anything; when the answer proposes a specific change it also returns that
    // change as an instruction, which the button on the answer feeds to the
    // ordinary refine pass.
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

      // Three outcomes, not one: the answer to read, a change to the piece in
      // front of them, and — the case this schema exists to separate out — work
      // that belongs somewhere ELSE. Asking a memo "write me an email about
      // this" used to come back as an instruction, and applying it overwrote the
      // memo with the email; asking it to prep you for the meeting the memo is
      // about had nowhere to go at all. Both are now a handoff: a new thing,
      // created alongside, with its own button and its own wording.
      const CHAT_SCHEMA = {
        type: "object" as const,
        properties: {
          reply: { type: "string" as const },
          instruction: { type: "string" as const },
          handoffApp: {
            type: "string" as const,
            enum: ["", ...HANDOFF_APPS],
          },
          handoffType: {
            type: "string" as const,
            enum: ["", ...DOC_TYPE_KEYS],
          },
          handoffBrief: { type: "string" as const },
          handoffTitle: { type: "string" as const },
        },
        required: [
          "reply",
          "instruction",
          "handoffApp",
          "handoffType",
          "handoffBrief",
          "handoffTitle",
        ],
        additionalProperties: false,
      };

      const res = await anthropic().messages.create({
        model: WRITER_MODEL,
        max_tokens: 4000,
        output_config: { format: { type: "json_schema", schema: CHAT_SCHEMA } },
        system: `You are the writing partner sitting beside someone working on a ${docType} in a writing tool. They can see their draft and the current version on screen; you can see both too (below). Answer their questions about it.

FIRST, WORK OUT WHAT THEY ARE ASKING FOR
Every message is one of three things, and getting this wrong is the worst mistake you can make here, because their ${docType} is the work they have been doing and it must not be destroyed by a suggestion they clicked.

The test that settles it, whatever words they used: when this is done, how many pieces of writing does this person have? Still one, or two?

(a) TALKING. A question, an opinion, options to consider, a reaction, something they want to think through. Nothing gets written or changed. Only "reply" is filled.
(b) A CHANGE TO THIS PIECE. Still one piece afterwards: the same ${docType}, doing the same job for the same reader, with something about it different. Cuts, additions, a new opening, a different tone, a restructure, even a total rewrite of it as itself.
(c) SOMETHING NEW ALONGSIDE. Two things afterwards: their ${docType} untouched, plus something else made from the same material. This covers far more than it first looks like. A different format (an email about this memo, a post, a Teams message, a summary). A different reader (the version for leadership, the version for the team). A different job (the covering note that goes with it, the reply to it, the follow-up, the agenda, the talking points, the short version to paste somewhere). Something that is not a piece of writing at all, like being ready for the conversation this piece is about. Anything phrased as "also", "as well", "another", "a version for", "one of these for". And anything where turning their ${docType} INTO it would mean their ${docType} no longer exists.
When (b) and (c) are both readable and the difference matters, ask which in one short line and leave every field but "reply" empty. Do not guess and do not split the difference.

WHERE (c) GOES
They are in Omni, a suite of apps that share their work. Writing Studio, where they are now, is one of them. Two of the others can be started for them right here, with this piece's material carried across:
- "writing-studio": any new piece of writing.
- "meeting-prep": what they need in order to walk into a conversation ready, rather than something to send. It builds a briefing on who they are meeting and what to aim for, drills them on the questions they will get, and takes the debrief afterwards. "Get me ready for the meeting about this", "what will they push back on when I present this", "I have to defend this to the exec team on Thursday".
Omni also has Territory Planning (KOLs and engagement cycles), Conference Planning, Insights, Slide Studio (presentations), Interview Prep (recordings, transcripts, summaries) and Dashboard (charts across the apps). If what they want plainly belongs to one of those, say which one in a line of the reply and leave the handoff fields empty: those cannot be started from here.

THEN FILL THE FIELDS
- "reply" is what they read, in every case. Most of what follows is about this field.
- (b) fills "instruction": the change, written as a direct order to a writing assistant that already has the piece in front of it — "Move the ask into the first paragraph and cut the closing sentence." Self-contained, imperative, no preamble, no explanation, no quoting the piece back. It is applied verbatim and what comes out REPLACES what is on screen, so it must only ever describe work on the piece that is already there. If you did not propose a specific change, this is an empty string; do not invent one to fill the field. If they asked you to pick between options and you picked one, this is the change that makes their piece match your pick.
- (c) fills "handoffApp", "handoffBrief" and "handoffTitle", and leaves "instruction" empty. Never both: an instruction alongside a handoff would offer them a button that overwrites the very piece the handoff exists to protect. Never tell them to change the doc type of this piece either.
  - "handoffType" applies only when "handoffApp" is "writing-studio": the closest fit from email, document (document, memo, report, one-pager), message (Teams, Slack, text), social (LinkedIn or other social post), summary (summary, abstract, recap), other (anything else: talking points, an agenda, notes, a script). Pick "other" rather than forcing a bad fit. Leave it empty for any other app.
  - "handoffBrief" is the brief for the new thing: what it is, who it is for, what it has to cover, and any shape or length they asked for. Two or three sentences, imperative. It is created from the same source material, notes and attachments they gave this one, and this ${docType} comes along as background, so never paste the piece into the brief — say what the new thing has to do, and what it should do differently. For "meeting-prep", write it as them describing the meeting in their own words: who is in the room, what they want out of it, and what they are worried about.
  - "handoffTitle" is a 3 to 7 word working name for it, the way they would refer to it ("Launch email to the field team", "Exec review of the pilot"). Not a subject line.
  - "reply" then says in a line or two what you will make, and that it arrives as its own thing with this ${docType} left alone. Do not write the new piece out in the reply.
- (a) leaves every field but "reply" empty.

How to answer:
- Be short. Two or three sentences for most questions, and a tight list when they ask for options.
- Be concrete and specific to THEIR text. Quote the line you mean. "Your second paragraph buries the ask" beats "consider improving clarity".
- Have an opinion. If they ask whether something works, say yes or no and why, then what you'd do.
- Don't hand back a full rewritten version of the piece. Say what to change and why; the "instruction" field is how the change actually gets made, and there is a button on your answer that applies it, so never tell them to retype anything or to go and use the refine box.
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
      // A handoff only exists if there is somewhere to send it and something to
      // say when it gets there; anything short of that is just an answer.
      const app = HANDOFF_APPS.includes(String(chat.handoffApp || ""))
        ? String(chat.handoffApp)
        : "";
      const handoffBrief = app ? stripEmDashes(String(chat.handoffBrief || "")) : "";
      const handoff = handoffBrief.trim() ? app : "";
      return NextResponse.json({
        reply: stripEmDashes(String(chat.reply || "")),
        // One or the other, never both: a handoff that also carried an
        // instruction would put an "apply to this piece" button next to the very
        // suggestion that must not touch this piece.
        instruction: handoff ? "" : stripEmDashes(String(chat.instruction || "")),
        handoffApp: handoff,
        handoffType:
          handoff === "writing-studio" && DOC_TYPE_KEYS.includes(String(chat.handoffType || ""))
            ? String(chat.handoffType)
            : "",
        handoffBrief: handoff ? handoffBrief : "",
        handoffTitle: handoff
          ? stripEmDashes(String(chat.handoffTitle || "")).slice(0, 80)
          : "",
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
