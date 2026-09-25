// Runs the real question-bank prompt (src/lib/meetingprep/questionsAi.ts)
// against one meeting row, then runs the "More questions" path against the
// result to prove a second batch never repeats the first. Two writer-model
// calls. Optionally writes the SQL that puts the bank on the meeting.
//
//   npx -y tsx scripts/check-questions.ts <meeting.json> [out.sql]
//
// <meeting.json> is an mp_meetings row including `brief` (the research notes
// on it are reused rather than searched again).

import { readFileSync, writeFileSync } from "node:fs";
import { writeQuestions, type WrittenQuestion } from "@/lib/meetingprep/questionsAi";
import { htmlToPlain } from "@/lib/writer/types";
import {
  meetingTypeLabel,
  type MpMeeting,
  type QuestionBank,
  type QuestionItem,
} from "@/lib/meetingprep/types";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

// The things that made the old brief's questions useless: a question that
// hands the meeting's own title back, or one that would fit any meeting in
// any industry.
const FILLER = [
  /what (does|do) (the )?(future|strategic leadership|success|excellence)[^?]*\?/i,
  /what (are|is) your (biggest )?(challenges?|priorities|goals)\??/i,
  /how do you see (the )?(industry|field|space) (evolving|changing)\??/i,
  /what (keeps|is keeping) you up at night\??/i,
];

async function main() {
  const [inPath, outPath] = process.argv.slice(2);
  const raw = readFileSync(inPath, "utf8").replace(/^﻿/, "");
  const parsed = JSON.parse(raw.slice(raw.indexOf("{")).trim());
  const m = (parsed.row_to_json ?? parsed) as MpMeeting;

  const payload = {
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
  };
  const research = m.brief?.research?.notes || "";
  const briefText = (m.brief?.sections || [])
    .map((s) => `${s.title}:\n${htmlToPlain(s.content)}`)
    .join("\n\n");

  const t0 = Date.now();
  const first = await writeQuestions({ meeting: payload, research, briefText, count: 20 });
  const t1 = Date.now();
  const more = await writeQuestions({
    meeting: payload,
    research,
    briefText,
    count: 10,
    existing: first.map((q) => q.text),
    categories: [...new Set(first.map((q) => q.category))],
    focus: "harder ones, and questions aimed at whoever has been quiet",
  });
  const t2 = Date.now();

  const all = [...first, ...more];
  const byCat = new Map<string, WrittenQuestion[]>();
  for (const q of all) byCat.set(q.category, [...(byCat.get(q.category) || []), q]);
  for (const [cat, list] of byCat) {
    console.log(`\n===== ${cat}`);
    for (const q of list.sort((a, b) => a.rank - b.rank))
      console.log(
        `  #${q.rank} ${q.text}\n      why: ${q.why}${q.forWhom ? ` | for: ${q.forWhom}` : ""}\n      probe: ${q.followUp}`,
      );
  }

  const problems: string[] = [];
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
  const firstSet = new Set(first.map((q) => norm(q.text)));
  const repeats = more.filter((q) => firstSet.has(norm(q.text)));
  if (repeats.length) problems.push(`batch two repeated: "${repeats[0].text}"`);
  if (first.length < 15) problems.push(`only ${first.length} questions in batch one`);
  if (!more.length) problems.push("batch two came back empty");
  const noProbe = all.filter((q) => !q.followUp.trim());
  if (noProbe.length) problems.push(`${noProbe.length} with no follow-up probe`);
  const filler = all.filter((q) => FILLER.some((re) => re.test(q.text)));
  if (filler.length) problems.push(`filler question: "${filler[0].text}"`);
  const firstCats = new Set(first.map((q) => q.category));
  const newCats = [...new Set(more.map((q) => q.category))].filter((c) => !firstCats.has(c));
  if (newCats.length > 1)
    problems.push(`batch two invented ${newCats.length} new categories: ${newCats.join(", ")}`);
  const ranks = new Set(first.map((q) => q.rank));
  if (ranks.size !== first.length) problems.push("ranks are not unique within a batch");
  if (byCat.size < 3) problems.push(`only ${byCat.size} categories`);
  const long = all.filter((q) => q.text.split(/\s+/).length > 45);
  if (long.length) problems.push(`${long.length} too long to read off a card`);

  console.log(
    `\n${first.length} + ${more.length} questions, ${byCat.size} categories, ${((t1 - t0) / 1000).toFixed(0)}s + ${((t2 - t1) / 1000).toFixed(0)}s`,
  );
  console.log(problems.length ? `PROBLEMS:\n- ${problems.join("\n- ")}` : "checks passed");

  if (outPath) {
    const items: QuestionItem[] = all.map((q, i) => ({
      id: `q${Date.now()}${i}`,
      text: q.text,
      category: q.category,
      why: q.why,
      followUp: q.followUp,
      forWhom: q.forWhom,
      rank: q.rank,
      picked: false,
      backup: false,
      asked: false,
      order: 0,
      source: "ai",
    }));
    const bank: QuestionBank = { items, generatedAt: new Date().toISOString() };
    writeFileSync(
      outPath,
      `update public.mp_meetings\n   set questions = '${JSON.stringify(bank).replace(/'/g, "''")}'::jsonb,\n       updated_at = now()\n where id = '${m.id}';\n`,
    );
    console.log(`wrote ${outPath} (${items.length} items)`);
  }
  if (problems.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
