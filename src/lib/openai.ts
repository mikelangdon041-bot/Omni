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

const SUMMARY_SYSTEM_PROMPT = `You organize an interview transcript into a faithful, nested bullet-point outline.

Rules:
- Output ONLY a nested bullet list. No preamble, no headings, no closing remarks.
- Use "- " for every bullet. Indent sub-points with exactly 2 spaces per level.
- Top-level bullet = a main topic or theme. Indented sub-bullets = supporting details under it. Go deeper (4, 6 spaces) where the detail warrants it.
- Group similar ideas together even if they were said at different times. Do not repeat the same point twice.
- Preserve every specific number, name, date, dosage, product, and quote. Do not round or generalize them away.
- Only include what was actually said. Do not infer, assume, or add information that is not in the transcript.
- Keep each bullet concise (a phrase or short sentence), not a paragraph.`;

// Summarize a full transcript into an indented bullet outline (plain text).
export async function summarizeTranscript(transcript: string): Promise<string> {
  const res = await openai().chat.completions.create({
    model: SUMMARY_MODEL,
    temperature: 0.3,
    messages: [
      { role: "system", content: SUMMARY_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Organize this interview transcript into a nested bullet outline:\n\n${transcript}`,
      },
    ],
  });
  return res.choices[0]?.message?.content?.trim() || "";
}
