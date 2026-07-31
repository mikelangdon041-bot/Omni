// The generate prompt for Writing Studio, kept out of the route handler so it
// can be exercised directly against the API (scripts/writer-prompt-check.mjs)
// without standing up a request and a session. The chat prompt lives next door
// in chatPrompt.ts for the same reason.

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
  /**
   * Every instruction given on this piece so far, oldest first. Without it each
   * refine is a fresh conversation: "don't mention the pricing" is honoured
   * once, and the round after that puts it straight back.
   */
  priorInstructions?: string[];
  /**
   * Recent earlier versions, newest first, so "bring back the line about the
   * pilot" has something to bring it back from.
   */
  priorVersions?: { instructions: string; text: string }[];
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
  draft: `MODE: WRITE IT FROM MY NOTES.
- What they gave you is shorthand: fragments, bullets, half-sentences, a bit of context. It is a brief, not a draft. Nothing in it needs preserving word for word, and their telegraphic phrasing should NOT survive into the result.
- Write the real piece. Full sentences, a proper opening and close, the points in an order that makes sense. This is expected to be longer than what they typed.
- Every fact, name, number, date and commitment must come from what they gave you. Do not invent a detail to round out a sentence, and do not promise anything on their behalf that they didn't say. If a hard fact is genuinely missing and the piece needs it, leave [square brackets] for that one thing.
- Their shorthand often mixes the message with notes to you about it ("keep it short", "she's annoyed"). Use the second kind to make choices; only the first kind belongs in the text.`,
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

// Asking for a shorter piece in the note box has to work on its own, without
// also hunting for the Length chip. Extraction ticks that chip a couple of
// seconds later, but the user may well hit Generate first, and until then the
// editing mode's "keep the length" line would quietly win. So the note is read
// for a length request here too, with no model call involved.
const SHORTEN_HINT =
  /\b(shorter|shorten|cut (?:it |this )?(?:down|back)?|trim|tighten|condense|concise|brevity|too long|wordy|halve|shrink|slim)\b/i;
const LENGTHEN_HINT =
  /\b(longer|expand|flesh(?:ed)? (?:it )?out|more detail|elaborate|too short|beef(?:ed)? up)\b/i;

// Asking for the pieces to be moved around runs straight into edit-only mode's
// "do NOT reorder anything", and the mode was winning. Same fix as length: read
// the request out of the note and lift the clause it contradicts.
// Asking for a look-up in the note has to work on its own, without also finding
// the checkbox. Extraction ticks that box a couple of seconds later, so anyone
// who types and hits Generate immediately would otherwise get a piece written
// without the search they asked for.
const RESEARCH_HINT =
  /\b(look (?:it |this |that |them )?up|look up|research|find out|search (?:for|online|the web)|google|what (?:do|are) others|how (?:do|are) others|what others say|best practice|current (?:guidance|recommendation|thinking|data|evidence)|latest (?:guidance|data|research|thinking)|cite|citation|source(?:s|d)?\b.*\bfor\b|what does the (?:data|evidence|literature|research) say|industry standard|benchmark)\b/i;

/** Did the user ask, in their own words, for something to be looked up? */
export function wantsResearch(text: string): boolean {
  return RESEARCH_HINT.test(text || "");
}

const RESTRUCTURE_HINT =
  /\b(reorder|re-?order|restructure|reorganiz|reorganis|rearrange|move (?:things |it |them |stuff )?around|different order|better order|flow better|reflow|rework the (?:structure|order)|makes? (?:the )?most sense|logical order)\b/i;

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

