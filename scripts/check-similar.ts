// The "you have one like this" check (questionsAi.ts findSimilar), run
// against a real meeting's bank: paraphrases of questions already in it must
// be matched to them, and genuinely new questions on the same subject must
// not be. Then the whole "Questions from this" flow on one reading-list
// source. Saves nothing.
//
// Two quick check calls and one writer call.
//
//   npx -y tsx scripts/check-similar.ts <meeting-id>

import { readFileSync } from "node:fs";
import { findSimilar, writeQuestions } from "@/lib/meetingprep/questionsAi";
import { withReading } from "@/lib/meetingprep/reading";
import { meetingTypeLabel, type MpMeeting } from "@/lib/meetingprep/types";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

const fails: string[] = [];
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}`);
  if (!ok) fails.push(what);
};

(async () => {
  const id = process.argv[2];
  const h = { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` };
  const m = ((await (await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/mp_meetings?id=eq.${id}&select=*`, { headers: h })).json()) as MpMeeting[])[0];
  const live = (m.questions?.items || []).filter((q) => !q.deleted);
  const existing = live.map((q) => q.text);
  const find = (needle: RegExp) => existing.findIndex((t) => needle.test(t));
  const trusted = find(/number on a trusted relationship/i);
  const cut = find(/cut a third/i);

  const drafts = [
    // Same asks as two questions already in the bank, reworded.
    "How do you measure the value of a KOL relationship without reducing it to a number that cheapens it?",
    "If leadership told you to drop a third of what medical affairs does, which activities would go first?",
    // New questions on the same subject that ask different things.
    "Who on your team is best at writing up an insight so that someone in R&D actually acts on it, and what do they do differently?",
    "What would make you trust a vendor's dashboard of field medical impact?",
  ];
  let t0 = Date.now();
  const got = await findSimilar({ drafts, existing });
  console.log(`similar check on ${existing.length} questions (${Math.round((Date.now() - t0) / 1000)}s): ${JSON.stringify(got)}`);
  check(trusted >= 0 && got[0] === trusted, `paraphrase 1 matched "${existing[trusted]?.slice(0, 60)}"`);
  check(cut >= 0 && got[1] === cut, `paraphrase 2 matched "${existing[cut]?.slice(0, 60)}"`);
  check(got[2] === -1, `a new question was left alone (got ${got[2] >= 0 ? existing[got[2]].slice(0, 60) : "none"})`);
  check(got[3] === -1, `another new question was left alone (got ${got[3] >= 0 ? existing[got[3]].slice(0, 60) : "none"})`);

  // The whole flow the Reading tab runs, on its second source.
  const src = (m.reading?.sources || []).filter((s) => s.kind === "found")[1];
  if (src) {
    const meeting = { title: m.title, topic: m.topic, meetingType: meetingTypeLabel(m.meeting_type), attendees: m.attendees, explain: m.explain, objectives: m.objectives };
    const piece = [`${src.title} (${src.outlet}, ${src.date})`, src.summary, ...src.findings.map((f) => `- ${f}`)].join("\n");
    t0 = Date.now();
    const qs = await writeQuestions({
      meeting, research: withReading(`THE SOURCE THIS BATCH IS BUILT ON:\n${piece}`, m), count: 4, existing,
      categories: [...new Set(live.map((q) => q.category))],
      focus: "Every question in this batch is built on the one source marked THE SOURCE THIS BATCH IS BUILT ON. Each one gets a setup that lays out the relevant finding or argument from it in plain words, without naming it. Three to five questions, no more.",
      guidance: m.questions?.guidance || "",
    });
    const sim = await findSimilar({ drafts: qs.map((q) => q.text), existing });
    console.log(`\nfrom "${src.title}" (${src.outlet}) in ${Math.round((Date.now() - t0) / 1000)}s`);
    qs.forEach((q, i) =>
      console.log(`\n${i + 1}. ${q.setup ? `[${q.setup}]\n   ` : ""}${q.text}${sim[i] >= 0 ? `\n   >> YOU HAVE ONE LIKE THIS: ${existing[sim[i]]}` : ""}`),
    );
    check(qs.length >= 3, "the source gave at least three questions");
  }

  console.log(fails.length ? `\n${fails.length} FAILED` : "\nall passed");
  process.exit(fails.length ? 1 : 0);
})();
