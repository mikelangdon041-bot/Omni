// Three other ways to ask one question (src/lib/meetingprep/questionsAi.ts).
//
// The thing that makes this feature worth having is that the three are
// genuinely different. Three rewordings of the same sentence is a worse
// version of the rewrite button the writer already had, and they would have
// to read all three to find that out.
//
// One writer-model call.
//
//   npx -y tsx scripts/check-variants.ts <meeting.json>

import { readFileSync } from "node:fs";
import { writeVariants } from "@/lib/meetingprep/questionsAi";
import { namedSource } from "@/lib/meetingprep/spokenSources";
import { meetingTypeLabel, type MpMeeting } from "@/lib/meetingprep/types";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

/** Words shared between two lines, as a share of the shorter one. */
function overlap(a: string, b: string): number {
  const w = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .split(/[^a-z]+/)
        .filter((x) => x.length > 3),
    );
  const A = w(a);
  const B = w(b);
  if (!A.size || !B.size) return 0;
  let same = 0;
  for (const x of A) if (B.has(x)) same++;
  return same / Math.min(A.size, B.size);
}

async function main() {
  const [inPath] = process.argv.slice(2);
  const raw = readFileSync(inPath, "utf8").replace(/^﻿/, "");
  const parsed = JSON.parse(raw.slice(raw.indexOf("{")).trim());
  const m = (parsed.row_to_json ?? parsed) as MpMeeting;

  const original =
    "The pitch is that medical affairs should own a real strategic seat. In your own shop, are you there, nearly there, or still putting it on a slide?";

  const out = await writeVariants({
    meeting: {
      title: m.title,
      topic: m.topic,
      meetingType: meetingTypeLabel(m.meeting_type),
      attendees: m.attendees,
      explain: m.explain,
      objectives: m.objectives,
    },
    research: m.brief?.research?.notes || "",
    question: { text: original, category: "Opening questions", followUp: "" },
    // The writer's own kind of instruction: vague, and about how it lands.
    guidance: "too long to say out loud, and it sounds like a consultant wrote it",
    standing:
      "Stop saying X person defines or says blah blah. It sounds too corporate and boring. I want this to sound more casual",
  });

  for (const v of out) console.log(`\n[${v.angle}] ${v.text}\n   probe: ${v.followUp}`);

  const problems: string[] = [];
  if (out.length !== 3) problems.push(`got ${out.length} versions, not 3`);
  if (out.some((v) => namedSource(v.text)))
    problems.push("a version names a source in the question itself");
  if (out.some((v) => !v.followUp.trim())) problems.push("a version came back with no probe");
  if (out.some((v) => !v.angle.trim() || v.angle.split(/\s+/).length > 6))
    problems.push("an angle label is missing or too long to scan");

  // The instruction was "too long". Every version should be shorter.
  const longer = out.filter((v) => v.text.length >= original.length);
  if (longer.length) problems.push(`${longer.length} version(s) ignored "too long to say out loud"`);

  // And they have to differ from each other, not just from the original.
  for (let i = 0; i < out.length; i++)
    for (let j = i + 1; j < out.length; j++) {
      const o = overlap(out[i].text, out[j].text);
      console.log(`overlap ${i + 1}/${j + 1}: ${(o * 100).toFixed(0)}%`);
      if (o > 0.7) problems.push(`versions ${i + 1} and ${j + 1} are the same question reworded`);
    }

  console.log(problems.length ? `\nPROBLEMS:\n- ${problems.join("\n- ")}` : "\nchecks passed");
  if (problems.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
