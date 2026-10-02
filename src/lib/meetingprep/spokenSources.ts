// Catching a name-drop in a question before the writer ever sees it.
//
// The writer asked, twice, for questions to stop opening with a consultancy's
// name. The first time the prompt was fighting itself and that was a real bug.
// The second time the prompt was right — the rule was in the system prompt,
// their own instruction was above it and said so, and the model was told to
// read its draft back question by question — and one in twenty two still came
// out as "McKinsey says whoever masters combining and interpreting evidence
// wins the field."
//
// So: stop asking. A rule the output has to pass is a check, not a sentence in
// a prompt. This module is that check, and it runs on every batch whether or
// not the writer has ever given an instruction, because nobody wants to read
// the question out that way.

/**
 * Houses whose name inside a spoken question is a name-drop by definition:
 * consultancies, analysts, the trade press, business-school brands, the
 * pharma data and services firms. Not regulators, not clinical bodies, not
 * guideline issuers — "what does the FDA actually require here" and "how do
 * you read the NICE position" are the questions, not decoration on one.
 */
const NAMED_HOUSES = [
  "mckinsey",
  "bcg",
  "boston consulting",
  "bain",
  "deloitte",
  "accenture",
  "pwc",
  "pricewaterhouse",
  "kpmg",
  "ernst & young",
  "ernst and young",
  "oliver wyman",
  "l.e.k.",
  "zs associates",
  "iqvia",
  "mckinsey & company",
  "veeva",
  "indegene",
  "syneos",
  "parexel",
  "across health",
  "gartner",
  "forrester",
  "idc",
  "nielsen",
  "ipsos",
  "kantar",
  "statista",
  "harvard business review",
  "mit sloan",
  "fierce pharma",
  "endpoints news",
  "stat news",
  "evaluate pharma",
  "informa",
  "reuters events",
];

/**
 * The same houses as initials. These need word boundaries, not a substring
 * match: "ey" is inside "they", "survey" and "key", and a detector that eats
 * a good question is worse than the tic it was built to catch.
 *
 * "ZS talks about a decision flywheel" got through the first version of this
 * file, because the list had "zs associates" and the question said "ZS".
 */
const INITIALS = /\b(?:zs|ey|hbr|bcg|pwc|kpmg|idc|bain|wef)\b/i;

/**
 * Capitalised words that open a sentence without being anybody's name, so
 * "Everyone says the evidence wins" is a question and not an attribution.
 */
const NOT_A_NAME = new Set(
  [
    "a","all","and","anybody","anyone","as","be","before","but","can","could","did","do","does",
    "each","either","europe","even","every","everybody","everyone","everything","few","finance",
    "for","from","he","her","here","his","how","i","if","in","is","it","its","leadership","many",
    "market","marketing","medical","most","my","neither","no","nobody","none","nothing","now",
    "one","our","people","pharma","research","she","should","some","somebody","someone","something",
    "that","the","their","them","then","there","these","they","this","those","to","us","we","what",
    "when","where","which","while","who","whoever","whom","whose","why","will","would","you","your",
  ].map((w) => w),
);

// "X says", "X found", "X puts it" — an attribution dressed as a clause.
const ATTRIBUTIVE =
  /\b([A-Z][A-Za-z&.'’-]{1,}(?:\s+(?:&\s+)?[A-Z][A-Za-z&.'’-]{1,}){0,2})\s+(?:says|said|argues|argued|claims|claimed|reports|reported|reckons|finds|found|estimates|estimated|predicts|predicted|notes|noted|writes|wrote|calls|puts|talks about|talk about|describes|described|frames|framed|publishes|published|points out|pointed out|has a|have a)\b/g;

// The flat-out citations.
const CITATIONS: RegExp[] = [
  /\baccording to\b/i,
  /\bper (?:a|the|their|its)\b/i,
  /\b(?:a|the|one|that|their|its|recent)\s+(?:\w+\s+){0,2}(?:report|study|survey|paper|analysis|whitepaper|benchmark)\s+(?:by|from)\b/i,
  /\b(?:research|data|figures|findings|numbers|analysis)\s+(?:by|from)\s+[A-Z]/,
  /\b[A-Z][A-Za-z&.'’-]{2,}(?:'s|’s)\s+(?:\d{4}\s+)?(?:report|study|survey|paper|analysis|data|research|benchmark|index)\b/,
];

/**
 * The first named source in a line that is going to be said out loud, or null
 * when there isn't one.
 *
 * `allow` is for names that belong in the room: the people in this meeting,
 * their organisations. Asking the person in front of you about their own
 * company's position is not a name-drop.
 */
export function namedSource(text: string, allow: string[] = []): string | null {
  const line = String(text || "");
  if (!line.trim()) return null;
  const lower = line.toLowerCase();
  const allowed = allow
    .map((a) => a.trim().toLowerCase())
    .filter((a) => a.length > 2);

  for (const house of NAMED_HOUSES) {
    if (!lower.includes(house)) continue;
    // Their own employer is fair game to ask them about.
    if (allowed.some((a) => a.includes(house) || house.includes(a))) continue;
    return house;
  }

  const initials = line.match(INITIALS);
  if (initials && !allowed.some((a) => a.includes(initials[0].toLowerCase())))
    return initials[0];

  for (const re of CITATIONS) {
    const hit = line.match(re);
    if (hit && !allowed.some((a) => hit[0].toLowerCase().includes(a))) return hit[0].trim();
  }

  for (const hit of line.matchAll(ATTRIBUTIVE)) {
    const who = hit[1].trim();
    const parts = who.toLowerCase().split(/\s+/);
    // Every word a common one means it is a turn of phrase, not a source.
    if (parts.every((w) => NOT_A_NAME.has(w.replace(/[^a-z&.'’-]/g, "")))) continue;
    if (allowed.some((a) => a.includes(parts[0]) || who.toLowerCase().includes(a))) continue;
    return who;
  }

  return null;
}

/** Names from the room, which are never a name-drop. */
export function allowedNames(
  attendees: { name?: string; org?: string }[] = [],
): string[] {
  const out: string[] = [];
  for (const a of attendees) {
    for (const part of [a.name, a.org]) {
      const v = (part || "").trim();
      if (v.length > 2) out.push(v);
    }
  }
  return out;
}
