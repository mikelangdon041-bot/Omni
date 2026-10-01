// Proves "Add more" adds rather than rewrites.
//
// A redo replaces a box, which is right when it's wrong and infuriating when
// it was nearly right. "Add more" has to come back with every line that was
// already there, untouched, plus new ones. One writer-model call.
//
//   npx -y tsx scripts/check-brief-extend.ts <meeting.json> [sectionKey]

import { readFileSync } from "node:fs";
import { writeBrief } from "@/lib/meetingprep/briefAi";
import { htmlToPlain } from "@/lib/writer/types";
import {
  DEFAULT_BRIEF_SECTIONS,
  meetingTypeLabel,
  type MpMeeting,
} from "@/lib/meetingprep/types";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

/** The comparable shape of one line: case and punctuation don't count. */
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

const lines = (html: string) =>
  htmlToPlain(html)
    .split("\n")
    .map(norm)
    .filter((l) => l.length > 12);

async function main() {
  const [inPath, keyArg] = process.argv.slice(2);
  const raw = readFileSync(inPath, "utf8").replace(/^﻿/, "");
  const parsed = JSON.parse(raw.slice(raw.indexOf("{")).trim());
  const m = (parsed.row_to_json ?? parsed) as MpMeeting;

  const key = keyArg || "questions_to_ask";
  const section = (m.brief?.sections || []).find((s) => s.key === key);
  if (!section) throw new Error(`that meeting has no "${key}" section`);
  const spec =
    DEFAULT_BRIEF_SECTIONS.find((s) => s.key === key) ||
    { key, title: section.title, prompt: section.prompt || `Section "${section.title}" as before.` };

  const out = await writeBrief({
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
    sections: [spec],
    research: m.brief?.research?.notes || "",
    previous: [section],
    onlyKey: key,
    extend: true,
  });

  const written = out[0];
  if (!written) throw new Error("nothing came back");

  const was = lines(section.content);
  const now = lines(written.content);
  const nowSet = new Set(now);
  const dropped = was.filter((l) => !nowSet.has(l));
  const wasSet = new Set(was);
  const added = now.filter((l) => !wasSet.has(l));

  console.log(`"${section.title}": ${was.length} lines in, ${now.length} out`);
  console.log(`\n--- added (${added.length})`);
  for (const l of added.slice(0, 12)) console.log(`  + ${l.slice(0, 150)}`);
  if (dropped.length) {
    console.log(`\n--- DROPPED (${dropped.length})`);
    for (const l of dropped.slice(0, 8)) console.log(`  - ${l.slice(0, 150)}`);
  }

  const problems: string[] = [];
  if (dropped.length) problems.push(`${dropped.length} existing line(s) were changed or removed`);
  if (!added.length) problems.push("nothing new was added");
  if (now.length <= was.length) problems.push("the box did not grow");

  console.log(problems.length ? `\nPROBLEMS:\n- ${problems.join("\n- ")}` : "\nchecks passed");
  if (problems.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
