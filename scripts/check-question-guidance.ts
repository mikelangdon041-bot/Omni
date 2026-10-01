// Proves the two things the question bank was missing.
//
//  1. A standing correction from the writer actually lands. The complaint was
//     that every question opened "McKinsey says ..."; telling the model to
//     stop has to work on the next batch, not nearly work.
//  2. The session's own subject outranks the meeting's name. A bank written
//     off a stale title is confident and useless.
//
// Two writer-model calls.
//
//   npx -y tsx scripts/check-question-guidance.ts <meeting.json> ["the topic"]
//
// <meeting.json> is an mp_meetings row. The second argument stands in for the
// `topic` column while an existing meeting hasn't got one.

import { readFileSync } from "node:fs";
import { writeQuestions } from "@/lib/meetingprep/questionsAi";
import { htmlToPlain } from "@/lib/writer/types";
import { meetingTypeLabel, type MpMeeting } from "@/lib/meetingprep/types";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

// The habit the writer asked to be rid of: naming a consultancy or a report
// in the question itself, so every question sounds like a slide.
const NAMEDROP = /\b(mckinsey|deloitte|bain|bcg|boston consulting|accenture|gartner|iqvia|pwc|kpmg|ey\b)/i;

const GUIDANCE =
  "Never open a question by citing a consultancy, a report or a survey by name. No 'McKinsey says', no 'a recent report found'. Ask the question directly, in your own words. Keep the substance, lose the citation.";

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

  const before = await writeQuestions({ meeting: payload, research, briefText, count: 12 });
  const after = await writeQuestions({
    meeting: payload,
    research,
    briefText,
    count: 12,
    guidance: GUIDANCE,
  });

  const problems: string[] = [];
  const named = (list: { text: string }[]) => list.filter((q) => NAMEDROP.test(q.text));

  console.log(`=== without guidance (${before.length})`);
  for (const q of before) console.log(`  #${q.rank} ${q.text}`);
  console.log(`\n=== with guidance (${after.length})`);
  for (const q of after) console.log(`  #${q.rank} ${q.text}\n      probe: ${q.followUp}`);

  const stillNaming = named(after);
  if (stillNaming.length)
    problems.push(
      `${stillNaming.length} question(s) still name a firm despite the guidance: "${stillNaming[0].text}"`,
    );
  if (after.length < 8) problems.push(`only ${after.length} questions came back`);
  if (after.some((q) => !q.followUp.trim())) problems.push("a question came back with no probe");

  // The subject test: the words the topic is made of have to show up across
  // the bank. Not in every question, but a bank that never once touches the
  // subject it was given is a bank about something else.
  if (topic) {
    const terms = topic
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((w) => w.length > 4 && !["about", "their", "which", "turning", "into"].includes(w));
    const blob = after.map((q) => `${q.text} ${q.why}`).join(" ").toLowerCase();
    const hit = terms.filter((t) => blob.includes(t.slice(0, 6)));
    console.log(
      `\ntopic terms present: ${hit.length}/${terms.length} (${hit.join(", ") || "none"})`,
    );
    if (terms.length && hit.length < Math.ceil(terms.length / 3))
      problems.push(`the bank barely touches the stated topic: ${topic}`);
  }

  console.log(
    `\nnamed a firm: ${named(before).length} without guidance, ${stillNaming.length} with it`,
  );
  console.log(problems.length ? `PROBLEMS:\n- ${problems.join("\n- ")}` : "checks passed");
  if (problems.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
