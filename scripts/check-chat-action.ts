// Which action the chat picks (src/lib/chat/prompt.ts + actions.ts).
//
// The bug this exists for: the writer sat on the Questions tab, asked the
// chat for a question, pressed Add, and it went to the Practice drill. The
// bank had no "add" verb at all, so the nearest thing the model could reach
// was meetingprep.grill.add — which is the OPPOSITE direction, a question
// somebody asks THEM.
//
// Two verbs that both begin "add a question" will be confused for each other
// forever unless the wording keeps them apart, and that wording is a prompt,
// so it is worth checking rather than hoping. Each case below says what the
// writer typed and which action must come back.
//
//   npx -y tsx scripts/check-chat-action.ts

import { readFileSync } from "node:fs";
import { anthropic, WRITER_MODEL } from "@/lib/anthropic";
import { ASK_SCHEMA, buildAskSystem } from "@/lib/chat/prompt";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

const CONTEXT = `Meeting: Panel Prep: The Future of Medical Affairs
THE SUBJECT OF THIS SESSION: Value Communication in Medical Affairs: Turning Scientific Exchange into Meaningful Outcomes
Type: Moderating a panel
The writer is moderating. Their question bank has 24 questions in groups including "Opening questions", "Measuring the value" and "How it works in practice".`;

/** What the writer typed, and the action that must come back. */
/** A prior exchange, for the cases where "that" needs something to mean. */
type Case = { say: string; want: string; after?: { role: "user" | "assistant"; content: string }[] };

const CASES: Case[] = [
  { say: "add a question about how anyone actually measures this", want: "meetingprep.question.add" },
  { say: "write me a question to open the panel with and add it", want: "meetingprep.question.add" },
  {
    // A bare pronoun, which is how people actually ask. It only means
    // anything with the turn before it, so the check supplies one.
    say: "add that to my questions",
    want: "meetingprep.question.add",
    after: [
      { role: "user", content: "give me a sharp question about measuring value" },
      {
        role: "assistant",
        content:
          '{"reply":"Try: What is a value metric your organisation tracks that you quietly think is nonsense?","actions":[]}',
      },
    ],
  },
  // The other direction, which must still work and must not be swallowed.
  {
    say: "what might the audience throw at me about commercial influence? add it to my practice",
    want: "meetingprep.grill.add",
  },
  {
    say: "add a question I should be ready to answer about AI, with how I'd answer it",
    want: "meetingprep.grill.add",
  },
];

async function pick(c: Case): Promise<string[]> {
  const system = buildAskSystem({
    app: "meeting-prep",
    subject: { kind: "meeting", label: "this meeting" },
    context: CONTEXT,
    canEdit: false,
  });
  const res = await anthropic().messages.create({
    model: WRITER_MODEL,
    max_tokens: 2000,
    output_config: { format: { type: "json_schema", schema: ASK_SCHEMA } },
    system,
    messages: [...(c.after || []), { role: "user", content: c.say }],
  });
  if (res.stop_reason === "refusal") return [];
  const block = res.content.find((b) => b.type === "text");
  const parsed = JSON.parse(("text" in (block || {}) ? block!.text : "") || "{}");
  return (Array.isArray(parsed.actions) ? parsed.actions : []).map((a: { id?: string }) =>
    String(a?.id || ""),
  );
}

async function main() {
  const problems: string[] = [];
  for (const c of CASES) {
    const kinds = await pick(c);
    const ok = kinds.includes(c.want);
    console.log(`${ok ? "ok  " : "MISS"} "${c.say.slice(0, 54)}"`);
    console.log(`       wanted ${c.want}, offered ${kinds.length ? kinds.join(", ") : "(nothing)"}`);
    if (!ok) problems.push(`"${c.say.slice(0, 40)}" offered ${kinds.join(", ") || "nothing"}`);
    // The specific regression: asking to ADD a question must never land in
    // the practice drill, which is where the writer lost one.
    if (c.want === "meetingprep.question.add" && kinds.includes("meetingprep.grill.add"))
      problems.push(`"${c.say.slice(0, 40)}" still reaches for the practice drill`);
  }
  console.log(problems.length ? `\nPROBLEMS:\n- ${problems.join("\n- ")}` : "\nchecks passed");
  if (problems.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
