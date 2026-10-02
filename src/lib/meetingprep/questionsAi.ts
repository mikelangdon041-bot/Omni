// The question bank: a long, ranked, categorised list of questions to ask in
// a meeting, which the writer picks from and arranges into the list they
// actually carry in.
//
// Separate from the brief's "Questions to ask", which is the four or five
// that belong in a document read on the way in. This is the pool — twenty or
// more, grouped, with a follow-up probe under each, written to be read off a
// card while standing up.

import { anthropic, WRITER_MODEL } from "@/lib/anthropic";
import { DOMAIN_RULE, SEAT_RULE, meetingContext, type MeetingPayload } from "./briefAi";
import { allowedNames, namedSource } from "./spokenSources";

export interface WrittenQuestion {
  text: string;
  category: string;
  why: string;
  followUp: string;
  forWhom: string;
  rank: number;
}

const QUESTIONS_SCHEMA = {
  type: "object" as const,
  properties: {
    questions: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          text: { type: "string" as const },
          category: { type: "string" as const },
          why: { type: "string" as const },
          followUp: { type: "string" as const },
          forWhom: { type: "string" as const },
          rank: { type: "number" as const },
        },
        required: ["text", "category", "why", "followUp", "forWhom", "rank"],
        additionalProperties: false,
      },
    },
  },
  required: ["questions"],
  additionalProperties: false,
};

// A question is SAID, in front of people. The brief's attribution rule — put
// the source in the line, as source plus year — is right for something read
// silently and wrong here: it turned every opener into "McKinsey says ...",
// and when the writer asked for that to stop, it could not, because that rule
// was in the system prompt and their correction was not.
const SPOKEN_SOURCING_RULE = `Where the material came from belongs in "why", never in the question itself. The writer is going to say this out loud, and "McKinsey says whoever masters the evidence wins, are you there?" is a line off a conference slide, not a question a person asks. Take the finding, drop the name, ask the thing underneath it. Put the source in "why" (e.g. "from the McKinsey 2025 line on evidence mastery") so the writer knows where it came from and can cite it themselves if they choose to. Never name a consultancy, report, survey, study or author in "text" unless the writer has explicitly asked for citations in the question.`;

/**
 * The block carrying the writer's own instructions. It goes in the SYSTEM
 * prompt, last, and says plainly that it outranks what came before it.
 *
 * It used to live at the end of the user message, where it lost a straight
 * fight with a system rule that said the opposite — which is how a bank came
 * back still opening every question with a consultancy's name after being
 * told twice not to.
 *
 * `guidance` is how the questions should be written; `coverage` is what they
 * should be about. Both are applied on a second pass rather than planned for
 * on the first: asked up front for "some on X", the model writes questions on
 * X and a worse bank around them.
 */
function instructionBlock(guidance: string, coverage: string, focus: string): string {
  if (!guidance && !coverage && !focus) return "";
  return `
THE WRITER'S OWN INSTRUCTIONS
These come from the person who is going to ask these questions out loud, after reading what you wrote last time. They outrank every rule above, including anything about how to phrase, source or structure a question. Where one of them contradicts a rule above, the instruction wins and that rule is simply off.
${guidance ? `\nHow these questions must be written:\n${guidance}\n` : ""}${coverage ? `\nWhat the writer wants covered:\n${coverage}\n` : ""}${focus ? `\nWhat this particular batch is for: ${focus}\n` : ""}
Work in two passes, and do the second one properly.

1. Write the bank you would have written anyway: the best questions on this subject, in the proportions the subject deserves, already obeying the instruction about how they are written.

2. Then read your own draft back as though someone else wrote it, and fix it against the instructions above.
   - Take each instruction about HOW they are written and check every single question against it, one at a time, not a sample. One question that breaks it is a failure, and it will be the one that gets read out loud. Rewrite that question; if the fix isn't obvious, cut it and write a different one.
   - Take each thing the writer wants COVERED and ask whether the draft genuinely covers it — a real question that someone who cares about that thing would be glad was asked. If it is already covered, change nothing, and do not pad it with near-duplicates to look thorough. If it is thin or missing, replace your weakest questions with ones that cover it.
   - There is no quota. "Include some on X and Y" never means a fixed number of each, and it never means the bank becomes about X and Y. The rest of the subject keeps the room it deserves.

Return only the finished second-pass list. Never mention the passes, the instructions, or that you revised anything.`;
}

const REPAIR_SCHEMA = {
  type: "object" as const,
  properties: {
    fixes: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          index: { type: "number" as const },
          text: { type: "string" as const },
          why: { type: "string" as const },
          followUp: { type: "string" as const },
        },
        required: ["index", "text", "why", "followUp"],
        additionalProperties: false,
      },
    },
  },
  required: ["fixes"],
  additionalProperties: false,
};

