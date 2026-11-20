// "Set up a meeting" in the Outlook pane: the directory import, the name
// matching, and the real model reading three threads into invites.
//
// What it guards against: a directory export read as nothing (Outlook's own
// contacts CSV has ninety columns and "Title" means Mr/Ms); "Shane" put on an
// invite as the wrong Shane, or silently dropped; the user themselves invited
// to their own meeting; "next Thursday" landing on the wrong date; and an
// agenda that needs rewriting before it can be sent.
//
//   npx -y tsx scripts/check-meeting-invite.ts
//
// Three model calls (CHECK_MODEL).

import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

let failed = 0;
function check(ok: boolean, what: string, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}${detail ? `  (${detail})` : ""}`);
  if (!ok) failed++;
}

async function main() {
  const { parseDirectory, resolvePerson, peopleInText } = await import("../src/lib/directory");
  const { planMeeting } = await import("../src/lib/meeting-invite");

  // --- Import -------------------------------------------------------------
  const outlookCsv = [
    '"Title","First Name","Middle Name","Last Name","Suffix","Company","Department","Job Title","E-mail Address","E-mail Type","E-mail Display Name","E-mail 2 Address"',
    '"Mr.","Shane","","O\'Brien","","Acme","Medical Affairs","Director, Medical Strategy","Shane.OBrien@acme.com","SMTP","Shane O\'Brien (Shane.OBrien@acme.com)","shane@gmail.com"',
    '"","Shane","","Patel","","Acme","Market Access","Account Lead","shane.patel@acme.com","SMTP","",""',
    '"","Glenn","","Ross","","Acme","Commercial","VP Sales","glenn.ross@acme.com","SMTP","",""',
    '"","","","","","Acme","","","noreply@acme.com","SMTP","",""',
  ].join("\r\n");
  const fromCsv = parseDirectory(outlookCsv);
  check(fromCsv.length === 3, "Outlook contacts CSV: 3 people, no-reply dropped", String(fromCsv.length));
  const shane = fromCsv.find((p) => p.email === "shane.obrien@acme.com");
  check(shane?.name === "Shane O'Brien", "name from First + Last", shane?.name);
  check(shane?.title === "Director, Medical Strategy", "Job Title, quoted comma kept, not Mr.", shane?.title);
  check(shane?.department === "Medical Affairs", "department", shane?.department);

  const tsv = "Name\tEmail\tRole\nPriya Nair\tpriya.nair@acme.com\tMSL\nTom Li\ttom.li@acme.com\tMSL";
  const fromTsv = parseDirectory(tsv);
  check(fromTsv.length === 2 && fromTsv[0].title === "MSL", "tab-separated paste from Excel");

  const toLine =
    "O'Brien, Shane <Shane.OBrien@acme.com>; \"Ross, Glenn\" <glenn.ross@acme.com>; dana.white@acme.com";
  const fromTo = parseDirectory(toLine);
  check(fromTo.length === 3, "pasted To line: 3 people", String(fromTo.length));
  check(fromTo[0].name === "Shane O'Brien", '"Last, First" turned round', fromTo[0].name);
  check(fromTo[2].name === "Dana White", "bare address named from its local part", fromTo[2].name);

  const quoted = peopleInText(
    "From: Ross, Glenn <glenn.ross@acme.com>\nSent: Monday\nTo: Zak B <zak@acme.com>\nCc: Priya Nair [mailto:priya.nair@acme.com]",
  );
  check(quoted.length === 3 && quoted[0].name === "Glenn Ross", "people read out of quoted headers", JSON.stringify(quoted.map((q) => q.name)));

  // --- Matching -----------------------------------------------------------
  const directory = [...fromCsv, ...fromTsv, { name: "Christopher Hale", email: "chale@acme.com" }];
  const ambiguous = resolvePerson("Shane", "", [], directory);
  check(ambiguous.status === "choose" && ambiguous.options.length === 2, "two Shanes: asks which");
  const onThread = resolvePerson("Shane", "", [{ name: "Shane Patel", email: "shane.patel@acme.com" }], directory);
  check(onThread.person?.email === "shane.patel@acme.com", "the Shane on the thread wins");
  check(resolvePerson("Shane O'Brien", "", [], directory).person?.email === "shane.obrien@acme.com", "full name, apostrophe");
  check(resolvePerson("Chris", "", [], directory).person?.email === "chale@acme.com", "Chris finds Christopher");
  check(resolvePerson("Nobody Here", "", [], directory).status === "unknown", "unknown stays unknown");

  // --- Which Rachel ---------------------------------------------------------
  const me = { name: "Zak B", email: "zak@acme.com", department: "Medical Affairs", company: "Acme US" };
  const rachels = [
    { name: "Rachel Italy", email: "r.italy@acme.it", company: "Acme SpA", department: "Sales" },
    { name: "Rachel Dept", email: "r.dept@acme.com", company: "Acme US", department: "Medical Affairs" },
    { name: "Rachel Report", email: "r.report@acme.com", company: "Acme US", department: "Field", relation: "report" },
    { name: "Rachel Us", email: "r.us@acme.com", company: "Acme US", department: "Finance" },
  ];
  const r1 = resolvePerson("Rachel", "", [], rachels, me);
  check(r1.person?.email === "r.report@acme.com" && r1.options.length === 3, "no history: your report wins, others kept", `${r1.person?.email} / ${r1.why}`);
  const r2 = resolvePerson("Rachel", "", [], rachels.map((p) => (p.email === "r.italy@acme.it" ? { ...p, sent_count: 25 } : { ...p, sent_count: 1 })), me);
  check(r2.person?.email === "r.italy@acme.it", "the one you email most beats the org chart", r2.why);
  const r3 = resolvePerson("Rachel", "", [], rachels.filter((p) => !p.relation), me);
  check(r3.person?.email === "r.dept@acme.com", "then your department", r3.why);
  const r4 = resolvePerson("Rachel", "", [], rachels.filter((p) => !p.relation && p.department !== "Medical Affairs"), me);
  check(r4.person?.email === "r.us@acme.com", "then your company", r4.why);
  const r5 = resolvePerson("Rachel", "", [], [rachels[0], { ...rachels[0], name: "Rachel Other", email: "r.o@acme.it" }], me);
  check(r5.status === "choose", "still level: asks");
  const r6 = resolvePerson("Rachel", "", [], rachels.map((p, i) => ({ ...p, sent_count: i === 0 ? 4 : i === 1 ? 3 : 0 })), me);
  check(r6.person?.email === "r.report@acme.com", "two written to about as often: org chart decides", r6.why);
  const csvRanked = parseDirectory('"Name","Email","Job Title","Department","Company","Relation","Emailed","Last Emailed"\n"Rachel High","r.high@acme.com","MSL","Field","Acme US","report","12","2026-11-02"');
  check(csvRanked[0].sent_count === 12 && csvRanked[0].relation === "report" && csvRanked[0].last_sent === "2026-11-02" && csvRanked[0].email === "r.high@acme.com", "export columns read, Emailed not taken for the address");

  // --- The model ------------------------------------------------------------
  // Friday 20 November 2026.
  const now = "Friday 20 November 2026, 09:15 (Europe/London) [2026-11-20]";
  const meMail = { name: "Zak Balmuth", email: "zak@acme.com" };

  const cases = [
    {
      what: "accepted time, extra person named in the thread",
      thread: `From: Shane O'Brien <shane.obrien@acme.com>
