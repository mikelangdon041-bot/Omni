// Taking apart the body of an email.
//
// Outlook hands the add-in one string for the whole window, and that string is
// several different things stacked on top of each other:
//
//   1. what the person has typed themselves (the only part that is "the draft")
//   2. their signature, which the app appends itself and must not write twice
//   3. on a reply or a forward, the entire thread underneath — which is not one
//      thing either, but every message in it, by different people, one under
//      the next
//
// Treating that as one blob has gone wrong in three separate ways now. First the
// pane ignored the body completely while composing, on the theory that an
// outgoing draft is "usually just your signature so far" — true of a blank new
// message, false of every reply anyone has half-written. Then it pasted the
// whole blob into the box the person types into, which buries their one line
// under forty of somebody else's. And then, with the thread handed over as one
// undifferentiated wall of text, the model had no way to know who had said what:
// asked to answer the first message in a thread it answered the last one, opened
// "Hi Tom" at a message Glenn wrote, and filled the gap with an invented
// paragraph about how much it enjoyed partnering with him.
//
// A thread is a list of messages with senders and dates. Parsing it as one is
// the whole fix: the person's words go in the box, each message in the thread
// keeps its own name on it, and exactly one of them is marked as the one being
// answered.

/** The parts of a compose body, separated. */
export interface SplitBody {
  /** What the person has typed themselves, signature removed. */
  mine: string;
  /** The thread underneath, verbatim, or "" when this isn't a reply. */
  quoted: string;
}

/** One message inside a quoted thread. */
export interface ThreadMessage {
  /** Who sent it, name preferred over address. "" when the header didn't say. */
  from: string;
  /**
   * Who it went to, as the header wrote them. Kept because a reply is read by
   * everyone on it: without this the model offers to "pass your note along to
   * Shrey" in an email Shrey is copied on.
   */
  to: string;
  cc: string;
  /** The date line as the mail client wrote it. */
  sent: string;
  subject: string;
  /** Its own text, without its header block and without the messages below it. */
  body: string;
}

// Where a quoted message starts. Every mail client marks the seam, but each one
// marks it differently, and Outlook alone does it two ways depending on whether
// the message came from the desktop client or the web one.
const ORIGINAL_MESSAGE = /^\s*-{2,}\s*(?:original message|forwarded message)\s*-{2,}\s*$/i;
// The horizontal rule the web client draws above the quoted header block.
const SEPARATOR_RULE = /^\s*[_-]{10,}\s*$/;
// "On Tuesday, 9 September 2026 at 16:12, Shane Bemiller <s@…> wrote:"
const WROTE_LINE = /^\s*On\b.{4,300}\bwrote:\s*$/i;
// A plain-text reply quotes with angle brackets.
const QUOTE_MARK = /^\s*>/;
// The header block Outlook writes above each quoted message. "From:" alone is
// not enough of a signal — someone can open a sentence with it — so it only
// counts when the rest of the block follows it.
const FROM_LINE = /^\s*from\s*:\s*\S/i;
const HEADER_FOLLOW = /^\s*(?:sent|date|to|cc|subject)\s*:/i;
const HEADER_LINE = /^\s*(?:from|sent|date|to|cc|bcc|subject|reply-to|importance)\s*:/i;

/** Does a quoted message begin on this line? */
function boundaryAt(lines: string[], i: number): boolean {
  const line = lines[i];
  if (ORIGINAL_MESSAGE.test(line) || WROTE_LINE.test(line)) return true;
  // Only the first line of a run of angle-bracket quoting: every line after it
  // is the same message continuing.
  if (QUOTE_MARK.test(line)) return !QUOTE_MARK.test(lines[i - 1] ?? "");
  // A rule on its own means nothing unless a quoted header follows it: a row of
  // dashes is also how plenty of people underline a heading.
  if (SEPARATOR_RULE.test(line)) {
    const next = lines.slice(i + 1, i + 4).find((l) => l.trim());
    return !!next && (FROM_LINE.test(next) || HEADER_FOLLOW.test(next));
  }
  if (FROM_LINE.test(line))
    return lines
      .slice(i + 1, i + 5)
      .filter((l) => l.trim())
      .some((l) => HEADER_FOLLOW.test(l));
  return false;
}