// Files the user attached, already read into text at upload time. Framed as
// source material rather than as their draft: a screenshot of an email they need
// to answer is the thing to respond TO, not the thing to polish.
function attachmentBlock(attachments: unknown): string {
  const list = (Array.isArray(attachments) ? attachments : []) as {
    name?: string;
    kind?: string;
    text?: string;
  }[];
  const usable = list.filter((f) => (f?.text || "").trim());
  if (!usable.length) return "";
  return `ATTACHED MATERIAL — files the user handed over, transcribed. Treat this as source material to work from (an email to answer, a document to draw on), not as their own draft to improve, unless they say otherwise. Pull names, dates and specifics from it:\n${usable
    .map(
      (f) =>
        `--- ${f.kind === "image" ? "Screenshot" : "File"}: ${f.name || "attachment"} ---\n${String(f.text).slice(0, 20000)}`,
    )
    .join("\n\n")}`;
}

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
      `THE USER'S OWN INSTRUCTIONS — these are direct orders from them and outrank every other preference below. If they asked for one specific change, make that change and leave everything else alone.

Read this the way a colleague reads a note over your shoulder: it is them talking TO you about the piece, not text to be dropped INTO the piece. When they say "I want to get across that X", work X into the writing in the piece's own voice and at the right place. Never quote their instruction back, never paste their phrasing verbatim, and never write a sentence that sounds like it is describing the note ("As mentioned, I want to convey…"). If part of the note is only context for you, use it to make better choices and leave it out of the text entirely.

${notes}`,
    list(ctx.actions) &&
      `Fixes the user explicitly ticked. Every one of these must be visibly done in the result: ${list(ctx.actions)}`,
    list(ctx.tone) && `Tone: ${list(ctx.tone)}`,
    list(ctx.audience) && `Audience: ${list(ctx.audience)}`,
    ctx.recipient && `Recipient: ${ctx.recipient}`,
    ctx.ask && `What the writer is asking for / wants to happen: ${ctx.ask}`,
    ctx.keyPoints && `Key points that MUST be included:\n${ctx.keyPoints}`,
    ctx.background && `Background / context:\n${ctx.background}`,
    // Findings from a web look-up run just before this call. Sourced, so it can
    // be used as fact — unlike anything the model would otherwise be inventing.
    ctx.researchNotes &&
      `RESEARCH — looked up on the web for this piece, with sources. You may state these as fact and reference them naturally; do not dump the list, cite a URL inline, or add a sources section unless the user asked for one:\n${ctx.researchNotes}`,
    attachmentBlock(ctx.attachments),
  ]
    .filter(Boolean)
    .join("\n\n");

  // Everything asked for on this piece so far. A refine that only sees the
  // newest instruction will cheerfully undo the last three.
  const standing = (a.priorInstructions || []).filter((s) => s.trim());
  const standingBlock = standing.length
    ? `\n\nWHAT THEY HAVE ALREADY ASKED FOR ON THIS PIECE, oldest first:
${standing.map((s, i) => `${i + 1}. ${s}`).join("\n")}

How to treat these:
- Anything phrased as a constraint or a preference ("don't mention the pricing", "never open with an apology", "always keep it under a page", "leave out the numbers") is STILL IN FORCE. Do not undo it, and do not let it creep back in because this round's instruction didn't repeat it. This is the most common way a refine goes wrong.
- Anything phrased as a one-off change ("make it shorter", "move the ask up") was already applied to the draft you have. Don't apply it again, and don't reverse it either.
- If the new instruction genuinely contradicts an earlier one, the new one wins.`
    : "";

  const versionsBlock = (a.priorVersions || []).length
    ? `\n\nEARLIER VERSIONS of this piece, newest first. Use these only if the user asks for something back ("put the line about the pilot back", "the previous opening was better"). Do not merge them in otherwise:
${(a.priorVersions || [])
        .map(
          (v, i) =>
            `--- Version ${i + 1}${v.instructions ? ` (after: ${v.instructions})` : ""} ---\n${v.text.slice(0, 6000)}`,
        )
        .join("\n\n")}`
    : "";

  const task = a.previous
    ? `Here is the current draft, including any edits the user has made to it by hand. Revise THIS text, keeping everything they didn't ask you to change.

The guidance below is the user talking to you about the draft, not copy to insert. Interpret it and fold it in: if they say "I want the idea that we're already piloting this", write that idea into the flow of the piece in its own voice, in the place it belongs. Do not quote their words back, do not paste their phrasing verbatim, and do not add a sentence that reads like a note to yourself. If the guidance is only context, let it inform your choices and keep it out of the text.

Current draft:
${a.previous}

What they want changed this round: ${a.guidance || "(none — light general polish)"}${standingBlock}${versionsBlock}`
    : `Here is everything the user put in the box. Work out what it is and deliver what they want.\n\nWhat the user wrote:\n${a.input || notes}`;

  // The picker if it was touched, otherwise whatever the note asks for in
  // plain words.
  let lengthKey = String(ctx.length || "");
  if (!LENGTH_RULES[lengthKey]) {
    const asked = `${notes} ${a.guidance}`;
    if (SHORTEN_HINT.test(asked)) lengthKey = "shorter";
    else if (LENGTHEN_HINT.test(asked)) lengthKey = "longer";
  }
  // Measured against whatever is actually being shortened: the current draft on
  // a refine pass, otherwise what the user put in the box.
  const lengthRule = lengthRuleFor(lengthKey, a.previous || a.input || notes);

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
  const wantsRestructure =
    RESTRUCTURE_HINT.test(`${notes} ${a.guidance}`) ||
    actionList.includes("Restructure for clarity") ||
    actionList.includes("Make it skimmable");

  // Rewrite and write-from-notes both change the shape by design, so neither
  // gets a length-preservation clause bolted on.
  const fidelityBlock =
    fidelity === "rewrite" || fidelity === "draft"
      ? FIDELITY_RULES[fidelity]
      : `${FIDELITY_RULES[fidelity]}\n${
          lengthMoves
            ? "- EXCEPTION, length: the user explicitly asked for a length change, and that beats this mode's instinct to leave the length alone. Make the cut (or the expansion) in full. Do it by deleting or merging whole sentences, not by rewriting the sentences you keep."
            : "- Keep the length where it is: the result should land within about 10% of the word count you were given. This one yields to the user's own instructions in the intake: if they asked you to cut it down or flesh it out in their own words, do that instead, in full, and ignore this line."
        }${
          wantsRestructure
            ? '\n- EXCEPTION, order: the user asked you to move things around, so the "do not reorder" line above does not apply to this piece. Re-sequence the paragraphs and points into the order that actually makes sense: lead with the point, group what belongs together, put the ask where it lands. Keep reusing their own sentences as you move them. This is a re-sequencing, not a rewrite.'
            : ""
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
