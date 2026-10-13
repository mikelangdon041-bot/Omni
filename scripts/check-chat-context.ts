// What the chat can see of a meeting (src/lib/chat/context.ts).
//
// The writer sat on the Questions tab, asked the chat about their own
// questions, and was told it could not see the screen. It was telling the
// truth: meetingContext sent the brief, the attendees, the documents and even
// the practice drill, and had never once included the question bank. The
// session's subject and the research notes were missing too.
//
// This asks the real model, through the real system prompt, the kind of
// question that can only be answered by someone who can see the list.
//
//   npx -y tsx scripts/check-chat-context.ts <meeting.json>

import { readFileSync } from "node:fs";
import { anthropic, WRITER_MODEL } from "@/lib/anthropic";
import { ASK_SCHEMA, buildAskSystem } from "@/lib/chat/prompt";
import { meetingContext } from "@/lib/chat/context";
import type { MpMeeting } from "@/lib/meetingprep/types";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

async function ask(context: string, say: string): Promise<string> {
  const res = await anthropic().messages.create({
    model: WRITER_MODEL,
    max_tokens: 4000,
    output_config: { format: { type: "json_schema", schema: ASK_SCHEMA } },
    system: buildAskSystem({
      app: "meeting-prep",
      subject: { kind: "meeting", label: "this meeting" },
      context,
      canEdit: false,
    }),
    messages: [{ role: "user", content: say }],
  });
  const block = res.content.find((b) => b.type === "text");
  const parsed = JSON.parse(("text" in (block || {}) ? block!.text : "") || "{}");
  return String(parsed.reply || "");
}

async function main() {
  const [inPath] = process.argv.slice(2);
  const raw = readFileSync(inPath, "utf8").replace(/^﻿/, "");
  const parsed = JSON.parse(raw.slice(raw.indexOf("{")).trim());
  const m = (parsed.row_to_json ?? parsed) as MpMeeting;

  const context = meetingContext(m);
  const live = (m.questions?.items || []).filter((q) => !q.deleted);
  const carried = live.filter((q) => q.picked);
  console.log(`context: ${context.length} chars`);
  console.log(`bank: ${live.length} live, ${carried.length} carried in\n`);

  const problems: string[] = [];

  // The thing it could not do.
  if (!context.includes(carried[0]?.text?.slice(0, 40) || "~~none~~"))
    problems.push("the carried list is still not in the context");
  if (m.topic && !context.includes(m.topic.slice(0, 30)))
    problems.push("the session's subject is still not in the context");

  // And the thing the writer actually asked: a count it can only get by
  // reading the list.
  const reply = await ask(context, "how many questions am I carrying in, and how many are backups?");
  console.log(`Q: how many am I carrying in, and how many are backups?\nA: ${reply}\n`);
  const backups = carried.filter((q) => q.backup).length;
  if (/can'?t see|cannot see|don'?t have (access|visibility)|no access/i.test(reply))
    problems.push("still says it cannot see the screen");
  if (!reply.includes(String(carried.length)))
    problems.push(`never said the number it is carrying (${carried.length})`);
  if (backups && !reply.includes(String(backups)))
    problems.push(`never said how many are backups (${backups})`);

  console.log(problems.length ? `PROBLEMS:\n- ${problems.join("\n- ")}` : "checks passed");
  if (problems.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
