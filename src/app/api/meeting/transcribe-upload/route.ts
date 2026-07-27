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
// nothing to clean up later. The file is deleted in a `finally`, on the
// success path and every failure path alike.
//
// Every upload takes the same route regardless of size — Vercel rejects
// request bodies past ~4.5 MB anyway, and going through storage is what lets
// the file be split into chunks and reported as a real percentage.
//
//   { action: "sign", ext }          → signed URL to PUT the file straight to storage
//   { action: "from-storage", path } → NDJSON progress stream, ends { type:"done", text }
//   { action: "discard", path }      → drop an upload that never got transcribed
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
            // Always split, not just past Whisper's size cap. Chunking is what
            // makes progress meaningful: a 60-minute meeting becomes ~20 pieces
            // that complete one by one, instead of a single opaque request the
            // UI can only spin on.
            send({ type: "progress", label: "Reading the recording" });
            const chunks = await chunkAudio(input, ext);
            const parts = chunks.map((c) => ({
              bytes: c.bytes,
              name: `chunk-${c.index}.wav`,
              type: "audio/wav",
            }));
            if (parts.length === 0) throw new Error("No audio found in that file");

            const total = parts.length;
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
                texts[i] = await whisper(parts[i].bytes, parts[i].name, parts[i].type);
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

  return NextResponse.json(
    { error: "Send JSON: sign, then from-storage." },
    { status: 400 },
  );
}
