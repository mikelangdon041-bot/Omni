// Times the research pass on its own (src/lib/meetingprep/briefAi.ts).
// The brief route has a 300s ceiling, so this step has to come back well
// inside it — at default effort the same search ran 371s and would have died
// in production. Spends one writer-model call plus its searches.
//
//   npx -y tsx scripts/check-research.ts <meeting.json>

import { readFileSync } from "node:fs";
import { researchMeeting } from "@/lib/meetingprep/briefAi";
import { meetingTypeLabel, type MpMeeting } from "@/lib/meetingprep/types";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

async function main() {
  const raw = readFileSync(process.argv[2], "utf8").replace(/^﻿/, "");
  const parsed = JSON.parse(raw.slice(raw.indexOf("{")).trim());
  const m = (parsed.row_to_json ?? parsed) as MpMeeting;
  const t0 = Date.now();
  const notes = await researchMeeting({
    title: m.title,
    meetingType: meetingTypeLabel(m.meeting_type),
    date: m.date ?? undefined,
    durationMin: m.duration_min,
    location: m.location,
    attendees: m.attendees,
    explain: m.explain,
    objectives: m.objectives,
    background: m.background,
    concerns: m.concerns,
  });
  const secs = (Date.now() - t0) / 1000;
  console.log(notes);
  console.log(`\n${secs.toFixed(0)}s, ${notes.split(/\s+/).length} words`);
  const problems: string[] = [];
  if (secs > 240) problems.push(`too slow for the 300s route ceiling (${secs.toFixed(0)}s)`);
  if (/\*\*|^#{1,6}\s/m.test(notes)) problems.push("markdown left in the notes");
  if (/^(I |Here|Let me|I've)/.test(notes)) problems.push(`preamble: "${notes.slice(0, 60)}"`);
  if (!notes.trim()) problems.push("came back empty");
  console.log(problems.length ? `PROBLEMS:\n- ${problems.join("\n- ")}` : "checks passed");
  if (problems.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
