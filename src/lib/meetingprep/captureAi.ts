// Turning a raw transcript into a titled set of notes with follow-ups.
//
// This lived inline in /api/meeting/ai as the "capture" action, which was fine
// while the browser was the only caller: the page called capture, read the
// result, and inserted the meeting row itself. The Windows desktop recorder
// cannot do that half — it has no Supabase client and no UI to review in — so
// it needs one server call that both writes the notes and creates the meeting.
// Rather than have two prompts drift apart, the model half lives here and both
// routes call it.

import { anthropic, QUICK_MODEL, WRITER_MODEL } from "@/lib/anthropic";
import { applySpellings, spellingPromptBlock, type Spelling } from "./spellings";

export const NO_DASH_RULE =
  "Never use an em dash or an en dash. Not to join clauses, not as an aside, not before a list. Use a comma, a semicolon, a colon or a full stop instead. Hyphens inside compound words (tier-one, endo-first, one-on-one) are fine.";

// The prompt rule catches most of it; this catches the rest. A dash used as
// punctuation becomes a comma; hyphens inside compound words (tier-one,
// one-on-one) are left alone because they are not the problem.
export function stripDashes(text: string): string {
  return text
    .replace(/ ?[—–] ?/g, ", ")
    .replace(/,\s*,/g, ",")
    .replace(/,\s*([.;:!?])/g, "$1")
    .replace(/,\s*(<\/li>|<ul>|<\/ul>|<ol>)/gi, "$1");
}

// Every attributed position has to be traceable to words actually spoken.
// The model is asked for a verbatim quote; this checks the quote is really in
// the transcript rather than taking its word for it. Anything unverifiable is
// a fabricated attribution, which is the failure mode worth catching: it reads
// authoritative and puts a view in the wrong person's mouth.
function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface Position {
  speaker: string;
  position: string;
  quote: string;
}

function verifyPositions(
  raw: unknown,
  transcript: string,
): { grounded: Position[]; dropped: number } {
  const haystack = normalizeForMatch(transcript);
  const grounded: Position[] = [];
  let dropped = 0;
  for (const item of Array.isArray(raw) ? raw : []) {
    const p = item as Partial<Position>;
    const quote = normalizeForMatch(String(p?.quote || ""));
    // Too short to be evidence of anything.
    if (quote.split(" ").length < 4) {
      dropped += 1;
      continue;
    }
    if (!haystack.includes(quote)) {
      dropped += 1;
      continue;
    }
    grounded.push({
      speaker: String(p?.speaker || ""),
      position: String(p?.position || ""),
      quote: String(p?.quote || ""),
    });
  }
  return { grounded, dropped };
}

// A captured recording has no meeting row to take its name from, so the model
// names the thing as well as writing it up.
const CAPTURE_SCHEMA = {
  type: "object" as const,
  properties: {
    // Generated before the notes on purpose. Each attribution has to be tied
    // to a verbatim quote first, which is what stops two speakers' views
    // being merged or a concern landing on whoever answered it.
    positions: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          speaker: { type: "string" as const },
          position: { type: "string" as const },
          quote: { type: "string" as const },
        },
        required: ["speaker", "position", "quote"],
        additionalProperties: false,
      },
    },
    title: { type: "string" as const },
    // One document, not a set of cards. The notes get pasted wholesale into
    // OneNote and the like, so they have to be a single nested list rather
    // than separate blocks the user has to copy one at a time.
    notes: { type: "string" as const },
    actions: { type: "array" as const, items: { type: "string" as const } },
    // Meetings routinely open with several minutes of greetings and travel
    // chat before anyone says anything worth keeping. The notes never include
    // it; this lets the UI offer to drop it from the stored transcript too.
    smallTalk: {
      type: "object" as const,
      properties: {
        found: { type: "boolean" as const },
        description: { type: "string" as const },
        firstSubstantiveLine: { type: "string" as const },
      },
      required: ["found", "description", "firstSubstantiveLine"],
      additionalProperties: false,
    },
  },
  required: ["positions", "title", "notes", "actions", "smallTalk"],
  additionalProperties: false,
};

export interface CaptureInput {
  transcript: string;
  hint?: string;
  ownNotes?: string;
  emphasizeNotes?: boolean;
  /** Words the user has corrected in earlier meetings (see spellings.ts). */
  spellings?: Spelling[];
}

