// Runs the read-through (src/lib/meetingprep/reviewAi.ts) against a real
// meeting and checks the advice is worth reading.
//
// The failure this guards against is the one every "AI review" feature has:
// it comes back with "strong agenda, consider adding more detail", which is
// praise plus a platitude, and the writer learns nothing. A note has to name
// something specific in THIS pack, and carry a fix you could hand straight
// to the writer.
//
// One writer-model call.
//
//   npx -y tsx scripts/check-review.ts <meeting.json>

import { readFileSync } from "node:fs";
import { reviewPrep } from "@/lib/meetingprep/reviewAi";
import { htmlToPlain } from "@/lib/writer/types";
import { meetingTypeLabel, sectionTitle, type MpMeeting } from "@/lib/meetingprep/types";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

// Advice that would be true of any meeting ever held.
const PLATITUDE =
  /\b(active listening|build rapport|be prepared|stay focused|engage the audience|make eye contact|be concise|practice|rehearse more)\b/i;
// Praise. A read-through that tells you what is good is padding its answer.
const PRAISE =
  /\b(strong|excellent|great job|well[- ]structured|solid|comprehensive|good work|impressive)\b/i;

async function main() {
  const [inPath] = process.argv.slice(2);
  const raw = readFileSync(inPath, "utf8").replace(/^﻿/, "");
  const parsed = JSON.parse(raw.slice(raw.indexOf("{")).trim());
  const m = (parsed.row_to_json ?? parsed) as MpMeeting;

  const sections = m.brief?.sections || [];
  const briefText = sections
    .map((s) => `[${s.key}] ${sectionTitle(s.key, s.title)}:\n${htmlToPlain(s.content)}`)
    .join("\n\n");
  const asked = (m.questions?.items || []).filter((q) => !q.deleted);
  const questionsText = asked
    .map((q, i) => `${i + 1}. (${q.category}) ${q.text}`)
    .join("\n");

  const t0 = Date.now();
  const notes = await reviewPrep({
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
    briefText,
    questionsText,
    questionCount: asked.length,
    sectionKeys: sections.map((s) => s.key),
    research: m.brief?.research?.notes || "",
  });

  for (const n of notes)
    console.log(
      `\n[${n.severity}] ${n.title}\n  about: ${n.targetLabel} (${n.target || "whole pack"})\n  why:   ${n.detail}\n  fix:   ${n.fix}`,
    );
  console.log(`\n${notes.length} notes in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

  const problems: string[] = [];
  if (notes.length < 3) problems.push(`only ${notes.length} notes`);
  if (notes.length > 7) problems.push(`${notes.length} notes is too many to act on`);

  const keys = new Set(sections.map((s) => s.key));
  const badTarget = notes.filter(
    (n) =>
      n.target &&
      n.target !== "questions" &&
      n.target !== "setup" &&
      !keys.has(n.target.replace(/^section:/, "")),
  );
  if (badTarget.length)
    problems.push(`a note points at a box that doesn't exist: ${badTarget[0].target}`);

  const noFix = notes.filter((n) => n.fix.trim().length < 20);
  if (noFix.length) problems.push(`${noFix.length} note(s) have no usable fix`);

  const platitudes = notes.filter((n) => PLATITUDE.test(`${n.title} ${n.detail}`));
  if (platitudes.length) problems.push(`generic meeting advice: "${platitudes[0].title}"`);

  const praise = notes.filter((n) => PRAISE.test(n.title));
  if (praise.length) problems.push(`a note is praise, not advice: "${praise[0].title}"`);

  const longTitles = notes.filter((n) => n.title.split(/\s+/).length > 14);
  if (longTitles.length) problems.push(`${longTitles.length} title(s) are too long to scan`);

  // Ranked: the first note should not be the one it called least important.
  if (notes.length > 1 && notes[0].severity === "low")
    problems.push("the list opens on a low-priority note");

  // It has to actually be about this pack. A note that names nothing from the
  // brief or the subject is a note about meetings in general.
  const subject = `${m.topic || ""} ${m.title}`.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 4);
  const grounded = notes.filter((n) => {
    const blob = `${n.title} ${n.detail} ${n.fix}`.toLowerCase();
    return subject.some((w) => blob.includes(w.slice(0, 6))) || /section:/.test(n.target);
  });
  console.log(`grounded in this pack: ${grounded.length}/${notes.length}`);
  if (grounded.length < Math.ceil(notes.length / 2))
    problems.push("most notes could have been written without reading this pack");

  
  // The point of this change: a note about the questions has to say WHICH.
  // questionRefs check
  const qNotes = notes.filter((n) => n.target === 'questions');
  for (const n of qNotes) {
    console.log('  [questions] ' + n.title + ' -> refs ' + JSON.stringify(n.questionRefs) + ' action ' + (n.action || '(none)'));
    if (!n.questionRefs.length) problems.push('a questions note named no questions: ' + n.title);
    if (n.action && !n.questionRefs.length) problems.push('an action with nothing to act on: ' + n.title);
  }
  const refd = notes.flatMap((n) => n.questionRefs);
  if (refd.some((r) => r < 1 || r > asked.length)) problems.push('a reference points outside the bank');

  console.log(problems.length ? `PROBLEMS:\n- ${problems.join("\n- ")}` : "checks passed");
  if (problems.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
