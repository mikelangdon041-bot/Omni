// Every figure in the notes is one somebody said
// (groundFigures in src/lib/meetingprep/captureAi.ts).
//
// The real case: notes for an MSL 1:1 read "July had 28; August and September
// had 14 each, giving a target of 56 for the quarter". 28, 14 and 14 were what
// had been logged in the activity log, which Santan had to be brought into line
// with. 56 was nobody's number: the model added the counts and called the sum a
// target. The target actually given was 20 to 25 a month.
//
// The transcript below is written from the user's own account of that meeting.
// Deterministic checks, then one check-model call.
//
//   npx -y tsx scripts/check-figures.ts

import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

const TRANSCRIPT = `Speaker A: Let's look at the activity log for Q3.
Speaker B: In the activity log I've got July at 28, that includes the presentation with Kristen, and then August and September are 14 each.
Speaker A: OK. And Santan doesn't match that, right?
Speaker B: No, Santan is behind. I'll update it so it matches the activity log.
Speaker A: Good. And just so you know, the target is twenty to twenty-five a month.
Speaker B: Got it.`;

// The stored notes from the real meeting, this topic only.
const NOTES =
  "<ul><li>Q3 scientific-exchange totals set the catch-up target.<ul><li>July had 28 (including a presentation with Kristen); August and September had 14 each, giving a target of 56 for the quarter.</li><li>Starting around April (new in role): April 23, May 15, with low early counts attributed to being new.</li></ul></li></ul>";

let failed = 0;
const report = (ok: boolean, what: string) => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}`);
};
const plain = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

async function main() {
  const { unsaidFigures, groundFigures } = await import("@/lib/meetingprep/captureAi");

  // Deterministic: what gets flagged.
  const flagged = unsaidFigures(NOTES, TRANSCRIPT);
  console.log("flagged:", flagged);
  report(flagged.includes("56"), "56 is flagged: nobody said it");
  report(!flagged.includes("28") && !flagged.includes("14"), "28 and 14 are not: they were said");
  report(flagged.includes("23") && flagged.includes("15"), "April 23 and May 15 are flagged: not in this transcript");
  report(
    unsaidFigures("<li>The target is 20 to 25 a month.</li>", TRANSCRIPT).length === 0,
    "spelled-out numbers count as said (twenty, twenty-five)",
  );
  report(
    unsaidFigures("<li>Cleanup covers 2026 entries.</li>", "").length === 0,
    "years are not checked",
  );

  // The model: fixes just those sentences.
  const fixed = await groundFigures(NOTES, TRANSCRIPT);
  console.log("\nBEFORE: " + plain(NOTES) + "\nAFTER:  " + plain(fixed) + "\n");
  report(!/target of 56|56[^.]*target/i.test(plain(fixed)), "56 is no longer called a target");
  report(/28/.test(fixed) && /14/.test(fixed), "the counts that were said stay");
  report(
    fixed.includes("Q3 scientific-exchange totals set the catch-up target."),
    "sentences with no unsaid figure are untouched",
  );
  report(!/\b23\b|\b15\b/.test(plain(fixed)), "April 23 and May 15, unsupported here, come out");

  console.log(failed ? `\n${failed} failed` : "\nall passed");
  process.exit(failed ? 1 : 0);
}

void main();
