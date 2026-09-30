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

// --- The second check: does it just read like a machine wrote it? -----------
//
// The check above is exact, and exactness is its limit: it only knows what
// went through Omni. A reply drafted in ChatGPT, or in Copilot, or by somebody
// else and forwarded on, is invisible to it.
//
// So there is a second, softer check on how the writing itself reads. Be
// honest about what that is worth. General-purpose "was this AI written?"
// classifiers are not reliable, and they are least reliable at exactly this
// length — a few hundred words — where there is not enough text to measure
// anything stably. OpenAI withdrew its own for that reason. Nothing here is
// treated as a verdict: a flagged piece is still listed, still tickable, and
// always says which words or habits caused the flag, so the judgement stays
// with the person who actually knows whether they wrote it.
//
// Three kinds of evidence, weakest to strongest:
//
//   1. Phrases that turn up in machine-written business email far more often
//      than in anybody's own. Not proof, but a good prior.
//   2. Shape. People write in bursts — a four-word sentence next to a
//      twenty-six-word one. Generated prose is noticeably more even.
//   3. Distance from writing you have already confirmed is yours. This is the
//      one that actually works, because it is no longer "is this AI?" in the
//      abstract but "is this the same person who wrote those?", with real
//      examples of the person on hand.

/** Phrases that are much commoner in generated business email than in anyone's. */
const TELLS: { re: RegExp; why: string }[] = [
  { re: /\bi hope (?:this|you)\b[^.!?]{0,30}\b(?:finds? you well|(?:are|is) doing well)/i, why: '"I hope this finds you well"' },
  { re: /\bi wanted to (?:reach out|take a moment|touch base)\b/i, why: '"I wanted to reach out"' },
  { re: /\bplease (?:don'?t|do not) hesitate to\b/i, why: '"please don\'t hesitate to"' },
  { re: /\bdelv(?:e|ing)\b/i, why: '"delve"' },
  { re: /\b(?:moreover|furthermore)\b/i, why: 'essay connectives ("moreover", "furthermore")' },
  { re: /\bit'?s (?:important|worth) (?:to note|noting)\b/i, why: '"it\'s worth noting"' },
  { re: /\b(?:leverage|streamline[ds]?|seamless(?:ly)?|holistic|synerg\w+|robust solution)\b/i, why: "consultant vocabulary" },
  { re: /\blooking forward to hearing from you\b/i, why: '"looking forward to hearing from you"' },
  { re: /\bthank you for your (?:understanding|patience)\b/i, why: '"thank you for your understanding"' },
  { re: /\bin today'?s\b[^.!?]{0,30}\b(?:landscape|environment|world|climate)\b/i, why: '"in today\'s landscape"' },
  { re: /\ba testament to\b/i, why: '"a testament to"' },
  { re: /\bi (?:truly |genuinely )?appreciate (?:you taking|your taking|the opportunity)\b/i, why: '"I appreciate you taking the time"' },
  { re: /\bnavigat\w+ (?:the )?(?:complex|challeng|landscape)/i, why: '"navigating the landscape"' },
  { re: /\bdon'?t hesitate to (?:reach out|let me know)\b/i, why: '"don\'t hesitate to reach out"' },
];

function sentences(text: string): string[] {
  return (text || "")
    // The greeting and the sign-off are formula in everybody's writing and
    // would flatten the measure below for good and bad alike.
    .replace(/^[^\n]{0,40},\s*$/gm, "")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.split(/\s+/).length >= 3);
}

function paragraphs(text: string): string[] {
  return (text || "")
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .filter((s) => s.split(/\s+/).length >= 6);
}

const mean = (n: number[]) => (n.length ? n.reduce((a, b) => a + b, 0) / n.length : 0);

/** How uneven a set of lengths is. People are uneven; generated prose is not. */
function spread(lengths: number[]): number {
  if (lengths.length < 3) return 1;
  const m = mean(lengths);
  if (!m) return 1;
  const variance = mean(lengths.map((l) => (l - m) ** 2));
  return Math.sqrt(variance) / m;
}

/** Contractions per hundred words — a stable, very personal habit. */
function contractionRate(text: string): number {
  const w = words(text).length;
  if (!w) return 0;
  const hits = (text.match(/\b\w+['’](?:s|t|re|ve|ll|d|m)\b/gi) || []).length;
  return (hits / w) * 100;
}

export interface VoiceCheck {
  /** Flagged, meaning "look at this before ticking it" — never "this is AI". */
  flagged: boolean;
  /** Why, in words, always. A flag with no reason is not actionable. */
  reasons: string[];
}

/**
 * Does this read like a machine wrote it? `own` is writing already confirmed
 * as the person's, which is what makes the answer worth anything.
 */
export function readsLikeAI(sample: string, own: string[] = []): VoiceCheck {
  const reasons: string[] = [];
  let weight = 0;

  for (const t of TELLS) {
    if (t.re.test(sample)) {
      reasons.push(t.why);
      weight += 2;
      break; // One named phrase is the point; a list of them is a lecture.
    }
  }

  const lengths = sentences(sample).map((s) => s.split(/\s+/).length);
  if (lengths.length >= 4 && spread(lengths) < 0.35) {
    reasons.push("every sentence is nearly the same length");
    weight += 1;
  }
  const paras = paragraphs(sample).map((s) => s.split(/\s+/).length);
  if (paras.length >= 3 && spread(paras) < 0.2) {
    reasons.push("every paragraph is nearly the same length");
    weight += 1;
  }

  // Against the person's own writing, where there is enough of it to mean
  // something. Two pieces and a couple of hundred words is the floor.
  const reference = own.filter(Boolean).join("\n\n");
  if (own.filter(Boolean).length >= 2 && words(reference).length >= 200) {
    const theirs = contractionRate(reference);
    const here = contractionRate(sample);
    if (theirs >= 1.5 && here === 0 && words(sample).length >= 60) {
      reasons.push("you use contractions and this has none");
      weight += 1;
    }
    const theirSentence = mean(sentences(reference).map((s) => s.split(/\s+/).length));
    const hereSentence = mean(lengths);
    if (theirSentence && hereSentence && Math.abs(hereSentence - theirSentence) >= 7) {
      reasons.push(
        hereSentence > theirSentence
          ? "much longer sentences than you write"
          : "much shorter sentences than you write",
      );
      weight += 1;
    }
  }

  return { flagged: weight >= 2, reasons };
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
