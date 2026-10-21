// Writes the spoken setups (src/lib/meetingprep/questionsAi.ts writeSetups)
// for the questions in a real meeting's list, and a small fresh batch, and
// checks them: no source named aloud, the questions untouched, a setup on
// most of the substantive ones, none longer than four sentences, and figures
// only from the reading. Saves nothing.
//
// Three writer-model calls.
//
//   npx -y tsx scripts/check-setups.ts <meeting-id>

import { readFileSync } from "node:fs";
import { writeQuestions, writeSetups } from "@/lib/meetingprep/questionsAi";
import { withReading } from "@/lib/meetingprep/reading";
import { allowedNames, housesIn, namedSource } from "@/lib/meetingprep/spokenSources";
import { meetingTypeLabel, setupFingerprint, type MpMeeting } from "@/lib/meetingprep/types";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

const fails: string[] = [];
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}`);
  if (!ok) fails.push(what);
};
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

(async () => {
  const id = process.argv[2];
  const h = { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` };
  const m = ((await (await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/mp_meetings?id=eq.${id}&select=*`, { headers: h })).json()) as MpMeeting[])[0];
  const meeting = {
    title: m.title, topic: m.topic, meetingType: meetingTypeLabel(m.meeting_type), durationMin: m.duration_min,
    attendees: m.attendees, explain: m.explain, objectives: m.objectives, background: m.background, concerns: m.concerns,
  };
  const fresh = m.brief?.research?.fingerprint === setupFingerprint(m);
  const research = withReading(fresh ? m.brief?.research?.notes || "" : "", m);
  check(research.includes("The subject in brief"), "the reading's overview reaches the question writer");

  const live = (m.questions?.items || []).filter((q) => !q.deleted);
  const picked = live.filter((q) => q.picked).sort((a, b) => a.order - b.order);
  const list = (picked.length ? picked : live).slice(0, 40);
  let t0 = Date.now();
  const setups = await writeSetups({ meeting, research, questions: list, standing: m.questions?.guidance || "" });
  console.log(`\nsetups for ${list.length} questions (${Math.round((Date.now() - t0) / 1000)}s)\n`);
  const allow = allowedNames(m.attendees);
  const houses = housesIn(research);
  list.forEach((q, i) => console.log(`${i + 1}. ${setups[i] ? `[${setups[i]}]\n   ` : "(bare) "}${q.text}\n`));
  const withOne = setups.filter(Boolean);
  check(setups.length === list.length, "one answer per question");
  check(withOne.length >= Math.ceil(list.length / 2), "most questions got a setup");
  check(withOne.length < list.length || list.length < 4, "not every question was given one");
  check(withOne.every((s) => !namedSource(s, allow, houses)), "no setup names a source");
  check(withOne.every((s) => words(s) <= 90), "every setup sayable: 90 words or fewer");

  t0 = Date.now();
  const batch = await writeQuestions({
    meeting, research, count: 6, existing: live.map((q) => q.text),
    categories: [...new Set(live.map((q) => q.category))], guidance: m.questions?.guidance || "", coverage: m.questions?.coverage || "",
  });
  console.log(`\nfresh batch of ${batch.length} (${Math.round((Date.now() - t0) / 1000)}s)\n`);
  batch.forEach((q, i) => console.log(`${i + 1}. ${q.setup ? `[${q.setup}]\n   ` : "(bare) "}${q.text}\n`));
  check(batch.filter((q) => q.setup).length >= 2, "a fresh batch comes with setups");
  check(batch.every((q) => !namedSource(`${q.setup} ${q.text}`, allow, houses)), "fresh batch names no source aloud");

  // 3. "Questions from this": a batch built on one reading-list source,
  // asked exactly the way the Reading tab asks.
  const src = (m.reading?.sources || [])[0];
  if (src) {
    t0 = Date.now();
    const piece = [`${src.title} (${src.outlet}, ${src.date})`, src.summary, ...src.findings.map((f) => `- ${f}`)].join("\n");
    const r2 = withReading(`THE SOURCE THIS BATCH IS BUILT ON:\n${piece}`, m);
    const one = await writeQuestions({
      meeting, research: r2, count: 4,
      existing: live.map((q) => q.text), categories: [...new Set(live.map((q) => q.category))],
      focus: "Every question in this batch is built on the one source marked THE SOURCE THIS BATCH IS BUILT ON: what it found, what it argues, and what it leaves open. Each one gets a setup that lays out the relevant finding or argument from it in plain words, without naming it, then asks what that means for the people answering. Three to five questions, no more; quality over count.",
      guidance: m.questions?.guidance || "",
    });
    console.log(`\nfrom "${src.title}" (${Math.round((Date.now() - t0) / 1000)}s)\n`);
    one.forEach((q, i) => console.log(`${i + 1}. ${q.setup ? `[${q.setup}]\n   ` : "(bare) "}${q.text}\n`));
    check(one.length >= 3 && one.length <= 6, "a source gives three to six questions");
    check(one.filter((q) => q.setup).length >= 2, "they come set up from the source");
    check(one.every((q) => !namedSource(`${q.setup} ${q.text}`, allow, housesIn(r2))), "the source is not named aloud");
  }

  console.log(fails.length ? `\n${fails.length} FAILED` : "\nall passed");
  process.exit(fails.length ? 1 : 0);
})();
