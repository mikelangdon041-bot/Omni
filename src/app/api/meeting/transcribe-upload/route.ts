import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { chunkAudio } from "@/lib/ffmpeg";
import { openai } from "@/lib/openai";
import { toFile } from "openai";

export const runtime = "nodejs";
export const maxDuration = 300;

const TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || "whisper-1";
// Whisper's own per-request cap.
const MAX_BYTES = 24 * 1024 * 1024;
// Vercel rejects request bodies past ~4.5 MB, so anything bigger has to go
// to storage via a signed URL instead of riding along in a multipart POST.
const DIRECT_LIMIT = 4 * 1024 * 1024;

const ALLOWED_EXT = new Set([
  "mp3", "m4a", "wav", "aac", "ogg", "oga", "webm", "mp4", "mpeg", "mpga", "flac",
]);

// Transcribe an uploaded meeting recording of any size, for a meeting that
// doesn't exist yet. Deliberately owns no database row: the audio is a means
// to a transcript and nothing else, so there is nothing to leave behind and
// nothing to clean up later. The file is deleted in a `finally`, on the
// success path and every failure path alike.
//
//   { action: "sign", ext }          → signed URL to PUT the file straight to storage
//   { action: "from-storage", path } → NDJSON progress stream, ends { type:"done", text }
//   { action: "discard", path }      → drop an upload that never got transcribed
//   multipart `audio`                → small files, transcribed inline
function pathFor(userId: string, ext: string) {
  return `${userId}/meeting-uploads/${crypto.randomUUID()}.${ext}`;
}

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

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const contentType = req.headers.get("content-type") || "";
  const admin = createAdminClient();
  const ownedPrefix = `${user.id}/meeting-uploads/`;

  if (contentType.includes("application/json")) {
    const body = await req.json().catch(() => ({}));

    if (body.action === "sign") {
      const ext = String(body.ext || "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
      if (!ALLOWED_EXT.has(ext)) {
        return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });
      }
      const path = pathFor(user.id, ext);
      const { data: signed, error } = await admin.storage
        .from("recordings")
        .createSignedUploadUrl(path);
      if (error || !signed) {
        return NextResponse.json({ error: "Could not start the upload" }, { status: 500 });
      }
      return NextResponse.json({ path, token: signed.token, signedUrl: signed.signedUrl });
    }

    // Every path below is keyed by the caller's own id, so one user can never
    // reach another's upload.
    const path = String(body.path || "");
    if (!path.startsWith(ownedPrefix)) {
      return NextResponse.json({ error: "Bad path" }, { status: 400 });
    }

    if (body.action === "discard") {
      await admin.storage.from("recordings").remove([path]);
      return NextResponse.json({ ok: true });
    }

    if (body.action === "from-storage") {
      const { data: blob, error } = await admin.storage
        .from("recordings")
        .download(path);
      if (error || !blob) {
        return NextResponse.json(
          { error: "Could not read the uploaded file" },
          { status: 500 },
        );
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
              parts = [
                { bytes: input, name: `upload.${ext}`, type: blob.type || "audio/webm" },
              ];
            } else {
              send({ type: "progress", label: "Splitting the recording into segments…" });
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
            // The transcript is all that survives, however this ended.
            await admin.storage
              .from("recordings")
              .remove([path])
              .then(
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

  // Small file: straight through, nothing ever touches storage.
  const form = await req.formData().catch(() => null);
  const audio = form?.get("audio");
  if (!(audio instanceof File)) {
    return NextResponse.json({ error: "No audio file" }, { status: 400 });
  }
  if (audio.size > DIRECT_LIMIT) {
    return NextResponse.json(
      { error: "That file needs the storage upload path." },
      { status: 413 },
    );
  }
  try {
    const bytes = Buffer.from(await audio.arrayBuffer());
    const text = await whisper(
      bytes,
      audio.name || "upload.webm",
      audio.type || "audio/webm",
    );
    return NextResponse.json({ text });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || "Transcription failed" },
      { status: 500 },
    );
  }
}
