// Replacing a word, and remembering it for the next meeting
// (src/lib/meetingprep/rename.ts, spellings.ts). No model calls.
//
//   npx -y tsx scripts/check-spellings.ts

import { countMatches, renameInHtml, renameInText } from "@/lib/meetingprep/rename";
import {
  applySpellings,
  canRemember,
  forgetSpelling,
  normalizeSpellings,
  rememberSpelling,
  spellingPromptBlock,
} from "@/lib/meetingprep/spellings";

let failed = 0;
function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n      got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`}`);
}

// Any word, not only names, and whole words only.
check(
  "a misheard system name in a follow-up",
  renameInText("Update Santan and keep it current.", "Santan", "Veeva"),
  "Update Veeva and keep it current.",
);
check("whole words only", renameInText("Zachary met Zach", "Zach", "Sam"), "Zachary met Sam");

// Case: a capital means a proper noun, matched exactly.
check(
  "a name that is also a word leaves the word alone",
  renameInText("Will said he will send it", "Will", "William"),
  "William said he will send it",
);
// All lower case means the word, wherever it sits in a sentence.
check(
  "lower case finds the sentence-start form and keeps the capital",
  renameInText("Santan is behind. Update santan weekly.", "santan", "veeva"),
  "Veeva is behind. Update veeva weekly.",
);
check("count follows the same rule", countMatches("Santan, santan, SANTAN", "santan"), 3);
check("count with a capital is exact", countMatches("Santan, santan", "Santan"), 1);

// Inside HTML only the text changes.
check(
  "html attributes are untouched",
  renameInHtml('<li class="Santan">Santan logging</li>', "Santan", "Veeva"),
  '<li class="Santan">Veeva logging</li>',
);

// First person still works.
check(
  "this was me",
  renameInText("Send Zach the data. Zach's territory.", "Zach", "I"),
  "Send me the data. My territory.",
);

// What can be remembered.
check("a spelling can be remembered", canRemember("Santan", "Veeva"), true);
check("'this was me' is about one meeting", canRemember("Zach", "I"), false);
check("a speaker label is about one recording", canRemember("Speaker A", "Dr. Chen"), false);
check("nothing changed, nothing to remember", canRemember("Veeva", "Veeva"), false);

// Remembering.
let list = rememberSpelling([], "Santan", "Santen");
list = rememberSpelling(list, "MRF", "MIRF");
check("a second correction of the same word replaces the first",
  rememberSpelling(list, "santan", "Veeva").filter((s) => /santan/i.test(s.wrong)),
  [{ wrong: "santan", right: "Veeva" }]);
check("a chain collapses to the last answer",
  rememberSpelling(list, "Santen", "Veeva"),
  [{ wrong: "Santan", right: "Veeva" }, { wrong: "MRF", right: "MIRF" }, { wrong: "Santen", right: "Veeva" }]);
check("forget removes it", forgetSpelling(list, "mrf"), [{ wrong: "Santan", right: "Santen" }]);
check("stored junk is dropped",
  normalizeSpellings([{ wrong: "x", right: "x" }, { wrong: "Speaker B", right: "Sam" }, null, { wrong: "MRF", right: "MIRF" }]),
  [{ wrong: "MRF", right: "MIRF" }]);

// Applied to fresh notes.
const spellings = [{ wrong: "Santan", right: "Veeva" }, { wrong: "MRF", right: "MIRF" }];
check("applied to notes html",
  applySpellings("<ul><li>Santan entries and the MRF queue</li></ul>", spellings, true),
  "<ul><li>Veeva entries and the MIRF queue</li></ul>");
check("applied to a follow-up", applySpellings("Log the MRF in Santan.", spellings), "Log the MIRF in Veeva.");
check("prompt block names each one", spellingPromptBlock(spellings).includes('"Santan" is "Veeva"'), true);
check("no spellings, no prompt block", spellingPromptBlock([]), "");

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
