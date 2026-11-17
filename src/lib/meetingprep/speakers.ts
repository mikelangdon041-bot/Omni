// Who's who: what the person who was in the room says each speaker label is.
//
// Voice separation gives "Speaker A" and "Speaker B" and nothing else, and
// the notes are barred from guessing who is who. Once the writer says, the
// notes can do more than swap a name in: knowing that Speaker A is the
// manager and Speaker B the rep changes whose concern a point is, who is
// coaching whom and whose follow-up it is. So an assignment is applied by
// rewriting (firstPerson.ts), or by writing the notes again from a
// relabelled transcript when the meeting still has one.

export type Pronouns = "" | "he" | "she" | "they";

export interface SpeakerAssignment {
  /** The label as it appears: "Speaker B", "Dr. Chen". */
  label: string;
  /** Who it is. Ignored when `me` is set. */
  name: string;
  /** True when this speaker is the writer: written as I, me, my. */
  me?: boolean;
  pronouns?: Pronouns;
}

/** Unnamed voice-separation labels still sitting in some text. */
export function unnamedLabels(...texts: string[]): string[] {
  const found = new Set<string>();
  for (const t of texts) {
    for (const m of (t || "").replace(/<[^>]+>/g, " ").matchAll(/\bSpeaker [A-Z0-9]{1,2}\b/g)) {
      found.add(m[0]);
    }
  }
  return [...found].sort();
}

/** The label a speaker carries in a relabelled transcript. */
export function transcriptLabel(a: SpeakerAssignment): string {
  return a.me ? "Me" : a.name.trim();
}

export function isComplete(a: SpeakerAssignment): boolean {
  return Boolean(a.me || a.name.trim());
}

/**
 * Rewrite line-start speaker labels ("Speaker B: ...") to the assigned name,
 * or "Me". Only line starts: that is where a label is a label, and anywhere
 * else the same words could be ordinary speech.
 */
export function relabelTranscript(text: string, assignments: SpeakerAssignment[]): string {
  const done = assignments.filter(isComplete);
  if (!done.length || !text) return text;
  return text
    .split("\n")
    .map((line) => {
      for (const a of done) {
        if (line.startsWith(`${a.label}:`)) return `${transcriptLabel(a)}:${line.slice(a.label.length + 1)}`;
      }
      return line;
    })
    .join("\n");
}

/** How a person is described to the model: "Dr. Chen (she/her)", "the writer". */
export function describe(a: SpeakerAssignment): string {
  const p = a.pronouns === "he" ? "he/him" : a.pronouns === "she" ? "she/her" : a.pronouns === "they" ? "they/them" : "";
  return a.me ? "the writer" : `${a.name.trim()}${p ? ` (${p})` : ""}`;
}
