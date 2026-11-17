// Client side of "This was me" (see firstPerson.ts). Sends the pieces that
// read as prose to the model and returns a function that renames anything:
// a piece the model rewrote comes back rewritten, anything else (the
// transcript, the title, a piece the call failed on) gets the word swap.

import { isFirstPerson, renameInHtml, renameInText } from "./rename";

export type Renamer = (text: string, html?: boolean) => string;

export async function writerRenamer(
  what: string,
  to: string,
  pieces: Record<string, string>,
): Promise<Renamer> {
  const swap: Renamer = (text, html) =>
    html ? renameInHtml(text, what, to) : renameInText(text, what, to);
  if (!isFirstPerson(to)) return swap;

  let rewritten: Record<string, string> = {};
  try {
    const res = await fetch("/api/meeting/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ action: "asWriter", who: what, pieces }),
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
