// The generate prompt for Writing Studio, kept out of the route handler so it
// can be exercised directly against the API (scripts/writer-prompt-check.mjs)
// without standing up a request and a session.

export interface GenerateArgs {
  docType: string;
  /** Everything the user put in the one box. */
  input: string;
  /** The draft being refined, if this is a refine pass. */
  previous: string;
  /** New instructions for a refine pass. */
  guidance: string;
  fidelity: string;
  noGreeting: boolean;
  ctx: Record<string, unknown>;
  styles: { name: string; text: string }[];
  signature: string;
  variants: number;
}

// How much of the user's own draft survives. This is the loudest instruction in
// the prompt because over-rewriting is the classic failure: you hand a writing
// AI a draft to proofread and it hands back a stranger's letter.
export const FIDELITY_RULES: Record<string, string> = {
  light: `MODE: EDIT ONLY. Treat this as the most important instruction in this prompt.
- The user's draft IS the deliverable. You are proofreading it, not writing your own version of it.
- Keep their sentences, their word choices, their order, and their paragraph breaks. Most sentences must come back identical, word for word.
- Change only what is actually wrong: spelling, grammar, punctuation, agreement, a genuinely garbled phrase, an obviously missing word.
- Do NOT add sentences, transitions, pleasantries, context, examples, or "value". Do NOT reorder anything. Do NOT upgrade their vocabulary or make it sound more corporate.
- If the draft is already fine, hand it back essentially unchanged. That is the correct answer, not a lazy one.`,
  polish: `MODE: POLISH.
- Keep the user's content, structure, order and length. Improve how it reads: tighten wordy sentences, fix awkward phrasing, sharpen weak verbs, fix grammar.
- Every idea in the result must already exist in their draft. Add nothing, remove nothing of substance, reorder nothing.
- It must still read as their writing, not yours. Roughly half the sentences should survive largely intact.`,
  rewrite: `MODE: REWRITE.
- You have room to restructure, re-order and re-word to make this as good as it can be, while keeping every fact, name, number and commitment the user gave you.
- Still never invent specifics they didn't provide.`,
};

// Length only lands when it is a measurable instruction. Asked for something
// "much shorter" the model trims a few words and calls it done; given a word
// ceiling it actually cuts. So when there is a draft to measure, the adjective
// is converted into a number.
const LENGTH_RULES: Record<string, string> = {
  shorter:
    "LENGTH: cut roughly a quarter of the words. The result must be visibly shorter than what the user gave you, never longer.",
  much_shorter:
    "LENGTH: cut it to half its length or less. Keep only the sentences that earn their place.",
  longer:
    "LENGTH: expand it, but only with substance the user actually provided. Never pad with filler or restatement.",
};

const LENGTH_FACTORS: Record<string, number> = {
  shorter: 0.75,
  much_shorter: 0.5,
  longer: 1.4,
};

