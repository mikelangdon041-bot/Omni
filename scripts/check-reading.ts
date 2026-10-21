// Runs the Reading tab's pieces against a real meeting and checks them:
//   - the reading list: every link one the search returned, findings present,
//     the unsettled points framed for the meeting's seat
//   - a pasted agenda: the writer's session found, its people pulled out
//   - one person looked up
//   - a web page read as material
//   - the read-through: notes about questions name them, notes about the
//     brief quote it word for word
//
// About four model calls and a dozen searches.
//
//   npx -y tsx scripts/check-reading.ts <meeting-id> [--save]
//
// --save writes the reading list back to the meeting. Never the read-through,
// which would replace notes the writer may be working through.

import { readFileSync, writeFileSync } from "node:fs";
import { buildReading, digestMaterial, lookupPerson } from "@/lib/meetingprep/readingAi";
import { reviewPrep } from "@/lib/meetingprep/reviewAi";
import { readUrl } from "@/lib/meetingprep/extractText";
import { htmlToPlain } from "@/lib/writer/types";
import {
  meetingTypeLabel,
  sectionTitle,
  setupFingerprint,
  unsettledHeading,
  type MpMeeting,
  type Reading,
} from "@/lib/meetingprep/types";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

const fails: string[] = [];
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}`);
  if (!ok) fails.push(what);
};
const secs = (t0: number) => `${Math.round((Date.now() - t0) / 1000)}s`;

async function main() {
  const [id] = process.argv.slice(2);
  const save = process.argv.includes("--save");
  // Plain REST: supabase-js wants a WebSocket this Node does not have.
  const base = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/mp_meetings?id=eq.${id}`;
  const headers = {
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  };
  const m = ((await (await fetch(`${base}&select=*`, { headers })).json()) as MpMeeting[])[0];
  const payload = {
    title: m.title,
    topic: m.topic,
    meetingType: meetingTypeLabel(m.meeting_type),
    durationMin: m.duration_min,
    attendees: m.attendees,
    explain: m.explain,
    objectives: m.objectives,
    background: m.background,
    concerns: m.concerns,
  };
  const out: Record<string, unknown> = {};

  // 1. Reading list
  let t0 = Date.now();
  const frame = unsettledHeading(m.meeting_type);
  const reading = await buildReading({ meeting: payload, frame });
  out.reading = reading;
  console.log(`\nreading list (${secs(t0)}): ${reading.sources.length} sources, ${reading.unsettled.length} unsettled`);
  check(reading.overview.length > 200, "overview written");
  check(reading.sources.length >= 4, "at least 4 sources with verified links");
  check(reading.sources.every((s) => /^https?:\/\//.test(s.url)), "every source has a link");
  check(reading.sources.every((s) => s.findings.length >= 2), "every source says what is in it");
  check(reading.sources.some((s) => s.priority === "must"), "some marked must-read");
  check(reading.unsettled.every((u) => u.sides.length >= 2), "each unsettled point has two sides");
  for (const s of reading.sources) console.log(`  [${s.priority}] ${s.title} | ${s.outlet} ${s.date}\n     ${s.url}\n     - ${s.findings.join("\n     - ")}`);
  for (const u of reading.unsettled) console.log(`  ? ${u.point}\n     ${u.sides.map((x) => `${x.position} (${x.who})`).join("\n     ")}`);

  // 1b. Find more, steered, not repeating
  t0 = Date.now();
  const more = await buildReading({
    meeting: payload,
    frame,
    more: true,
    count: 2,
    ask: "hard survey data on how medical affairs teams measure value",
    existing: reading.sources.map((s) => ({ title: s.title, url: s.url })),
    rejected: reading.sources[0] ? [{ title: reading.sources[0].title, url: reading.sources[0].url, reason: "Too general" }] : [],
  });
  console.log(`\nfind more (${secs(t0)}): ${more.sources.map((s) => s.title).join(" | ")}`);
  check(more.sources.length >= 1, "find more returned something");
  check(!more.sources.some((s) => reading.sources.some((r) => r.url === s.url)), "find more did not repeat a source");

  // 2. A pasted agenda
  t0 = Date.now();
  const agenda = `Medical Affairs Leaders Forum 2026, Day 2 programme
08:30-09:15 Keynote: The Medical Affairs Operating Model in 2030. Dr. Helen Ortiz, Chief Medical Officer, Arcadia Bio
09:30-10:30 Panel: Value Communication in Medical Affairs: Turning Scientific Exchange into Meaningful Outcomes
  Moderator: (you)
  Panelists: Priya Raman, VP Global Medical Affairs, Lumen Therapeutics; Marcus Hale, Head of Field Medical Excellence, Novagen; Dr. Sofia Lindqvist, Medical Director, Nordic Health Analytics
  Room: Harbor Ballroom B
10:45-11:30 Workshop: Field Insights at Scale. Tom Becker, Director, Veeva Systems`;
  const dig = await digestMaterial({
    meeting: payload,
    doc: { name: "Day 2 programme", text: agenda, purpose: "agenda", note: "The programme. My session is the 9:30 panel; I need the other panelists." },
  });
  out.agenda = dig;
  console.log(`\nagenda (${secs(t0)}): ${dig.people.map((p) => `${p.name} (${p.role}, ${p.org})`).join("; ")} | session ${JSON.stringify(dig.session)}`);
  const names = dig.people.map((p) => p.name).join(" ");
  check(/Priya/.test(names) && /Marcus/.test(names) && /Lindqvist/.test(names), "found all three panelists");
  check(!/Ortiz|Becker/.test(names), "left out speakers from other sessions");
  check(dig.session.durationMin === 60, "session length worked out from the times");

  // 3. A person
  t0 = Date.now();
  const person = await lookupPerson({
    person: { name: "Garth Sundem", role: "", org: "Medical Affairs Professional Society" },
    subject: m.topic,
  });
  out.person = person;
  console.log(`\nperson (${secs(t0)}): ${person.text}\n  ${person.sources.map((s) => s.url).join("\n  ")}`);
  check(person.text.length > 120, "person lookup wrote something");
  check(person.sources.length >= 1, "person lookup kept a verified source");

  // 4. A web page as material
  t0 = Date.now();
  try {
    const page = await readUrl("https://en.wikipedia.org/wiki/Medical_science_liaison");
    console.log(`\nurl (${secs(t0)}): "${page.name}" ${page.text.length} chars`);
    check(page.text.length > 1000 && /liaison/i.test(page.text), "web page read as text");
  } catch (e) {
    check(false, `web page read: ${(e as Error).message}`);
  }

  // 5. The read-through
  t0 = Date.now();
  const sections = m.brief?.sections || [];
  const briefText = sections.map((s) => `[${s.key}] ${sectionTitle(s.key, s.title)}:\n${htmlToPlain(s.content)}`).join("\n\n");
  const asked = (m.questions?.items || []).filter((q) => !q.deleted);
  const questionsText = asked.map((q, i) => `${i + 1}. (${q.category}) ${q.text}`).join("\n");
  const notes = await reviewPrep({
    meeting: payload,
    briefText,
    questionsText,
    questionCount: asked.length,
    sectionKeys: sections.map((s) => s.key),
    research: m.brief?.research?.notes || "",
  });
  out.review = notes;
  console.log(`\nreview (${secs(t0)}): ${notes.length} notes`);
  for (const n of notes)
    console.log(
      `  - [${n.target}] ${n.title}\n     refs ${JSON.stringify(n.questionRefs)} keep ${n.keepRef} ${n.action || ""}\n     ${n.quotes.map((q) => `"${q}"`).join("\n     ")}${
        n.questionRefs.length ? `\n     Q: ${n.questionRefs.map((r) => asked[r - 1]?.text).join("\n     Q: ")}` : ""
      }`,
    );
  const aboutQs = notes.filter((n) => n.target === "questions");
  check(aboutQs.every((n) => n.questionRefs.length > 0 || n.keepRef > 0), "every note about the questions names them");
  const aboutBrief = notes.filter((n) => n.target.startsWith("section:"));
  check(aboutBrief.filter((n) => n.quotes.length).length >= Math.ceil(aboutBrief.length / 2), "most notes about the brief quote it");

  writeFileSync(`${process.env.TEMP || "."}/check-reading-out.json`, JSON.stringify(out, null, 2));

  if (save) {
    const nowISO = new Date().toISOString();
    const r: Reading = {
      ...(m.reading || {}),
      overview: reading.overview,
      sources: [
        ...((m.reading?.sources || []).filter((s) => s.kind === "yours")),
        ...reading.sources.map((s, i) => ({ ...s, id: `r${Date.now()}${i}`, kind: "found" as const })),
      ],
      unsettled: reading.unsettled.map((u, i) => ({ ...u, id: `u${Date.now()}${i}` })),
      at: nowISO,
      fingerprint: setupFingerprint(m),
    };
    const res = await fetch(base, { method: "PATCH", headers, body: JSON.stringify({ reading: r }) });
    console.log(res.ok ? "\nsaved the reading list to the meeting" : `\nSAVE FAILED: ${res.status} ${await res.text()}`);
  }

  console.log(fails.length ? `\n${fails.length} FAILED` : "\nall passed");
  process.exit(fails.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
