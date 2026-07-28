// Em dashes are the loudest "a machine wrote this" tell, and prompt guidance
// alone does not stop a model producing them: it complies for a paragraph and
// then relapses. So every generated string is run through here on the way out,
// and the rule stops being a suggestion.
//
// The hard part is that an em dash stands in for four different marks. Swapping
// them all for commas produces comma splices, so this picks the mark the
// sentence actually calls for, by looking at the clause on each side. No model
// call: the whole thing is a few hundred bytes of rules.
//
//   The plan, which we agreed, is fine.     (paired dashes = an aside)
//   We shipped it; the team worked all weekend.   (two full clauses, short)
//   I looked into it. The invoice was never raised.  (two full clauses, long)
//   There is one problem: the budget.       (a clause, then a fragment naming it)
//   It works, mostly.                       (a clause, then a trailing fragment)

const BLOCK_TAG = "<\\/?(?:p|div|li|ul|ol|br|h[1-6])[^>]*>";
// Where one sentence stops and the next begins: terminal punctuation followed
// by a space or a tag, or any block-level tag.
const BOUNDARY = new RegExp(`([.!?;:](?=\\s|<|$))|(${BLOCK_TAG})`, "gi");
const DASH_RUN = /\s*(?:—|–|--)\s*/g;

// Periods that don't end a sentence, so "Dr. Kaplan — we spoke" doesn't get
// read as the fragment "Kaplan".
const ABBREVIATIONS = /\b(?:dr|mr|mrs|ms|prof|sr|jr|st|vs|etc|inc|no|approx|dept|e\.g|i\.e|a\.m|p\.m|[a-z])\.$/i;

const AUXILIARIES = new Set([
  "am", "is", "are", "was", "were", "be", "been", "being", "has", "have", "had",
  "do", "does", "did", "will", "would", "can", "could", "shall", "should", "may",
  "might", "must", "let", "need", "needs", "want", "wants", "wanted",
]);

// Common irregular verbs, which no suffix rule catches.
const VERBS = new Set([
  "go", "goes", "went", "gone", "get", "gets", "got", "make", "makes", "made",
  "take", "takes", "took", "come", "comes", "came", "see", "sees", "saw", "know",
  "knows", "knew", "think", "thinks", "thought", "say", "says", "said", "tell",
  "tells", "told", "give", "gives", "gave", "find", "finds", "found", "keep",
  "keeps", "kept", "put", "puts", "send", "sends", "sent", "run", "runs", "ran",
  "bring", "brings", "brought", "hold", "holds", "held", "leave", "leaves",
  "left", "mean", "means", "meant", "feel", "feels", "felt", "seem", "seems",
  "look", "looks", "cut", "cuts", "set", "sets", "read", "reads", "hit", "hits",
  "cost", "costs", "meet", "meets", "met", "pay", "pays", "paid", "sit", "sits",
  "stand", "stands", "stood", "lose", "loses", "lost", "win", "wins", "won",
]);

const PRONOUNS = new Set([
  "i", "we", "you", "he", "she", "it", "they", "this", "that", "these", "those",
  "there", "here", "who", "which", "everyone", "everything", "nobody", "nothing",
]);

const DETERMINERS = new Set([
  "the", "a", "an", "my", "our", "your", "his", "her", "its", "their", "some",
  "any", "no", "every", "each", "both", "all", "another", "one", "two", "most",
]);

// A dash followed by one of these is joining, not breaking: a comma is the only
// mark that works.
const CONJUNCTIONS = new Set([
  "and", "but", "or", "so", "yet", "nor", "because", "which", "who", "whom",
  "whose", "that", "while", "although", "though", "since", "unless", "until",
  "after", "before", "when", "whenever", "where", "if", "as", "plus", "then",
  "especially", "particularly", "including", "like", "not", "just", "only",
  "even", "again", "still", "hopefully", "ideally", "obviously", "basically",
]);

// Nouns that promise something is about to be named, which is what a colon is
// for: "there is one catch: the timing".
const ANTICIPATORY = new Set([
  "problem", "problems", "issue", "issues", "question", "questions", "reason",
  "reasons", "catch", "thing", "things", "point", "points", "plan", "answer",
  "result", "upshot", "following", "this", "these", "is", "are", "was", "were",
  "means", "includes", "include", "namely", "ask", "goal", "risk", "risks",
  "options", "option", "takeaway", "takeaways", "summary", "detail", "details",
]);

