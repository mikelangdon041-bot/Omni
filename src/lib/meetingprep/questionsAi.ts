// The question bank: a long, ranked, categorised list of questions to ask in
// a meeting, which the writer picks from and arranges into the list they
// actually carry in.
//
// Separate from the brief's "Smart questions to ask them", which is the four
// or five that belong in a document read on the way in. This is the pool —
// twenty or more, grouped, with a follow-up probe under each, written to be
// read off a card while standing up.

import { anthropic, WRITER_MODEL } from "@/lib/anthropic";
import { DOMAIN_RULE, SEAT_RULE, meetingContext, type MeetingPayload } from "./briefAi";

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
  /** "more on AI", "shorter", "harder" — what this batch should be about. */
  focus?: string;
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
    system: `You write the question bank someone carries into a meeting. Exactly ${count} questions.

${SEAT_RULE}

${DOMAIN_RULE}

Every question:
- is written word for word, exactly as it would be said out loud, short enough to say in one breath and to read off a card at a glance. No preamble, no stage directions, no "you might ask".
- is one only someone who knows this subject could ask. A question that hands the meeting's own title back ("what does the future of X look like?") or that could be asked at any meeting in any industry ("what are your biggest challenges?") is filler. Name the specific change, number, trade-off or disagreement underneath it.
- opens something up. Never a yes/no unless the yes/no is the point and the follow-up does the work.

Fields:
- text: the question itself.
- category: which part of the conversation it belongs to. When categories are given below, use those exact names; only invent a new one for a question that genuinely belongs nowhere in them, and never a near-synonym of one that exists. Otherwise invent 4 to 6 categories that fit THIS meeting and its arc (an opener category, two or three on the substance, one on the harder or riskier ground, a closing one). Use the same wording for every question in a category. Keep category names short, 2 to 5 words.
- why: at most 12 words on what it gets you — the reason to pick this one. Not a restatement of the question.
- followUp: the probe to use when the first answer is thin or too comfortable, also written word for word. Never empty.
- forWhom: who to put it to, when that matters — a name from the context, or a role ("the most operational panelist", "the CFO"). Empty string when it is for everyone or for the only other person in the room.
- rank: 1 is the strongest question in the whole list, then 2, and so on, every number used once. Rank on what would most move this meeting, not on category order.

Plain prose. No markdown, no bold, no emoji, no quotation marks around the question. Never an em dash or en dash; use a comma or a full stop.`,
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
        }${focus ? `\n\nWhat this batch should focus on: ${focus}` : ""}`,
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
  return out.sort((a, b) => a.rank - b.rank);
}
