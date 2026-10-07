// The follow-up email (src/lib/meetingprep/recapAi.ts), against a real
// meeting's notes.
//
// What it guards against, all of which the old recap did: a closing line
// asking to be corrected, which reads as not trusting the people you met;
// semicolons and dashes, which read as a machine; and no way to steer it, so
// "only the Utah trip" or "keep it short" meant rewriting it by hand.
//
// Four or more writer-model calls: a plain draft, one with instructions, a redo
// of the first draft, and one signed by an account handle (plus a cut pass
// whenever a short draft comes back long).
//
//   npx -y tsx scripts/check-recap.ts <meeting.json>
//
// meeting.json: { "title", "notes" (HTML), "actions" ([{text}] or a JSON
// string of it) }, as selected from mp_meetings.

import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

const DISTRUST = /missed or misstated|if i('|’)ve missed|let me know if i missed|correct me|anything i got wrong|misremembered/i;
const MACHINE = /[;—–]|--|\b(delve|furthermore|moreover|additionally|leverage|hope this (email )?finds you)\b/i;
// Said in the meeting, not for an email to the people in it.
const AWKWARD = /\bbehave\b|scrutin/i;

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

async function main() {
  const { writeRecap } = await import("@/lib/meetingprep/recapAi");
  const m = JSON.parse(readFileSync(process.argv[2], "utf8").replace(/^﻿/, ""));
  const actions = (typeof m.actions === "string" ? JSON.parse(m.actions) : m.actions).map(
    (a: { text: string }) => a.text,
  );
  const base = { notes: m.notes, actions, title: m.title, when: "10/7/2026", sender: "Zach" };

  let failed = 0;
  const report = (ok: boolean, what: string) => {
    if (!ok) failed++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${what}`);
  };
  const common = (label: string, body: string) => {
    report(!DISTRUST.test(body), `${label}: does not ask to be corrected`);
    const hit = body.match(MACHINE);
    report(!hit, `${label}: no semicolons, dashes or stock phrases${hit ? ` (found "${hit[0]}")` : ""}`);
    report(!AWKWARD.test(body), `${label}: leaves out the remark about behaving`);
    report(/\bZach\s*$/.test(body.trim()), `${label}: signed by the sender`);
    // None of these follow-ups name an owner, and one names the sender as the
    // person checking in, so the logging is not the sender's to promise.
    const claimed = body.match(/\bI['’]ll (go back and )?(log|close out|arrange|update)/i);
    report(!claimed, `${label}: does not claim unowned follow-ups for the sender${claimed ? ` ("${claimed[0]}")` : ""}`);
  };

  const a = await writeRecap(base);
  console.log(`\n--- plain (${words(a.body)} words) ---\nSubject: ${a.subject}\n\n${a.body}\n`);
  common("plain", a.body);

  const b = await writeRecap({
    ...base,
    guidance: "Only talk about the Utah trip and the conferences. Keep it short.",
  });
  console.log(`\n--- guided (${words(b.body)} words) ---\nSubject: ${b.subject}\n\n${b.body}\n`);
  common("guided", b.body);
  report(/utah|salt lake|sandy/i.test(b.body), "guided: is about the Utah trip");
  report(!/npse|mirf|dr\. he\b|santan|q3|territory/i.test(b.body), "guided: leaves out everything else");
  report(words(b.body) < words(a.body) && words(b.body) <= 90, "guided: short");

  const c = await writeRecap({ ...base, previous: a.body, guidance: "make it shorter" });
  console.log(`\n--- redo of plain, shorter (${words(c.body)} words) ---\n${c.body}\n`);
  common("redo", c.body);
  report(words(c.body) < words(a.body), "redo: shorter than the draft it changed");

  // An account handle is not a name to sign an email with.
  const d = await writeRecap({ ...base, sender: "zbalmuth", guidance: "short" });
  console.log(`\n--- sender is a handle ---\n${d.body}\n`);
  report(!/zbalmuth/i.test(d.body), "handle: never signs with the account handle");

  console.log(failed ? `\n${failed} failed` : "\nall passed");
  process.exit(failed ? 1 : 0);
}

void main();