function words(text: string): string[] {
  return text
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .toLowerCase()
    .replace(/[^a-z0-9' ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function hasVerb(text: string): boolean {
  return words(text).some(
    (w) =>
      AUXILIARIES.has(w) ||
      VERBS.has(w) ||
      /'(?:s|re|ve|ll|d|m)$/.test(w) ||
      (w.length > 4 && w.endsWith("ed")) ||
      (w.length > 5 && w.endsWith("ing")),
  );
}

/** A clause that could stand alone as a sentence: something doing something. */
function isIndependent(text: string): boolean {
  const w = words(text);
  if (!w.length || !hasVerb(text)) return false;
  return PRONOUNS.has(w[0]) || DETERMINERS.has(w[0]) || /^[A-Z]/.test(text.trim());
}

/** The sentence fragment running up to `end`, with tags stripped. */
function clauseBefore(text: string): string {
  BOUNDARY.lastIndex = 0;
  let cut = 0;
  for (let m = BOUNDARY.exec(text); m; m = BOUNDARY.exec(text)) {
    // A period inside "Dr." or "e.g." is not the end of anything.
    if (m[1] && ABBREVIATIONS.test(text.slice(Math.max(0, m.index - 6), m.index + 1)))
      continue;
    cut = m.index + m[0].length;
  }
  return text.slice(cut).replace(/<[^>]+>/g, " ").trim();
}

/** The sentence fragment running from the start of `text` to its first boundary. */
function clauseAfter(text: string): string {
  BOUNDARY.lastIndex = 0;
  for (let m = BOUNDARY.exec(text); m; m = BOUNDARY.exec(text)) {
    if (m[1] && ABBREVIATIONS.test(text.slice(Math.max(0, m.index - 6), m.index + 1)))
      continue;
    return text.slice(0, m.index).replace(/<[^>]+>/g, " ").trim();
  }
  return text.replace(/<[^>]+>/g, " ").trim();
}

/**
 * Which mark this dash should have been. `paired` means a matching dash sits in
 * the same sentence, so the two of them are bracketing an aside.
 */
function markFor(
  left: string,
  right: string,
  paired: boolean,
  asSubject: boolean,
  inListItem: boolean,
): string {
  if (!left) return ""; // opened a line: decoration, not punctuation
  if (!right) return ""; // trailed off at the end of one
  if (paired) return ", ";

  const rightWords = words(right);
  const leftWords = words(left);
  const leftClause = isIndependent(left) || hasVerb(left);
  const rightClause = isIndependent(right);

  // A fragment on the left can't take a period or a semicolon after it, so the
  // only question is whether it is announcing what follows. In a subject line
  // or a bullet it always is: "Budget: approved" is the shape of every list
  // ever written. This is settled before the conjunction rule below, or a
  // bullet reading "Timeline, still open" slips through on the "still".
  if (!leftClause)
    return asSubject || inListItem || rightClause || rightWords.length > 3
      ? ": "
      : ", ";

  // "…, but we should talk" — the dash was doing a comma's job all along.
  if (CONJUNCTIONS.has(rightWords[0])) return ", ";

  if (rightClause) {
    // Two complete sentences. A semicolon holds a short pair together; past
    // about a line of text it reads better as two sentences.
    return leftWords.length + rightWords.length <= 16 ? "; " : ". ";
  }

  // Clause, then a fragment. A colon if the clause was promising to name
  // something or hand over a list, otherwise the fragment is just a trailing
  // aside and takes a comma.
  const tail = leftWords.slice(-3);
  const namesSomething = tail.some((w) => ANTICIPATORY.has(w));
  const isList = /,| and /.test(right) && rightWords.length > 2;
  return namesSomething || isList ? ": " : ", ";
}

/** Capitalize the first letter of `text`, skipping over any leading tags. */
function capitalizeFirst(text: string): string {
  return text.replace(/^((?:\s|<[^>]+>)*)([a-z])/, (_, lead, ch) => lead + ch.toUpperCase());
}

export function stripEmDashes(input: string, opts?: { asSubject?: boolean }): string {
  if (!input || !/—|–|--/.test(input)) return input;
  const asSubject = !!opts?.asSubject;

  // A dash between digits is a range, the one honest use of the character.
  const text = input.replace(/(\d)\s*[—–]\s*(?=\d)/g, "$1-");

  const edits: { index: number; length: number; mark: string }[] = [];
  DASH_RUN.lastIndex = 0;
  for (let m = DASH_RUN.exec(text); m; m = DASH_RUN.exec(text)) {
    const before = text.slice(0, m.index);
    const after = text.slice(m.index + m[0].length);
    const left = clauseBefore(before);
    const right = clauseAfter(after);
    // A second dash inside the same sentence means the pair is bracketing an
    // aside, and an aside takes commas whatever the clauses look like.
    const paired = /—|–|--/.test(right) || /—|–|--/.test(left);
    // Inside an open <li> the line is a label, not prose.
    const inListItem = before.lastIndexOf("<li") > before.lastIndexOf("</li");

    let mark = markFor(left, right, paired, asSubject, inListItem);
    // Never stack marks: after existing punctuation the dash was redundant and
    // only its spacing survives.
    if (mark && /[,;:.!?]$/.test(before.trimEnd())) mark = " ";
    edits.push({ index: m.index, length: m[0].length, mark });
  }

  let out = "";
  let cursor = 0;
  let capitalizeNext = false;
  const push = (segment: string) => {
    out += capitalizeNext ? capitalizeFirst(segment) : segment;
    capitalizeNext = false;
  };
  for (const e of edits) {
    push(text.slice(cursor, e.index));
    out += e.mark;
    cursor = e.index + e.length;
    // A new sentence starts here, so what follows needs a capital.
    if (e.mark === ". ") capitalizeNext = true;
  }
  push(text.slice(cursor));

  return out
    .replace(/\s+([,;:.!?])/g, "$1")
    .replace(/([,;:])\s*\1+/g, "$1")
    .replace(/\s{2,}/g, " ")
    .replace(/(<(?:p|li|div)\b[^>]*>|<br\s*\/?>)\s*[,;:]\s*/gi, "$1")
    .replace(/[,;:]\s*(<\/(?:p|li|div)>|<br\s*\/?>)/gi, "$1")
    .replace(/^\s*[,;:]\s*/, "")
    .replace(/[,;:]\s*$/, "");
}
