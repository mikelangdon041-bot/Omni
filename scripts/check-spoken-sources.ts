// The name-drop detector (src/lib/meetingprep/spokenSources.ts), checked
// both ways.
//
// It has to catch the lines the writer has twice asked not to be given, and
// it has to leave alone the perfectly good questions that happen to contain a
// capital letter followed by "says". A detector that fires on "Everyone says
// the evidence wins" would quietly delete real questions, which is worse than
// the problem it fixes.
//
// No model calls.
//
//   npx -y tsx scripts/check-spoken-sources.ts

import { allowedNames, namedSource, sourceNames } from "@/lib/meetingprep/spokenSources";

// Real offenders. The first two came out of the writer's own bank, written
// AFTER the prompt was fixed and their instruction was moved above it.
const MUST_CATCH = [
  "McKinsey says whoever masters combining and interpreting evidence wins the field. In your own shop, are you actually there?",
  "According to a recent report, most medical affairs teams cannot show their value. Why not?",
  "Gartner put it well when they called this the last mile problem. Do you buy that?",
  "Deloitte's 2025 survey says scientific exchange is undervalued. Is it?",
  "IQVIA data shows engagement is falling. What are you seeing?",
  "A study by Veeva found that half of teams have no measurement at all. Does that match you?",
  "Research from Forrester suggests the budget moves next year. Does it?",
  "Per the Harvard Business Review framing, is value communication a marketing job now?",
  // Got through the first cut of this file: the list had the firm's full name
  // and the question used its initials.
  "ZS talks about a decision flywheel. Where is your line between mining insight and carrying it outward?",
  "BCG frames this as a last mile problem. Is it?",
  // Spoken setups from a house that is on no list, named by its document or
  // by a verb the first version did not know.
  "The Umbrex playbook makes the point bluntly: counting advisory boards, none of it matters unless it moves trust. So let's force the prioritization.",
  "Umbrex makes the point bluntly that counting visits means nothing.",
  "There's a new Acme Insights framework doing the rounds that says belief shift is the outcome.",
];

// Questions that must get through untouched.
const MUST_PASS = [
  "Everyone says the evidence wins. What does winning on evidence actually look like on a Tuesday?",
  "Nobody says this out loud, so I will: is scientific exchange just marketing with references?",
  "What does the FDA actually require you to show here, and what are you adding on top of that?",
  "How do you read the NICE position on real world evidence?",
  "The data says one thing and the field says another. Which do you trust?",
  "Your team says they are measured on reach. Should they be?",
  "If the CFO asked you tomorrow what scientific exchange returned last year, what would you say?",
  "Who in your organisation decides what counts as a meaningful outcome?",
  "What is the hardest conversation you have had with a KOL in the last year?",
  "Medical says access is the blocker, commercial says medical is. Who is right?",
  // The initials check must not fire inside ordinary words.
  "They survey the key accounts every quarter. What does that actually tell you?",
  "Is the real bottleneck money, people, or the authority to decide?",
  "The AstraZeneca Spain real world evidence work served patients and the company at once. Can one programme honestly do both?",
  // Setups that carry a finding without a name, the way they are meant to.
  "Here's what I keep running into with the word value. In one global survey of medical affairs professionals, value and impact weren't even the same thing to people.",
  "In a 2023 report, field medical leaders said activity metrics were their main measured KPI, and yet they rated them only 6% important.",
  "People have tried the Delphi method, rounds of expert consensus, to agree on what MSL metrics should even be.",
  "The 2030 vision for this function is about moving from executing to actually shaping strategy.",
  "A lot of the proposed answer to the measurement problem is a more mature framework, activity plus quality plus outcomes.",
  "The data shows something odd: the internal work is rated above the external work.",
  "One finding that complicates this whole panel is that respondents rate internal communication higher.",
];

// A name from the room is not a name-drop: asking someone about their own
// employer's position is the whole job.
const ROOM = allowedNames([
  { name: "Sarah Chen", org: "Veeva" },
  { name: "Dr Raj Patel", org: "Novartis" },
]);
const ALLOWED_IN_ROOM = [
  "Sarah, Veeva sells the measurement layer here. What does your own data say that your marketing does not?",
  "Raj, how does Novartis decide what a meaningful outcome is?",
];

function main() {
  const problems: string[] = [];

  for (const line of MUST_CATCH) {
    const hit = namedSource(line);
    if (!hit) problems.push(`MISSED: ${line.slice(0, 70)}`);
    else console.log(`caught  [${hit}]  ${line.slice(0, 62)}…`);
  }

  for (const line of MUST_PASS) {
    const hit = namedSource(line);
    if (hit) problems.push(`FALSE POSITIVE on "${hit}": ${line.slice(0, 70)}`);
    else console.log(`passed        ${line.slice(0, 62)}…`);
  }

  for (const line of ALLOWED_IN_ROOM) {
    const hit = namedSource(line, ROOM);
    if (hit) problems.push(`FLAGGED SOMEONE IN THE ROOM ("${hit}"): ${line.slice(0, 60)}`);
    else console.log(`in the room   ${line.slice(0, 62)}…`);
  }

  // The reading list's own publishers, whoever they are. Umbrex is on no
  // list of famous houses and got through a setup in the wrong word order.
  const houses = sourceNames(["Umbrex", "Medical Affairs Professional Society (MAPS)", "Medical Affairs Specialist", "PMC (companion paper, same 2025 MSL Society survey)"]);
  for (const [line, should] of [
    ["The Umbrex work makes the point bluntly that counting is not enough.", true],
    ["What MAPS calls the impact model, does it survive a budget meeting?", true],
    ["Medical affairs maps onto commercial priorities more than anyone admits. Does it?", false],
    ["As a medical affairs specialist, what would you cut first?", false],
  ] as const) {
    const hit = namedSource(line, [], houses);
    if (Boolean(hit) !== should)
      problems.push(`${should ? "MISSED reading-list name" : `FALSE POSITIVE on "${hit}"`}: ${line.slice(0, 60)}`);
    else console.log(`${should ? `caught  [${hit}]` : "passed       "}  ${line.slice(0, 62)}…`);
  }

  // The allow list must not be a blanket amnesty: a vendor in the room does
  // not make a different consultancy citable.
  if (!namedSource("McKinsey says the field has moved. Has it?", ROOM))
    problems.push("the allow list let an unrelated consultancy through");

  console.log(
    problems.length ? `\nPROBLEMS:\n- ${problems.join("\n- ")}` : "\nchecks passed",
  );
  if (problems.length) process.exitCode = 1;
}

main();
