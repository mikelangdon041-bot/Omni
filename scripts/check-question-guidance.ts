// Proves the three things the question bank kept getting wrong.
//
//  1. A standing correction from the writer actually lands — using the
//     writer's OWN vague wording, not a lawyer's version of it. The first
//     cut of this check passed with an instruction that spelled out
//     "never name a consultancy", while the real instruction ("stop saying X
//     person says blah blah, it sounds corporate") still lost to a system
//     rule telling the model to cite its sources inline.
//  2. Coverage guidance tops the bank up without taking it over. Asked to
//     include something on two themes, the bank covers both AND stays mostly
//     about the subject.
//  3. Category names are plain. "Opener: the strategic seat" is a label with
//     a clever subtitle; "Opening questions" is a name.
//
// Two writer-model calls.
//
//   npx -y tsx scripts/check-question-guidance.ts <meeting.json> ["the topic"]

import { readFileSync } from "node:fs";
import { writeQuestions, type WrittenQuestion } from "@/lib/meetingprep/questionsAi";
import { htmlToPlain } from "@/lib/writer/types";
import { meetingTypeLabel, type MpMeeting } from "@/lib/meetingprep/types";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

// The habit the writer asked to be rid of: naming a firm, a report or an
// author in the question itself, so every question sounds like a slide.
const NAMEDROP =
  /\b(mckinsey|deloitte|bain|bcg|boston consulting|accenture|gartner|iqvia|veeva|indegene|zs\b|pwc|kpmg|ey\b)/i;
// The same tic without a brand name: "a recent report found that ...".
const CITES_IN_LINE =
  /\b(a|one|the|recent|new)\s+(recent\s+)?(report|survey|study|analysis|paper)\s+(found|says|showed|suggests|argues)/i;

// Verbatim from the user. Deliberately not tidied up: an instruction only
// counts as obeyed if it is obeyed as typed.
const GUIDANCE =
  "Stop saying X person defines or says blah blah. It sounds too corporate and boring. I want this to sound more casual";

const COVERAGE =
  "Include some questions about AI and about how teams are actually measuring any of this.";

const THEMES: [string, RegExp][] = [
  ["AI", /\b(ai|artificial intelligence|llm|model|automat)/i],
  ["measurement", /\b(measur|metric|kpi|prove|evidence that|how do you know|track)/i],
];

const show = (label: string, list: WrittenQuestion[]) => {
  console.log(`\n=== ${label} (${list.length})`);
  for (const q of list)
    console.log(`  [${q.category}] #${q.rank} ${q.text}\n      why: ${q.why}`);
};

async function main() {
  const [inPath, topicArg] = process.argv.slice(2);
  const raw = readFileSync(inPath, "utf8").replace(/^﻿/, "");
  const parsed = JSON.parse(raw.slice(raw.indexOf("{")).trim());
  const m = (parsed.row_to_json ?? parsed) as MpMeeting;
  const topic = topicArg || m.topic || "";

  const payload = {
    title: m.title,
    topic,
    meetingType: meetingTypeLabel(m.meeting_type),
    date: m.date ?? undefined,
    durationMin: m.duration_min,
    location: m.location,
    attendees: m.attendees,
    explain: m.explain,
    objectives: m.objectives,
    background: m.background,
    concerns: m.concerns,
  };
  const research = m.brief?.research?.notes || "";
  const briefText = (m.brief?.sections || [])
    .map((s) => `${s.title}:\n${htmlToPlain(s.content)}`)
    .join("\n\n");
  const base = { meeting: payload, research, briefText };

  const before = await writeQuestions({ ...base, count: 12 });
  const after = await writeQuestions({
    ...base,
    count: 14,
    guidance: GUIDANCE,
    coverage: COVERAGE,
  });

  show("no instructions", before);
  show("with the writer's instructions", after);

  const problems: string[] = [];
  const offenders = after.filter((q) => NAMEDROP.test(q.text) || CITES_IN_LINE.test(q.text));
  if (offenders.length)
    problems.push(
      `${offenders.length} question(s) still cite a source in the line: "${offenders[0].text}"`,
    );

  // Coverage: each named theme has to show up, and neither may take over.
  for (const [name, re] of THEMES) {
    const hits = after.filter((q) => re.test(q.text) || re.test(q.followUp));
    console.log(`\ntheme "${name}": ${hits.length}/${after.length} questions`);
    if (!hits.length) problems.push(`nothing covers "${name}" despite being asked for`);
    if (hits.length > after.length / 2)
      problems.push(`"${name}" took over the bank (${hits.length} of ${after.length})`);
  }

  // Category names: plain, short, no clever subtitles.
  const cats = [...new Set(after.map((q) => q.category))];
  console.log(`\ncategories: ${cats.join(" | ")}`);
  const fancy = cats.filter((c) => c.includes(":") || c.split(/\s+/).length > 4);
  if (fancy.length) problems.push(`category names are still fancy: ${fancy.join(", ")}`);

  if (after.length < 10) problems.push(`only ${after.length} questions came back`);
  if (after.some((q) => !q.followUp.trim())) problems.push("a question came back with no probe");

  const baseOffenders = before.filter(
    (q) => NAMEDROP.test(q.text) || CITES_IN_LINE.test(q.text),
  ).length;
  console.log(
    `\ncited a source in the line: ${baseOffenders} without instructions, ${offenders.length} with them`,
  );
  console.log(problems.length ? `PROBLEMS:\n- ${problems.join("\n- ")}` : "checks passed");
  if (problems.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
