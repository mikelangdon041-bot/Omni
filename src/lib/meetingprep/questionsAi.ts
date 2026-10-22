// The question bank: a long, ranked, categorised list of questions to ask in
// a meeting, which the writer picks from and arranges into the list they
// actually carry in.
//
// Separate from the brief's "Questions to ask", which is the four or five
// that belong in a document read on the way in. This is the pool — twenty or
// more, grouped, with a follow-up probe under each, written to be read off a
// card while standing up.

import { anthropic, CHECK_MODEL, WRITER_MODEL } from "@/lib/anthropic";
import { DOMAIN_RULE, SEAT_RULE, meetingContext, type MeetingPayload } from "./briefAi";
import { allowedNames, housesIn, namedSource } from "./spokenSources";

export interface WrittenQuestion {
  /** Said before the question: the argument or finding it stands on. May be "". */
  setup: string;
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
          setup: { type: "string" as const },
          text: { type: "string" as const },
          category: { type: "string" as const },
          why: { type: "string" as const },
          followUp: { type: "string" as const },
          forWhom: { type: "string" as const },
          rank: { type: "number" as const },
        },
        required: ["setup", "text", "category", "why", "followUp", "forWhom", "rank"],
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

// Every setup is said on its own. The writer reorders the list, holds some
// back, skips some in the room, so "that same survey found" is a sentence
// with nothing in front of it as often as not. The batch prompt used to ask
// for exactly that ("refer back to it briefly"), and it broke the moment two
// questions were asked out of order.
const STANDALONE_RULE = `Each setup must make complete sense on its own, said cold, in any order, with every other question skipped. The writer reorders, holds back and skips questions in the room. So never refer to another question or setup, never "that same survey", "the same study", "as I said", "coming back to", "earlier", "again", "also", "another finding". If two questions stand on the same finding, each setup states it in full, in different words.`;

// Words that only make sense if something else was said first.
const LEANS_ON =
  /\b(?:that same|this same|those same|the same (?:survey|study|report|paper|data|research|finding|findings|group|people|respondents|numbers?|guidance|document|deck|piece|source|article|framework|standards?|work|analysis|review)|as (?:I|we) (?:said|mentioned|noted|discussed)|(?:I|we) (?:just )?mentioned|(?:said|mentioned|noted) earlier|earlier question|coming back to|come back to|going back to|as before|once again|another finding from|the other finding|building on that|on that same)\b/i;

/**
 * The phrase in a setup that needs something said before it, or null.
 *
 * Only the opening sentence is read. A setup that leans on another question
 * gives itself away at the start ("Coming back to AI", "That same survey
 * found"); later in a setup, "those same leaders" points at people it named a
 * sentence earlier, which is fine. "I keep coming back to" is the speaker's
 * own preoccupation, not a reference, and is let through.
 */
export function leansOnAnother(setup: string): string | null {
  const first = (String(setup || "").trim().match(/^[^.!?]*[.!?]?/) || [""])[0]
    .replace(/\b(?:I|we) keep coming back to\b/gi, "");
  const hit = first.match(LEANS_ON);
  return hit ? hit[0] : null;
}

// Filler that pretends to be a reaction: the writer asked for it gone, and the
// prompt alone did not hold it. Openers that announce the substance instead of
// stating it, and words that tell the room how to feel.
const FAKE_HOOK =
  /\b(?:quiet(?:ly)?|keep (?:coming back|returning|snagging) (?:to|on)|(?:stays|sticks) with me|worth sitting with|should (?:scare|worry|terrify|alarm)|(?:this|that|it) (?:surprises|shocks|stuns)|surprising(?:ly)?|striking|buried in|buried (?:inside|deep)|quiet(?:ly)? (?:admission|admits|warning|concedes|confession)|almost (?:embarrassing|disarming|philosophical|noble|brutal)|quietly brutal|(?:here'?s|there'?s) (?:a|an|one|this|something) (?:provocation|claim worth|line worth|thing worth|number that|vivid|uglier)|vivid picture|easy to skip past|(?:most )?people skip past|nobody wants to (?:name|admit|say)|everybody circles|I find (?:it )?(?:hard|fascinating)|uglier problem|deserves (?:more )?attention|nobody (?:loves|likes|wants to (?:talk about|hear|admit))|(?:problem|question|truth|thing) (?:nobody|no one) (?:loves|likes|wants)|elephant in the room|let'?s be honest|here'?s the (?:thing|kicker|rub|catch)|(?:is|was|are|gets) (?:very |pretty )?blunt|bluntly|quiet (?:incentive|problem|truth|tension|shift|crisis|pressure|cost)|quietly (?:shrinking|brutal|admits|concedes|tells))\b/i;

