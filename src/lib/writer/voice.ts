// Which writing a voice is allowed to be learned from.
//
// There is one way for this feature to quietly destroy itself, and it is not
// obvious until you watch it happen. The pane offers to learn from "messages
// you wrote", and some of those messages were written here — you asked for a
// reply, inserted it, sent it, and a week later it is sitting in the thread
// under your name. Learn from that and the model is reading its own output
// back: its habits get scored as yours, your own habits thin out with every
// round, and the profile converges on a generic version of the register it
// started with. The same goes double for the draft currently open in Outlook,
// which is very often the piece the pane put there thirty seconds ago.
//
// So nothing is learned from without being checked against what Omni has
// written. The check has to survive editing — people change a sentence or two
// before sending — so it is not an equality test. Overlapping runs of eight
// words are counted: independent writing about the same subject shares almost
// none of them, and a lightly edited draft shares most.

/** Runs of this many words, compared between two pieces. */
const RUN = 8;

/** Share of a sample's runs that must turn up in one Omni piece to call it ours. */
const THRESHOLD = 0.25;

/** Between one piece of somebody's writing and the next. */
export const SAMPLE_SEPARATOR = "\n\n---\n\n";

function words(text: string): string[] {
  return (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function runs(text: string): Set<string> {
  const w = words(text);
  const out = new Set<string>();
  for (let i = 0; i + RUN <= w.length; i++) out.add(w.slice(i, i + RUN).join(" "));
  return out;
}

/** The stored blob of samples, back as the separate pieces it is. */
export function splitSamples(samples: string): string[] {
  return (samples || "")
    .split(/\n\s*-{3,}\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** And back again. */
export function joinSamples(list: string[]): string {
  return list
    .map((s) => s.trim())
    .filter(Boolean)
    .join(SAMPLE_SEPARATOR);
}

/**
 * A test for "did this come out of Omni rather than out of the person?", with
 * the comparison set worked out once. `written` is what Omni has produced — the
 * content of the pieces in the library, not the briefs that went into them.
 */
export function generatedDetector(written: string[]): (sample: string) => boolean {
  const sets = written.map(runs).filter((s) => s.size > 0);
  return (sample: string) => {
    const mine = runs(sample);
    // Too short to tell the difference between a shared phrase and a shared
    // passage. The caller has its own floor on length; this is the safety net.
    if (mine.size < 3) return false;
    for (const theirs of sets) {
      let hits = 0;
      for (const run of mine) if (theirs.has(run)) hits++;
      if (hits / mine.size >= THRESHOLD) return true;
    }
    return false;
  };
}

/** Is this one already in the samples? Compared on a run, not on the whole. */
export function alreadyLearned(sample: string, samples: string): boolean {
  const known = runs(samples);
  if (!known.size) return false;
  const mine = runs(sample);
  if (!mine.size) return false;
  let hits = 0;
  for (const run of mine) if (known.has(run)) hits++;
  return hits / mine.size >= 0.5;
}
