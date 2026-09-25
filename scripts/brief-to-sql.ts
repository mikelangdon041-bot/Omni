// Turns a check-brief.ts output file into the UPDATE that puts that brief on
// the meeting, in exactly the shape the app writes (sections stamped with
// generatedContent so "Redo" can tell hand-edits apart, the research notes,
// and the setup fingerprint so the "your setup changed" banner clears).
//
//   npx -y tsx scripts/brief-to-sql.ts <meeting.json> <brief.json> <out.sql>

import { readFileSync, writeFileSync } from "node:fs";
import { setupFingerprint, type Brief, type MpMeeting } from "@/lib/meetingprep/types";
import type { WrittenSection } from "@/lib/meetingprep/briefAi";

const [meetingPath, briefPath, outPath] = process.argv.slice(2);
const readJson = (p: string) => {
  const raw = readFileSync(p, "utf8").replace(/^﻿/, "");
  const parsed = JSON.parse(raw.slice(raw.indexOf("{")).trim());
  return parsed.row_to_json ?? parsed;
};

const m = readJson(meetingPath) as MpMeeting;
const { sections, research } = readJson(briefPath) as {
  sections: WrittenSection[];
  research: string;
};

const brief: Brief = {
  sections: sections.map((s) => ({
    key: s.key,
    title: s.title,
    content: s.content,
    generatedContent: s.content,
    ...(s.prompt ? { prompt: s.prompt } : {}),
    ...(s.origin ? { origin: s.origin } : {}),
  })),
  ...(research.trim()
    ? { research: { notes: research, at: new Date().toISOString() } }
    : {}),
  generatedAt: new Date().toISOString(),
  sourceFingerprint: setupFingerprint(m),
};

const literal = JSON.stringify(brief).replace(/'/g, "''");
writeFileSync(
  outPath,
  `update public.mp_meetings\n   set brief = '${literal}'::jsonb,\n       updated_at = now()\n where id = '${m.id}';\n`,
);
console.log(
  `${brief.sections?.length} sections, research ${research.trim().length} chars, fingerprint ${brief.sourceFingerprint}`,
);
