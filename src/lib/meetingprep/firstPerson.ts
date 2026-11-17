// "This was me": rewriting a meeting's notes so one speaker is the writer.
//
// It used to be a word swap: every "Speaker A" became "I". That read wrong in
// most places: "Speaker A's view" is "my view", "Speaker A to check with
// Priya" is "I'll check with Priya", "Speaker A goes Tuesday" is "I go
// Tuesday", and every "he" or "his" that pointed back at them stayed put.
// Which "he" means which person is a question about meaning, not spelling,
// so the model does it. The word swap in rename.ts is the fallback when this
// call fails.

import { anthropic, WRITER_MODEL } from "@/lib/anthropic";

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
  return `THE WRITER IS "${who}". These are their notes, so "${who}" is always written in the first person: I, me, my, mine, myself, with the verb agreeing ("I go", "I'm", "I have"). Never write "${who}" by name or label in the notes or the follow-ups, and never refer to them as he, she or they. A follow-up that is theirs is written as their own to-do ("Check with Priya before Friday"), never "${who} to…" or "I to…".`;
}

export async function rewriteAsWriter(
  who: string,
  pieces: Record<string, string>,
): Promise<Record<string, string>> {
  const entries = Object.entries(pieces).filter(([, v]) => typeof v === "string" && v.trim());
  if (!who.trim() || !entries.length) return {};

  const res = await anthropic().messages.create({
    model: WRITER_MODEL,
    max_tokens: 8000,
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
    system: `You turn meeting notes into the writer's own first-person notes. The writer is "${who}": that is their name or speaker label in the text below.

Every reference to "${who}" becomes first person, chosen by grammar, not by swapping a word:
- Subject: I. Object: me. Possessive: my, or mine when it stands alone. Reflexive: myself.
- Verbs agree: "is" becomes "am" (or "I'm"), "has" becomes "have", "goes" becomes "go", "needs" becomes "need".
- Pronouns that point back at "${who}" (he, she, they, him, her, them, his, hers, their, theirs, himself, herself) become first person too. Work out from the sentence which person a pronoun refers to; one that refers to anyone else stays exactly as it is.
- "${who} and Dr. Chen" becomes "Dr. Chen and I" (or "Dr. Chen and me" as an object).
- A follow-up that "${who}" owns becomes the writer's own to-do: "${who} to check with Priya" becomes "Check with Priya"; "${who} will send the slides" becomes "Send the slides". A follow-up owned by someone else keeps its owner.
- A shortened label that clearly means "${who}" (just "A" for "Speaker A") is the writer too.
- Read every sentence back once you have rewritten it. It must read the way a person writes about themselves.

Change nothing else. Same facts, same order, same other people, same HTML tags and nesting where the piece is HTML. A piece that never mentions "${who}" comes back unchanged. Return every key you were given.`,
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