/**
 * The line after this message's marker and header block. Used to step over a
 * header once it has been claimed, so the "From:" inside a block that opened
 * with a rule is not counted as a second message. Always past `start`, so the
 * scan cannot stall.
 */
function headerEnd(lines: string[], start: number): number {
  let i = start;
  const opener = lines[i] ?? "";
  const framed = ORIGINAL_MESSAGE.test(opener) || SEPARATOR_RULE.test(opener);
  if (framed || WROTE_LINE.test(opener) || QUOTE_MARK.test(opener)) i++;
  // A framing marker can sit a blank line or two above the headers it frames.
  if (framed) while (i < lines.length && !lines[i].trim() && i < start + 4) i++;
  let sawHeader = false;
  while (i < lines.length) {
    if (HEADER_LINE.test(lines[i])) {
      sawHeader = true;
      i++;
      continue;
    }
    // A long recipient list wraps, indented, under the header it belongs to.
    if (sawHeader && lines[i].trim() && /^\s+\S/.test(lines[i])) {
      i++;
      continue;
    }
    break;
  }
  return Math.max(i, start + 1);
}

/** The line each quoted message starts on, oldest last. */
function quoteBoundaries(lines: string[]): number[] {
  const found: number[] = [];
  let i = 0;
  while (i < lines.length) {
    if (boundaryAt(lines, i)) {
      found.push(i);
      i = headerEnd(lines, i);
      // A run of angle-bracket quoting sitting directly under a marker is that
      // message's own body — "On … wrote:" followed by the words they wrote —
      // not the start of another message. A blank line inside the run is still
      // inside it.
      while (i < lines.length) {
        if (QUOTE_MARK.test(lines[i])) i++;
        else if (!lines[i].trim() && QUOTE_MARK.test(lines[i + 1] ?? "")) i++;
        else break;
      }
      continue;
    }
    i++;
  }
  return found;
}