// A question with no setup in front of it that starts mid-thought.
const MID_THOUGHT = /^\s*(?:given that|so[,\s]|and\s|but\s|that said|with that|which (?:means|is why)|then,|in that case|if so|if that's (?:true|right))/i;

/**
 * What is wrong with a setup and question as said, if anything: leaning on
 * something said before it, or filler pretending to be a reaction. Null when
 * it is fine.
 */
// A document the room has never been told about. "The source is blunt that
// this creates blind spots" was said to a panel audience who could only ask
// "what source?" The prompt called the article THE SOURCE and said not to
// name it, so the writer called it "the source". These words always point at
// something unintroduced; report/study/survey/paper/framework only do when
// nothing earlier in the line introduced one ("a 2025 survey found... the
// survey also...").
const ALWAYS_UNNAMED =
  /\b(?:the|this|that) (?:source|article|piece|deck|slides?|guidance|guidance document|document|authors?|write-?up|standards (?:work|document|guidance)|20\d\d (?:thinking|vision|piece|report))\b|\b(?:the source|the article|the authors?) (?:says?|argues?|is|was|found|makes)\b/i;
const MAYBE_UNNAMED = /\b(?:the|this|that) (report|study|survey|paper|framework|analysis|research|white ?paper|playbook|review)\b/i;
const INTRODUCES = /\b(?:a|an|one|another|some|recent|new|large|global|\d{4})\b[^.?!]{0,40}\b(?:report|study|survey|paper|framework|analysis|research|white ?paper|playbook|review)s?\b/i;

/** The phrase pointing at a document nobody was told about, or null. */
export function unnamedSource(line: string): string | null {
  const t = String(line || "");
  const hard = t.match(ALWAYS_UNNAMED);
  if (hard) return hard[0];
  const soft = t.match(MAYBE_UNNAMED);
  if (soft && soft.index !== undefined && !INTRODUCES.test(t.slice(0, soft.index))) return soft[0];
  return null;
}

export function spokenProblem(setup: string, text: string): string | null {
  // The setup is the run-up; a setup that asks its own question has the
  // question said twice. One rewrite ended by repeating it word for word.
  if (/\?\s*$/.test(setup.trim()) || (text.length > 20 && setup.includes(text.slice(0, Math.min(50, text.length)))))
    return "the setup asks the question itself, so it would be said twice";
  const unnamed = unnamedSource(setup) || unnamedSource(text);
  if (unnamed) return `it refers to a document the room has never been told about ("${unnamed}")`;
  const lean = leansOnAnother(setup) || leansOnAnother(text);
  if (lean) return `it depends on something said before it ("${lean}")`;
  if (!setup.trim() && MID_THOUGHT.test(text)) return "the question starts mid-thought with nothing before it";
  const fake = setup.match(FAKE_HOOK);
  if (fake) return `it opens with filler instead of substance ("${fake[0]}")`;
  return null;
}

const JUDGE_SCHEMA = {
  type: "object" as const,
  properties: {
    failures: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: { index: { type: "number" as const }, reason: { type: "string" as const } },
        required: ["index", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["failures"],
  additionalProperties: false,
};

/**
 * The same two tests, judged, for what a list of phrases cannot catch. Each
 * item is a setup and the question after it, said aloud as the FIRST thing
 * in a session. Returns index to reason for each that fails.
 */
export async function judgeSpoken(items: { setup: string; text: string }[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (!items.length) return out;
  try {
    const res = await anthropic().messages.create({
      model: CHECK_MODEL,
      max_tokens: 2000,
      output_config: { format: { type: "json_schema", schema: JUDGE_SCHEMA } },
      system: `Each item below is what someone will say out loud in a panel: a setup, then a question. They may ask any of them in any order and skip the rest, so each must work as the first and only thing they say.

Fail an item only for one of these, and say which in a few words:
1. It depends on something not in the item itself: another question, an earlier remark, "the same survey", "as I said", "coming back to", "given that" with nothing before it, "also", "another".
2. It refers to a document, study or author the listener has not been told about: "the source", "the article", "the guidance", "the report", "the authors", "the 2030 thinking", "it says". The listener has not read anything; a finding must be stated as a fact, or introduced in words a stranger would follow ("one large survey of MSLs found").
3. It uses filler that pretends to be a reaction instead of stating the substance: telling the room something is surprising, striking, scary, worth sitting with, buried, quiet, or that it stays with the speaker. "Here's a claim worth sitting with", "There's a provocation buried in", "This surprises people".

Facts, figures and plain conversational framing are fine. Most items pass; list only the ones that fail.`,
      messages: [
        {
          role: "user",
          content: items.map((x, i) => `${i}. ${x.setup ? `${x.setup} ` : ""}${x.text}`).join("\n\n"),
        },
      ],
    });
    const parsed = JSON.parse(firstText(res) || "{}");
    for (const f of Array.isArray(parsed.failures) ? parsed.failures : []) {
      const i = Number(f?.index);
      if (Number.isInteger(i) && i >= 0 && i < items.length) out.set(i, String(f?.reason || "it does not stand alone"));
    }
  } catch {
    // The pattern check still ran; this is the second net.
  }
  return out;
}

// How the writer wants to ask: the way Ezra Klein interviews. The bank used to
// be one-breath questions with no preamble, which threw away the thing that
// makes a question land in front of an audience: the room hearing what the
// argument is before being asked where someone stands on it. The background
// was sitting on the Reading tab and none of it reached the question.
export const SETUP_RULE = `The writer asks questions the way Ezra Klein does in an interview. Before the question, a setup: two to four spoken sentences that put the substance on the table, so the person answering and the room both know exactly what is being asked about. Then the question itself, short and open.

What a good setup does, in his manner:
- Lays out the argument, the finding or the tension in plain words, specifically enough that someone new to the subject could follow it: what the long-running disagreement actually is, what the numbers say, where the gap between what people say and what they do sits.
- Often states the strongest version of one side, or both sides, before asking which way the guest leans or what each side is missing. "One view is X, and it is a serious view because Y. The other is Z." Then: "Where do you come down?" or "What does the first camp get wrong?"
- Ties it to the person answering where that is possible: their seat, their work, what someone in their role would have seen.
- Uses a concrete figure or example in place of an abstraction. "Nine in ten organisations still measure field teams by how many meetings they log" rather than "metrics remain activity-based".
- Opens with the substance itself: the finding, the argument, the number, the example. Plain and conversational, the way a well-read person talks, not a briefing read off a slide.
- Ends by handing over to the question; the question is the last thing said, and it is short.

What it never does:
- Never answers its own question, or tells the guest what they think.
- Never more than four sentences. Someone has to say it out loud without losing the room.
- Never names a consultancy, analyst house, report, survey, study or author. The same rule as the question: the finding, not the brand. "One large global survey of MSLs found" is fine; a company's name is not.
- Never points at a document the room has not been told about. The listener has read nothing: "the source says", "the article argues", "the guidance admits", "the report found", "the authors", "the deck", "the 2030 thinking" all leave them asking which one. State the finding as a plain fact about the field ("Most organizations pick their KOLs bottom-up"), or introduce where it comes from in words a stranger would follow ("a recent industry report on medical affairs argues", "one large survey of MSLs found").
- Never leans on another question. ${STANDALONE_RULE}
- Never a manufactured reaction or throat-clearing. No "quiet" or "quietly" at all, and no line about how surprising, striking, buried, scary, vivid or worth thinking about something is: not "this surprises people", "here's a claim worth sitting with", "there's a provocation buried in", "a number that should scare anyone", "this stays with me", "I keep coming back to", "most people skip past this". Those tell the room how to feel instead of telling it something. Say the thing; if it is surprising, the room will notice.
- Never a setup for its own sake. An opener, a quick follow-up, a question whose substance is already in the question, or one that lands harder bare gets setup "". Klein does not preface every question, and a bank where every question has a paragraph in front of it is one nobody can get through.`;

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
          setup: { type: "string" as const },
          text: { type: "string" as const },
          why: { type: "string" as const },
          followUp: { type: "string" as const },
        },
        required: ["index", "setup", "text", "why", "followUp"],
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
  houses: string[] = [],
): Promise<WrittenQuestion[]> {
  let out = [...questions];
  for (let round = 0; round < 2; round++) {
    const bad = out
      .map((q, index) => ({ index, q, hit: namedSource(`${q.setup} ${q.text}`, allow, houses) }))
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
Some questions come with a "setup", the spoken lead-in said before the question. It is said out loud too, so the same rule applies to it: keep its substance, take the name out ("one large global survey found"). Return it rewritten the same way, or "" if it had none.

Return "index" exactly as given, the new "setup", the new "text", a "why" of at most 15 words that may name the source, and a "followUp" probe written word for word. Plain prose, no markdown, never an em dash or en dash.`,
      messages: [
        {
          role: "user",
          content: bad
            .map(
              (r) =>
                `index ${r.index}\nbroke the rule with: ${r.hit}\nsetup: ${r.q.setup || "(none)"}\nquestion: ${r.q.text}\nwhy it was picked: ${r.q.why}\nits probe: ${r.q.followUp}`,
            )
            .join("\n\n"),
        },
      ],
    });
    if (res.stop_reason === "refusal") break;
    const parsed = JSON.parse(firstText(res) || "{}");
    const byIndex = new Map<number, { setup: string; text: string; why: string; followUp: string }>();
    for (const f of Array.isArray(parsed.fixes) ? parsed.fixes : []) {
      const i = Number(f?.index);
      const text = String(f?.text || "").trim();
      if (!Number.isInteger(i) || !text) continue;
      byIndex.set(i, {
        setup: String(f?.setup || "").trim(),
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
      const still = namedSource(`${fix.setup} ${fix.text}`, allow, houses);
      if (still) {
        console.warn(`[questions] the repair named "${still}" as well, keeping the original`);
        return q;
      }
      return {
        ...q,
        setup: fix.setup,
        text: fix.text,
        why: fix.why || q.why,
        followUp: fix.followUp || q.followUp,
      };
    });
  }
  // Last resort, and the only one that cannot fail.
  // A setup that will not come clean goes, and the question stays: the
  // question was never the problem.
  out = out.map((q) => (q.setup && namedSource(q.setup, allow, houses) && !namedSource(q.text, allow, houses) ? { ...q, setup: "" } : q));
  const dropped = out.filter((q) => namedSource(q.text, allow, houses));
  if (dropped.length)
    console.warn(
      `[questions] dropped ${dropped.length} question(s) that would not come clean: ${dropped
        .map((q) => q.text.slice(0, 60))
        .join(" | ")}`,
    );
  return out.filter((q) => !namedSource(q.text, allow, houses));
}

function firstText(res: { content: { type: string; text?: string }[] }): string {
  const block = res.content.find((b) => b.type === "text");
  return (block?.text || "").trim();
}

const VARIANTS_SCHEMA = {
  type: "object" as const,
  properties: {
    variants: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          angle: { type: "string" as const },
          text: { type: "string" as const },
          followUp: { type: "string" as const },
        },
        required: ["angle", "text", "followUp"],
        additionalProperties: false,
      },
    },
  },
  required: ["variants"],
  additionalProperties: false,
};

export interface QuestionVariant {
  /** Three or four words on what this version does differently. */
  angle: string;
  text: string;
  followUp: string;
}

/**
 * Three other ways to ask one question.
 *
 * The gap this fills: a question can be nearly right, and the only thing the
 * app could do about it was throw it away and write a different one, or hand
 * the writer a blank box and let them do it themselves. Neither is what you
 * want when you like the question and not the wording. These are versions of
 * the SAME question, so the writer picks rather than describes.
 */
export async function writeVariants({
  meeting,
  kolBlock = "",
  research = "",
  question,
  others = [],
  guidance = "",
  standing = "",
}: {
  meeting: MeetingPayload;
  kolBlock?: string;
  research?: string;
  question: { text: string; why?: string; followUp?: string; category?: string };
  /**
   * The rest of the bank. Without it "combine this with the next one" is a
   * sentence the model cannot act on, because it has never been shown the
   * next one — it was handed a single question in isolation.
   */
  others?: string[];
  /** What the writer wants different about this one, in their words. */
  guidance?: string;
  /** Their standing instruction about how every question must be written. */
  standing?: string;
}): Promise<QuestionVariant[]> {
  const res = await anthropic().messages.create({
    // Three short rewrites of a sentence the writer already likes. The heavy
    // model was spending the better part of a minute on it while they sat
    // watching a progress bar, and the work does not need it.
    model: CHECK_MODEL,
    max_tokens: 2000,
    output_config: { format: { type: "json_schema", schema: VARIANTS_SCHEMA } },
    system: `You are rewriting one question for someone who is going to ask it out loud. They like it. They do not like how it lands.

Give exactly three versions of THIS question. Not three new questions: three ways of asking the same thing, far enough apart that choosing between them is a real choice. One might be blunter, one might come at it sideways, one might put a number or a scenario in front of it. Never three rewordings of the same sentence.

The writer may keep more than one of your three, so make each one able to stand on its own in a running order next to the others, rather than three mutually exclusive takes on one slot.

${SEAT_RULE}

${SPOKEN_SOURCING_RULE}

Every version:
- is written word for word, exactly as it would be said, short enough to say in one breath.
- keeps the job the original was doing in the conversation. If the writer's instruction below changes that job, the instruction wins.
- opens something up rather than closing it down.
${guidance ? `\nWHAT THE WRITER WANTS DIFFERENT ABOUT THIS ONE. This outranks every rule above:\n${guidance}\n` : ""}${standing ? `\nTheir standing instruction about how all their questions must be written, which still applies:\n${standing}\n` : ""}
Fields:
- angle: three or four words on what this version does differently, so they can choose at a glance. "Blunter", "Puts a number on it", "Through a scenario". Not a description of the question.
- text: the question.
- followUp: the probe for when the answer is thin, written word for word.

Plain prose. No markdown, no quotation marks around the question. Never an em dash or en dash.`,
    messages: [
      {
        role: "user",
        content: `${meetingContext(meeting, kolBlock)}${
          research ? `\n\nThe research this meeting was prepared from:\n${research.slice(0, 8000)}` : ""
        }${
          others.length
            ? `\n\nThe rest of the bank, for reference only. You are rewriting ONE question, not these. They are here so that an instruction like "combine this with the one about measurement" or "make sure it does not overlap the others" is something you can act on rather than guess at:\n${others
                .map((o, i) => `${i + 1}. ${o}`)
                .join("\n")
                .slice(0, 6000)}`
            : ""
        }\n\nThe question to rework${question.category ? `, filed under "${question.category}"` : ""}:\n${question.text}${
          question.why ? `\nWhy it was picked: ${question.why}` : ""
        }${question.followUp ? `\nIts current probe: ${question.followUp}` : ""}`,
      },
    ],
  });
  if (res.stop_reason === "refusal") return [];

  const parsed = JSON.parse(firstText(res) || "{}");
  const allow = allowedNames(meeting.attendees);
  const houses = housesIn(research);
  const out: QuestionVariant[] = [];
  for (const v of Array.isArray(parsed.variants) ? parsed.variants : []) {
    const text = String(v?.text || "").trim();
    // The same guard every question goes through. An alternative that names a
    // source is not an alternative.
    if (!text || namedSource(text, allow, houses)) continue;
    out.push({
      angle: String(v?.angle || "").trim() || "Another way",
      text,
      followUp: String(v?.followUp || "").trim(),
    });
  }
  return out;
}

const FILL_SCHEMA = {
  type: "object" as const,
  properties: {
    followUp: { type: "string" as const },
    why: { type: "string" as const },
    forWhom: { type: "string" as const },
    sourceNote: { type: "string" as const },
  },
  required: ["followUp", "why", "forWhom", "sourceNote"],
  additionalProperties: false,
};

export interface FilledQuestion {
  /** The probe the writer's own question went in without. */
  followUp: string;
  why: string;
  forWhom: string;
  /** Backing from the research already gathered, or "" when there is none. */
  sourceNote: string;
}

/**
 * Finishing off a question the writer typed themselves.
 *
 * A question they write goes into the bank bare: no probe, no reason, and no
 * sign that the research already sitting on this meeting has anything to say
 * about it. Every question the model writes has all three, so their own
 * questions read as the thin ones in their own list, which is backwards.
 *
 * Two rules do the work here. The question itself is theirs and never comes
 * back changed — this call cannot return a `text`, so there is nothing to
 * overwrite it with. And a source may only come out of the notes handed in:
 * with no research there is no source, and a finding that merely shares a
 * theme with the question is not backing for it.
 */
export async function fillOutQuestion({
  meeting,
  kolBlock = "",
  research = "",
  question,
  standing = "",
}: {
  meeting: MeetingPayload;
  kolBlock?: string;
  /** The notes this meeting was prepared from: the only place a source may come from. */
  research?: string;
  question: { text: string; category?: string };
  /** Their standing instruction about how all their questions must be written. */
  standing?: string;
}): Promise<FilledQuestion> {
  const system = `You are finishing off one question that the writer typed themselves.

The question is theirs, and it is not yours to rewrite. You are not judging it, sharpening it or replacing it, and there is no field here to put a new version of it in. You are adding the things it went in without: the probe underneath it, a line on what it gets them, and the source behind it where the research actually has one.

${SEAT_RULE}

${SPOKEN_SOURCING_RULE}

Where that rule says the source goes in "why", in this call it goes in "sourceNote" instead.

Fields:
- followUp: the probe for when the first answer is thin or too comfortable, written word for word, exactly as it would be said, short enough to say in one breath. It asks for the part a comfortable answer leaves out: the example, the number, the time it did not work. Never a rephrasing of their question, never a second question about something else. Never empty.
- why: at most 15 words on what this question gets them. Not a restatement of the question.
- forWhom: who to put it to, when the context names someone it obviously belongs to. A name or a role, at most four words, because it is read at a glance beside the question. Never an instruction about how to ask it. Empty string whenever it is for everyone, which is the usual answer.
- sourceNote: one line of backing drawn from the research notes below, and from nowhere else. The finding first, in the writer's own terms, then the source and year in brackets. Under 25 words. This one is read by the writer and never said out loud, so the name belongs in it. Return an empty string unless the notes carry something that genuinely bears on THIS question: no research, nothing relevant, or a match that is only thematic all mean an empty string. Never reach into your own memory for a source, and never stretch a real one to fit, because they may cite it in the room.
${standing.trim() ? `\nTHE WRITER'S OWN INSTRUCTION ON HOW THEIR QUESTIONS ARE WRITTEN. It applies to the probe, and it outranks every rule above:\n${standing.trim()}\n` : ""}
Plain prose. No markdown, no quotation marks around the question. Never an em dash or en dash.`;

  const base = `${meetingContext(meeting, kolBlock) || "(minimal context)"}${
    research.trim()
      ? `\n\nThe research this meeting was already prepared from. This is the only place a source may come from:\n${research.slice(0, 20000)}`
      : `\n\nNo research was gathered for this meeting, so there is nothing to draw a source from. Return an empty sourceNote.`
  }\n\nThe writer's own question${
    question.category ? `, filed under "${question.category}"` : ""
  }:\n${question.text}`;

  const allow = allowedNames(meeting.attendees);
  const houses = housesIn(research);
  let out: FilledQuestion = { followUp: "", why: "", forWhom: "", sourceNote: "" };

  // Asking is not enough, so the probe is checked. It is said out loud, which
  // makes a named source in it the exact thing the writer has twice asked not
  // to be given; the offending phrase goes back quoted, once.
  for (let attempt = 0; attempt < 2; attempt++) {
    const dirty = attempt ? namedSource(out.followUp, allow, houses) : null;
    const res = await anthropic().messages.create({
      model: WRITER_MODEL,
      max_tokens: 1200,
      output_config: { format: { type: "json_schema", schema: FILL_SCHEMA } },
      system,
      messages: [
        {
          role: "user",
          content: dirty
            ? `${base}\n\nYou wrote this probe: ${out.followUp}\nIt names "${dirty}", and the probe is said out loud, so it cannot name anyone. Ask the thing underneath the finding instead, just as specific, with the name taken out. The name can stay in sourceNote, where the writer reads it rather than says it.`
            : base,
        },
      ],
    });
    if (res.stop_reason === "refusal") break;
    const parsed = JSON.parse(firstText(res) || "{}");
    out = {
      followUp: String(parsed?.followUp || "").trim(),
      why: String(parsed?.why || "").trim(),
      forWhom: String(parsed?.forWhom || "").trim(),
      // With nothing handed in to draw from, anything it names came out of
      // its own memory, which is the one place a source may not come from.
      sourceNote: research.trim() ? String(parsed?.sourceNote || "").trim() : "",
    };
    if (!namedSource(out.followUp, allow, houses)) return out;
  }

  // Asked twice and still naming someone. They get no probe rather than that
  // probe; the source still reaches them in sourceNote, where it belongs.
  if (namedSource(out.followUp, allow, houses)) {
    console.warn(`[questions] probe would not come clean, dropped it: ${out.followUp.slice(0, 60)}`);
    out = { ...out, followUp: "" };
  }
  return out;
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
  sourceText = "",
}: {
  meeting: MeetingPayload;
  kolBlock?: string;
  research?: string;
  /**
   * The whole of one document the batch is written from: a reading-list
   * source opened at its link, or material the writer uploaded. Its own
   * block, apart from the research, so a sixty-slide deck is not cut down to
   * the research budget, and so "based on this publication" has the
   * publication to work from rather than a four-line summary of it.
   */
  sourceText?: string;
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
    sourceText &&
      `THE FULL TEXT OF THE SOURCE THIS BATCH IS BUILT ON. Work from what it actually says: its specific findings, frameworks, examples, recommendations and admissions, in its own terms, not a summary of it:\n${sourceText.slice(0, 45000)}`,
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

${SETUP_RULE}

Every question:
- is written word for word, exactly as it would be said out loud. The question itself is short enough to say in one breath and to read off a card at a glance; the background it needs goes in "setup", never crammed into the question. No stage directions, no "you might ask".
- serves the session's stated subject. Not the industry around it, not the meeting's title, that subject.
- is one only someone who knows this subject could ask. A question that hands the meeting's own title back ("what does the future of X look like?") or that could be asked at any meeting in any industry ("what are your biggest challenges?") is filler. Name the specific change, number, trade-off or disagreement underneath it.
- opens something up. Never a yes/no unless the yes/no is the point and the follow-up does the work.

Fields:
- setup: the spoken lead-in before the question, per the rules above, drawn from the research, the reading list and what you know of the subject. "" where the question does not need one. Most questions on the substance and the harder ground should have one; openers and quick ones usually should not.
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
      setup: String(q?.setup || "").trim(),
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
    housesIn(research),
  );
  // A batch is written as one sequence, so its setups lean on each other
  // exactly the way a list of separate questions cannot; and filler slips in
  // however the prompt is worded. Checked by pattern and by judgement.
  const judged = await judgeSpoken(clean.map((q) => ({ setup: q.setup, text: q.text })));
  const bad = clean
    .map((q, i) => ({ q, why: spokenProblem(q.setup, q.text) || judged.get(i) || "" }))
    .filter((r) => r.why);
  if (bad.length) {
    console.warn(`[questions] ${bad.length} did not stand alone or used filler: ${bad.map((r) => r.why).join(" | ")}`);
    const redone = await writeSetups({
      meeting,
      kolBlock,
      research,
      questions: bad.map((r) => r.q),
      standing: `${guidance.trim()}\nThe setups these had were rejected: ${bad.map((r) => r.why).join("; ")}. Each new one stands completely alone and opens with the substance.`.trim(),
      force: true,
    });
    bad.forEach((r, i) => (r.q.setup = redone[i] || ""));
  }
  // A question that still only makes sense after something else is dropped:
  // the writer cannot ask it without the thing it leans on.
  return clean
    .filter((q) => !(spokenProblem(q.setup, q.text) || "").startsWith("the question starts") && !leansOnAnother(q.text))
    .sort((a, b) => a.rank - b.rank);
}

const SETUPS_SCHEMA = {
  type: "object" as const,
  properties: {
    setups: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          index: { type: "number" as const },
          setup: { type: "string" as const },
        },
        required: ["index", "setup"],
        additionalProperties: false,
      },
    },
  },
  required: ["setups"],
  additionalProperties: false,
};

/**
 * The background for questions the writer already has, without touching
 * them. Their bank was written before setups existed, and it is the bank they
 * have curated: rewriting it to get the background in would cost them the
 * wording they chose. This adds the lead-in and nothing else; there is no
 * field to put a new question in.
 *
 * Returns one setup per question, in order; "" where it needs none.
 */
export async function writeSetups({
  meeting,
  kolBlock = "",
  research = "",
  questions,
  standing = "",
  force = false,
  repairing = false,
}: {
  meeting: MeetingPayload;
  kolBlock?: string;
  research?: string;
  questions: { text: string; category?: string; why?: string }[];
  standing?: string;
  /** The writer asked for these by name: every one gets a setup. */
  force?: boolean;
  /** Already a repair: never recurse into another one. */
  repairing?: boolean;
}): Promise<string[]> {
  if (!questions.length) return [];
  const res = await anthropic().messages.create({
    model: WRITER_MODEL,
    max_tokens: 8000,
    output_config: { format: { type: "json_schema", schema: SETUPS_SCHEMA } },
    system: `You are writing the spoken lead-in for questions the writer already has. The questions are theirs and are not yours to change: there is no field here for a new question. You only write what they say before each one.

${SEAT_RULE}

${SETUP_RULE}

Write each setup so it leads straight into that exact question as worded. ${STANDALONE_RULE}

${force ? `\nThe writer has asked for a setup on every question below by name, including ones you would normally leave bare. Write one for each: the shortest setup that makes the question land, one or two sentences where that is all it needs. Never return "".\n` : ""}
When a question already has a setup being replaced, keep every figure and named finding it had ("more than a quarter", "20 percent relative to revenue"): those are why it was written. Draw the substance from the research and reading list below first; where they say nothing on a question, use what you know of the subject, but never invent a figure. A number in a setup must come from the material below.
${standing.trim() ? `\nThe writer's standing instruction on how their questions are written. It applies to the setups too and outranks every rule above:\n${standing.trim()}\n` : ""}
Return one entry per question, with "index" exactly as given. Plain prose, no markdown, no quotation marks. Never an em dash or en dash.`,
    messages: [
      {
        role: "user",
        content: `${meetingContext(meeting, kolBlock) || "(minimal context)"}${
          research.trim()
            ? `\n\nThe research and reading list this meeting was prepared from:\n${research.slice(0, 24000)}`
            : ""
        }\n\nThe questions, in the order they will be asked:\n${questions
          .map(
            (q, i) =>
              `index ${i}${q.category ? ` (${q.category})` : ""}: ${q.text}${q.why ? `\n  what it is for: ${q.why}` : ""}`,
          )
          .join("\n")}`,
      },
    ],
  });
  if (res.stop_reason === "refusal") return questions.map(() => "");
  const parsed = JSON.parse(firstText(res) || "{}");
  const allow = allowedNames(meeting.attendees);
  const houses = housesIn(research);
  const out = questions.map(() => "");
  for (const r of Array.isArray(parsed.setups) ? parsed.setups : []) {
    const i = Number(r?.index);
    const setup = String(r?.setup || "").trim();
    if (!Number.isInteger(i) || i < 0 || i >= out.length || !setup) continue;
    // Said out loud, so the same check every question passes. A setup that
    // names a source is left off rather than said.
    if (namedSource(setup, allow, houses)) {
      console.warn(`[setups] named a source, left it off: ${setup.slice(0, 60)}`);
      continue;
    }
    out[i] = setup;
  }

  // Asked not to, a setup can still open "that same survey found". Those go
  // back once, one at a time so none of them can lean on its neighbour, with
  // the phrase quoted; anything still leaning goes bare. A question with no
  // setup is fine; one that starts mid-thought is not.
  let leaning: { i: number; hit: string }[] = [];
  if (!repairing) {
    const judged = await judgeSpoken(out.map((x, i) => ({ setup: x, text: questions[i].text })));
    leaning = out
      .map((x, i) => ({ i, hit: spokenProblem(x, questions[i].text) || judged.get(i) || "" }))
      // A bare question that is fine bare stays bare.
      .filter((r) => r.hit && (out[r.i] || /mid-thought/.test(r.hit)));
  }
  if (leaning.length) {
    console.warn(`[setups] ${leaning.length} did not stand alone or used filler, rewriting: ${leaning.map((r) => r.hit).join(" | ")}`);
    const fixed = await Promise.all(
      leaning.map((r) =>
        writeSetups({
          meeting,
          kolBlock,
          research,
          questions: [questions[r.i]],
          standing: `${standing}\nA previous setup for this question said "${r.hit}", which only works if another question was asked first. This one is said on its own: state the finding in full.`.trim(),
          force: true,
          repairing: true,
        }).then((x) => x[0] || ""),
      ),
    );
    leaning.forEach((r, k) => {
      out[r.i] = fixed[k] && !leansOnAnother(fixed[k]) ? fixed[k] : "";
    });
  }
  return out;
}

const SIMILAR_SCHEMA = {
  type: "object" as const,
  properties: {
    matches: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          draft: { type: "number" as const },
          existing: { type: "number" as const },
        },
        required: ["draft", "existing"],
        additionalProperties: false,
      },
    },
  },
  required: ["matches"],
  additionalProperties: false,
};

/**
 * Which question the writer already has that each new one is really asking.
 *
 * Wording overlap is not the test: "how do you put a number on a trusted
 * relationship" and "how do you measure a KOL relationship without cheapening
 * it" share three words and are the same question. So it is judged, once per
 * batch, on a model that is quick and strict. Returns, per draft, the index
 * into `existing` it duplicates, or -1.
 */
export async function findSimilar({
  drafts,
  existing,
  within = false,
}: {
  drafts: string[];
  existing: string[];
  /** Both lists are one batch: match only to an earlier question, never itself. */
  within?: boolean;
}): Promise<number[]> {
  const out = drafts.map(() => -1);
  if (!drafts.length || !existing.length) return out;
  const res = await anthropic().messages.create({
    model: CHECK_MODEL,
    max_tokens: 1500,
    output_config: { format: { type: "json_schema", schema: SIMILAR_SCHEMA } },
    system: `You compare new interview questions against the ones the writer already has, so they never end up asking the same thing twice.

For each new question, find the existing question that asks essentially the same thing: the same ask of the person answering, so that asking both in one session would feel repetitive, even if the wording, the angle or the setup differs. Sharing a topic is not enough. "How do you measure value?" and "What would you put on one slide to prove your worth to the board?" are different questions about the same topic; "How do you put a number on a trusted relationship?" and "How do you measure a KOL relationship without cheapening it?" are the same question.

Return a match only when you are confident. Most new questions have none; leave those out. At most one existing match per new question: the closest.${
      within
        ? " The two lists are the SAME batch. A new question may only match an existing question with a SMALLER number than its own, never itself: you are finding the later question of each pair that repeats an earlier one."
        : ""
    }`,
    messages: [
      {
        role: "user",
        content: `New questions:\n${drafts.map((d, i) => `${i}. ${d}`).join("\n")}\n\nQuestions the writer already has:\n${existing
          .map((e, i) => `${i}. ${e}`)
          .join("\n")
          .slice(0, 16000)}`,
      },
    ],
  });
  if (res.stop_reason === "refusal") return out;
  const parsed = JSON.parse(firstText(res) || "{}");
  for (const x of Array.isArray(parsed.matches) ? parsed.matches : []) {
    const d = Number(x?.draft);
    const e = Number(x?.existing);
    if (Number.isInteger(d) && d >= 0 && d < out.length && Number.isInteger(e) && e >= 0 && e < existing.length)
      if (!within || e < d) out[d] = e;
  }
  return out;
}
