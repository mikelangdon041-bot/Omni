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
import { stripAskedQuestion } from "./types";
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
  /\b(?:the|this|that) (?:source|article|piece|deck|slides?|guidance|guidance document|document|authors?|write-?up|standards (?:work|document|guidance)|20\d\d (?:thinking|vision|piece|report))\b|\b(?:the source|the article|the authors?) (?:says?|argues?|is|was|found|makes)\b|\b(?:this|the) material\b|\b(?:one|a|another) contributor\b|\bthe (?:whole|same|full|entire) (?:report|article|piece|paper|study)\b|\bin this (?:work|material|piece|research)\b|\b(?:people|folks|everyone|leaders|those|experts|executives|teams?) (?:we )?interviewed\b|\b(?:one|some|several|many|most) of the (?:people|folks|leaders|teams|experts|executives|interviewees|contributors) (?:here|interviewed|in it)\b|\binterviewees?\b/i;
const MAYBE_UNNAMED = /\b(?:the|this|that) (report|study|survey|paper|framework|analysis|research|white ?paper|playbook|review)\b/i;
const INTRODUCES = /\b(?:a|an|one|another|some|recent|new|large|global|\d{4})\b[^.?!]{0,40}\b(?:report|study|survey|paper|framework|analysis|research|white ?paper|playbook|review)s?\b/i;

/** The phrase pointing at a document nobody was told about, or null. */
export function unnamedSource(line: string): string | null {
  const t = String(line || "");
  // "That guidance" is fine once the same line has already said what the
  // guidance is ("most AI guidance in pharma covers..."). "The source" never is.
  for (const hard of t.matchAll(new RegExp(ALWAYS_UNNAMED.source, "gi"))) {
    const noun = hard[0].split(/\s+/).pop()!.toLowerCase();
    const before = t.slice(0, hard.index).toLowerCase();
    if (noun === "source" || noun === "article" || !before.includes(noun)) return hard[0];
  }
  const soft = t.match(MAYBE_UNNAMED);
  if (soft && soft.index !== undefined && !INTRODUCES.test(t.slice(0, soft.index))) return soft[0];
  return null;
}

/**
 * One source's view said as if it were settled. The writer, on "there's a
 * well-known trust equation" and "when you pin down relationship quality,
 * you land on four things": do you, or is that one person's opinion? The
 * model judge passed the first, so it is caught by pattern too.
 */
const OVERCLAIM =
  /\b(?:well[- ]known|everyone (?:agrees|knows|says)|everybody (?:agrees|knows)|(?:nearly|almost) (?:all|everyone|everybody)|you land on|the field keeps|it'?s widely (?:accepted|agreed|known)|universally|most (?:organi[sz]ations|companies|teams|leaders) (?:pick|build|use|say|agree|still))\b/i;

export function spokenProblem(setup: string, text: string): string | null {
  // The setup is the run-up; a setup that asks its own question has the
  // question said twice. One rewrite ended by repeating it word for word.
  if (/\?\s*$/.test(setup.trim()) || (text.length > 20 && setup.includes(text.slice(0, Math.min(50, text.length)))))
    return "the setup asks the question itself, so it would be said twice";
  // "The guidance" in the question is fine once the setup has said what the
  // guidance is. Checked only against the question, a setup could never fix
  // it, so "Add a setup" failed on every try for two such questions.
  const inText = unnamedSource(text);
  const noun = (inText || "").split(/\s+/).pop()?.toLowerCase() || "";
  // With a setup in front, only a pointer at a document itself ("the
  // article", "the report") must be named there word for word; "the
  // guidance" after a setup about the rules for AI reads fine, and the
  // model judge still reads the pair as a whole.
  const documentLike = /^(?:source|article|piece|authors?|report|study|survey|paper|document|write-?up|deck|material)$/.test(noun);
  const introduced = Boolean(inText && setup.trim() && noun && (setup.toLowerCase().includes(noun) || !documentLike));
  const unnamed = unnamedSource(setup);
  if (unnamed) return `it refers to a document the room has never been told about ("${unnamed}")`;
  if (inText && !introduced)
    return `the question says "${inText}" and the setup never says what that is; the setup must say plainly what it is, using the word "${noun}"`;
  const lean = leansOnAnother(setup) || leansOnAnother(text);
  if (lean) return `it depends on something said before it ("${lean}")`;
  if (!setup.trim() && MID_THOUGHT.test(text)) return "the question starts mid-thought with nothing before it";
  const fake = setup.match(FAKE_HOOK);
  if (fake) return `it opens with filler instead of substance ("${fake[0]}")`;
  const over = setup.match(OVERCLAIM);
  if (over) return `it says one view as if everyone holds it ("${over[0]}"); say whose view it is, or that it is one view`;
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
const FIT_SCHEMA = {
  type: "object" as const,
  properties: {
    scores: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          index: { type: "number" as const },
          score: { type: "number" as const },
          problem: { type: "string" as const },
        },
        required: ["index", "score", "problem"],
        additionalProperties: false,
      },
    },
  },
  required: ["scores"],
  additionalProperties: false,
};

/**
 * How well each question earns its setup, scored. The writer said the setups
 * were thoughtful and the questions under them fell flat. Asked only to list
 * failures across a whole bank, the judge passed all 56; so every question
 * is scored, eight at a time, against what a sharp moderator would ask next.
 * Returns index to the problem for each that scores under 4. Only judged
 * where there is a setup to follow.
 */
/**
 * What the question after a setup is for. The writer: "how often does this
 * happen", "is there real data behind it", "was it data or an MSL vouching"
 * do not start a conversation. A panel question is an invitation to a long
 * answer, a story or an argument, never a choice between two answers.
 */
export const OPEN_QUESTION_RULE = `The question after a setup starts a conversation: an invitation to a long answer, where a panelist could talk for two minutes and still not be done.

The setup explains something general: an idea, a finding, a problem. The panelists are experienced people in the field, but you know nothing about what they personally have done. So the question never assumes they have used the method, tool, metric or framework the setup describes, and never assumes they have a story of it working or failing. "Tell us about a time one of these ratios caught a relationship going sideways" is absurd: nobody knows if they ever used that ratio. Every panelist must be able to answer it well.

What works, best first (the writer ranked these):
1. How the problem the setup describes actually works, or shows up, in their own organisation, in plain words: "When someone in your organization says a KOL relationship is strong, what are they actually looking at?"
2. The same, ending on what they do about it: "...and how do you make sure that doesn't happen?" or "...and how do you fix it?"
3. A short push back that follows from the setup, one people will argue with: "If every relationship metric ends up being activity in disguise, should we stop trying to measure relationships at all?"
4. What it would take, or what would have to change. Fine, but weaker, and a question so hard that nobody can answer it gets silence.

Never:
- "make the case", or anything that asks them to pick a side ("A, or B?", "data or gut?", "where do you come down?"): forcing people to take a side is strange on a panel;
- a frequency, count, share or estimate ("how often", "how many", "what share"), a fact check ("is there real data behind that"), or "when was the last time";
- "be honest", or anything that implies they otherwise would not be;
- the same opening for every question.

When the context names the people in the room, ask each of them about their own work as their role and the notes describe it. Never say "your team", "your field team" or "your MSLs" to someone who does not lead one; a field MSL is asked about what they do themselves ("when you..."). Trust the notes over a title: "director" in a field or account role is often a senior individual, not a manager. A question meant for everyone has to work from every one of their seats.`;

/** Openings handed out in turn when many questions are rewritten at once. */
const OPENERS = [
  "When someone in your organization...",
  "How does that actually work where you sit...",
  "What does that look like in your organization...",
  "Where does that show up for you...",
  "How do you make sure that doesn't happen...",
  "What gets in the way of...",
  "What would have to change for...",
];

