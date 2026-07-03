import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { openai } from "@/lib/openai";
import { toFile } from "openai";

export const runtime = "nodejs";
export const maxDuration = 300;

const TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || "whisper-1";
// Whisper caps requests at 25 MB; the recorder keeps segments well under this
// by restarting MediaRecorder every few minutes.
const MAX_BYTES = 24 * 1024 * 1024;

// Transcribe one audio segment (multipart form: `audio` file). The client
// pipeline is chunk-at-source: record in ~4-minute standalone segments (or a
// single uploaded file) and append transcripts in order — no ffmpeg needed,
// so this works on serverless.
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const audio = form?.get("audio");
  if (!(audio instanceof File)) {
    return NextResponse.json({ error: "No audio file" }, { status: 400 });
  }
  if (audio.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "Audio segment too large (max 24 MB). Try a shorter clip or a compressed format (m4a/webm)." },
      { status: 413 },
    );
  }

  try {
    const bytes = await audio.arrayBuffer();
    const name = audio.name || "segment.webm";
    const file = await toFile(Buffer.from(bytes), name, {
      type: audio.type || "audio/webm",
    });
    const res = await openai().audio.transcriptions.create({
      file,
      model: TRANSCRIBE_MODEL,
      response_format: "text",
    });
    const text =
      typeof res === "string" ? res : ((res as unknown as { text?: string }).text ?? "");
    return NextResponse.json({ text: text.trim() });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || "Transcription failed" },
      { status: 500 },
    );
  }
}
