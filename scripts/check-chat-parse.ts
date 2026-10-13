// Reading a malformed answer back (src/lib/chat/parse.ts).
//
// The failure this guards: asked to pull numbers together across a question
// bank, the model wrote past the token cap, the object stopped mid-string,
// and "Unterminated string in JSON at position 834 (line 1 column 835)" went
// to the screen. The route now checks the cap first, but a malformed object
// can arrive other ways, and none of them may ever reach the person as a
// character offset.
//
// No model calls — it runs the real parser over the real shapes.
//
//   npx -y tsx scripts/check-chat-parse.ts

import { parseReply } from "@/lib/chat/parse";

const cases: { name: string; input: string; reply?: string; actions?: boolean }[] = [
  {
    name: "a whole answer",
    input: JSON.stringify({ reply: "Nine of your 24 are about measurement.", actions: [] }),
    reply: "Nine of your 24 are about measurement.",
    actions: true,
  },
  {
    name: "cut off mid-sentence, the reported bug",
    input: '{"reply":"Across your 24 questions, 9 are about measurement and 4 open the pan',
    reply: "Across your 24 questions, 9 are about measurement and 4 open the pan",
  },
  {
    name: "cut off right after an escaped quote",
    input: '{"reply":"They asked \\"what is value\\" and nobody',
    reply: 'They asked "what is value" and nobody',
  },
  {
    name: "cut off on a half-written escape",
    input: '{"reply":"line one\\',
    reply: "line one",
  },
  { name: "empty", input: "", reply: undefined },
  { name: "not JSON at all", input: "the model said something odd", reply: undefined },
];

const problems: string[] = [];
for (const c of cases) {
  let got: ReturnType<typeof parseReply>;
  try {
    got = parseReply(c.input);
  } catch (e) {
    problems.push(`${c.name}: THREW ${(e as Error).message}`);
    continue;
  }
  const reply = typeof got.reply === "string" ? got.reply : undefined;
  console.log(`  ${c.name} -> ${reply === undefined ? "(no reply)" : JSON.stringify(reply)}`);
  if (reply !== c.reply) problems.push(`${c.name}: wanted ${JSON.stringify(c.reply)}, got ${JSON.stringify(reply)}`);
  if (c.actions && !Array.isArray(got.actions))
    problems.push(`${c.name}: lost the actions off a perfectly good answer`);
}

console.log(problems.length ? `\nPROBLEMS:\n- ${problems.join("\n- ")}` : "\nchecks passed");
if (problems.length) process.exitCode = 1;
