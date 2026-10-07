// Finishing off a question the writer typed (src/lib/meetingprep/questionsAi.ts).
//
// Their own questions go into the bank bare, so this writes the probe and,
// where the research genuinely has one, the source behind it. Two things can
// go wrong and both are invisible in a screenshot:
//
//   - the probe names a consultancy, which is the thing the writer has twice
//     asked not to be handed in a line they say out loud.
//   - the source is invented. A probe that is merely weak wastes a moment; a
//     source that is plausible and false gets cited in the room.
//
// So the second call runs the same question with the research taken away. A
// source may only ever come out of notes we actually gathered, which means
// that call has to come back with nothing. That is the invariant: not "did it
// write something good", but "can it name a source it was never given".
//
// Two writer-model calls.
//
//   npx -y tsx scripts/check-probe.ts <meeting.json>

import { readFileSync } from "node:fs";
import { fillOutQuestion } from "@/lib/meetingprep/questionsAi";
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

/**
 * Is this source line actually traceable to the notes it was supposed to come
 * out of? A real one carries something distinctive — a name, a year — that is
 * findable in the research. A line with nothing of either in it is not a
 * citation, whatever it reads like.
 */
function groundedIn(sourceNote: string, research: string): boolean {
  const hay = research.toLowerCase();
  const marks = [
    ...(sourceNote.match(/\b(?:19|20)\d{2}\b/g) || []),
    ...(sourceNote.match(/\b[A-Z][A-Za-z&.'-]{3,}\b/g) || []),
  ];
  return marks.some((t) => hay.includes(t.toLowerCase()));
}

async function main() {
  const [inPath] = process.argv.slice(2);
  const raw = readFileSync(inPath, "utf8").replace(/^﻿/, "");
  const parsed = JSON.parse(raw.slice(raw.indexOf("{")).trim());
  const m = (parsed.row_to_json ?? parsed) as MpMeeting;

  const meeting = {
    title: m.title,
    topic: m.topic,
    meetingType: meetingTypeLabel(m.meeting_type),
    attendees: m.attendees,
    explain: m.explain,
    objectives: m.objectives,
  };
  const research = m.brief?.research?.notes || "";
  const standing = m.questions?.guidance || "";

  // A real one of theirs, typed in and left without a probe.
  const question = {
    text:
      (m.questions?.items || []).find((q) => q.source === "user" && !q.followUp)?.text ||
      "This session is about communicating value so let's first define what value is. How would you define it?",
    category: "Mine",
  };

  console.log(`question: ${question.text}`);
  console.log(`research: ${research.length} chars · standing: ${standing || "(none)"}\n`);

  const problems: string[] = [];

  const got = await fillOutQuestion({ meeting, research, question, standing });
  console.log(`probe:  ${got.followUp || "(none)"}`);
  console.log(`why:    ${got.why || "(none)"}`);
  console.log(`for:    ${got.forWhom || "(anyone)"}`);
  console.log(`source: ${got.sourceNote || "(none)"}\n`);

  if (!got.followUp.trim()) problems.push("came back with no probe at all");
  const dirty = namedSource(got.followUp);
  if (dirty) problems.push(`the probe names a source: "${dirty}"`);
  // A probe that hands the question back is the one thing it must not be.
  const echo = overlap(got.followUp, question.text);
  console.log(`probe/question overlap: ${(echo * 100).toFixed(0)}%`);
  if (echo > 0.7) problems.push("the probe is the question reworded, not a probe");
  if (got.why.split(/\s+/).filter(Boolean).length > 15)
    problems.push("why ran past 15 words");
  if (got.sourceNote && !groundedIn(got.sourceNote, research))
    problems.push(`the source is not traceable to the research: "${got.sourceNote}"`);

  // The one that matters. Same question, nothing to draw from.
  const blind = await fillOutQuestion({ meeting, research: "", question, standing });
  console.log(`\nwith no research — source: ${blind.sourceNote || "(none)"}`);
  if (blind.sourceNote.trim())
    problems.push(`invented a source with no research in front of it: "${blind.sourceNote}"`);
  if (namedSource(blind.followUp))
    problems.push("the probe names a source when there is no research");

  console.log(problems.length ? `\nPROBLEMS:\n- ${problems.join("\n- ")}` : "\nchecks passed");
  if (problems.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