/** "Shane Bemiller <s@x.com>" → "Shane Bemiller"; "<s@x.com>" → "s@x.com". */
function cleanName(raw: string): string {
  const value = (raw || "").trim();
  if (!value) return "";
  const name = value
    .replace(/<[^>]*>/g, "")
    .replace(/["']/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (name) return name;
  const address = value.match(/<([^>]+)>/);
  return address ? address[1] : value;
}

/**
 * Pull the sender and the date out of a "On <date>, <person> wrote:" line.
 * The date runs up to the time of day, so whatever follows the time is the
 * person — which survives the several date formats this line comes in.
 */
function readWroteLine(line: string): { from: string; sent: string } {
  const inner = line
    .replace(/^\s*On\b/i, "")
    .replace(/\bwrote:\s*$/i, "")
    .trim();
  const withoutAddress = inner.replace(/<[^>]*>/g, "").trim();
  const parts = withoutAddress.split(/\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?\b/i);
  const tail = parts.length > 1 ? parts[parts.length - 1] : "";
  const who = tail.replace(/^[,\s]+/, "").replace(/[,\s]+$/, "").trim();
  const address = inner.match(/<([^>]+)>/);
  const from = who || (address ? address[1] : "");
  const sent = from ? withoutAddress.slice(0, withoutAddress.lastIndexOf(from)).replace(/[,\s]+$/, "").trim() : withoutAddress;
  return { from: cleanName(from), sent };
}

/** One message's lines → its header fields and its own text. */
function parseMessage(segment: string[]): ThreadMessage {
  let i = 0;
  let from = "";
  let to = "";
  let cc = "";
  let sent = "";
  let subject = "";

  if (WROTE_LINE.test(segment[0] ?? "")) {
    const parsed = readWroteLine(segment[0]);
    from = parsed.from;
    sent = parsed.sent;
    i = 1;
  } else {
    if (ORIGINAL_MESSAGE.test(segment[0] ?? "") || SEPARATOR_RULE.test(segment[0] ?? "")) i = 1;
    while (i < segment.length && !segment[i].trim()) i++;
    let key = "";
    for (; i < segment.length; i++) {
      const header = segment[i].match(/^\s*([A-Za-z-]+)\s*:\s*(.*)$/);
      if (header && HEADER_LINE.test(segment[i])) {
        key = header[1].toLowerCase();
        const value = header[2].trim();
        if (key === "from") from = value;
        else if (key === "to") to = value;
        else if (key === "cc") cc = value;
        else if (key === "sent" || key === "date") sent = value;
        else if (key === "subject") subject = value;
        continue;
      }
      if (key && segment[i].trim() && /^\s+\S/.test(segment[i])) {
        // A long recipient list wraps onto the next line, indented.
        const more = segment[i].trim();
        if (key === "from") from = `${from} ${more}`;
        else if (key === "to") to = `${to} ${more}`;
        else if (key === "cc") cc = `${cc} ${more}`;
        continue;
      }
      break;
    }
  }

  const body = segment
    .slice(i)
    .map((line) => line.replace(/^\s*>+\s?/, ""))
    .join("\n")
    .trim();
  return { from: cleanName(from), to: people(to), cc: people(cc), sent, subject, body };
}

/** A header's recipient list, names preferred over addresses. */
function people(raw: string): string {
  return (raw || "")
    .split(/;|,(?![^<]*>)/)
    .map((one) => cleanName(one))
    .filter(Boolean)
    .join(", ");
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
 * Split a message body into the person's own words and the thread below them.
 *
 * `signature` is their saved signature as plain text; pass "" when they haven't
 * set one and it is left alone, since without a copy to compare against there
 * is no safe way to tell a signature from a closing paragraph. Passing "" is
 * also right for a message that arrived: the signature in it belongs to whoever
 * sent it, and it is part of what they wrote.
 */
export function splitComposeBody(body: string, signature = ""): SplitBody {
  const lines = (body || "").split(/\r?\n/);
  const starts = quoteBoundaries(lines);
  const cut = starts.length ? starts[0] : -1;
  const mineLines = cut === -1 ? lines : lines.slice(0, cut);
  const quoted = cut === -1 ? "" : lines.slice(cut).join("\n").trim();

  const sig = signature ? signatureStart(mineLines, signature) : -1;
  const kept = sig === -1 ? mineLines : mineLines.slice(0, sig);

  return { mine: kept.join("\n").trim(), quoted };
}

/** Every message in a quoted thread, newest first. */
export function splitThread(quoted: string): ThreadMessage[] {
  const text = (quoted || "").trim();
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  const starts = quoteBoundaries(lines);
  // No markers at all: it is one message, however it got here.
  if (!starts.length) return [{ from: "", to: "", cc: "", sent: "", subject: "", body: text }];

  const out: ThreadMessage[] = [];
  for (let k = 0; k < starts.length; k++) {
    const end = k + 1 < starts.length ? starts[k + 1] : lines.length;
    out.push(parseMessage(lines.slice(starts[k], end)));
  }
  return out.filter((m) => m.from || m.sent || m.subject || m.body.trim());
}

/**
 * The thread as the model should see it: every message with its own sender on
 * it, and exactly one marked as the one being answered.
 *
 * A single message needs none of this scaffolding and reads better without it,
 * so it comes back as a plain headed email. The numbering only appears when
 * there is actually something to confuse.
 */
export function threadForPrompt(messages: ThreadMessage[], target = 0): string {
  if (!messages.length) return "";

  if (messages.length === 1) {
    const only = messages[0];
    const head = [
      only.from && `From: ${only.from}`,
      only.to && `To: ${only.to}`,
      only.cc && `Cc: ${only.cc}`,
      only.sent && `Sent: ${only.sent}`,
      only.subject && `Subject: ${only.subject}`,
    ]
      .filter(Boolean)
      .join("\n");
    return head ? `${head}\n\n${only.body}` : only.body;
  }

  const pick = Math.min(Math.max(target, 0), messages.length - 1);
  const header = `One thread, ${messages.length} messages, newest first. MESSAGE ${
    pick + 1
  } is the one being answered — reply to that one, greet its sender, and treat the rest as history.`;
  const blocks = messages.map((message, i) => {
    const who = message.from || "unknown sender";
    const when = message.sent ? `, ${message.sent}` : "";
    const mark =
      i === pick
        ? "   <<< ANSWER THIS ONE. Greet this sender."
        : i === 0
          ? "   (most recent)"
          : "";
    const sent = [message.to && `to ${message.to}`, message.cc && `cc ${message.cc}`]
      .filter(Boolean)
      .join(", ");
    const line = sent ? `\n(${sent})` : "";
    return `--- MESSAGE ${i + 1}, from ${who}${when}${mark} ---${line}\n${message.body}`;
  });
  return [header, ...blocks].join("\n\n");
}
