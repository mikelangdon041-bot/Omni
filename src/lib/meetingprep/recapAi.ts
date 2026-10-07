// The follow-up email people send after a meeting, drafted from its notes.
//
// It used to be framed as a record of what was agreed, and it read like one: a
// formal summary that thanked them for their time, closed by asking to be
// corrected, and joined every other clause with a semicolon, because the dash
// ban pushed the model to the next piece of punctuation along. Sent to a
// colleague, that reads as either distrust or a machine. So the brief is a
// friendly note from a colleague, the sender can steer it ("only the Utah
// trip", "keep it short"), and it borrows their own voice when the Writing
// Studio has one.
//
// Lives here rather than inline in /api/meeting/ai so the prompt can be run
// from a script against real notes.

import type { SupabaseClient } from "@supabase/supabase-js";
import { anthropic, WRITER_MODEL } from "@/lib/anthropic";
import { stripDashes } from "./captureAi";
import { pickSamples } from "@/lib/writer/voice";
import type { WordSwap } from "@/lib/writer/types";

const EMAIL_SCHEMA = {
  type: "object" as const,
  properties: {
    subject: { type: "string" as const },
    body: { type: "string" as const },
  },
  required: ["subject", "body"],
  additionalProperties: false,
};

export interface RecapInput {
  notes: string;
  actions: string[];
  title?: string;
  when?: string;
  sender?: string;
  recipients?: string[];
  /** What the sender wants: "only the conference plans", "make it shorter". */
  guidance?: string;
  /** The draft being changed, so "shorter" means shorter than this. */
  previous?: string;
  /** From voiceFor(); empty when the sender has not taught one. */
  voice?: string;
  /** Set on the one retry that cuts an over-long short draft, so it stops there. */
  cutting?: boolean;
}

export interface RecapOutput {
  subject: string;
  body: string;
}

function firstText(res: { content: { type: string; text?: string }[] }): string {
  const block = res.content.find((b) => b.type === "text");
  return (block?.text || "").trim();
}

/**
 * Semicolons become the full stop a person would have used, after the dash
 * clean-up that is shared with the notes. Prompting alone does not hold: the
 * model goes back to them whenever two clauses meet.
 */
export function plainPunctuation(text: string): string {
  return stripDashes(text)
    .replace(/[ \t]*;[ \t]+(\S)/g, (_m, c: string) => `. ${c.toUpperCase()}`)
    .replace(/;[ \t]*$/gm, ".");
}

/**
 * The sender's own voice from the Writing Studio, when they have taught it
 * one, so a recap sounds like the rest of their email. Their word swaps come
 * with it: those are facts about the person, not about one style.
 */
export async function voiceFor(supabase: SupabaseClient, userId: string): Promise<string> {
  const [{ data: style }, { data: settings }] = await Promise.all([
    supabase
      .from("writer_styles")
      .select("voice_profile, samples")
      .eq("user_id", userId)
      .eq("kind", "voice")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("writer_settings").select("word_swaps").eq("user_id", userId).maybeSingle(),
  ]);

  const parts: string[] = [];
  const profile = String(style?.voice_profile || "").trim();
  if (profile) {
    const samples = pickSamples(String(style?.samples || ""), 120, 3)
      .map((s, i) => `<sample ${i + 1}>\n${s.slice(0, 1500)}\n</sample ${i + 1}>`)
      .join("\n\n");
    parts.push(
      `HOW THIS PERSON WRITES. Match it: the rhythm, the sentence length, the way they open and close. Never copy content from the samples, only how they sound.\n${profile}${
        samples ? `\n\n${samples}` : ""
      }`,
    );
  }
  const swaps = (Array.isArray(settings?.word_swaps) ? (settings.word_swaps as WordSwap[]) : [])
    .filter((w) => w?.avoid?.trim())
    .slice(0, 40)
    .map((w) =>
      w.prefer?.trim()
        ? `- Where you would write "${w.avoid.trim()}", write "${w.prefer.trim()}".`
        : `- "${w.avoid.trim()}" is not a word this person uses. Say it another way.`,
    );
  if (swaps.length) parts.push(`THIS PERSON'S OWN WORDS:\n${swaps.join("\n")}`);
  return parts.join("\n\n");
}