/**
 * Rewrites the questions that came back with a source named in them.
 *
 * Told not to, with the instruction in the system prompt and the writer's own
 * words above it saying they outrank everything, one question in twenty two
 * still came back as "McKinsey says whoever masters the evidence wins". A
 * rule the output has to pass is a check, not a sentence in a prompt. So the
 * output gets checked, the failures get sent back one more time with the
 * exact offending phrase quoted at them, and anything still naming a source
 * after that is dropped. A bank of nineteen is better than a bank of twenty
 * with a line in it the writer has now asked twice not to be given.
 */
async function scrubNamedSources(
  questions: WrittenQuestion[],
  allow: string[],
  guidance: string,
): Promise<WrittenQuestion[]> {
  let out = [...questions];
  for (let round = 0; round < 2; round++) {
    const bad = out
      .map((q, index) => ({ index, q, hit: namedSource(q.text, allow) }))
      .filter((r) => r.hit);
    if (!bad.length) {
      if (round) console.warn(`[questions] name-drop repair fixed all ${round} round(s)`);
      return out;
    }
    console.warn(
      `[questions] round ${round + 1}: ${bad.length} question(s) named a source - ${bad
        .map((r) => r.hit)
        .join(", ")}`,
    );

    const res = await anthropic().messages.create({
      model: WRITER_MODEL,
      max_tokens: 4000,
      output_config: { format: { type: "json_schema", schema: REPAIR_SCHEMA } },
      system: `You are fixing questions that broke one rule, and nothing else about them.

The rule: the question is said OUT LOUD, so the name of a consultancy, analyst house, report, study, survey or author can never appear in it. Not at the front, not in a clause, not as "according to", not as "their 2025 survey". The writer has asked for this twice. Take the finding, drop the name, and ask the thing underneath it, in their own voice. Where the source matters, it goes in "why" instead, so the writer can cite it themselves if they decide to.

Each question below is quoted with the exact phrase that broke the rule. Rewrite that question so it does the same job in the conversation, just as strong and just as specific, with no source named. Do not make it vaguer to get around the rule: if the only thing the question had going for it was the citation, write a different question about the same thing. Keep it short enough to say in one breath.
${guidance ? `\nThe writer also said this about how their questions must be written, and it still applies:\n${guidance}\n` : ""}
Return "index" exactly as given, the new "text", a "why" of at most 15 words that may name the source, and a "followUp" probe written word for word. Plain prose, no markdown, never an em dash or en dash.`,
      messages: [
        {
          role: "user",
          content: bad
            .map(
              (r) =>
                `index ${r.index}\nbroke the rule with: ${r.hit}\nquestion: ${r.q.text}\nwhy it was picked: ${r.q.why}\nits probe: ${r.q.followUp}`,
            )
            .join("\n\n"),
        },
      ],
    });
    if (res.stop_reason === "refusal") break;
    const parsed = JSON.parse(firstText(res) || "{}");
    const byIndex = new Map<number, { text: string; why: string; followUp: string }>();
    for (const f of Array.isArray(parsed.fixes) ? parsed.fixes : []) {
      const i = Number(f?.index);
      const text = String(f?.text || "").trim();
      if (!Number.isInteger(i) || !text) continue;
      byIndex.set(i, {
        text,
        why: String(f?.why || "").trim(),
        followUp: String(f?.followUp || "").trim(),
      });
    }
    if (!byIndex.size) break;
    out = out.map((q, i) => {
      const fix = byIndex.get(i);
      // Only take the replacement if it actually passes. A fix that names a
      // different source is not a fix.
      if (!fix) return q;
      const still = namedSource(fix.text, allow);
      if (still) {
        console.warn(`[questions] the repair named "${still}" as well, keeping the original`);
        return q;
      }
      return { ...q, text: fix.text, why: fix.why || q.why, followUp: fix.followUp || q.followUp };
    });
  }
  // Last resort, and the only one that cannot fail.
  const dropped = out.filter((q) => namedSource(q.text, allow));
  if (dropped.length)
    console.warn(
      `[questions] dropped ${dropped.length} question(s) that would not come clean: ${dropped
        .map((q) => q.text.slice(0, 60))
        .join(" | ")}`,
    );
  return out.filter((q) => !namedSource(q.text, allow));
}

function firstText(res: { content: { type: string; text?: string }[] }): string {
  const block = res.content.find((b) => b.type === "text");
  return (block?.text || "").trim();
}

