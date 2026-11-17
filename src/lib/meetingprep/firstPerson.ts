// Putting names (and "me") into notes that were written with speaker labels.
//
// It used to be a word swap: every "Speaker A" became "I". That read wrong in
// most places: "Speaker A's view" is "my view", "Speaker A to check with
// Priya" is "I'll check with Priya", "Speaker A goes Tuesday" is "I go
// Tuesday", and every "he" or "his" that pointed back at them stayed put.
// Which "he" means which person is a question about meaning, not spelling.
// And knowing who someone is changes more than their name: once Speaker A is
// the manager and Speaker B the rep, who is coaching whom, whose concern a
// point is and who owns a follow-up can all read differently. So the model
// does it. The word swap in rename.ts is the fallback when this call fails.

import { anthropic, WRITER_MODEL } from "@/lib/anthropic";
import { describe, isComplete, transcriptLabel, type SpeakerAssignment } from "./speakers";

const SCHEMA = {
  type: "object" as const,
  properties: {
    pieces: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: { key: { type: "string" as const }, text: { type: "string" as const } },
        required: ["key", "text"],
        additionalProperties: false,
      },
    },
  },
  required: ["pieces"],
  additionalProperties: false,
};

/** The prompt line capture uses when the writer is already known. */
export function writerRule(who: string): string {
  return `THE WRITER IS "${who}". These are their notes, so "${who}" is always written in the first person: I, me, my, mine, myself, with the verb agreeing ("I go", "I'm", "I have"). Never write "${who}" by name or label in the notes or the follow-ups, and never refer to them as he, she or they. A follow-up that is theirs is written as their own to-do ("Check with Priya before Friday"), never "${who} to…" or "I to…". Their views are never a bracketed name at the end of a bullet: it is "I doubt it'll get used", never "Some doubt it'll get used (${who})" or "(me)".`;
}

/**
 * For capture, when the transcript has been relabelled from the writer's
 * own say-so: who each label now is, and what to do with that.
 */
export function speakersRule(assignments: SpeakerAssignment[]): string {
  const done = assignments.filter(isComplete);
  if (!done.length) return "";
  const lines = done.map((a) => `- "${transcriptLabel(a)}" is ${describe(a)}.`).join("\n");
  const me = done.find((a) => a.me);
  return `WHO IS WHO. The writer, who was in the room, has said who the speakers are. This is fact, not a guess:
${lines}
Use it to get the meaning right, not just the names: whose concern a point is, who is asking and who is answering, who is coaching or managing whom, whose follow-up it is. Write people by name, with the pronouns given; with none given, use their name or they/them.${
    me ? `\n\n${writerRule(transcriptLabel(me))}` : ""
  }`;
}

export async function rewriteWithSpeakers(
  assignments: SpeakerAssignment[],
  pieces: Record<string, string>,
): Promise<Record<string, string>> {
  const done = assignments.filter(isComplete);
  const entries = Object.entries(pieces).filter(([, v]) => typeof v === "string" && v.trim());
  if (!done.length || !entries.length) return {};

  const who = done.map((a) => `- "${a.label}" is ${describe(a)}.`).join("\n");
  const me = done.find((a) => a.me);

  const res = await anthropic().messages.create({
    model: WRITER_MODEL,
    max_tokens: 12000,
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
    system: `These are the writer's notes on a meeting, written before anyone said who the speakers were. The writer, who was in the room, has now said:
${who}

Rewrite the notes with that known. Two jobs:

1. Every reference to a speaker becomes the person. A named person is written by name, with the pronouns given (none given: their name, or they/them). Pronouns in the notes that point back at a speaker change to match; work out from the sentence which person a pronoun refers to, and leave anyone else's alone.${
      me
        ? `
   "${me.label}" is the writer, so they are always first person, chosen by grammar, not by swapping a word:
   - Subject I, object me, possessive my (mine when it stands alone), reflexive myself.
   - Verbs agree: "is" becomes "am" (or "I'm"), "has" becomes "have", "goes" becomes "go".
   - "${me.label} and Dr. Chen" becomes "Dr. Chen and I" (or "Dr. Chen and me" as an object).
   - A follow-up the writer owns becomes their own to-do: "${me.label} to check with Priya" becomes "Check with Priya".
   - A bracketed attribution to the writer is folded into the sentence: "Some doubt it'll get used, based on past tools (${me.label})" becomes "I doubt it'll get used, based on past tools". Never leave "(me)" or "(I)".
   - A shortened label that clearly means "${me.label}" (just "${me.label.replace(/^Speaker /, "")}") is the writer too.`
        : ""
    }

2. Where knowing who is who changes what a sentence means, reword it so it reads right: whose concern a point is, who is asking and who is answering, who is coaching or managing whom, who owns a follow-up. A sentence written vaguely because the speaker was unknown ("one side felt…", "some doubt…", "the two sides…") can now say who. A bracketed name at the end ("Some doubt it'll get used (Speaker B)") becomes the subject of the sentence where that reads more naturally: "Dr. Chen doubts it'll get used".

Never add a fact that is not already in the notes. Keep the same topics, order and nesting, and the same HTML tags where the piece is HTML. Keep the voice: plain, short, the way a person types their own notes. A piece that never mentions any of these speakers comes back unchanged. Return every key you were given.`,
    messages: [
      {
        role: "user",
        content: entries.map(([k, v]) => `<piece key="${k}">\n${v}\n</piece>`).join("\n\n"),
      },
    ],
  });

  const block = res.content.find((b) => b.type === "text");
  const parsed = JSON.parse((block && "text" in block ? block.text : "") || "{}");
  const out: Record<string, string> = {};
  for (const p of Array.isArray(parsed.pieces) ? parsed.pieces : []) {
    if (p && typeof p.key === "string" && typeof p.text === "string" && p.key in pieces && p.text.trim()) {
      out[p.key] = p.text.trim();
    }
  }
  return out;
}

/** "This was me" from the Replace dialog: one speaker, made the writer. */
export function rewriteAsWriter(who: string, pieces: Record<string, string>) {
  return rewriteWithSpeakers([{ label: who, name: "", me: true }], pieces);
}
