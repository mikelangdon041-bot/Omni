// Runs the real brief prompt (src/lib/meetingprep/briefAi.ts) against one
// meeting row and prints what comes back, so a prompt change can be judged on
// a real meeting before it ships. Spends one writer-model call.
//
//   npx -y tsx scripts/check-brief.ts <meeting.json> [out.json]
//
// <meeting.json> is an mp_meetings row (title, meeting_type, duration_min,
// explain, ...). Fails loudly on the two things this prompt exists to stop:
// a meeting length the row never gave, and a question or line the brief says
// to deliver without writing it out.

import { readFileSync, writeFileSync } from "node:fs";
import { researchMeeting, writeBrief } from "@/lib/meetingprep/briefAi";
import { DEFAULT_BRIEF_SECTIONS, meetingTypeLabel, type MpMeeting } from "@/lib/meetingprep/types";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

async function main() {
  const [inPath, outPath] = process.argv.slice(2);
  const raw = readFileSync(inPath, "utf8").replace(/^\uFEFF/, "");
  // Accepts a bare row, or sb.ps1's `select row_to_json(m)` output.
  const parsed = JSON.parse(raw.slice(raw.indexOf("{")).trim());
  const m = (parsed.row_to_json ?? parsed) as MpMeeting;
  if (!m.title && !m.explain) throw new Error("No meeting in that file");
  const t0 = Date.now();
  const payload = {
      title: m.title,
      meetingType: meetingTypeLabel(m.meeting_type),
      date: m.date ?? undefined,
      durationMin: m.duration_min,
      format: m.format,
      location: m.location,
      attendees: m.attendees,
      explain: m.explain,
      objectives: m.objectives,
      background: m.background,
      concerns: m.concerns,
      priorTranscript: m.prior_transcript,
      documents: m.documents,
  };
  const research = await researchMeeting(payload);
  console.log(`===== RESEARCH (${((Date.now() - t0) / 1000).toFixed(0)}s)\n${research}`);
  const out = await writeBrief({
    meeting: payload,
    sections: DEFAULT_BRIEF_SECTIONS,
    research,
  });
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  if (outPath)
    writeFileSync(outPath, JSON.stringify({ sections: out, research }, null, 2));

  const text = (html: string) =>
    html
      .replace(/<li>/g, "\n  * ")
      .replace(/<\/?(ul|li|p|b)>/g, "")
      .replace(/<i>/g, "“")
      .replace(/<\/i>/g, "”");
  for (const s of out)
    console.log(`\n===== ${s.title}${s.origin === "ai" ? "  [ADDED: " + s.prompt + "]" : ""}\n${text(s.content)}`);

  const all = out.map((s) => s.content).join("\n");
  const problems: string[] = [];
  if (!m.duration_min && /\b\d+[- ]minute\b|\(\s*\d+\s*[-–]\s*\d+\s*min/i.test(all))
    problems.push("states a meeting length / minute timings the row never gave");
  const people = (m.attendees || []).filter((a) => a.name?.trim()).length;
  // A headcount only counts as invented when it counts people: "the three
  // pillars in the panel title" is in the title the writer gave.
  const count = all.match(
    /\b(these|those|the|our|all|both) (two|three|four|five|six|2|3|4|5|6) (of you|panelists?|speakers?|people|guests|attendees)\b/i,
  );

  if (count && !people) problems.push(`states a headcount nobody gave: "${count[0]}"`);
  // Did the research actually reach the page? Distinctive tokens are the
  // proper nouns and figures the search turned up; a brief that used none of
  // them was written from nothing, whatever the notes say.
  if (!research.trim()) problems.push("the research pass came back empty");
  else {
    const tokens = [
      ...new Set(
        (research.match(/\b(?:[A-Z][A-Za-z]{3,}|\d[\d.,%]{2,})\b/g) || []).filter(
          (t) => !/^(The|This|That|Their|These|Where|What|When|Open|Sources)$/.test(t),
        ),
      ),
    ];
    const used = tokens.filter((t) => all.includes(t));
    console.log(`research terms reaching the brief: ${used.length}/${tokens.length}`);
    if (used.length < 3) problems.push("the brief barely used the research notes");
  }
  const bare = all.match(/(ask|pose|open with) (one|a) (sharp|strong|good)[^<]*question[^<]*<\/li>/gi) || [];
  if (bare.length) problems.push(`a question it never writes out: ${bare[0]}`);
  console.log(`\n${secs}s, ${out.length} sections (${out.filter((s) => s.origin === "ai").length} added)`);
  console.log(problems.length ? `PROBLEMS:\n- ${problems.join("\n- ")}` : "checks passed");
  if (problems.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