export interface CaptureOutput {
  positions: Position[];
  /** How many attributions were dropped for having no verbatim quote. */
  ungrounded: number;
  title: string;
  notes: string;
  actions: string[];
  smallTalk: { found: boolean; description: string; firstSubstantiveLine: string };
}

/** Thrown when the model declines the recording, so callers can send a 502. */
export class CaptureRefusal extends Error {}

function firstText(res: { content: { type: string; text?: string }[] }): string {
  const block = res.content.find((b) => b.type === "text");
  return (block?.text || "").trim();
}

export async function captureFromTranscript(input: CaptureInput): Promise<CaptureOutput> {
  const transcript = String(input.transcript || "").slice(0, 120000);
  const hint = String(input.hint || "").slice(0, 2000);
  // The writer's own notes, and whether they want them treated as the
  // priority signal rather than as one more piece of context.
  const ownNotes = String(input.ownNotes || "").slice(0, 20000);
  const emphasizeNotes = input.emphasizeNotes !== false;
  const spellings = input.spellings || [];
  const spellingBlock = spellingPromptBlock(spellings);

  const res = await anthropic().messages.create({
    model: WRITER_MODEL,
    max_tokens: 8000,
    output_config: { format: { type: "json_schema", schema: CAPTURE_SCHEMA } },
    system: `You turn the transcript of a meeting into usable notes. It may come from automatic speech recognition — expect missing punctuation and mis-heard words — or be an exported transcript. Infer sensibly from context but never invent content.

Attribution, which matters and is easy to get wrong:
- If the transcript has speaker labels ("Dr. Chen:", "Speaker 1:", "Speaker A:"), USE them. Attribute positions, objections and commitments to the person who actually said them, and carry that through into the follow-ups ("Dr. Chen asked for…", not "someone asked for…").
- Use speaker labels EXACTLY as they appear. Never rename a speaker, never map a label onto a person named elsewhere in the conversation, and never merge or swap two labels. A label like "Speaker A" means voice separation found a distinct person but nobody has said who they are — leave it as "Speaker A". Somebody being greeted or thanked by name tells you a name was said, NOT which label it belongs to; the person saying "thanks, Sarah" is the one person it definitely is not.
- Never state or imply a speaker's gender. Do not write he, she, his, her, him, or hers about a participant unless the transcript itself says so outright. Use their label or name, or they/them. Voice pitch is not evidence and is not available to you anyway.
- If you cannot tell who did something, say so plainly ("one participant asked…") rather than picking whoever seems most likely. A confident wrong attribution is far worse than an unattributed note: it puts words in someone's mouth and the reader has no way to tell it was a guess.
- If it has NO speaker labels, you cannot tell who spoke. Write the notes impersonally ("the dosing schedule was questioned"). Do NOT guess who said what, do NOT invent speaker names, and do NOT assume it was all one person — a single unlabelled block is usually several people talking in turn.
- Line breaks often mark a change of speaker even when nobody is named — Apple Voice Memos and several other tools put each turn on its own line. Treat a line-broken transcript as a multi-party conversation with turns, and let that shape the notes ("this was pushed back on", "the two sides landed on…"). Use the turn structure; still don't invent who owns which turn.

- title: a short, specific name for this meeting as a person would write it in a calendar (5-8 words, no quotes). Use real names/topics from the transcript when they're clear, e.g. "Dr. Patel — dosing concerns and advisory board". If the transcript is too thin to tell, use a plain descriptive title.
- notes: ONE nested bullet list covering the whole meeting, as HTML using ONLY <ul>, <li>, <b> and <i>. No headings, no <p>, no styling attributes, no markdown. Structure:
  - Top level: one <li> per topic, in the order topics came up, 3-7 of them; no "Introduction" / "Discussion" / "Conclusion" filler. The topic bullet is itself a complete statement of what that topic came to — it is not a heading and it is not a label. It must NOT end in a dash, colon, ellipsis or any other trailing punctuation waiting for the nested bullets to finish the thought; it has to stand on its own if the nested list under it were deleted.
  - Nested <ul> inside each topic for the substance, 2-3 levels deep. Complete sentences. Preserve names, figures, product names and dates exactly as spoken. Never invent anything that wasn't said.
  - It must read as one document someone can paste straight into OneNote or Word and have it keep its shape.
  - ${NO_DASH_RULE}

FIRST, before writing anything else, fill "positions". This is a grounding step and it exists for a specific reason: when notes are written straight from a conversation, attribution drifts. Two people's views get merged into one, or a concern gets pinned on the person who answered it rather than the person who raised it. Forcing every attribution back to the exact words first is what stops that.

For each distinct stance, concern, decision or commitment in the transcript, record:
- speaker: the label EXACTLY as it appears in the transcript ("Speaker A", "Dr. Chen"). If the transcript carries no speaker labels at all, use an empty string and do not guess.
- position: what that person holds or committed to, in one sentence.
- quote: 6 to 20 words copied VERBATIM from that speaker's own line, character for character, so it can be found in the transcript by exact string search. Do not paraphrase, do not tidy the grammar, do not stitch together words from two different lines. If you cannot produce a verbatim quote for a position, do not record that position at all.

Record both sides of every disagreement as separate positions. If the same person says something twice, record it once.

THEN write "notes" using only what you recorded. Every attribution in the notes must correspond to a position you recorded, and to that position's speaker. A point you could not ground goes in the notes with no attribution rather than being guessed at. Never merge two speakers' positions into one bullet, and never move a concern from the person who raised it to the person who responded.

WRITE NOTES, NOT A RETELLING. This is the difference between useful and useless, so weigh it heavily.

THE BANNED SENTENCE SHAPE: a bullet must never open with a person, role or pronoun followed by a verb of speaking, thinking or feeling. Not "I", not "Shrey", not "the manager", not "they". The banned verbs include said, told, explained, noted, stated, clarified, affirmed, confirmed, flagged, raised, mentioned, added, responded, replied, asked, acknowledged, committed, understood, felt, thought, believed, emphasised, pointed out, indicated, reported, expressed, suggested, argued, pushed back, wanted, offered, agreed, disagreed. Swapping one of these verbs for another one is NOT a fix — the shape is the problem, not the word. "I clarified…" is exactly as wrong as "I said…".

Write what is now true, decided, or open — not who uttered it:
  BAD:  "I clarified that it was never a direction but an option."
  GOOD: "Talking to other specialties who see Cushing's is an option, not a direction; endo-first guidance stands."
  BAD:  "Shrey flagged a perceived East/West divide and a drop in team morale."
  GOOD: "A perceived East/West divide and falling team morale are live concerns beyond this 1:1."
  BAD:  "Shrey reported that several colleagues feel a lack of confidence and support."
  GOOD: "Several colleagues feel a lack of confidence and support, and the intent behind recent changes is landing as negative."
  BAD:  "I stated they know nothing about this territory and only wanted the MSL to walk them through it."
  GOOD: "The territory review is for orientation — colour and background a list cannot give, plus who the key people are. Explicitly not a performance review."
  BAD:  "I committed to following up with team members."
  GOOD: "The morale concerns need a follow-up with the wider team." The subject and why it matters stay in the notes; who does what goes in actions.

Most bullets need no attribution at all. Add the bracketed name only where a reader would act differently for knowing who holds the view: a contested position, an unresolved disagreement, a commitment someone owns. Shared context, agreed facts and background carry no name. If more than about a third of your bullets end in a name, you are over-attributing and should strip the ones that do not change what the reader does.

Attribution, when it genuinely matters — a contested position, an unresolved disagreement, a view the reader must respond to — goes in brackets at the end of the sentence, never as the verb: "Endo-first guidance stands (Shrey had read earlier feedback as a steer toward tier-one cardiology)."

Also:
- Organise by topic and by what came out of it, never by the order people spoke.
- Where people disagreed, give the resolved position first and then what is still open, rather than replaying both sides in sequence. Where nothing was resolved, say so and say what would settle it.
- A reader who was not in the meeting should skim this and know where things stand — not reconstruct who talked when.

EVERY FOLLOW-UP HAS A HOME IN THE NOTES. A reader who sees a follow-up must be able to find, in the notes, what it is about and why it came up. When part of the conversation produced nothing but a next step, usually the last few minutes, it still gets a bullet saying what was discussed: what the thing is, what state it is in, what was agreed about it. A follow-up that mentions something the notes never mention is a sign that a topic was dropped. Put it back.

BEFORE YOU FINISH: reread every bullet you have written. If it describes someone saying, thinking or feeling something rather than stating what is true, decided or open, rewrite it. If a bullet is only a promise ("I will send…"), reword it as what was decided and put the promise in actions. Then read the actions one by one and check each has a bullet behind it.
- actions: every concrete follow-up the recording implies or someone promised, each as one imperative sentence, with the owner and any deadline when stated (e.g. "Send Dr. Chen the phase 3 subgroup data by Friday"). Only real commitments and next steps — not topics, not general observations. Empty array if there genuinely are none.
- smallTalk: meetings usually open with pleasantries — greetings, travel, weather, weekend plans, waiting for people to join, tech checks — before anyone says anything substantive. Never make a section for it.
  - found: true only when there is a genuine run of opening pleasantries. A one-line "hi, how are you" before real content does not count.
  - description: what it was, 3-8 words ("greetings and weekend plans", "waiting for Dr. Ruiz to join").
  - firstSubstantiveLine: the first 8-15 words of the first sentence that carries real content, copied VERBATIM from the transcript — exact characters, including any speaker label. It is used to locate the cut point, so a paraphrase is useless. Empty string when found is false.${
      spellingBlock ? `

${spellingBlock}` : ""
    }${
      ownNotes
        ? emphasizeNotes
          ? `

THE WRITER'S OWN NOTES — the highest-signal input you have. They took the trouble to write these down, which means they judged it mattered: the transcript is everything that was said, their notes are what was worth saying. Concretely:
- Every point in their notes must appear in the sections. None may be dropped for being thinly covered in the transcript.
- Lead the relevant section with their point, and prefer their framing and wording where it is clear.
- Where their notes and the transcript cover the same ground, their emphasis decides what matters; the transcript supplies the specifics, names and figures around it.
- If they noted something the transcript barely covers, still include it, worded as their note — but never invent transcript detail to prop it up.
- A follow-up they wrote down is a real commitment even where the transcript is vague about it.`
          : `

THE WRITER'S OWN NOTES are background context. Use them to understand the meeting and resolve ambiguity, but weight them no more heavily than the transcript — build the notes from what was actually said.`
        : ""
    }`,
    messages: [
      {
        role: "user",
        content: `${hint ? `What the recording is (from the person who recorded it): ${hint}\n\n` : ""}${
          ownNotes ? `The writer's own notes:\n${ownNotes}\n\n` : ""
        }Transcript:\n${transcript}`,
      },
    ],
  });

  if (res.stop_reason === "refusal") {
    throw new CaptureRefusal("The model declined this recording.");
  }

  const parsed = JSON.parse(firstText(res) || "{}");
  // Quotes that aren't in the transcript mean the attribution was invented.
  // Surfaced so the caller can say the notes are unattributed rather than
  // silently presenting a guess as fact.
  const { grounded, dropped } = verifyPositions(parsed.positions, transcript);
  // The prompt asks for the right spellings; this makes sure of them.
  const actions: string[] = (Array.isArray(parsed.actions) ? parsed.actions : []).map(
    (a: unknown) => applySpellings(stripDashes(String(a)), spellings),
  );
  let notes = applySpellings(stripDashes(String(parsed.notes || "")), spellings, true);
  // The prompt also asks for every follow-up to have a bullet behind it. This
  // checks, and asks again for just the missing ones when it does not.
  const orphans = orphanedFollowUps(notes, actions, transcript);
  if (orphans.length) {
    notes = applySpellings(await fillOrphanedFollowUps(notes, orphans, transcript), spellings, true);
  }
  return {
    positions: grounded,
    ungrounded: dropped,
    title: applySpellings(String(parsed.title || "").slice(0, 200), spellings),
    notes,
    actions,
    smallTalk: {
      found: Boolean(parsed.smallTalk?.found),
      description: String(parsed.smallTalk?.description || ""),
      firstSubstantiveLine: String(parsed.smallTalk?.firstSubstantiveLine || ""),
    },
  };
}

// --- Follow-ups with nothing behind them ------------------------------------
//
// A follow-up that names something the notes never mention is the visible
// trace of a dropped topic: "Update Santan and keep it current" under notes
// that say nothing about Santan, so nobody reading them later knows what it is
// or why it came up. It happens most at the end of a long meeting, where the
// last few minutes produced a to-do and nothing else.
//
// The names are the test because they are what a reader would look for. A
// capitalised word past the first (the first is the verb), or an acronym,
// that appears in a follow-up and nowhere in the notes. Speaker labels and
// the owner in brackets are left out: notes deliberately carry few names.

const NOT_A_SUBJECT = new Set([
  "Speaker", "The", "This", "That", "Then", "And", "But", "With", "For", "From",
  "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
  "January", "February", "March", "April", "May", "June", "July", "August",
  "September", "October", "November", "December",
]);

export interface OrphanedFollowUp {
  action: string;
  /** The words in it that the notes never mention. */
  missing: string[];
}

function speakerLabels(transcript: string): Set<string> {
  const out = new Set<string>();
  for (const line of transcript.split("\n")) {
    const m = line.match(/^([^:]{1,40}):\s/);
    if (m) for (const w of m[1].split(/\s+/)) out.add(w.replace(/[^A-Za-z0-9]/g, ""));
  }
  return out;
}

export function orphanedFollowUps(
  notesHtml: string,
  actions: string[],
  transcript = "",
): OrphanedFollowUp[] {
  const notes = ` ${normalizeForMatch(notesHtml.replace(/<[^>]+>/g, " "))} `;
  const labels = speakerLabels(transcript);
  const out: OrphanedFollowUp[] = [];
  for (const action of actions) {
    const words = action
      .replace(/\([^)]*\)/g, " ")
      .split(/\s+/)
      .map((w) => w.replace(/['’]s$/, "").replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, ""))
      .filter(Boolean);
    const terms = words
      .slice(1)
      .filter((w) => w.length >= 3 && /^[A-Z]/.test(w) && !NOT_A_SUBJECT.has(w) && !labels.has(w));
    const missing = [...new Set(terms)].filter(
      (t) => !notes.includes(` ${normalizeForMatch(t)} `),
    );
    if (missing.length) out.push({ action, missing });
  }
  return out;
}

const ADDITIONS_SCHEMA = {
  type: "object" as const,
  properties: {
    additions: { type: "array" as const, items: { type: "string" as const } },
  },
  required: ["additions"],
  additionalProperties: false,
};

/**
 * Add a bullet to the notes for each follow-up that has none, from what the
 * transcript says about it. Only adds: the notes that exist are not sent back
 * to be rewritten, so nothing already there can change. Any failure returns
 * the notes as they were, which is no worse than before the check existed.
 */
export async function fillOrphanedFollowUps(
  notesHtml: string,
  orphans: OrphanedFollowUp[],
  transcript: string,
): Promise<string> {
  try {
    const res = await anthropic().messages.create({
      model: QUICK_MODEL,
      max_tokens: 2000,
      output_config: { format: { type: "json_schema", schema: ADDITIONS_SCHEMA } },
      system: `Some follow-ups from a meeting name things the meeting notes never mention, so a reader cannot tell what they are about. For each follow-up listed, write ONE bullet for the notes from what the transcript says about it.

- Each addition is a single top-level <li>: one complete sentence saying what the thing is and where it stands, then, only if the transcript has them, a nested <ul> of one to three specifics. HTML using only <li>, <ul>, <b>, <i>.
- Only what the transcript says. If it says nothing beyond the follow-up itself, the bullet says just that much, plainly, and stops.
- It is a note, not a to-do: never an imperative, and never a copy of the follow-up. The follow-up says "Send the deck to Dr. Chen"; the note says "The updated deck has not gone to Dr. Chen yet."
- State what is true, decided or open. Never open with a person or pronoun followed by a verb of speaking (said, asked, noted, mentioned...).
- One addition per follow-up listed, in the same order. Do not repeat anything already in the notes.
- ${NO_DASH_RULE}`,
      messages: [
        {
          role: "user",
          content: `The notes so far:\n${notesHtml}\n\nFollow-ups with nothing behind them:\n${orphans
            .map((o) => `- ${o.action} (not in the notes: ${o.missing.join(", ")})`)
            .join("\n")}\n\nTranscript:\n${transcript.slice(0, 120000)}`,
        },
      ],
    });
    const parsed = JSON.parse(firstText(res) || "{}");
    const additions = (Array.isArray(parsed.additions) ? parsed.additions : [])
      .map((a: unknown) => stripDashes(String(a).trim()))
      .filter((a: string) => /^<li[\s>][\s\S]*<\/li>$/i.test(a));
    if (!additions.length) return notesHtml;
    const trimmed = notesHtml.trim();
    const at = trimmed.lastIndexOf("</ul>");
    return /<\/ul>$/i.test(trimmed)
      ? `${trimmed.slice(0, at)}${additions.join("")}${trimmed.slice(at)}`
      : `${trimmed}<ul>${additions.join("")}</ul>`;
  } catch {
    return notesHtml;
  }
}