To: Zak Balmuth <zak@acme.com>
Cc: Glenn Ross <glenn.ross@acme.com>
Subject: Q1 KOL advisory board

Zak, Thursday at 2 works for me. Can we use the hour to lock the advisory board agenda, agree the honoraria budget and decide whether Priya runs the logistics? Bring her in too.

Shane

> From: Zak Balmuth
> Could you do Wednesday 10am or Thursday 2pm next week to plan the Q1 advisory board?`,
      people: [
        { name: "Shane O'Brien", email: "shane.obrien@acme.com" },
        { name: "Zak Balmuth", email: "zak@acme.com" },
        { name: "Glenn Ross", email: "glenn.ross@acme.com" },
      ],
      request: "",
      expect: (p: Awaited<ReturnType<typeof planMeeting>>) => {
        const emails = p.attendees.map((a) => a.person?.email);
        check(p.start === "2026-11-26T14:00", "Thursday 2pm next week = 26 Nov 14:00", p.start);
        check(p.durationMinutes === 60, "the hour", String(p.durationMinutes));
        check(emails.includes("shane.obrien@acme.com") && emails.includes("glenn.ross@acme.com"), "Shane and Glenn invited");
        check(emails.includes("priya.nair@acme.com"), "Priya found in the directory", JSON.stringify(p.attendees.map((a) => a.asked)));
        check(!emails.includes("zak@acme.com"), "not inviting myself");
        check(/^- /m.test(p.agenda) && !/agenda:/i.test(p.agenda), "agenda as dash lines");
      },
    },
    {
      what: "the user's line outranks the thread",
      thread: `From: Glenn Ross <glenn.ross@acme.com>
To: Zak Balmuth <zak@acme.com>, Tom Li <tom.li@acme.com>
Subject: Territory numbers

The October numbers for the north territory are well under plan. We should talk about it.`,
      people: [
        { name: "Glenn Ross", email: "glenn.ross@acme.com" },
        { name: "Tom Li", email: "tom.li@acme.com" },
      ],
      request: "30 min with Glenn and Chris on Tuesday at 3, not Tom",
      expect: (p: Awaited<ReturnType<typeof planMeeting>>) => {
        const emails = p.attendees.map((a) => a.person?.email);
        check(p.start === "2026-11-24T15:00", "Tuesday at 3 = 24 Nov 15:00", p.start);
        check(p.durationMinutes === 30, "30 min", String(p.durationMinutes));
        check(emails.includes("chale@acme.com"), "Chris resolved to Christopher Hale", JSON.stringify(emails));
        check(!emails.includes("tom.li@acme.com"), "Tom left off as asked");
      },
    },
    {
      what: "no time anywhere",
      thread: `From: Priya Nair <priya.nair@acme.com>
To: Zak Balmuth <zak@acme.com>
Subject: Speaker training

We should get together at some point to go through the new speaker training deck before it goes to compliance.`,
      people: [{ name: "Priya Nair", email: "priya.nair@acme.com" }],
      request: "",
      expect: (p: Awaited<ReturnType<typeof planMeeting>>) => {
        check(p.start === "", "no invented time", p.start);
        check(p.attendees.length === 1 && p.attendees[0].person?.email === "priya.nair@acme.com", "Priya only");
      },
    },
  ];

  for (const c of cases) {
    console.log(`\n--- ${c.what}`);
    const plan = await planMeeting({
      thread: c.thread,
      subject: "",
      request: c.request,
      now,
      me: meMail,
      onThread: c.people.filter((p) => p.email !== meMail.email),
      directory,
    });
    console.log(JSON.stringify({ ...plan, attendees: plan.attendees.map((a) => `${a.status} ${a.asked} -> ${a.person?.email || a.options.map((o) => o.email).join("|")}${a.optional ? " (optional)" : ""}`) }, null, 2));
    c.expect(plan);
  }

  console.log(failed ? `\n${failed} FAILED` : "\nall passed");
  process.exit(failed ? 1 : 0);
}

void main();