/**
 * A closed question by its shape: either/or, frequency or count, or opened
 * with a verb that wants yes or no. The model judges let these through
 * ("Be honest, what share...", "is there real data behind that or did it
 * come down to an MSL saying trust me"), so they are caught by pattern too.
 */
export function closedQuestion(text: string): string {
  if (/\b(tell us|tell me|walk us through)\b[^?]*\b(a time|the time|when)\b[^?]*\b(this|these|that|those|one of these|such an?)\s+(ratio|metric|tool|dashboard|framework|model|approach|method|score|index|kind of)/i.test(text))
    return "it assumes they have used what the setup describes";
  const t = text.trim().replace(/^(so|and|but|okay|now|honestly)[,\s]+/i, "");
  // the last clause is the question actually asked
  const asked = (t.split(/[,;:.]\s+/).filter((x) => x.includes("?")).pop() || t).trim();
  if (/\b(how often|how many|how much of|what share|what percentage|what proportion|what fraction|how frequently|when was the last time)\b/i.test(asked))
    return "it asks for a number or a frequency, which gets a short answer";
  if (/\bbe honest\b/i.test(t)) return "\"be honest\" implies they otherwise would not be";
  if (/,?\s+or\s+(is|was|did|do|does|are|were|has|have|would|could|can|just|simply|a|an|the|more|less|it|they|you|someone)\b[^?]*\?\s*$/i.test(t) || /\bversus\b|\bvs\.?\s/i.test(asked))
    return "it offers a choice between two answers, so they pick one and stop";
  if (/^(is|are|was|were|do|does|did|have|has|had|would|will|could|can|should|shall)\s/i.test(asked))
    return "it can be answered yes or no";
  return "";
}

