// The guard that throws away research notes which are really an apology for
// a failed search (src/lib/meetingprep/briefAi.ts). Both cases below are real
// output from the search tool erroring and from it working. No API call.
//
//   npx -y tsx scripts/check-research-guard.ts

import { researchIsAnApology } from "@/lib/meetingprep/briefAi";

const APOLOGY = `Search access has been unavailable throughout this session despite repeated attempts — every call returned a tool-limit error, including on fresh attempts. I was not able to retrieve live results on the Nexus conference, the named panel, or current medical affairs industry data.

What I can flag plainly, without citation, since it's not search-derived:

No confirmed details found: I could not verify the specific Nexus conference (there are multiple industry events using that name), the identities or bios of the panelists, or any 2025-dated statistics on medical affairs.`;

const GOOD = `Medical Affairs is being reframed as a "third strategic pillar" alongside R&D and Commercial (McKinsey, 2025). MSL role is shifting toward specialty and rare disease work (medicalaffairsspecialist.org, 2025).

AI and data are the dominant 2025 conference theme (Inizio, 2025). No single source gives a hard adoption number for AI in Medical Affairs; treat cited stats as directional. I could not confirm the panel's final line-up.

Open questions in the field:
Whether Medical Affairs should own enterprise scientific data strategy.`;

const cases: [string, string, boolean][] = [
  ["every search errored", APOLOGY, true],
  ["real findings, one unconfirmed detail", GOOD, false],
  ["empty", "", false],
];

let failed = 0;
for (const [name, notes, want] of cases) {
  const got = researchIsAnApology(notes);
  console.log(`${got === want ? "ok  " : "FAIL"}  ${name}: apology=${got}, want=${want}`);
  if (got !== want) failed++;
}
console.log(failed ? `${failed} failed` : "checks passed");
if (failed) process.exitCode = 1;
