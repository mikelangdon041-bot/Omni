// Taking apart the body of a message that is being composed.
//
// Outlook hands the add-in one string for the whole compose window, and that
// string is three different things stacked on top of each other:
//
//   1. what the person has actually typed (the only part that is "the draft")
//   2. their signature, which the app appends itself and must not write twice
//   3. on a reply or a forward, the entire thread underneath
//
// Treating all three as one blob is how the pane used to get this wrong in both
// directions: at first it ignored the body completely on a compose item, on the
// theory that an outgoing draft is "usually just your signature so far" — which
// is true of a blank new message and false of every reply anyone has ever
// half-written. Handing the whole blob over instead would be no better: the
// model would be asked to rewrite a thread it is only supposed to be answering,
// and the person's two lines of shorthand would be buried under forty lines of
// someone else's email.
//
// So it is split here, once, and each piece goes where it belongs: their words
// into the draft box, the thread into the background the model is told to write
// against, the signature into the bin.

/** The three parts of a compose body, separated. */
export interface SplitBody {
  /** What the person has typed themselves, signature removed. */
  mine: string;
  /** The thread underneath, verbatim, or "" when this isn't a reply. */
  quoted: string;
}

// Where a quoted thread starts. Every mail client marks the seam, but each one
// marks it differently, and Outlook alone does it two ways depending on whether
// the message came from the desktop client or the web one.
const ORIGINAL_MESSAGE = /^\s*-{2,}\s*(?:original message|forwarded message)\s*-{2,}\s*$/i;
// The horizontal rule the web client draws above the quoted header block.
const SEPARATOR_RULE = /^\s*[_-]{10,}\s*$/;
// "On Tuesday, 9 September 2026 at 16:12, Shane Bemiller <s@…> wrote:"
const WROTE_LINE = /^\s*On\b.{4,300}\bwrote:\s*$/i;
// A plain-text reply quotes with angle brackets.
const QUOTE_MARK = /^\s*>/;
// The header block Outlook writes above the quoted message. "From:" alone is
// not enough of a signal — someone can open a sentence with it — so it only
// counts when the rest of the block follows it.
const FROM_LINE = /^\s*from\s*:\s*\S/i;
const HEADER_FOLLOW = /^\s*(?:sent|date|to|cc|subject)\s*:/i;

/** The line number the quoted thread starts on, or -1 if there isn't one. */
function quoteStart(lines: string[]): number {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (ORIGINAL_MESSAGE.test(line) || WROTE_LINE.test(line) || QUOTE_MARK.test(line)) return i;
    // A rule on its own means nothing unless a quoted header follows it: a row
    // of dashes is also how plenty of people underline a heading.
    if (SEPARATOR_RULE.test(line)) {
      const next = lines.slice(i + 1, i + 4).find((l) => l.trim());
      if (next && (FROM_LINE.test(next) || HEADER_FOLLOW.test(next))) return i;
      continue;
    }
    if (FROM_LINE.test(line)) {
      const following = lines.slice(i + 1, i + 5).filter((l) => l.trim());
      if (following.some((l) => HEADER_FOLLOW.test(l))) return i;
    }
  }
  return -1;
}

/**
 * The end of the person's own text and the start of their signature, or -1.
 *
 * Matched against the signature they saved in settings rather than guessed at:
 * a heuristic that hunts for "a block that looks like a sign-off" eventually
 * eats a real closing paragraph, and losing a sentence someone wrote is a worse
 * failure than leaving a signature in. Their name is usually the first line of
 * it, but an image or a "Thanks," can come first, so the first few lines are
 * each tried and the earliest one that matches wins.
 */
function signatureStart(lines: string[], signature: string): number {
  const needles = signature
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length >= 4)
    .slice(0, 3)
    .map((l) => l.toLowerCase());
  if (!needles.length) return -1;

  let found = -1;
  for (const needle of needles) {
    // Last occurrence, not the first: a name that appears in the body ("as
    // Zak mentioned") is not where the signature starts.
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].trim().toLowerCase() === needle) {
        if (found === -1 || i < found) found = i;
        break;
      }
    }
  }
  return found;
}

/**
 * Split a composed message into the person's own words and the thread below it.
 *
 * `signature` is their saved signature as plain text; pass "" when they haven't
 * set one and it is left alone, since without a copy to compare against there
 * is no safe way to tell a signature from a closing paragraph.
 */
export function splitComposeBody(body: string, signature = ""): SplitBody {
  const lines = (body || "").split(/\r?\n/);
  const cut = quoteStart(lines);
  const mineLines = cut === -1 ? lines : lines.slice(0, cut);
  const quoted = cut === -1 ? "" : lines.slice(cut).join("\n").trim();

  const sig = signature ? signatureStart(mineLines, signature) : -1;
  const kept = sig === -1 ? mineLines : mineLines.slice(0, sig);

  return { mine: kept.join("\n").trim(), quoted };
}
