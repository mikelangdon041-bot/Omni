// Client side of naming speakers (see firstPerson.ts). Sends the pieces that
// read as prose to the model and returns a function that renames anything:
// a piece the model rewrote comes back rewritten, anything else (the
// transcript, the title, a piece the call failed on) gets the word swap.

import { isFirstPerson, renameInHtml, renameInText } from "./rename";
import { isComplete, type SpeakerAssignment } from "./speakers";

export type Renamer = (text: string, html?: boolean) => string;

function swapAll(assignments: SpeakerAssignment[]): Renamer {
  return (text, html) =>
    assignments.reduce((t, a) => {
      const to = a.me ? "I" : a.name.trim();
      return html ? renameInHtml(t, a.label, to) : renameInText(t, a.label, to);
    }, text);
}

export async function speakersRenamer(
  assignments: SpeakerAssignment[],
  pieces: Record<string, string>,
): Promise<Renamer> {
  const done = assignments.filter(isComplete);
  const swap = swapAll(done);
  if (!done.length) return (t) => t;

  let rewritten: Record<string, string> = {};
  try {
    const res = await fetch("/api/meeting/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ action: "assignSpeakers", speakers: done, pieces }),
    });
    const json = await res.json();
    if (res.ok && json && typeof json.pieces === "object") rewritten = json.pieces;
  } catch {
    // The word swap below still runs; worse wording beats a lost rename.
  }

  const byOriginal = new Map<string, string>();
  for (const [k, v] of Object.entries(pieces)) {
    if (rewritten[k]) byOriginal.set(v, rewritten[k]);
  }
  return (text, html) => byOriginal.get(text) ?? swap(text, html);
}

/** The Replace dialog: a plain swap, unless it is "This was me". */
export async function writerRenamer(
  what: string,
  to: string,
  pieces: Record<string, string>,
): Promise<Renamer> {
  if (!isFirstPerson(to)) {
    return (text, html) => (html ? renameInHtml(text, what, to) : renameInText(text, what, to));
  }
  return speakersRenamer([{ label: what, name: "", me: true }], pieces);
}
