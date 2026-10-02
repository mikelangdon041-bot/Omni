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

import { allowedNames, namedSource } from "@/lib/meetingprep/spokenSources";

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