function wordCount(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

function lengthRuleFor(key: string, source: string): string {
  const base = LENGTH_RULES[key];
  if (!base) return "";
  const n = wordCount(source);
  if (n < 40) return base;
  const target = Math.round(n * LENGTH_FACTORS[key]);
  return key === "longer"
    ? `${base} You were given about ${n} words; aim for around ${target}.`
    : `${base} You were given about ${n} words, so the result must come in at ${target} words or fewer. That is a ceiling, not a target to approach from below. Count as you go.`;
}

const TYPE_NOTES: Record<string, string> = {
  email:
    "This is an email. Also produce a subject line (concise, specific, no clickbait). Do NOT include the signature in the body — it is appended separately.",
  document: "This is a document/memo. Use clear structure; headings only if genuinely helpful.",
  message: "This is a short message (Teams/Slack/text). Keep it tight; no greetings unless natural.",
  social: "This is a LinkedIn/social post. Strong hook in the first line, skimmable, no hashtag spam.",
  summary: "This is a summary/abstract. Faithful, complete, no invention, as tight as possible.",
  other: "Follow the user's description of what this should be.",
};

export function buildGeneratePrompt(a: GenerateArgs): { system: string; user: string } {
  const fidelity = FIDELITY_RULES[a.fidelity] ? a.fidelity : "light";
  const ctx = a.ctx || {};
  const list = (v: unknown) => (Array.isArray(v) && v.length ? v.join("; ") : "");
  const notes = String(ctx.brief || "").slice(0, 30000);

  const styleBlock = a.styles.length
    ? `Writing styles to follow (treat these as binding rules):\n${a.styles
        .map((s) => `--- Style "${s.name}" ---\n${s.text}`)
        .join("\n")}`
    : "";

  const intake = [
    // The user's own note goes first and is framed as an order, not as
    // background colour: typing "just fix the grammar and cut it down" in that
    // box has to be enough on its own, without also hunting for the matching
    // chips further down the page.
    notes &&
      `THE USER'S OWN INSTRUCTIONS — these are direct orders from them and outrank every other preference below. If they asked for one specific change, make that change and leave everything else alone:\n${notes}`,
    list(ctx.actions) &&
      `Fixes the user explicitly ticked. Every one of these must be visibly done in the result: ${list(ctx.actions)}`,
    list(ctx.tone) && `Tone: ${list(ctx.tone)}`,
    list(ctx.audience) && `Audience: ${list(ctx.audience)}`,
    ctx.recipient && `Recipient: ${ctx.recipient}`,
    ctx.ask && `What the writer is asking for / wants to happen: ${ctx.ask}`,
    ctx.keyPoints && `Key points that MUST be included:\n${ctx.keyPoints}`,
    ctx.background && `Background / context:\n${ctx.background}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const task = a.previous
    ? `Here is the current draft you produced earlier. Revise it according to the new guidance while keeping everything that wasn't asked to change.\n\nCurrent draft:\n${a.previous}\n\nNew guidance: ${a.guidance || "(none — light general polish)"}`
    : `Here is everything the user put in the box. Work out what it is and deliver what they want.\n\nWhat the user wrote:\n${a.input || notes}`;

  // Measured against whatever is actually being shortened: the current draft on
  // a refine pass, otherwise what the user put in the box.
  const lengthRule = lengthRuleFor(String(ctx.length || ""), a.previous || a.input || notes);

  // The editing mode and the length control can pull in opposite directions:
  // "keep it as it is" versus "cut it in half". Left unresolved the mode wins
  // and the length picker does nothing, which is exactly the complaint it was
  // added to fix — so the conflict is settled here, in favour of the thing the
  // user explicitly asked for.
  const actionList = (Array.isArray(ctx.actions) ? ctx.actions : []).map(String);
  const lengthMoves =
    !!lengthRule ||
    actionList.includes("Tighten / shorten") ||
    actionList.includes("Expand with more detail");
  const fidelityBlock =
    fidelity === "rewrite"
      ? FIDELITY_RULES.rewrite
      : `${FIDELITY_RULES[fidelity]}\n${
          lengthMoves
            ? "- EXCEPTION, length: the user explicitly asked for a length change, and that beats this mode's instinct to leave the length alone. Make the cut (or the expansion) in full. Do it by deleting or merging whole sentences, not by rewriting the sentences you keep."
            : "- Keep the length where it is: the result should land within about 10% of the word count you were given."
        }`;

  const system = `You are an elite writing partner. You produce polished, natural writing that sounds like a real person, never like AI filler.

OUTPUT
- Return JSON: {"variants":[{"subject":"...","html":"..."}]} with exactly ${a.variants} variant(s).${a.variants > 1 ? " Make the variants genuinely different in angle/structure, not reworded copies." : ""}
- "html" is the piece itself as simple HTML: <p> for paragraphs, <br> only inside a paragraph, <ul>/<ol>/<li> for lists, <b>/<i> sparingly. No inline styles, no headings unless the piece truly needs them, no markdown.
- "subject" is only meaningful for emails; otherwise return "".
- No preamble, no explanations, no commentary about what you changed.

WHAT YOU WERE HANDED
The user has ONE input box, so work out for yourself what is in it:
(a) a draft of their own — edit it under the mode below;
(b) source material such as an email, message or transcript plus an instruction about what to do with it — do exactly what they asked (reply, decline, forward, summarize…), pulling the sender's name, topic, dates and commitments straight from it;
(c) a plain description of what they want — write it from scratch, and ignore the mode below since there is nothing of theirs to preserve.
Never ask which it is, never explain your reading of it, and never invent facts, numbers, names or commitments the user didn't provide.

HOW MUCH TO CHANGE
${fidelityBlock}

HARD RULES
- Never use an em dash (—), an en dash (–), or a double hyphen (--). Not once. Use a comma, a period, a colon, or parentheses instead. This is absolute and overrides any style guidance.
- If key points are listed, include every one.
- Names: address the recipient by name whenever it can be inferred from anything provided (the pasted email's sender, the recipient field, the background). NEVER output a placeholder like [Name] or [Recipient].${a.noGreeting ? "" : ' If no name is inferable, open naturally without one (e.g. "Hi," / "Hi there,") or skip the greeting if the format doesn\'t need it.'}
- Only use [square brackets] for a genuinely missing hard fact (a date, a number) the user must fill in — never for names or things you can infer.
- Avoid AI tells: no "I hope this email finds you well", no "delve", no "moreover"/"furthermore" scaffolding, no exclamation stacking, no bullet lists the user didn't ask for, and no closing paragraph that restates what you already said.
${a.noGreeting ? '- NO GREETING: do not open with a salutation of any kind (no "Hi Sarah,", no "Hello,", no "Dear …"). Start on the first real sentence of the message.\n' : ""}${lengthRule ? `- ${lengthRule}\n` : ""}${TYPE_NOTES[a.docType] || TYPE_NOTES.other}
${styleBlock ? `\n${styleBlock}` : ""}${a.signature ? `\n(The user's emails get this signature appended automatically after your body, so end on the last sentence or at most a short "Thanks," line. Never write your own sign-off block with a name and contact details.)` : ""}`;

  return { system, user: `${intake ? `Intake:\n${intake}\n\n` : ""}${task}` };
}
