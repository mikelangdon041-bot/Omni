// Finding where someone's words stop and their sign-off block starts.
//
// Every email in a thread carries one, and none of them are worth a token. A
// corporate signature is a dozen lines of job title, street address, two phone
// numbers, a website, a legal disclaimer and a note about printing — repeated
// under every message in the thread, so a four-message thread pays for it four
// times. Worse, inside a compose window Outlook drops the user's own signature
// in before they have typed a word, so "what have they written so far?" answers
// with fourteen lines of letterhead and nothing else.
//
// The pane used to refuse to guess at this, on the reasoning that losing a real
// closing sentence is worse than leaving a signature in, and matched only
// against a signature the user had saved in Omni's settings. That is sound as
// far as it goes, and it is still tried first — but almost nobody has saved one,
// so in practice the guard meant the signature was never stripped at all.
//
// So: guess, but only from evidence. A block is only ever cut when it contains
// at least one thing that cannot be prose — a labelled phone number, a bare
// email address, a street address, a URL on its own line, a "sent from my
// iPhone", a confidentiality notice. Name and job-title lines are swept up only
// because they sit directly above such a thing. Anything that reads like a
// sentence stops the scan cold, which is what keeps a real closing paragraph.

/** "Cheers," / "Best regards," / "Thanks again" — on its own line. */
const SIGN_OFF =
  /^\s*(?:thanks(?:\s+(?:again|so\s+much|a\s+lot|a\s+million|in\s+advance))?|thank\s+you(?:\s+(?:again|so\s+much|kindly))?|many\s+thanks|much\s+appreciated|appreciate\s+it|with\s+thanks|cheers|best|best\s+regards|kind(?:est)?\s+regards|warm(?:est)?\s+regards|regards|sincerely|yours(?:\s+(?:sincerely|truly|faithfully))?|respectfully|cordially|all\s+the\s+best|best\s+wishes|take\s+care|talk\s+soon|speak\s+soon|v\/r|br)\s*[,.!;:–—-]*\s*$/i;

/** The classic plain-text signature delimiter, and its lookalikes. */
const DELIMITER = /^\s*(?:--|__|\*\*|==|~~)[-_*=~\s]*$/;

/** "Mobile: 978-394-3104", "Website: www.example.com". */
const CONTACT_LABEL =
  /^\s*(?:mobile|cell(?:ular)?|phone|telephone|tel|office|direct|desk|fax|work|home|e-?\s?mail|web(?:site)?|url|www|linkedin|twitter|instagram|skype|teams|zoom|address|main|toll[\s-]?free|pronouns|schedule\s+(?:a\s+)?(?:time|call|meeting)|book\s+(?:a\s+)?(?:time|call|meeting))\s*[:|]/i;

/** The same thing abbreviated — "M: 978…", "E: zak@…", "W: www…" — but only
 *  when what follows is actually a number, an address or a link. */
