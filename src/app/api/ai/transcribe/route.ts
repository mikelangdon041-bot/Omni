import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { openai } from "@/lib/openai";
import { toFile } from "openai";

export const runtime = "nodejs";
export const maxDuration = 300;

const TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || "whisper-1";
// Whisper caps requests at 25 MB; callers send recorded ~4-minute segments
// or small uploads, both far below the cap.
const MAX_BYTES = 24 * 1024 * 1024;

// Module-agnostic audio → text (multipart `audio` file). Used by Meeting
// Prep (prior-meeting transcripts, grill-me answers, debriefs) and Slide
// Studio (practice runs). Conference keeps its own richer endpoint.
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const audio = form?.get("audio");
  if (!audio || !(audio instanceof File)) {
    return NextResponse.json({ error: "No audio provided" }, { status: 400 });
  }
  if (audio.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "That file is too big for one request — record in segments or trim it." },
      { status: 413 },
    );
  }

  try {
    const file = await toFile(
      Buffer.from(await audio.arrayBuffer()),
      audio.name || "audio.webm",
      { type: audio.type || "audio/webm" },
    );
    const res = await openai().audio.transcriptions.create({
      file,
      model: TRANSCRIBE_MODEL,
      response_format: "text",
    });
    const text =
      typeof res === "string" ? res : ((res as unknown as { text?: string }).text ?? "");
    return NextResponse.json({ text: text.trim() });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Transcription failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
