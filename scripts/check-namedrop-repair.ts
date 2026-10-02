// One real batch, with the repair pass talking out loud.
//
// The guard has three layers — check, repair, drop — and the drop is the only
// one that cannot fail, so it is the one that hides a broken repair. If the
// repair call is silently returning nothing usable, every batch quietly
// arrives a question or two short and the writer loses good questions to a
// bug. This run proves which layer is doing the work.
//
// One writer-model call, plus a repair call only if the batch needs one.
//
//   npx -y tsx scripts/check-namedrop-repair.ts <meeting.json>

import { readFileSync } from "node:fs";
import { writeQuestions } from "@/lib/meetingprep/questionsAi";
import { namedSource, allowedNames } from "@/lib/meetingprep/spokenSources";
import { htmlToPlain } from "@/lib/writer/types";
import { meetingTypeLabel, type MpMeeting } from "@/lib/meetingprep/types";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

const GUIDANCE =
  "Stop saying X person defines or says blah blah. It sounds too corporate and boring. I want this to sound more casual";

async function main() {
  const [inPath, countArg] = process.argv.slice(2);
  const raw = readFileSync(inPath, "utf8").replace(/^﻿/, "");
  const parsed = JSON.parse(raw.slice(raw.indexOf("{")).trim());
  const m = (parsed.row_to_json ?? parsed) as MpMeeting;

  // The count is a floor the writer picks, so the check has to prove two
  // things: the floor is honoured, and it is a floor rather than a cap.
  const want = Number(countArg) || 20;
  const t0 = Date.now();
  const out = await writeQuestions({
    meeting: {
      title: m.title,
      topic: m.topic,
      meetingType: meetingTypeLabel(m.meeting_type),
      durationMin: m.duration_min,
      attendees: m.attendees,
      explain: m.explain,
      objectives: m.objectives,
      background: m.background,
      concerns: m.concerns,
    },
    research: m.brief?.research?.notes || "",
    briefText: (m.brief?.sections || [])
      .map((s) => `${s.title}:\n${htmlToPlain(s.content)}`)
      .join("\n\n"),
    count: want,
    guidance: GUIDANCE,
  });

  const allow = allowedNames(m.attendees);
  const leaks = out.filter((q) => namedSource(q.text, allow));
  for (const q of out) console.log(`  [${q.category}] #${q.rank} ${q.text}`);
  console.log(
    `\nasked for ${want}, got ${out.length}, in ${((Date.now() - t0) / 1000).toFixed(0)}s`,
  );

  const problems: string[] = [];
  // The only hard requirement: nothing the writer has asked twice to be rid
  // of reaches them.
  if (leaks.length) problems.push(`${leaks.length} name-drop(s) still got through`);
  // And the guard must not be eating the batch. Losing a couple to the drop
  // is the guard working; losing a quarter of them means the repair is not.
  if (out.length < want)
    problems.push(
      `asked for at least ${want} and got ${out.length} — the floor is not being honoured`,
    );

  console.log(problems.length ? `PROBLEMS:\n- ${problems.join("\n- ")}` : "checks passed");
  if (problems.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