const SYSTEM = `You write the follow-up email someone sends to the people they just met with. It is a friendly note from a colleague, not a record for the file and not a check that everyone agrees.

HOW IT READS
- Like a person wrote it, quickly and well. Short sentences, contractions, plain words: the way someone writes to people they work with and get on with.
- Greeting: "Hi" and the first name for one person, "Hi all," or "Hi both," for several. The sender is never in the greeting.
- Open with one short line that is about this meeting in particular. Not a stock thank-you for their time.
- Then what matters to them: what you landed on and what happens next. Usually two to five points, and under 150 words in all. They were in the meeting and the notes are filed, so pick what matters and leave out the detail.
- Bullets only when there are three or more separate items, each starting "• ", one level, no sub-bullets. Fewer than three, write a sentence or two instead.
- Next steps say who is doing them only where the notes say so. "I'll" is only for something the notes or follow-ups say the sender is doing. A follow-up with no owner named is written without one, never claimed for the sender. When a follow-up names the sender in it ("with Zach checking in"), the sender does that part and the rest belongs to the people they met.
- Close the way people really end an email to colleagues, briefly and warmly, and vary it. Do not ask them to correct you, and do not add "let me know if I missed anything". Only ask for a reply when there is a real open question for them.
- Sign off with the sender's first name on its own line. When no name is given, end on the closing line and leave the name for them to add.

WHAT GIVES WRITING AWAY AS MACHINE-MADE, AND IS NEVER IN THIS EMAIL
- Semicolons. Em dashes, en dashes and double hyphens. Colons in the middle of a sentence. Where two thoughts meet, write two sentences, or join them with and, but or so.
- Every sentence the same length. Mix short ones in.
- Stock phrases. Where you would write "ensure", write "make sure". "Leverage" is "use". "Additionally" and "furthermore" are just "also", or nothing. No "I hope this finds you well", no "it was a pleasure", no "please don't hesitate".
- A closing paragraph that sums up what the email already said.
- Bold, headers, markdown, emoji, stacked exclamation marks.

WHAT GOES IN
- Only what is in the notes and follow-ups. Never invent an agreement, a deadline, an owner, a figure, or a warmth in the relationship that the notes do not show.
- Something still open is described as open.
- Leave out what would be awkward to put in writing to these people: candid remarks about colleagues, personal asides, internal warnings, anything said off the record.
- Write as the sender, in the first person.

FORMAT
- body is plain text with blank lines between paragraphs.
- subject: short and natural, what a person would type. No "Re:", no quotes, no date unless it helps.`;

const GUIDANCE_RULE = `THE SENDER'S INSTRUCTIONS FOR THIS EMAIL outrank everything above about what to include, how long it is and how it is shaped. If they say talk only about something, the email is only about that, and everything else is left out even if it was the biggest topic in the meeting. If they ask for it short, the whole body is the greeting, three or four sentences, and the sign-off: no bullets, nothing that is merely nice to know, under 70 words. Never mention the instructions in the email.`;

export async function writeRecap(input: RecapInput): Promise<RecapOutput> {
  const notes = String(input.notes || "").slice(0, 40000);
  const acts = (input.actions || []).map(String).slice(0, 40);
  const title = String(input.title || "").slice(0, 200);
  const when = String(input.when || "").slice(0, 60);
  const given = String(input.sender || "").slice(0, 80).trim();
  // A display name is often the account handle ("zbalmuth"), and an email
  // signed with a handle is worse than one left for the sender to sign.
  const sender = /\s/.test(given) || given !== given.toLowerCase() ? given : "";
  const recipients = (input.recipients || []).map(String).slice(0, 20);
  const guidance = String(input.guidance || "").slice(0, 2000).trim();
  const previous = String(input.previous || "").slice(0, 8000).trim();
  const voice = String(input.voice || "").trim();

  const res = await anthropic().messages.create({
    model: WRITER_MODEL,
    max_tokens: 3000,
    output_config: { format: { type: "json_schema", schema: EMAIL_SCHEMA } },
    system: [SYSTEM, guidance && GUIDANCE_RULE, voice].filter(Boolean).join("\n\n"),
    messages: [
      {
        role: "user",
        content: [
          title && `Meeting: ${title}`,
          when && `When: ${when}`,
          sender && `Sender (write as this person): ${sender}`,
          recipients.length && `Recipients: ${recipients.join(", ")}`,
          `Notes:\n${notes}`,
          // Said outright because the pull is the other way: written as the
          // sender, every unowned to-do turned into "I'll" and promised the
          // sender's time for work the notes give to someone else.
          acts.length &&
            `Follow-ups. An owner is only known where the line names one. None of these is the sender's unless it says so, so do not write "I'll" for them:\n${acts
              .map((a) => `- ${a}`)
              .join("\n")}`,
          previous && `The current draft, which the sender wants changed:\n${previous}`,
          guidance && `The sender's instructions: ${guidance}`,
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
  });

  const parsed = JSON.parse(firstText(res) || "{}");
  const out = {
    subject: plainPunctuation(String(parsed.subject || "")),
    // Backstop for the bullet character: models default to "- " however
    // firmly the prompt says otherwise.
    body: plainPunctuation(String(parsed.body || "")).replace(/^(\s*)[-*]\s+/gm, (_m, indent) =>
      indent.length >= 2 ? `${indent}◦ ` : "• ",
    ),
  };

  // "Keep it short" came back at 95 words three times running with the limit
  // in the prompt, so the length is measured rather than trusted, and an
  // over-long draft goes round once more with its own word count attached.
  const n = wordCount(out.body);
  if (!input.cutting && SHORT.test(guidance) && n > SHORT_WORDS + 15) {
    return writeRecap({
      ...input,
      previous: out.body,
      guidance: `${guidance}. This draft is ${n} words. Cut it to under ${SHORT_WORDS} by deleting whole sentences, keeping what they asked for.`,
      cutting: true,
    });
  }
  return out;
}

/** Guidance that asks for a short email. */
const SHORT = /\b(short|shorter|brief|quick|concise|few lines|two lines|three lines|keep it tight)\b/i;
const SHORT_WORDS = 70;

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}
