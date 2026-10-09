// Every follow-up has a home in the notes, and remembered spellings are used
// (src/lib/meetingprep/captureAi.ts).
//
// The failure this guards against: a meeting's last few minutes produced
// nothing but a to-do ("update the system and keep it current"), the prompt
// said a commitment is not a note, and that topic vanished from the notes. The
// follow-up was left mentioning a word the notes never explain.
//
// The transcript is made up, shaped like the one that did it. Two
// writer-model calls (one without spellings, one with), each followed by the
// quick-model coverage check, plus one more coverage check on its own.
//
//   npx -y tsx scripts/check-capture-followups.ts [path/to/captureAi.ts]
//
// Pass another copy of captureAi.ts (an older commit, say) to run that one
// instead and see the difference.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

const TRANSCRIPT = `Speaker A: OK so let's start with the activity log. Where are you on NPSE?
Speaker B: NPSE is up to date. Everything through September is in.
Speaker A: Good. What about the other scientific exchange, the face to face and the phone calls?
Speaker B: Honestly not great. I have notes for most of them, I just never put them in the monthly log.
Speaker A: OK, so go back and enter those from your notes. Emails don't count, only face to face or phone.
Speaker B: Got it. In the activity log July is 28, August and September are 14 each.
Speaker A: And Santan doesn't match that yet. Get Santan updated so it lines up with the activity log.
Speaker B: Will do.
Speaker A: For reference, the target is twenty to twenty-five a month.
Speaker B: Makes sense.
Speaker A: Next thing, travel. You're in Utah next week?
Speaker B: Yes, Salt Lake and Sandy. I'll drive Monday, meetings Tuesday.
Speaker A: And the endo nurses conference is the same week. ADCES is November.
Speaker B: Right, ADCES is the diabetes one. Registration is cheap and a lot of the doctors are going.
Speaker A: Worth it then. Now territory. Michelle's area split, so some of North LA is coming to you.
Speaker B: Yeah, Dr. Nguyen and John Gilbert came over. Dr. Sharma was already mine.
Speaker A: Some emails are still going to Shelby, so watch for overlap. Last week a contact got emailed by both of you.
Speaker B: I saw that. I'll clean up the 2026 entries and confirm everyone's been reached.
Speaker A: Good. And Dr. He sent an MIRF straight in. He's a speaker, wants a sit-down in LA.
Speaker B: Cross territory?
Speaker A: Yes, but it's approved. Set it up.
Speaker B: Will do.
Speaker A: Great. Oh, and update Santan, keep it current. I'll check in on it in our meetings.
Speaker B: Yep.
Speaker A: OK, that's it, thanks.`;

const path = resolve(process.argv[2] || "src/lib/meetingprep/captureAi.ts");

async function main() {
  const mod = await import(pathToFileURL(path).href);
  const capture = mod.captureFromTranscript as (i: Record<string, unknown>) => Promise<{
    notes: string;
    actions: string[];
  }>;

  let failed = 0;
  const report = (ok: boolean, what: string) => {
    if (!ok) failed++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${what}`);
  };
  const plain = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

  console.log(`Using ${path}\n`);

  // 1. No spellings: the Santan topic must be in the notes, not only in a follow-up.
  const a = await capture({ transcript: TRANSCRIPT, hint: "1:1 with my manager" });
  console.log("NOTES:\n" + plain(a.notes) + "\n\nFOLLOW-UPS:\n" + a.actions.map((x) => "- " + x).join("\n") + "\n");
  const santanActions = a.actions.filter((x) => /santan/i.test(x));
  report(santanActions.length > 0, "a follow-up about Santan exists");
  report(/santan/i.test(plain(a.notes)), "the notes say what Santan is about");
  // The figures, which the real meeting got wrong: the logged counts are not
  // a target, and the target is per month.
  report(!/56/.test(plain(a.notes)) || !/56[^.]*target|target[^.]*56/i.test(plain(a.notes)), "the logged counts are never summed into a target");
  report(/(20|twenty)\D{1,12}(25|twenty.five)[^.]*month/i.test(plain(a.notes)), "the stated target is there, per month");

  // 2. With a remembered spelling: the wrong word is gone everywhere.
  if (path.endsWith("captureAi.ts") && !process.argv[2]) {
    const b = await capture({
      transcript: TRANSCRIPT,
      hint: "1:1 with my manager",
      spellings: [{ wrong: "Santan", right: "Veeva" }],
    });
    console.log("\nWITH SPELLINGS, FOLLOW-UPS:\n" + b.actions.map((x) => "- " + x).join("\n") + "\n");
    const all = plain(b.notes) + " " + b.actions.join(" ");
    report(!/santan/i.test(all), "no 'Santan' left in notes or follow-ups");
    report(/veeva/i.test(plain(b.notes)) && b.actions.some((x) => /veeva/i.test(x)), "'Veeva' in both notes and follow-ups");
  }

  // 3. The backstop: every follow-up is judged against the notes by what it
  //    is about. One that names something missing (Santan) and one in plain
  //    words (the hotel, with the Utah trip dropped from the notes) both get a
  //    bullet. One the notes already cover (Dr. He) does not. Nothing already
  //    there changes. Notes shaped like the real meeting, shortened.
  if (mod.coverFollowUps) {
    const dropped =
      "<ul><li>Territory splits are causing NPSE confusion.<ul><li>Dr. Nguyen and John Gilbert are inherited contacts.</li></ul></li><li>A Dr. He MIRF prompts a cross-territory meeting.<ul><li>Approval appears granted.</li></ul></li></ul>";
    const follow = [
      "Arrange the LA sit-down with Dr. He.",
      "Update Santan and keep it current, with Zach checking in on it during meetings.",
      "Drive to Utah on Monday and hold the Tuesday meetings.",
    ];
    const fixed: string = await mod.coverFollowUps(dropped, follow, TRANSCRIPT);
    const added = fixed.slice(dropped.lastIndexOf("</ul>"));
    console.log("\nADDED: " + plain(added));
    report(
      fixed.startsWith(dropped.slice(0, dropped.lastIndexOf("</ul>"))),
      "the notes already there are untouched",
    );
    report(/santan/i.test(plain(added)), "a Santan bullet is added (names something missing)");
    report(/utah|salt lake|sandy/i.test(plain(added)), "a Utah bullet is added (plain words, no missing name)");
    report(!/dr\. he\b/i.test(plain(added)), "nothing added for Dr. He, which the notes cover");
  }

  console.log(failed ? `\n${failed} failed` : "\nall passed");
  process.exit(failed ? 1 : 0);
}

void main();