export async function judgeFit(items: { setup: string; text: string }[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const idx = items.map((x, i) => (x.setup.trim() ? i : -1)).filter((i) => i >= 0);
  const chunks: number[][] = [];
  for (let k = 0; k < idx.length; k += 8) chunks.push(idx.slice(k, k + 8));
  await Promise.all(
    chunks.map(async (chunk) => {
      try {
        const res = await anthropic().messages.create({
          model: CHECK_MODEL,
          max_tokens: 8000,
          output_config: { format: { type: "json_schema", schema: FIT_SCHEMA } },
          system: `Each item is a setup a panel moderator says, then the question they ask after it. The setups are good. Score only the QUESTION, 1 to 5, on whether it makes the most of its setup.

5: the question a sharp moderator would ask the moment that setup ends, and one that starts a conversation: the panelist could talk for two minutes, telling a story or making an argument. It goes straight at the specific tension or finding the setup laid out and asks how it plays out in their world, where they land on it and why, or what it would take. Any experienced panelist can answer it well, whether or not they have done what the setup describes.
4: on the setup's point and draws on experience, but could be sharper or more specific to what the setup set up.
3: related to the setup but generic: it could follow almost any setup on the subject, or it restates the setup as a question, or asks for an opinion anyone could give.
2: presumes, closed or flat: it assumes they have used the method, tool or metric the setup describes, or have a story of it working or failing ("tell us about a time one of these ratios caught..."); or a choice between two answers ("data, or an MSL vouching?"), a frequency, count or share ("how often", "what share"), a yes/no or fact check ("is there real data behind that"), a "when was the last time", or a detail of their process that teaches the room nothing. These get a short answer and end the conversation.
1: about something other than what the setup laid out.

Be demanding: a question that merely relates to its setup is a 3. For anything under 5, say in one line what it misses. Score every item.`,
          messages: [
            {
              role: "user",
              content: chunk.map((i, k) => `${k}. SETUP: ${items[i].setup}\nQUESTION: ${items[i].text}`).join("\n\n"),
            },
          ],
        });
        const parsed = JSON.parse(firstText(res) || "{}");
        for (const f of Array.isArray(parsed.scores) ? parsed.scores : []) {
          const k = Number(f?.index);
          const score = Number(f?.score);
          if (Number.isInteger(k) && k >= 0 && k < chunk.length && score < 4)
            out.set(chunk[k], String(f?.problem || "it does not make the most of its setup"));
        }
      } catch {
        // That chunk goes unjudged; the rest still count.
      }
    }),
  );
  // Words from the source nobody in the room would follow.
  for (const [i, why] of await outsideTerms(idx.map((i) => items[i])).then((m) => [...m].map(([k, w]) => [idx[k], w] as const)))
    if (!out.has(i)) out.set(i, `${why}; say it in the field's own words`);
  // Closed by its shape, whatever the score.
  for (const i of idx) {
    const why = closedQuestion(items[i].text);
    if (why && !out.has(i)) out.set(i, `${why}; ask for the story or the argument instead`);
  }
  return out;
}

/**
 * Questions that only make sense to someone who read the source. The setup
 * check caught "send mode" and the walkie-talkie in setups, but the
 * questions under them kept "the push-to-talk button" after the setup had
 * been rewritten without it, and the writer: "makes no sense". Judged
 * against its own setup: a term the setup explains is fine.
 */
export async function outsideTerms(items: { setup: string; text: string }[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const chunks: number[][] = [];
  for (let k = 0; k < items.length; k += 12) chunks.push(items.slice(k, k + 12).map((_, j) => k + j));
  await Promise.all(
    chunks.map(async (chunk) => {
      try {
        const res = await anthropic().messages.create({
          model: CHECK_MODEL,
          max_tokens: 8000,
          output_config: { format: { type: "json_schema", schema: JUDGE_SCHEMA } },
          system: `Each item is a setup a panel moderator says out loud, then a question asked after it. Nobody in the room has read anything.

Fail the QUESTION, saying which words in a few words, when it uses a term, image, metaphor, label, framework name or figure that its setup did not introduce and that people working in the field would not say themselves, so it only makes sense to someone who read a particular document: "the push-to-talk button", "send mode", "a seek and avoidance ratio", "digital exhaust", "the trust equation". Also fail it when it points at a document, a study, a report or the people interviewed for one.

Ordinary vocabulary of the field (KOL, MSL, KPI, HCP, field team, scorecard, medical affairs, insights) is fine, and so is anything the setup itself explains. Most pass; list only the ones that fail.`,
          messages: [
            {
              role: "user",
              content: chunk.map((i, k) => `${k}. SETUP: ${items[i].setup || "(none)"}\nQUESTION: ${items[i].text}`).join("\n\n"),
            },
          ],
        });
        const parsed = JSON.parse(firstText(res) || "{}");
        for (const f of Array.isArray(parsed.failures) ? parsed.failures : []) {
          const k = Number(f?.index);
          if (Number.isInteger(k) && k >= 0 && k < chunk.length)
            out.set(chunk[k], `it uses words only a reader of the source would follow: ${String(f?.reason || "")}`);
        }
      } catch {
        // Unchecked, the rest still stand.
      }
    }),
  );
  return out;
}

const REPEATS_SCHEMA = {
  type: "object" as const,
  properties: {
    items: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: { index: { type: "number" as const }, repeats: { type: "boolean" as const }, what: { type: "string" as const } },
        required: ["index", "repeats", "what"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
};

/**
 * Setups that make the question's own point again. The writer's own
 * questions often carry a lead-in ("This session is about communicating
 * value, so let's first define it"), and the setup written for them said the
 * same thing first ("I want to pin down what we're talking about"). The
 * general judge, asked only for failures, passed all of them; this one has
 * to answer for every item.
 */
export async function setupRepeats(items: { setup: string; text: string }[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  // Only a setup that announces the moderator's own intent can repeat one
  // the question announces too. Asked of every setup, the model called any
  // setup that introduces the question's topic a repeat, which is what a
  // setup is for.
  const META = /\b(?:I want to|I'm after|I am after|I'd like to|let's|let us|before we (?:get|go|dig|start)|to start|I want us)\b/i;
  const idx = items.map((x, i) => (x.setup.trim() && META.test(x.setup) ? i : -1)).filter((i) => i >= 0);
  const chunks: number[][] = [];
  for (let k = 0; k < idx.length; k += 12) chunks.push(idx.slice(k, k + 12));
  await Promise.all(
    chunks.map(async (chunk) => {
      try {
        const res = await anthropic().messages.create({
          model: CHECK_MODEL,
          max_tokens: 8000,
          output_config: { format: { type: "json_schema", schema: REPEATS_SCHEMA } },
          system: `Each item is a setup a moderator says out loud, then the question that follows it. For every item, answer: does the moderator announce the same intention twice, once in the setup and again in the question? Yes: "I want to get past the mission-statement language" then "not the mission-statement version, the one you'd defend"; "before we get into it, I want to pin down what we mean" then "so let's first define what value is". No: a setup that lays out facts, a finding or a tension that the question then asks about; that is what a setup is for, even when they share a topic. what: the repeated intention in a few words, or "".`,
          messages: [{ role: "user", content: chunk.map((i, k) => `${k}. SETUP: ${items[i].setup}\nQUESTION: ${items[i].text}`).join("\n\n") }],
        });
        const parsed = JSON.parse(firstText(res) || "{}");
        for (const x of Array.isArray(parsed.items) ? parsed.items : []) {
          const k = Number(x?.index);
          if (x?.repeats && Number.isInteger(k) && k >= 0 && k < chunk.length)
            out.set(chunk[k], `the setup says what the question already says (${String(x.what || "the same point")}); give the setup substance the question does not have, and drop the repeated framing`);
        }
      } catch (e) {
        console.warn("[repeats] check failed", (e as Error).message);
        // Unchecked; the rest still stand.
      }
    }),
  );
  return out;
}

const ANSWERS_SCHEMA = {
  type: "object" as const,
  properties: {
    items: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: { index: { type: "number" as const }, answers: { type: "boolean" as const }, what: { type: "string" as const } },
        required: ["index", "answers", "what"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
};

/**
 * Setups that answer the question they lead into. "A meaningful outcome is
 * the change in how a physician treats or how a patient does", then "define
 * a meaningful outcome": the writer said the question was no longer open.
 * Laying out the competing answers is fine; settling on one is not.
 */
export async function setupAnswers(items: { setup: string; text: string }[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const idx = items.map((x, i) => (x.setup.trim() ? i : -1)).filter((i) => i >= 0);
  const chunks: number[][] = [];
  for (let k = 0; k < idx.length; k += 12) chunks.push(idx.slice(k, k + 12));
  await Promise.all(
    chunks.map(async (chunk) => {
      try {
        const res = await anthropic().messages.create({
          model: CHECK_MODEL,
          max_tokens: 8000,
          output_config: { format: { type: "json_schema", schema: ANSWERS_SCHEMA } },
          system: `Each item is a setup a moderator says out loud, then the question that follows it. For every item, answer: does the setup already give THE answer to the question, so the question is no longer open? Yes: a setup that defines the very term the question asks the panel to define, or states as settled the conclusion the question asks them to reach. No: a setup that lays out several competing answers, a finding, a tension or the stakes; that is what a setup is for. what: the answer the setup gives away, in a few words, or "".`,
          messages: [{ role: "user", content: chunk.map((i, k) => `${k}. SETUP: ${items[i].setup}\nQUESTION: ${items[i].text}`).join("\n\n") }],
        });
        const parsed = JSON.parse(firstText(res) || "{}");
        for (const x of Array.isArray(parsed.items) ? parsed.items : []) {
          const k = Number(x?.index);
          if (x?.answers && Number.isInteger(k) && k >= 0 && k < chunk.length)
            out.set(chunk[k], `the setup answers the question before it is asked (${String(x.what || "it settles the answer")}); lay out the competing views or the stakes instead, and leave the answer to the panel`);
        }
      } catch (e) {
        console.warn("[answers] check failed", (e as Error).message);
      }
    }),
  );
  return out;
}

const TRIM_SCHEMA = {
  type: "object" as const,
  properties: {
    items: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: { index: { type: "number" as const }, repeats: { type: "boolean" as const }, question: { type: "string" as const } },
        required: ["index", "repeats", "question"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
};

/**
 * Questions that say their setup again. The setup gives the figure ("two
 * thirds say they can't measure MSL performance") and the question opens by
 * giving it again ("Two thirds of you say you can't accurately measure MSL
 * performance. So how..."). Returns, for each one that does, the question
 * with the repeat taken out and the rest of its words kept.
 */
export async function trimRepeatedSetup(items: { setup: string; text: string }[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const idx = items.map((x, i) => (x.setup.trim() ? i : -1)).filter((i) => i >= 0);
  const chunks: number[][] = [];
  for (let k = 0; k < idx.length; k += 10) chunks.push(idx.slice(k, k + 10));
  const wordsOf = (t: string) => t.toLowerCase().match(/[a-z0-9']+/g) || [];
  await Promise.all(
    chunks.map(async (chunk) => {
      try {
        const res = await anthropic().messages.create({
          model: CHECK_MODEL,
          max_tokens: 8000,
          output_config: { format: { type: "json_schema", schema: TRIM_SCHEMA } },
          system: `Each item is a setup a moderator says out loud, then the question they ask straight after it. The room has just heard the setup. For every item answer: does the question state again, as fact, the finding, figure or claim the setup just gave, before it asks? That is a statement such as "Two thirds of you say you can't measure MSL performance.", "The best-in-class numbers actually dropped this year.", "MAPS is pushing everyone to drop the word metrics.", "Half the field says value is a relationship, the other half says it's changing practice." sitting in front of the actual question.
Not a repeat, and left alone: a "When..." or "If..." clause that puts the question in the panelist's own work ("When the scorecard is built on volume, how does that shape..."), a question that only shares the topic, and one that points back briefly ("that gap").
If it repeats: question is the question without the restated statement, changed as little as possible. It must make complete sense read on its own, with no "that", "those", "it" or "they" pointing at something only the removed part named: where it would, name the thing in a few words ("What's stopping you?" becomes "What's stopping you from using qualitative measures?"). End with a question mark.
If not: question is "".`,
          messages: [{ role: "user", content: chunk.map((i, k) => `${k}. SETUP: ${items[i].setup}\nQUESTION: ${items[i].text}`).join("\n\n") }],
        });
        const parsed = JSON.parse(firstText(res) || "{}");
        for (const x of Array.isArray(parsed.items) ? parsed.items : []) {
          const k = Number(x?.index);
          if (!x?.repeats || !Number.isInteger(k) || k < 0 || k >= chunk.length) continue;
          const was = items[chunk[k]].text;
          const t = String(x.question || "")
            .trim()
            .replace(/^(?:so|and|but)[,\s]+/i, "")
            .replace(/^./, (c) => c.toUpperCase());
          // A cut, not a rewrite: clearly shorter, a question, and mostly its old words.
          const old = new Set(wordsOf(was));
          const w = wordsOf(t);
          if (t.length < 15 || t.length > was.length * 0.85 || !t.endsWith("?")) continue;
          if (w.filter((x) => old.has(x)).length < w.length * 0.7) continue;
          out.set(chunk[k], t);
        }
      } catch (e) {
        console.warn("[trim] check failed", (e as Error).message);
      }
    }),
  );
  return out;
}

export async function judgeSpoken(items: { setup: string; text: string }[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (!items.length) return out;
  try {
    const res = await anthropic().messages.create({
      model: CHECK_MODEL,
      max_tokens: 8000,
      output_config: { format: { type: "json_schema", schema: JUDGE_SCHEMA } },
      system: `Each item below is what someone will say out loud in a panel: a setup, then a question. They may ask any of them in any order and skip the rest, so each must work as the first and only thing they say.

Fail an item only for one of these, and say which in a few words:
1. It depends on something not in the item itself: another question, an earlier remark, "the same survey", "as I said", "coming back to", "given that" with nothing before it, "also", "another".
2. It refers to a document, study or author the listener has not been told about: "the source", "the article", "the guidance", "the report", "the authors", "the 2030 thinking", "it says". The listener has not read anything; a finding must be stated as a fact, or introduced in words a stranger would follow ("one large survey of MSLs found").
3. It uses filler that pretends to be a reaction instead of stating the substance: telling the room something is surprising, striking, scary, worth sitting with, buried, quiet, or that it stays with the speaker. "Here's a claim worth sitting with", "There's a provocation buried in", "This surprises people".
5. It states one source's framework, one person's opinion or one company's model as if it were settled or universal: "when you pin down relationship quality, you land on four things", "there's a well-known trust equation", "everyone agrees", "the field keeps running into". It should say it is one view ("one framework splits it into four", "one leader put it this way").
4. It leans on a term, image or label a document coined instead of the words people in the field actually use, so a practitioner would not recognise it or would have to guess: "send mode", "a walkie-talkie", "a seek and avoidance ratio", "digital exhaust", "relationship health". Or it is too vague to picture: "measured on how much they pushed out" instead of "measured on how many meetings they log, not on what they bring back".

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
- Where there is a real disagreement, can state the strongest version of each side, but never then asks the guest to pick one.
- Says it in the words people in the field actually use. A term or image the source coined ("relationship health", "send mode", a walkie-talkie, a seek-versus-avoid ratio) is translated into what practitioners would say: "whether a KOL relationship is strong", "MSLs have the meetings but the insights never come back". A listener should never have to guess what a phrase means, and "how much they pushed out" is too vague to land.
- Uses the strongest, most recognisable example the source gives, not the first one or the most technical.
- Is honest about how settled a thing is. One source's framework, one person's view or one company's model is introduced as that ("one way people break it down is...", "one framework splits it into four...", "one medical affairs leader put it this way..."), never as the way things are ("when you pin down relationship quality, you land on four things", "there's a well-known equation"). Only what is broadly agreed, or a figure from a named kind of study, is stated flat. No "everyone agrees", "the field keeps running into", "well-known" unless it truly is.
- Ties it to the person answering where that is possible: their seat, their work, what someone in their role would have seen.
- Uses a concrete figure or example in place of an abstraction. "Nine in ten organisations still measure field teams by how many meetings they log" rather than "metrics remain activity-based".
- Opens with the substance itself: the finding, the argument, the number, the example. Plain and conversational, the way a well-read person talks, not a briefing read off a slide.
- Ends by handing over to the question; the question is the last thing said, and it is short.
- Never says what the question already says. Some questions carry their own lead-in ("This session is about communicating value, so let's first define it", "Not the mission-statement version, the one you'd actually defend"); the setup then adds substance the question does not have, a fact, a tension, the different ways people see it, and never makes the question's point again in other words.

The question after a setup:
- asks about the specific problem, tension or finding the setup just laid out, so it is the obvious next thing to ask the moment the setup ends. A question about a neighbouring point wastes the setup.
- asks the people answering what they know from their own seat: how the problem plays out where they sit, where they land on it and why, what it would take to fix. It never assumes they have done what the setup describes.
- never asks "when was the last time", never a yes/no, never a detail of their process that teaches the room nothing.

${OPEN_QUESTION_RULE}

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
      max_tokens: 8000,
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
          setup: { type: "string" as const },
          forWhom: { type: "string" as const },
          changed: { type: "string" as const, enum: ["setup", "question", "both"] },
        },
        required: ["angle", "text", "followUp", "setup", "forWhom", "changed"],
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
  /** A new setup when this version is better with one; "" keeps the current one. */
  setup?: string;
  /** The panelists it works for, by first name. */
  forWhom?: string;
  /** Which part this version changed. */
  changed?: "setup" | "question" | "both";
}

export type ReworkPart = "auto" | "setup" | "question" | "both";

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
  count = 3,
  avoid = [],
  part = "auto",
  keep = [],
  drop = [],
}: {
  meeting: MeetingPayload;
  kolBlock?: string;
  research?: string;
  question: { text: string; why?: string; followUp?: string; category?: string; setup?: string };
  /** Which part to change. "auto" works it out from what the writer said. */
  part?: ReworkPart;
  /** Words the writer marked to keep, exactly as they are. */
  keep?: string[];
  /** Words the writer marked to lose. */
  drop?: string[];
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
  /** How many to write; the writer can ask for more than three. */
  count?: number;
  /** Versions already on screen, so "more" brings new ones. */
  avoid?: string[];
}): Promise<QuestionVariant[]> {
  const res = await anthropic().messages.create({
    // Three short rewrites of a sentence the writer already likes. The heavy
    // model was spending the better part of a minute on it while they sat
    // watching a progress bar, and the work does not need it.
    model: CHECK_MODEL,
    max_tokens: 16000,
    output_config: { format: { type: "json_schema", schema: VARIANTS_SCHEMA } },
    system: `You are rewriting one question for someone who is going to ask it out loud. They like it. They do not like how it lands.

Give exactly ${count} versions of THIS question, unless what the writer wants below asks for new questions rather than versions, in which case give ${count} of those. Not new questions by default: ways of asking the same thing, far enough apart that choosing between them is a real choice. One might be blunter, one might come at it sideways, one might put a number or a scenario in front of it. Never three rewordings of the same sentence.

The writer may keep more than one of them, so make each one able to stand on its own in a running order next to the others, rather than three mutually exclusive takes on one slot.

${SEAT_RULE}

${SPOKEN_SOURCING_RULE}

Every version:
- is written word for word, exactly as it would be said, short enough to say in one breath.
- keeps the job the original was doing in the conversation. If the writer's instruction below changes that job, the instruction wins.
- opens something up rather than closing it down.

${OPEN_QUESTION_RULE}
${guidance ? `\nWHAT THE WRITER WANTS DIFFERENT ABOUT THIS ONE. This outranks every rule above:\n${guidance}\n` : ""}${standing ? `\nTheir standing instruction about how all their questions must be written, which still applies:\n${standing}\n` : ""}
WHAT TO CHANGE. ${
      part === "setup"
        ? "The writer wants a different SETUP. Keep the question word for word as it is. Only if a new setup genuinely stops leading into the question may you touch the question, and then change as few words as possible and set changed to \"both\"."
        : part === "question"
          ? "The writer wants a different QUESTION under the same setup. setup is \"\" in every version, so the current setup stays."
          : part === "both"
            ? "The writer wants both the setup and the question reworked."
            : "Work out from what the writer says which part they are unhappy with. When it is the setup, write new setups and keep the question word for word; when it is the question, keep the setup (setup \"\"). Change both only when they ask for both, or when the new part truly cannot work with the old one, and then change the other part as little as possible. Never rewrite a part they did not complain about just to make the version look different. With no instruction at all, vary the question and keep the setup."
    }${keep.length ? `\nKeep these words exactly as they are, in every version, wherever they appear: ${keep.map((k) => `"${k}"`).join("; ")}.` : ""}${drop.length ? `\nLeave these words out of every version: ${drop.map((k) => `"${k}"`).join("; ")}.` : ""}

Fields:
- angle: three or four words on what this version does differently, so they can choose at a glance. "Blunter", "Puts a number on it", "Through a scenario". Not a description of the question.
- text: the question.
- followUp: the probe for when the answer is thin, written word for word.
- setup: the question is said after a setup (given below when there is one). When this version needs a different lead-in, or what the writer wants different is about the setup, write the new setup in full, two to four spoken sentences that lay out the substance, never pointing at a document the room has not heard of, never saying what the question says. Otherwise "", and the current setup stays.
- forWhom: When the context names the people in the room, forWhom is the first names of those who can answer THIS version from their own direct work, strictly: a question about managing MSLs fits nobody who does not manage MSLs, a question about KOL meetings does not fit people who never meet KOLs, a question about hiring fits only people who hire. "Everyone" only when all of them truly can. "" when it fits none of them, or when no names are given.
- changed: "setup" when only the setup is new (text is the question unchanged), "question" when only the question is new (setup ""), "both" when both are.

Plain prose. No markdown, no quotation marks around the question. Never an em dash or en dash.`,
    messages: [
      {
        role: "user",
        content: `${meetingContext(meeting, kolBlock)}${
          research ? `\n\nThe research this meeting was prepared from:\n${research.slice(0, 8000)}` : ""
        }${
          others.length
            ? `\n\nThe writer's other questions, for reference only, numbered exactly as the writer sees them: "question four" means the line marked 4 in their list. You are rewriting ONE question, not these. They are here so an instruction like "combine this with question four" or "make sure it does not overlap the others" is something you can act on rather than guess at:\n${others
                .join("\n")
                .slice(0, 8000)}`
            : ""
        }${
          avoid.length ? `\n\nVersions the writer has already seen; write new ones, not these again:\n${avoid.map((a) => `- ${a}`).join("\n")}` : ""
        }${question.setup ? `\n\nThe setup said before it now:\n${question.setup}` : ""}\n\nThe question to rework${question.category ? `, filed under "${question.category}"` : ""}:\n${question.text}${
          question.why ? `\nWhy it was picked: ${question.why}` : ""
        }${question.followUp ? `\nIts current probe: ${question.followUp}` : ""}`,
      },
    ],
  });
  if (res.stop_reason === "refusal") return [];
  if (res.stop_reason === "max_tokens") console.warn("[variants] ran out of room before answering");

  const parsed = JSON.parse(firstText(res) || "{}");
  const allow = allowedNames(meeting.attendees);
  const houses = housesIn(research);
  const out: QuestionVariant[] = [];
  for (const v of Array.isArray(parsed.variants) ? parsed.variants : []) {
    // "Quietly" is a word the writer has banned from anything said aloud.
    const text = String(v?.text || "").replace(/\s*\bquietly\b/gi, "").trim();
    // The same guard every question goes through. An alternative that names a
    // source is not an alternative.
    // A version that closes the question down is not offered either.
    if (!text || namedSource(text, allow, houses) || closedQuestion(text)) continue;
    let setup = String(v?.setup || "").trim();
    let changed = (["setup", "question", "both"].includes(v?.changed) ? v.changed : setup ? "both" : "question") as QuestionVariant["changed"];
    let said = text;
    // The part they did not ask to change stays as it was. Asked for a better
    // setup, the writer got four new questions and lost the one they liked.
    if (part === "question") {
      setup = "";
      changed = "question";
    }
    if (part === "setup" && changed !== "both") {
      said = question.text;
      changed = "setup";
    }
    if (changed === "setup") said = question.text;
    // A new setup is held to the same checks as every other one.
    if (setup && (spokenProblem(setup, said) || namedSource(setup, allow, houses))) {
      if (changed === "setup") continue;
      setup = "";
      changed = "question";
    }
    if (part === "setup" && !setup) continue;
    out.push({
      angle: String(v?.angle || "").trim() || "Another way",
      text: said,
      followUp: String(v?.followUp || "").trim(),
      setup,
      forWhom: String(v?.forWhom || "").trim(),
      changed,
    });
  }
  // Words they marked to keep must be there; a version that dropped them is
  // not what they asked for, unless none kept them.
  const low = (t: string) => t.toLowerCase().replace(/\s+/g, " ");
  const kept = keep.length
    ? out.filter((v) => keep.every((k) => low(`${v.setup || question.setup || ""} ${v.text}`).includes(low(k))))
    : out;
  return kept.length ? kept : out;
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
- forWhom: who to put it to. When the context names the people in the room, their first names ("Ajay and Eleonora"), only those who can answer it from their own work, or "Everyone" when all of them truly can; never a description like "the most digitally focused panelist", which the writer cannot act on. With no names, a role at most four words, or "" when it is for everyone. Never an instruction about how to ask it.
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
      max_tokens: 8000,
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
  // Where the time goes, in the server log: a batch the writer watched sit
  // at 94% was four checks in a row after the writing.
  const t0 = Date.now();
  const lap = (what: string) => console.info(`[questions] ${what} at ${((Date.now() - t0) / 1000).toFixed(1)}s`);
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
- category: which part of the conversation it belongs to. Name it the way you would say it to a colleague: plain, literal, two to four words, describing what the questions in it are about or when they get asked. "Opening questions", "How it works in practice", "The uncomfortable ones", "Measuring it", "To close on". Never a colon, never a label with a clever subtitle after it, never a word nobody would say out loud. When categories are given below, use those exact names; only invent a new one for a question that genuinely belongs nowhere in them, and never a near-synonym of one that exists. Otherwise invent 4 to 6 that fit this meeting's arc (one to open with, two or three on the substance, one on the harder ground, one to close with). Use identical wording for every question in a category. The group you open with holds only questions that open a panel: broad, about the panelist's own view or seat, answerable by every one of them in a minute, with no statistic or finding to react to. A question that reacts to a figure or a finding belongs with the substance, however good a start it would make.
- Never say the setup's finding, figure or claim again in the question: the room has just heard it. Ask straight after it.
- why: at most 15 words on what it gets you — the reason to pick this one, plus where the material came from when it came from the research. Not a restatement of the question.
- followUp: the probe to use when the first answer is thin or too comfortable, also written word for word. Never empty.
- forWhom: who to put it to. When the context names the people in the room, their first names, only those who can answer it from their own work ("Ajay and Eleonora"), or "Everyone" when all of them truly can. Never a description like "the most operational panelist", which the writer cannot act on. With no names, a role ("the CFO"), or "" for the only other person in the room.
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
  lap("written");
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
  lap("names scrubbed");
  // A batch is written as one sequence, so its setups lean on each other
  // exactly the way a list of separate questions cannot; and filler slips in
  // however the prompt is worded. Checked by pattern and by judgement.
  // The three checks read the same first draft, so they run at once: one
  // after another they took a minute between them while the bar sat at 94%.
  const firstDraft = clean.map((q) => ({ setup: q.setup, text: q.text }));
  const [judged, misfitEarly, trimmedEarly] = await Promise.all([
    judgeSpoken(firstDraft),
    judgeFit(firstDraft),
    trimRepeatedSetup(firstDraft),
  ]);
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
  lap("setups judged and repaired");
  // A question that misses its setup is rewritten under the same setup, on
  // the quick model; the setup was checked above and stays.
  const misfit = misfitEarly;
  if (misfit.size) {
    console.warn(`[questions] ${misfit.size} did not follow their setup: ${[...misfit.values()].join(" | ")}`);
    await Promise.all(
      [...misfit].map(async ([i, why]) => {
        const q = clean[i];
        const [better] = await rewriteQuestion({ meeting, setup: q.setup, question: q.text, complaint: why, kind: "fix", standing: guidance, count: 1 }).catch(() => []);
        if (better) {
          q.text = better.text;
          q.followUp = better.followUp || q.followUp;
        }
      }),
    );
  }
  lap("fit checked and fixed");
  // A question that says its setup again, after the room just heard it.
  // A trim applies only where the question was not rewritten since.
  for (const [i, t] of trimmedEarly) if (clean[i].text === firstDraft[i].text) clean[i].text = t;
  lap("repeats trimmed");
  // A question that still only makes sense after something else is dropped:
  // the writer cannot ask it without the thing it leans on.
  return clean
    .map((q) => ({ ...q, setup: stripAskedQuestion(q.setup, q.text) }))
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

Write each setup so it leads straight into that exact question as worded. If the question refers to something as "the X" (the guidance, the slide, the framework), the setup says plainly what that is, so the question makes sense to a room that has read nothing. ${STANDALONE_RULE}

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
  // Asked for by name, a setup that names a source goes back for another
  // try rather than vanishing: "Add a setup" used to fail outright.
  const named: { i: number; hit: string }[] = [];
  for (const r of Array.isArray(parsed.setups) ? parsed.setups : []) {
    const i = Number(r?.index);
    const setup = String(r?.setup || "").trim();
    if (!Number.isInteger(i) || i < 0 || i >= out.length || !setup) continue;
    // Said out loud, so the same check every question passes. A setup that
    // names a source is left off rather than said.
    const name = namedSource(setup, allow, houses);
    if (name) {
      console.warn(`[setups] named a source, left it off: ${setup.slice(0, 60)}`);
      if (force && !repairing) named.push({ i, hit: `it names a source aloud (${String(name)}); state the point without saying who published it` });
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
    const pairs = out.map((x, i) => ({ setup: x, text: questions[i].text }));
    const [judged, repeats, answers] = await Promise.all([judgeSpoken(pairs), setupRepeats(pairs), setupAnswers(pairs)]);
    for (const [i, why] of [...repeats, ...answers]) if (!judged.has(i)) judged.set(i, why);
    leaning = out
      .map((x, i) => ({ i, hit: spokenProblem(x, questions[i].text) || judged.get(i) || "" }))
      // A bare question that is fine bare stays bare.
      .filter((r) => r.hit && (out[r.i] || /mid-thought/.test(r.hit)));
    leaning.push(...named);
  }
  if (leaning.length) {
    console.warn(`[setups] ${leaning.length} did not stand alone or used filler, rewriting: ${leaning.map((r) => r.hit).join(" | ")}`);
    // Asked for one by name ("Add a setup"), it gets a second try: one try
    // failed about half the time on a question that mentions "the guidance".
    const tries = force && questions.length === 1 ? 2 : 1;
    const repair = async (r: { i: number; hit: string }): Promise<string> => {
      let hit = r.hit;
      for (let t = 0; t < tries; t++) {
        const [got = ""] = await writeSetups({
          meeting,
          kolBlock,
          research,
          // The fix rides on the question itself, where the writer reads it:
          // in the standing note alone it was ignored three times running.
          questions: [{ ...questions[r.i], why: `${questions[r.i].why || ""} MUST FIX: ${hit}.`.trim() }],
          standing: `${standing}\nA previous setup for this question had this problem: ${hit}. Write it again without it; it is said on its own, so state the finding in full.`.trim(),
          force: true,
          repairing: true,
        });
        // The full check, not only the leaning one: accepting on leaning
        // alone let a rewrite through that ended by asking its own question.
        const still = got ? spokenProblem(got, questions[r.i].text) || namedSource(got, allow, houses) : "came back empty";
        if (!still) return got;
        console.warn(`[setups] repair rejected (${still}): ${got.slice(0, 160)}`);
        hit = still;
      }
      return "";
    };
    const fixed = await Promise.all(leaning.map(repair));
    leaning.forEach((r, k) => (out[r.i] = fixed[k]));
  }
  return out.map((x, i) => stripAskedQuestion(x, questions[i].text));
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
    max_tokens: 8000,
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

const REWRITE_SCHEMA = {
  type: "object" as const,
  properties: {
    questions: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: { text: { type: "string" as const }, followUp: { type: "string" as const } },
        required: ["text", "followUp"],
        additionalProperties: false,
      },
    },
  },
  required: ["questions"],
  additionalProperties: false,
};

/**
 * New questions for a setup the writer likes, the setup untouched.
 *
 * "Setup is great but question isn't" went through the whole question writer,
 * which rewrote the setup it had just been told was great, took the best part
 * of a minute doing it, and still asked "when was the last time" instead of
 * what the setup was asking for. This writes only the question, on the quick
 * model, tied to the problem the setup lays out.
 */
export async function rewriteQuestion({
  meeting,
  setup,
  question,
  complaint = "",
  kind = "fix",
  standing = "",
  count = 2,
  opener = "",
}: {
  meeting: MeetingPayload;
  setup: string;
  question: string;
  /** A suggested opening, so a batch of rewrites does not all start alike. */
  opener?: string;
  /** What the writer said about it. */
  complaint?: string;
  /** "fix": they did not like it. "version": they want it asked another way. */
  kind?: "fix" | "version";
  standing?: string;
  count?: number;
}): Promise<{ text: string; followUp: string }[]> {
  const res = await anthropic().messages.create({
    model: CHECK_MODEL,
    max_tokens: 8000,
    output_config: { format: { type: "json_schema", schema: REWRITE_SCHEMA } },
    system: `You write the question that follows a setup someone will say out loud on a panel. The setup stays exactly as it is; you write only the question after it.

${SEAT_RULE}

The question:
- is about the exact problem or tension the setup lays out, so it lands as the obvious next thing to ask after hearing it. A question about a neighbouring point is wrong however good it is.
- asks the people answering what they know from their own seat: how the problem plays out where they sit, where they land on it and why, what it would take to fix. It never assumes they have done what the setup describes. Not "when was the last time", not yes/no, not a trivia question about their process.
- is short enough to say in one breath and opens something up.

${OPEN_QUESTION_RULE}
- never names a consultancy, report, study, survey or author, and never refers to "the source", "the article" or anything the room has not heard.
${kind === "version" ? "\nThe writer likes the current question and wants other ways of asking the same thing, far enough apart that choosing is a real choice." : "\nThe writer did not like the current question. Fix what they said is wrong with it."}
${opener ? `\nFor variety, open the first one along the lines of "${opener}" if it fits; and never assume they have done what the setup describes.\n` : ""}${complaint ? `\nWhat the writer said, which outranks every rule above: ${complaint}\n` : ""}${standing.trim() ? `\nTheir standing instruction for how all their questions are written: ${standing.trim()}\n` : ""}
Write exactly ${count} questions, each with a follow-up probe for when the first answer is thin, written word for word. Plain prose, no quotation marks, never an em dash.`,
    messages: [
      {
        role: "user",
        content: `${meetingContext({ ...meeting, documents: [] }, "") || "(minimal context)"}\n\nThe setup, which stays:\n${setup || "(none)"}\n\nThe current question:\n${question}`,
      },
    ],
  });
  if (res.stop_reason === "refusal") return [];
  const parsed = JSON.parse(firstText(res) || "{}");
  const allow = allowedNames(meeting.attendees);
  return (Array.isArray(parsed.questions) ? parsed.questions : [])
    .map((q: { text?: unknown; followUp?: unknown }) => ({
      text: String(q?.text || "").trim().replace(/\bquietly\s+/gi, "").replace(/[\s.,;:]*$/, "").replace(/([^?])$/, "$1?"),
      followUp: String(q?.followUp || "").trim(),
    }))
    .filter(
      (q: { text: string }) =>
        q.text.length > 1 &&
        q.text.toLowerCase() !== question.trim().toLowerCase() &&
        !namedSource(q.text, allow) &&
        !unnamedSource(q.text) &&
        !leansOnAnother(q.text) &&
        !closedQuestion(q.text),
    )
    .slice(0, count);
}

const OPTIONS_SCHEMA = {
  type: "object" as const,
  properties: {
    options: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          kind: { type: "string" as const, enum: ["Where they sit", "And how they fix it", "A push back"] },
          text: { type: "string" as const },
          followUp: { type: "string" as const },
          forWhom: { type: "string" as const },
        },
        required: ["kind", "text", "followUp", "forWhom"],
        additionalProperties: false,
      },
    },
  },
  required: ["options"],
  additionalProperties: false,
};

/**
 * Three ways to ask the question under one setup, of different kinds, for the
 * writer to choose from. Asked to rank versions of the same question, the
 * writer liked one kind for one setup and another for the next, and said
 * someone else might choose differently again: so choose, not decide for them.
 */
export async function questionOptions({
  meeting,
  setup,
  question,
  standing = "",
}: {
  meeting: MeetingPayload;
  setup: string;
  question: string;
  standing?: string;
}): Promise<{ kind: string; text: string; followUp: string; forWhom?: string }[]> {
  const res = await anthropic().messages.create({
    model: CHECK_MODEL,
    max_tokens: 8000,
    output_config: { format: { type: "json_schema", schema: OPTIONS_SCHEMA } },
    system: `You write three ways to ask the question that follows a setup a moderator will say out loud on a panel. The setup stays exactly as it is. The writer picks one, so write one of each kind, each a real choice:
- "Where they sit": how the problem the setup lays out actually works, or shows up, in the panelist's own organisation. The writer's favourite kind.
- "And how they fix it": the same, ending on what they do about it ("...and how do you make sure that doesn't happen?").
- "A push back": a short challenge that follows from the setup, that people will argue with at length. This one may be shaped like a yes or no, if nobody could answer it in a word.

${SEAT_RULE}

${OPEN_QUESTION_RULE}

Use the words people in the field actually say, never a term or image the setup borrowed from a document. Never name a consultancy, report, study, survey or author, never refer to "the source" or anything the room has not heard.

The room has just heard the setup. Never say its finding, figure or claim again in the question: ask straight after it.
${standing.trim() ? `\nThe writer's standing instruction for how all their questions are written: ${standing.trim()}\n` : ""}
Each one is short enough to say in one breath and ends with a question mark, with a follow-up probe for when the first answer is thin, written word for word. Plain prose, no quotation marks, never an em dash.

forWhom, for each: When the context names the people in the room, forWhom is the first names of those who can answer THIS version from their own direct work, strictly: a question about managing MSLs fits nobody who does not manage MSLs, a question about KOL meetings does not fit people who never meet KOLs, a question about hiring fits only people who hire. "Everyone" only when all of them truly can. "" when it fits none of them, or when no names are given.`,
    messages: [
      {
        role: "user",
        content: `${meetingContext({ ...meeting, documents: [] }, "") || "(minimal context)"}\n\nThe setup, which stays:\n${setup || "(none: the question is asked bare, so each version has to stand on its own)"}\n\nThe question as it stands, for what it is after:\n${question}`,
      },
    ],
  });
  if (res.stop_reason === "refusal") return [];
  const parsed = JSON.parse(firstText(res) || "{}");
  const allow = allowedNames(meeting.attendees);
  const kept = (Array.isArray(parsed.options) ? parsed.options : [])
    .map((q: { kind?: unknown; text?: unknown; followUp?: unknown; forWhom?: unknown }) => ({
      kind: String(q?.kind || ""),
      forWhom: String(q?.forWhom || "").trim(),
      text: String(q?.text || "").trim().replace(/\bquietly\s+/gi, "").replace(/[\s.,;:]*$/, "").replace(/([^?])$/, "$1?"),
      followUp: String(q?.followUp || "").trim(),
    }))
    .filter((q: { kind: string; text: string }) => {
      if (q.text.length < 2 || q.text.toLowerCase() === question.trim().toLowerCase()) return false;
      if (namedSource(q.text, allow) || unnamedSource(q.text) || leansOnAnother(q.text)) return false;
      const closed = closedQuestion(q.text);
      return !closed || (q.kind === "A push back" && closed === "it can be answered yes or no");
    }) as { kind: string; text: string; followUp: string; forWhom: string }[];
  // Versions that only make sense to someone who read the source.
  const bad = await outsideTerms(kept.map((q: { text: string }) => ({ setup, text: q.text })));
  return kept.filter((_: unknown, i: number) => !bad.has(i));
}

/** Options for many setups at once, six at a time. */
export async function optionsFor({
  meeting,
  items,
  standing = "",
}: {
  meeting: MeetingPayload;
  items: { setup: string; text: string }[];
  standing?: string;
}): Promise<{ kind: string; text: string; followUp: string; forWhom?: string }[][]> {
  const out: { kind: string; text: string; followUp: string; forWhom?: string }[][] = items.map(() => []);
  for (let k = 0; k < items.length; k += 6)
    await Promise.all(
      items.slice(k, k + 6).map(async (x, j) => {
        out[k + j] = await questionOptions({ meeting, setup: x.setup, question: x.text, standing }).catch(() => []);
      }),
    );
  return out;
}

/**
 * A sharper question for every setup whose question scores under 4, offered
 * to the writer rather than applied: the list and the bank are theirs.
 * Returns, per item, the suggestion or null.
 */
const ORDER_SCHEMA = {
  type: "object" as const,
  properties: {
    order: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: { index: { type: "number" as const }, section: { type: "string" as const } },
        required: ["index", "section"],
        additionalProperties: false,
      },
    },
  },
  required: ["order"],
  additionalProperties: false,
};

type ListLine = { text: string; setup?: string; forWhom?: string; askWho?: string; section?: string };
const lineOf = (q: ListLine, i: number) =>
  `${i}. ${q.text}${q.askWho ? ` [asked of ${q.askWho}]` : q.forWhom ? ` [for ${q.forWhom}]` : ""}${q.setup ? `\n   (setup: ${q.setup.slice(0, 200)})` : ""}`;

/**
 * The list in the order a conversation would run, in a few named stretches.
 * The writer: group similar questions and put them in an order that makes
 * sense for a conversation. Every question is kept; only the order and the
 * stretch it sits in change.
 */
export async function orderForConversation({
  meeting,
  items,
}: {
  meeting: MeetingPayload;
  items: ListLine[];
}): Promise<{ index: number; section: string }[]> {
  if (items.length < 2) return items.map((_, index) => ({ index, section: "" }));
  const res = await anthropic().messages.create({
    model: CHECK_MODEL,
    max_tokens: 16000,
    output_config: { format: { type: "json_schema", schema: ORDER_SCHEMA } },
    system: `A moderator's list of questions for a panel. Put them in the order the conversation should run and group them into 3 to 6 stretches.
- The first stretch is always named "Opening": the one or two questions that open the panel, short enough for every panelist to answer briefly in turn and frame what follows. Close with a forward-looking or call-to-action question.
- Keep questions on the same theme together, so the conversation builds instead of jumping around, and put the one that sets up a theme before the ones that go deeper into it.
- Spread the panelists: avoid putting several questions in a row to the same person when another order works as well.
- section: a short plain name for the stretch, two to five words ("Defining value", "Measuring the field", "Publications and evidence", "Where this goes next"). Questions in the same stretch share the exact same name.
Return every index exactly once.`,
    messages: [
      {
        role: "user",
        content: `${meetingContext({ ...meeting, documents: [] }, "") || "(minimal context)"}\n\nThe list:\n${items.map(lineOf).join("\n")}`,
      },
    ],
  });
  if (res.stop_reason === "max_tokens") console.warn("[order] ran out of room before answering");
  const parsed = JSON.parse(firstText(res) || "{}");
  const seen = new Set<number>();
  const out: { index: number; section: string }[] = [];
  for (const o of Array.isArray(parsed.order) ? parsed.order : []) {
    const i = Number(o?.index);
    if (!Number.isInteger(i) || i < 0 || i >= items.length || seen.has(i)) continue;
    seen.add(i);
    out.push({ index: i, section: String(o?.section || "").trim() });
  }
  // Anything the model dropped stays, at the end of the stretch it was in.
  items.forEach((q, i) => !seen.has(i) && out.push({ index: i, section: q.section || out[out.length - 1]?.section || "" }));
  // A stretch is one run: questions given the same name sit together, in
  // the order the stretches first appear, whatever order they came back in.
  const runs = [...new Set(out.map((o) => o.section))];
  return runs.flatMap((r) => out.filter((o) => o.section === r));
}

const REGROUP_SCHEMA = {
  type: "object" as const,
  properties: {
    groups: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          name: { type: "string" as const },
          indices: { type: "array" as const, items: { type: "number" as const } },
        },
        required: ["name", "indices"],
        additionalProperties: false,
      },
    },
  },
  required: ["groups"],
  additionalProperties: false,
};

/**
 * The whole bank sorted by what each question is about. Each batch named
 * its own groups, so the same kind of question sat under "Measuring it",
 * "Measuring the value" and "The hard ground" at once, and the writer could
 * not see like with like. Returns the groups in conversation order, each with
 * its questions broadest first; every index exactly once.
 */
export async function regroupQuestions({
  meeting,
  items,
}: {
  meeting: MeetingPayload;
  items: { text: string; setup?: string }[];
}): Promise<{ name: string; indices: number[] }[]> {
  if (!items.length) return [];
  const res = await anthropic().messages.create({
    model: CHECK_MODEL,
    max_tokens: 16000,
    output_config: { format: { type: "json_schema", schema: REGROUP_SCHEMA } },
    system: `A moderator's bank of questions for a panel, written in several batches that each invented their own group names. Sort them again by what each question is actually about, so questions on the same subject sit together.
- One group per subject. Two questions about the same thing (activity targets and which experts get chased, say, or measuring MSL performance) go in the same group whatever their tone, and however differently they were grouped before. Never split one subject across two groups, and never put a question in a group whose name does not describe it.
- Name each group plainly, two to five words, for its subject, as a colleague would say it ("Activity targets and KOL choice", "Measuring MSL performance", "AI and digital", "Budget and resources"). Never a mood ("The uncomfortable ones", "The hard ground"), never a colon.
- "Opening questions" holds only broad openers every panelist could answer from their own seat with no figure to react to. "To close on" holds only closing or forward-looking calls to action. Leave either out if nothing fits.
- About 6 to 9 groups. Order them the way a conversation would run: opening first, closing last. Within a group, the broadest question first.
Return every index exactly once.`,
    messages: [
      {
        role: "user",
        content: `${meetingContext({ ...meeting, documents: [] }, "") || "(minimal context)"}\n\nThe questions:\n${items
          .map((q, i) => `${i}. ${q.text}${q.setup ? `\n   (setup: ${q.setup.slice(0, 160)})` : ""}`)
          .join("\n")}`,
      },
    ],
  });
  if (res.stop_reason === "max_tokens") console.warn("[regroup] ran out of room before answering");
  const parsed = JSON.parse(firstText(res) || "{}");
  const seen = new Set<number>();
  const out: { name: string; indices: number[] }[] = [];
  for (const g of Array.isArray(parsed.groups) ? parsed.groups : []) {
    const name = String(g?.name || "").replace(/:.*$/, "").trim();
    const idx = (Array.isArray(g?.indices) ? g.indices : [])
      .map(Number)
      .filter((i: number) => Number.isInteger(i) && i >= 0 && i < items.length && !seen.has(i));
    idx.forEach((i: number) => seen.add(i));
    if (!name || !idx.length) continue;
    const same = out.find((o) => o.name.toLowerCase() === name.toLowerCase());
    if (same) same.indices.push(...idx);
    else out.push({ name, indices: idx });
  }
  // Nothing is dropped: a question the model left out keeps a group of its own.
  const left = items.map((_, i) => i).filter((i) => !seen.has(i));
  if (left.length) out.push({ name: "Other questions", indices: left });
  return out;
}

const SEARCH_SCHEMA = {
  type: "object" as const,
  properties: {
    matches: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: { index: { type: "number" as const }, why: { type: "string" as const } },
        required: ["index", "why"],
        additionalProperties: false,
      },
    },
  },
  required: ["matches"],
  additionalProperties: false,
};

/**
 * "Do we have anything about X?" across every question the writer has, by
 * what each one is about rather than the words it uses: a question on
 * "which experts get chased" is about KOL targeting even if it never says so.
 * Returns the matching indices, best first, each with a few words on why.
 */
export async function searchQuestions({
  query,
  items,
}: {
  query: string;
  items: { text: string; setup?: string }[];
}): Promise<{ index: number; why: string }[]> {
  if (!query.trim() || !items.length) return [];
  const res = await anthropic().messages.create({
    model: CHECK_MODEL,
    max_tokens: 8000,
    output_config: { format: { type: "json_schema", schema: SEARCH_SCHEMA } },
    system: `A moderator is searching their own questions for a panel: "do we have anything about this?". Return every question that is genuinely about what they are looking for, judged by what the question and its setup are about, not by shared words: a question can be about the topic without naming it, and one that only mentions a word in passing is not about it. Best match first. why: at most eight words on how it bears on the search. Nothing that does not fit; an empty list is a fine answer.`,
    messages: [
      {
        role: "user",
        content: `Looking for: ${query.trim()}\n\nThe questions:\n${items
          .map((q, i) => `${i}. ${q.text}${q.setup ? `\n   (setup: ${q.setup.slice(0, 160)})` : ""}`)
          .join("\n")}`,
      },
    ],
  });
  const parsed = JSON.parse(firstText(res) || "{}");
  const seen = new Set<number>();
  const out: { index: number; why: string }[] = [];
  for (const x of Array.isArray(parsed.matches) ? parsed.matches : []) {
    const i = Number(x?.index);
    if (!Number.isInteger(i) || i < 0 || i >= items.length || seen.has(i)) continue;
    seen.add(i);
    out.push({ index: i, why: String(x?.why || "").trim() });
  }
  return out;
}

const PLACE_SCHEMA = {
  type: "object" as const,
  properties: { after: { type: "number" as const }, section: { type: "string" as const } },
  required: ["after", "section"],
  additionalProperties: false,
};

/** Where a new question belongs in the running order: after which one (-1 for first), and in which stretch. */
export async function placeQuestion({
  items,
  question,
}: {
  items: ListLine[];
  question: ListLine;
}): Promise<{ after: number; section: string }> {
  if (!items.length) return { after: -1, section: "" };
  try {
    const res = await anthropic().messages.create({
      model: CHECK_MODEL,
      max_tokens: 8000,
      output_config: { format: { type: "json_schema", schema: PLACE_SCHEMA } },
      system: `A moderator's questions for a panel, in the order the conversation runs, some marked with the stretch of the conversation they sit in. Say where the new question fits best: after: the index of the question it should follow (-1 to open with it), next to the questions on the same theme. section: the stretch it joins, copied exactly from the list, or "" if the list has none.`,
      messages: [{ role: "user", content: `The list:\n${items.map((q, i) => `${lineOf(q, i)}${q.section ? `\n   [stretch: ${q.section}]` : ""}`).join("\n")}\n\nThe new question:\n${question.text}` }],
    });
    const p = JSON.parse(firstText(res) || "{}");
    const after = Math.max(-1, Math.min(items.length - 1, Math.round(Number(p.after))));
    return { after: Number.isFinite(after) ? after : items.length - 1, section: String(p.section || "") };
  } catch {
    return { after: items.length - 1, section: items[items.length - 1]?.section || "" };
  }
}

export async function sharpenQuestions({
  meeting,
  items,
  standing = "",
}: {
  meeting: MeetingPayload;
  items: { setup: string; text: string }[];
  standing?: string;
}): Promise<({ text: string; followUp: string; why: string } | null)[]> {
  const out: ({ text: string; followUp: string; why: string } | null)[] = items.map(() => null);
  const weak = [...(await judgeFit(items))];
  // Six at a time: each is a quick call, and a whole bank at once trips rate limits.
  for (let k = 0; k < weak.length; k += 6)
    await Promise.all(
      weak.slice(k, k + 6).map(async ([i, why], j) => {
        const [q] = await rewriteQuestion({
          meeting,
          setup: items[i].setup,
          question: items[i].text,
          complaint: why,
          kind: "fix",
          standing,
          count: 2,
          opener: OPENERS[(k + j) % OPENERS.length],
        }).catch(() => []);
        if (q) out[i] = { text: q.text, followUp: q.followUp, why };
      }),
    );
  return out;
}
