import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { chunkAudio } from "@/lib/ffmpeg";
import { openai } from "@/lib/openai";
import { toFile } from "openai";

export const runtime = "nodejs";
export const maxDuration = 300;

const TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || "whisper-1";
// Whisper caps requests at 25 MB; recorded segments stay far below this
// because the recorder restarts MediaRecorder every few minutes.
const MAX_BYTES = 24 * 1024 * 1024;

const ALLOWED_EXT = new Set([
  "mp3", "m4a", "wav", "aac", "ogg", "oga", "webm", "mp4", "mpeg", "mpga", "flac",
]);

async function whisper(bytes: Buffer, name: string, type: string): Promise<string> {
  const file = await toFile(bytes, name, { type });
  const res = await openai().audio.transcriptions.create({
    file,
    model: TRANSCRIBE_MODEL,
    response_format: "text",
  });
  const text =
    typeof res === "string" ? res : ((res as unknown as { text?: string }).text ?? "");
  return text.trim();
}

// Three entry points:
//  * multipart form (`audio` file)      — recorded ~4-min segments (small).
//  * JSON {action:"sign", conferenceId, ext} — signed URL so the client can
//    PUT big uploaded files straight to storage (Vercel caps request bodies
//    at ~4.5 MB, which is why big multipart uploads used to die silently).
//  * JSON {action:"from-storage", conferenceId, path} — download from
//    storage, ffmpeg-chunk if needed, transcribe chunk by chunk and stream
//    NDJSON progress lines so the client can show real x/y numbers.
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const contentType = req.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const body = await req.json().catch(() => ({}));
    const conferenceId = String(body.conferenceId || "");

    // The conference must be visible to this user (org RLS enforces it).
    const { data: conf } = await supabase
      .from("conferences")
      .select("id")
      .eq("id", conferenceId)
      .maybeSingle();
    if (!conf) return NextResponse.json({ error: "Conference not found" }, { status: 404 });

    if (body.action === "sign") {
      const ext = String(body.ext || "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
      if (!ALLOWED_EXT.has(ext)) {
        return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });
      }
      const path = `${conferenceId}/audio-uploads/${crypto.randomUUID()}.${ext}`;
      const admin = createAdminClient();
      const { data: signed, error } = await admin.storage
        .from("conference")
        .createSignedUploadUrl(path);
      if (error || !signed) {
        return NextResponse.json({ error: "Could not sign upload" }, { status: 500 });
      }
      return NextResponse.json({ path, token: signed.token, signedUrl: signed.signedUrl });
    }

    if (body.action === "from-storage") {
      const path = String(body.path || "");
      if (!path.startsWith(`${conferenceId}/audio-uploads/`)) {
        return NextResponse.json({ error: "Bad path" }, { status: 400 });
      }
      const admin = createAdminClient();
      const { data: blob, error } = await admin.storage.from("conference").download(path);
      if (error || !blob) {
        return NextResponse.json({ error: "Could not read the uploaded file" }, { status: 500 });
      }
      const input = Buffer.from(await blob.arrayBuffer());
      const ext = path.split(".").pop() || "bin";

      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          const send = (obj: unknown) =>
            controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
          try {
            let parts: { bytes: Buffer; name: string; type: string }[];
            if (input.length <= MAX_BYTES) {
              parts = [{ bytes: input, name: `upload.${ext}`, type: blob.type || "audio/webm" }];
            } else {
              send({ type: "progress", label: "Splitting audio into segments…" });
              const chunks = await chunkAudio(input, ext);
              parts = chunks.map((c) => ({
                bytes: c.bytes,
                name: `chunk-${c.index}.wav`,
                type: "audio/wav",
              }));
            }
            send({ type: "progress", done: 0, total: parts.length });
            const texts: string[] = [];
            for (let i = 0; i < parts.length; i++) {
              texts.push(await whisper(parts[i].bytes, parts[i].name, parts[i].type));
              send({ type: "progress", done: i + 1, total: parts.length });
            }
            send({ type: "done", text: texts.filter(Boolean).join("\n\n") });
          } catch (err) {
            send({ type: "error", error: (err as Error).message || "Transcription failed" });
          } finally {
            // The tmp upload served its purpose either way.
            await admin.storage.from("conference").remove([path]).then(
              () => {},
              () => {},
            );
            controller.close();
          }
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          "X-Accel-Buffering": "no",
        },
      });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  // Multipart: one small audio segment.
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
    const bytes = Buffer.from(await audio.arrayBuffer());
    const text = await whisper(bytes, audio.name || "segment.webm", audio.type || "audio/webm");
    return NextResponse.json({ text });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || "Transcription failed" },
      { status: 500 },
    );
  }
}