export async function writeQuestions({
  meeting,
  kolBlock = "",
  research = "",
  briefText = "",
  existing = [],
  categories = [],
  count = 20,
  focus = "",
  guidance = "",
  coverage = "",
}: {
  meeting: MeetingPayload;
  kolBlock?: string;
  research?: string;
  /** The brief, so the bank extends it rather than repeating it. */
  briefText?: string;
  /** Questions already in the bank — never repeat or paraphrase these. */
  existing?: string[];
  /** Categories the bank already uses, so a second batch files into them. */
  categories?: string[];
  count?: number;
  /** "more on AI", "shorter", "harder" — what THIS batch is for. */
  focus?: string;
  /** Standing instruction on how every question must be written. */
  guidance?: string;
  /** Standing instruction on what the bank should cover. */
  coverage?: string;
}): Promise<WrittenQuestion[]> {
  const context = [
    meetingContext(meeting, kolBlock),
    research && `Research notes, from a web search run for this meeting. This is your best material — most questions should be traceable to something in here:\n${research.slice(0, 20000)}`,
    briefText && `The brief already written for this meeting:\n${briefText.slice(0, 12000)}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const res = await anthropic().messages.create({
    model: WRITER_MODEL,
    max_tokens: 12000,
    output_config: { format: { type: "json_schema", schema: QUESTIONS_SCHEMA } },
    system: `You write the question bank someone carries into a meeting. At least ${count} questions, and more than that where the subject genuinely carries them. ${count} is a floor the writer chose, not a target: never pad towards it with near-duplicates or questions you do not believe in, and never stop at it if there is more worth asking.

Before you write a single question, find the subject of this session in the context and hold it in front of you. If a line marked THE SUBJECT OF THIS SESSION is there, that is the subject, and the meeting's name is not: a question that would still make sense if the subject were swapped for a different one does not belong in this bank. Every question must be about that subject, in the specific terms that subject is argued about. Read the subject closely enough to name its parts: if it says one thing is turned into another, ask about the turning, about what is lost on the way, and about how anyone would know it worked.

${SEAT_RULE}

${DOMAIN_RULE}

${SPOKEN_SOURCING_RULE}

Every question:
- is written word for word, exactly as it would be said out loud, short enough to say in one breath and to read off a card at a glance. No preamble, no stage directions, no "you might ask".
- serves the session's stated subject. Not the industry around it, not the meeting's title, that subject.
- is one only someone who knows this subject could ask. A question that hands the meeting's own title back ("what does the future of X look like?") or that could be asked at any meeting in any industry ("what are your biggest challenges?") is filler. Name the specific change, number, trade-off or disagreement underneath it.
- opens something up. Never a yes/no unless the yes/no is the point and the follow-up does the work.

Fields:
- text: the question itself.
- category: which part of the conversation it belongs to. Name it the way you would say it to a colleague: plain, literal, two to four words, describing what the questions in it are about or when they get asked. "Opening questions", "How it works in practice", "The uncomfortable ones", "Measuring it", "To close on". Never a colon, never a label with a clever subtitle after it, never a word nobody would say out loud. When categories are given below, use those exact names; only invent a new one for a question that genuinely belongs nowhere in them, and never a near-synonym of one that exists. Otherwise invent 4 to 6 that fit this meeting's arc (one to open with, two or three on the substance, one on the harder ground, one to close with). Use identical wording for every question in a category.
- why: at most 15 words on what it gets you — the reason to pick this one, plus where the material came from when it came from the research. Not a restatement of the question.
- followUp: the probe to use when the first answer is thin or too comfortable, also written word for word. Never empty.
- forWhom: who to put it to, when that matters — a name from the context, or a role ("the most operational panelist", "the CFO"). Empty string when it is for everyone or for the only other person in the room.
- rank: 1 is the strongest question in the whole list, then 2, and so on, every number used once. Rank on what would most move this meeting, not on category order.

Plain prose. No markdown, no bold, no emoji, no quotation marks around the question. Never an em dash or en dash; use a comma or a full stop.
${instructionBlock(guidance.trim(), coverage.trim(), focus.trim())}`,
    messages: [
      {
        role: "user",
        content: `${context || "(minimal context)"}${
          existing.length
            ? `\n\nAlready in the bank — do not repeat these, and do not write a paraphrase of any of them:\n${existing
                .map((q) => `- ${q}`)
                .join("\n")
                .slice(0, 8000)}`
            : ""
        }${
          categories.length
            ? `\n\nCategories already in the bank. File these questions into these exact names unless one genuinely belongs nowhere in them:\n${categories
                .map((c) => `- ${c}`)
                .join("\n")}`
            : ""
        }`,
      },
    ],
  });
  if (res.stop_reason === "refusal") return [];

  const parsed = JSON.parse(firstText(res) || "{}");
  const seen = new Set(existing.map((e) => e.trim().toLowerCase()));
  const out: WrittenQuestion[] = [];
  for (const q of Array.isArray(parsed.questions) ? parsed.questions : []) {
    const text = String(q?.text || "").trim();
    if (!text || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    out.push({
      text,
      category: String(q?.category || "").trim() || "Questions",
      why: String(q?.why || "").trim(),
      followUp: String(q?.followUp || "").trim(),
      forWhom: String(q?.forWhom || "").trim(),
      rank: Number(q?.rank) || out.length + 1,
    });
  }
  const clean = await scrubNamedSources(
    out,
    allowedNames(meeting.attendees),
    guidance.trim(),
  );
  return clean.sort((a, b) => a.rank - b.rank);
}
