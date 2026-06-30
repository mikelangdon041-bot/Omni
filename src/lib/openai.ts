import OpenAI, { toFile } from "openai";

let _client: OpenAI | null = null;

export function openai() {
  if (!_client) {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error("OPENAI_API_KEY is not set");
    _client = new OpenAI({ apiKey: key });
  }
  return _client;
}

const TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || "whisper-1";
const SUMMARY_MODEL = process.env.OPENAI_SUMMARY_MODEL || "gpt-4o";

// Transcribe one audio chunk. `bytes` is the raw chunk (wav).
export async function transcribeChunk(
  bytes: ArrayBuffer,
  filename = "chunk.wav",
): Promise<string> {
  const file = await toFile(Buffer.from(bytes), filename, {
    type: "audio/wav",
  });
  const res = await openai().audio.transcriptions.create({
    file,
    model: TRANSCRIBE_MODEL,
    response_format: "text",
  });
  // With response_format "text", the SDK returns a plain string.
  const text =
    typeof res === "string"
      ? res
      : (res as unknown as { text?: string }).text ?? "";
  return text.trim();
}

const SUMMARY_SYSTEM_PROMPT = `You turn an interview transcript into a thorough, faithful, nested bullet outline that someone who was NOT in the room could read and fully understand what was covered.

Structure:
- Output ONLY a nested bullet list. No preamble, no headings, no closing remarks, no markdown bold/italics.
- Use "- " for every bullet. Indent each level with exactly 2 spaces (0, 2, 4, 6 …).
- Each top-level bullet is a distinct topic, question, or theme from the conversation. Under it, nest the discussion: what was asked, how it was answered, examples given, follow-ups, and any conclusions. Go 2–3 levels deep where the content warrants it.
- Organize the whole interview top to bottom: opening/background, each substantive topic or question explored, and any wrap-up or next steps.

Completeness (most important):
- Every bullet must be a COMPLETE, SELF-CONTAINED sentence — never a 2–6 word label or fragment. Write it so it stands on its own without the heading.
- Capture the substance, not just the topic: include the specifics of what was actually said — names, numbers, dates, companies, products, roles, projects, metrics, tools, outcomes, opinions, concerns, and reasoning.
- Be comprehensive. It is better to include a detail than to drop it. Do not compress multiple distinct points into one vague bullet.
- Group genuinely repeated ideas together so nothing is said twice, but do not omit distinct details just to be brief.

Faithfulness:
- Include only what was actually said. Do not infer, assume, embellish, or add information that is not in the transcript.
- Preserve the speaker's meaning and any specific figures or quotes accurately.`;

// Summarize a full transcript into a detailed indented bullet outline (plain text).
export async function summarizeTranscript(transcript: string): Promise<string> {
  // Allow generous output so long interviews aren't truncated into terse bullets.
  const maxTokens = Math.min(8000, Math.max(2000, Math.round(transcript.length / 3)));
  const res = await openai().chat.completions.create({
    model: SUMMARY_MODEL,
    temperature: 0.3,
    max_tokens: maxTokens,
    messages: [
      { role: "system", content: SUMMARY_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Organize this interview transcript into a detailed, complete nested bullet outline that captures everything discussed:\n\n${transcript}`,
      },
    ],
  });
  return res.choices[0]?.message?.content?.trim() || "";
}

const QUESTION_SYSTEM_PROMPT = `You are an expert interviewer who writes sharp, specific interview questions.

- Return ONLY JSON of the form {"questions": ["...", "..."]}. No prose outside the JSON.
- Each item is a single, clear, standalone question.
- Tailor questions to the role and to specifics in the candidate's background (companies, projects, technologies, gaps, achievements). Reference concrete details where possible.
- Mix question types: role/competency, behavioral (past experience), and resume-specific probes.
- Do not repeat or lightly reword any question the user already has.
- Keep each question concise and conversational — something you'd actually say out loud.`;

// Suggest interview questions tailored to a candidate's resume + role.
export async function suggestInterviewQuestions(opts: {
  resumeText?: string;
  role?: string;
  existing?: string[];
  count?: number;
}): Promise<string[]> {
  const { resumeText = "", role = "", existing = [], count = 10 } = opts;
  const user = `Role / position: ${role || "(unspecified)"}

Candidate background / resume:
${resumeText.trim() || "(no resume text provided — base questions on the role and general best practice)"}

Questions already planned (do NOT duplicate these):
${existing.length ? existing.map((q) => `- ${q}`).join("\n") : "(none)"}

Generate ${count} strong interview questions.`;

  const res = await openai().chat.completions.create({
    model: SUMMARY_MODEL,
    temperature: 0.6,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: QUESTION_SYSTEM_PROMPT },
      { role: "user", content: user },
    ],
  });

  try {
    const parsed = JSON.parse(res.choices[0]?.message?.content || "{}");
    const arr = Array.isArray(parsed.questions) ? parsed.questions : [];
    return arr
      .map((q: unknown) => String(q).trim())
      .filter((q: string) => q.length > 0)
      .slice(0, count);
  } catch {
    return [];
  }
}
