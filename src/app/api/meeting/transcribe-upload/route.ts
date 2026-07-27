import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { chunkAudio } from "@/lib/ffmpeg";
import { openai } from "@/lib/openai";
import { toFile } from "openai";

export const runtime = "nodejs";
export const maxDuration = 300;

const TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || "whisper-1";
// Whisper calls run a few at a time — transcribing a full-length meeting one
// chunk after another overran the function's time limit.
const CONCURRENCY = 4;

const ALLOWED_EXT = new Set([
  "mp3", "m4a", "wav", "aac", "ogg", "oga", "webm", "mp4", "mpeg", "mpga", "flac",
]);

// Transcribe an uploaded meeting recording of any size, for a meeting that
// doesn't exist yet. Deliberately owns no database row: the audio is a means
// to a transcript and nothing else, so there is nothing to leave behind and
// nothing to clean up later. Everything under the upload's prefix is deleted
// in a `finally`, on the success path and every failure path alike.
//
// Uploads arrive in parts. Two ceilings force it: Vercel rejects request
// bodies past ~4.5 MB (so the file can't be POSTed here), and Supabase
// storage rejects any single object over 50 MB — reported, confusingly, as a
// 400 whose body says 413. A 90-minute meeting clears both easily, so the
// client slices the file and PUTs each slice separately; this route stitches
// the bytes back together before handing them to ffmpeg.
//
//   { action: "sign", uploadId, part, ext } → signed URL for one part
//   { action: "from-storage", uploadId, parts, ext }
//                                           → NDJSON progress, ends { type:"done", text }
//   { action: "discard", uploadId }         → drop an upload that never got transcribed
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function partPath(userId: string, uploadId: string, part: number, ext: string) {
  return `${userId}/meeting-uploads/${uploadId}/${String(part).padStart(3, "0")}.${ext}`;
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

// Remove every part of an upload. Best-effort: never fail a caller over it.
async function purge(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  uploadId: string,
) {
  try {
    const prefix = `${userId}/meeting-uploads/${uploadId}`;
    const { data } = await admin.storage.from("recordings").list(prefix);
    const paths = (data || []).filter((e) => e.id).map((e) => `${prefix}/${e.name}`);
    if (paths.length) await admin.storage.from("recordings").remove(paths);
  } catch {
    // best-effort
  }
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Expected JSON" }, { status: 400 });

  const admin = createAdminClient();

  const uploadId = String(body.uploadId || "");
  if (!UUID_RE.test(uploadId)) {
    return NextResponse.json({ error: "Bad upload id" }, { status: 400 });
  }
  const ext = String(body.ext || "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!ALLOWED_EXT.has(ext)) {
    return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });
  }

  if (body.action === "sign") {
    const part = Number(body.part);
    if (!Number.isInteger(part) || part < 0 || part > 999) {
      return NextResponse.json({ error: "Bad part number" }, { status: 400 });
    }
    const path = partPath(user.id, uploadId, part, ext);
    const { data: signed, error } = await admin.storage
      .from("recordings")
      .createSignedUploadUrl(path);
    if (error || !signed) {
      return NextResponse.json({ error: "Could not start the upload" }, { status: 500 });
    }
    return NextResponse.json({ signedUrl: signed.signedUrl });
  }

  if (body.action === "discard") {
    await purge(admin, user.id, uploadId);
    return NextResponse.json({ ok: true });
  }

  if (body.action === "from-storage") {
    const parts = Number(body.parts);
    if (!Number.isInteger(parts) || parts < 1 || parts > 1000) {
      return NextResponse.json({ error: "Bad part count" }, { status: 400 });
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (obj: unknown) =>
          controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
        try {
          // Stitch the slices back into the original file, in order.
          send({ type: "progress", label: "Reading the recording" });
          const buffers: Buffer[] = [];
          for (let i = 0; i < parts; i++) {
            const { data: blob, error } = await admin.storage
              .from("recordings")
              .download(partPath(user.id, uploadId, i, ext));
            if (error || !blob) throw new Error("The upload was incomplete.");
            buffers.push(Buffer.from(await blob.arrayBuffer()));
          }
          const input = Buffer.concat(buffers);
          buffers.length = 0;

          // Always split, not just past Whisper's size cap. Chunking is what
          // makes progress meaningful: a 60-minute meeting becomes ~20 pieces
          // that complete one by one, instead of a single opaque request the
          // UI can only spin on.
          const audioChunks = await chunkAudio(input, ext);
          const pieces = audioChunks.map((c) => ({
            bytes: c.bytes,
            name: `chunk-${c.index}.wav`,
            type: "audio/wav",
          }));
          if (pieces.length === 0) throw new Error("No audio found in that file");

          const total = pieces.length;
          send({ type: "progress", done: 0, total });

          // Transcribe a few at a time. Sequential was simpler, but a
          // full-length meeting then ran past the function's time limit.
          // Results are stored by index so the transcript stays in order.
          const texts: string[] = new Array(total).fill("");
          let done = 0;
          let next = 0;
          const worker = async () => {
            for (;;) {
              const i = next++;
              if (i >= total) return;
              texts[i] = await whisper(pieces[i].bytes, pieces[i].name, pieces[i].type);
              done += 1;
              send({ type: "progress", done, total });
            }
          };
          await Promise.all(
            Array.from({ length: Math.min(CONCURRENCY, total) }, worker),
          );

          send({ type: "done", text: texts.filter(Boolean).join("\n\n") });
        } catch (err) {
          send({ type: "error", error: (err as Error).message || "Transcription failed" });
        } finally {
          // The transcript is all that survives, however this ended.
          await purge(admin, user.id, uploadId);
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