const SHORT_LABEL =
  /^\s*[a-z]\s*[:|]\s*(?:\+?[\d(][\d\s().+-]{6,}|[^\s@]+@[^\s@]+\.\w{2,}|(?:https?:\/\/|www\.)\S+)\s*$/i;

/** An email address, a URL, or a bracketed link, alone on the line. */
const BARE_EMAIL = /^\s*<?[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}>?\s*$/;
const BARE_URL = /^\s*<?(?:https?:\/\/|www\.|mailto:|file:\/\/)\S*>?\s*[.,]?\s*$/i;

/**
 * Outlook's plain-text coercion renders every hyperlink as `label <url>`, so a
 * signature's website line arrives as "www.example.com <http://www.example.com/>".
 * A link inside a real sentence arrives the same way, which is why the label in
 * front of it has to be short and wordless to count — "Please see the deck here
 * <https://…>" is prose with a link in it, not letterhead.
 */
function isLinkLine(line: string): boolean {
  const t = line.trim().replace(/[.,;]$/, "");
  const m = t.match(/^(.*?)<(?:https?:\/\/|mailto:|file:\/\/|tel:)[^>]*>$/i);
  if (!m) return false;
  const label = m[1].trim();
  if (!label) return true;
  return label.length <= 45 && label.split(/\s+/).length <= 4 && !/[.!?]$/.test(label);
}

/** Outlook's own plain-text rendering of an HTML signature links the local
 *  .htm file it was built from. Nothing but a signature ever does this. */
const OUTLOOK_SIGNATURE_FILE = /Microsoft[/\\]Signatures[/\\]/i;

/** A phone number with nothing else on the line. */
const BARE_PHONE = /^\s*\+?[\d(][\d\s().+-]{6,24}(?:\s*(?:x|ext\.?)\s*\d{1,6})?\s*$/i;

/** "440 Route 22, Suite 205" — a number, then something that names a street. */
const STREET =
  /^\s*\d{1,6}[A-Za-z]?\s+[A-Za-z0-9].{2,70}\b(?:street|st|road|rd|avenue|ave|route|rte|drive|dr|lane|ln|boulevard|blvd|way|court|ct|place|pl|suite|ste|floor|fl|unit|parkway|pkwy|highway|hwy|circle|cir|terrace|trail|plaza|square|sq|building|bldg)\b\.?,?(?:\s+.{0,30})?$/i;
const SUITE = /^\s*(?:suite|ste\.?|floor|fl\.?|unit|apt\.?|mail\s?stop|ms\.?|p\.?\s?o\.?\s+box)\b/i;
/** "Bridgewater, New Jersey 08807". */
const CITY_STATE_ZIP =
  /^\s*[A-Za-z][A-Za-z .'-]{1,40},\s*(?:[A-Z]{2}|[A-Za-z][A-Za-z .]{2,24})\s+\d{5}(?:-\d{4})?\s*$/;

/** "Sent from my iPhone", "Get Outlook for Android". */
const SENT_FROM =
  /^\s*(?:sent (?:from|via|using) (?:my|a|an)? ?[\w\s'’.-]{1,40}|get outlook for (?:ios|android)\b.*|download outlook for\b.*)\s*$/i;

/** The bits companies staple on: the printing plea and the legal block. */
const GREEN_LINE = /(?:consider the environment|before printing this|think before you print)/i;
const DISCLAIMER =
  /^\s*\**\s*(?:confidentiality notice|privileged and confidential|disclaimer\b|legal notice|notice\s*:|this\s+(?:e-?mail|message|transmission|communication)\b[^.]{0,140}\b(?:confidential|intended|privileged|proprietary)|the information (?:contained )?in this\b|if you (?:are not|have received)\b)/i;

/**
 * Letterhead: a line that is only ever printed under a message, never written
 * into one. One of these is licence enough to cut.
 */
function isLetterhead(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  return (
    OUTLOOK_SIGNATURE_FILE.test(t) ||
    CONTACT_LABEL.test(t) ||
    SHORT_LABEL.test(t) ||
    CITY_STATE_ZIP.test(t) ||
    SENT_FROM.test(t) ||
    GREEN_LINE.test(t) ||
    DISCLAIMER.test(t)
  );
}

/**
 * A contact detail on its own line. Not licence enough by itself: "here's the
 * deck" followed by a link, "call me on" followed by a number, "the venue is"
 * followed by a street address — each is somebody telling you something, and
 * stripping it loses the only part that mattered. Two of them together, or one
 * next to a line of letterhead, is a signature.
 */
function isContactDetail(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  return (
    BARE_EMAIL.test(t) ||
    BARE_URL.test(t) ||
    isLinkLine(t) ||
    BARE_PHONE.test(t) ||
    STREET.test(t) ||
    SUITE.test(t)
  );
}

/** A line that cannot be part of a sentence someone wrote. */
function isHardSignal(line: string): boolean {
  return isLetterhead(line) || isContactDetail(line);
}

/**
 * A trailing full stop that belongs to an abbreviation rather than to a
 * sentence — "Recordati Rare Diseases, Inc.", "Zak Balmuth-Loris, Ph.D.".
 *
 * Written out rather than listed loosely on purpose: a pattern for the D.O.
 * degree spelled `d\.?\s?o` also matches the word "do", which quietly turned
 * "Will do." into a line of letterhead. Dotless forms are an explicit short
 * list; everything else has to actually carry its dots.
 */
const ABBREVIATION_END =
  /(?:\b(?:inc|llc|ltd|co|corp|plc|gmbh|pty|llp|assoc|dept|esq|jr|sr|ii|iii|iv)\.$|(?:\b[A-Za-z]\.){2,5}$|\bph\.?\s?d\.?$|\bm\.?\s?b\.?\s?a\.?$)/i;

/**
 * Does this read like a sentence? Prose is the hard stop on the way up: a
 * closing paragraph the person actually wrote must never be mistaken for
 * letterhead, so anything sentence-shaped ends the scan where it stands.
 */
function looksLikeProse(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (isHardSignal(t)) return false;
  const words = t.split(/\s+/).length;
  // Two sentences on one line is as plain as this gets.
  if (/[.!?]["')\]]?\s+[A-Z("']/.test(t)) return true;
  if (words >= 12) return true;
  return words >= 7 && /[.!?]["')\]]?$/.test(t) && !ABBREVIATION_END.test(t);
}

/**
 * A name, a job title, a company — the lines that carry no hard signal of their
 * own and are only swept up because a real one sits directly below them. Kept
 * deliberately tight: short, not a sentence, and not ending in a full stop
 * unless that stop belongs to an abbreviation ("Recordati Rare Diseases, Inc.",
 * "Zak Balmuth-Loris, Ph.D.").
 */
function looksLikeNameBlock(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 90) return false;
  if (looksLikeProse(t)) return false;
  if (/[.!?]$/.test(t) && !ABBREVIATION_END.test(t)) return false;
  return true;
}

/** How many unlabelled name/title lines may sit above the block. */
const NAME_LINES = 3;

/**
 * The index where the signature block starts, or -1 when there isn't one.
 *
 * Read from the bottom up: a run of hard signals, then up to three name-ish
 * lines above it, then a sign-off line above that. The first thing that reads
 * like a sentence stops it.
 */
export function guessSignatureStart(lines: string[]): number {
  // An explicit "-- " delimiter says so outright; nothing needs guessing after
  // one. Taken only when it is in the bottom half, so a row of dashes used to
  // underline a heading partway up a message isn't read as the end of it.
  for (let i = Math.max(0, Math.floor(lines.length / 2)); i < lines.length; i++) {
    if (DELIMITER.test(lines[i]) && lines.slice(i + 1).some((l) => l.trim())) return i;
  }

  let top = -1;
  let letterhead = 0;
  let details = 0;
  let names = 0;
  let i = lines.length - 1;
  while (i >= 0) {
    const t = lines[i].trim();
    if (!t) {
      i--;
      continue;
    }
    if (isHardSignal(t)) {
      if (isLetterhead(t)) letterhead++;
      else details++;
      names = 0;
      top = i;
      i--;
      continue;
    }
    // Above the block, and only above it: a bare name or title is allowed to
    // join, a sentence never is.
    if (letterhead + details > 0 && names < NAME_LINES && looksLikeNameBlock(t)) {
      names++;
      top = i;
      i--;
      continue;
    }
    break;
  }

  // One letterhead line proves it; a lone contact detail doesn't, because a
  // message can end on the link or the number it was sent to pass on.
  if (top === -1 || (!letterhead && details < 2)) return -1;

  // "Cheers," belongs to the signature, not to the message. Taken only when it
  // sits directly above what was just found, blank lines allowed between.
  for (let j = top - 1; j >= 0; j--) {
    const t = lines[j].trim();
    if (!t) continue;
    if (SIGN_OFF.test(t)) top = j;
    break;
  }

  return top;
}

/**
 * Everything above the signature, with the signature gone.
 *
 * `saved` is the signature the user stored in Omni's settings, as plain text.
 * When there is one it is matched exactly — that is better evidence than any
 * guess — and whichever of the two cuts higher wins.
 */
export function stripSignature(text: string, saved = ""): string {
  const lines = (text || "").split(/\r?\n/);
  const guessed = guessSignatureStart(lines);
  const exact = saved ? savedSignatureStart(lines, saved) : -1;
  const cut = exact === -1 ? guessed : guessed === -1 ? exact : Math.min(exact, guessed);
  return (cut === -1 ? lines : lines.slice(0, cut)).join("\n").trim();
}

/**
 * Where the signature the user actually saved begins, or -1.
 *
 * Their name is usually its first line, but an image or a "Thanks," can come
 * first, so the first few lines are each tried and the earliest match wins.
 * Last occurrence of each, not the first: a name that turns up in the body ("as
 * Zak mentioned") is not where the signature starts.
 */
export function savedSignatureStart(lines: string[], signature: string): number {
  const needles = signature
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length >= 4)
    .slice(0, 3)
    .map((l) => l.toLowerCase());
  if (!needles.length) return -1;

  let found = -1;
  for (const needle of needles) {
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].trim().toLowerCase() === needle) {
        if (found === -1 || i < found) found = i;
        break;
      }
    }
  }
  return found;
}
