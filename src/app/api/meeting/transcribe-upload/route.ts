import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { chunkAudio } from "@/lib/ffmpeg";
import { openai } from "@/lib/openai";
import { toFile } from "openai";

export const runtime = "nodejs";
export const maxDuration = 300;

const TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || "whisper-1";

const ALLOWED_EXT = new Set([
  "mp3", "m4a", "wav", "aac", "ogg", "oga", "webm", "mp4", "mpeg", "mpga", "flac",
]);

// Transcribe an uploaded meeting recording of any size, for a meeting that
// doesn't exist yet. Deliberately owns no database row: the audio is a means
// to a transcript and nothing else, so there is nothing to leave behind.
//
// The work is split across several short requests rather than done in one.
// Transcribing every chunk inside a single call put a hard ceiling on
// recording length — a long meeting simply ran past the function's time limit
// and lost the whole job. Now each chunk is its own request, so total duration
// is bounded by the client's loop, not by one invocation.
//
//   { action: "sign", uploadId, part, ext }    → signed URL for one upload part
//   { action: "prepare", uploadId, parts, ext } → reassemble + split to mp3
//                                                 chunks; → { totalChunks, chunkExt }
//   { action: "chunk", uploadId, index, chunkExt } → transcribe one chunk → { text }
//   { action: "discard", uploadId }            → drop everything left behind
//
// Uploads arrive in parts because of two ceilings: Vercel rejects request
// bodies past ~4.5 MB, and Supabase storage rejects any single object over
// 50 MB — reported, confusingly, as a 400 whose body says 413.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const prefixFor = (userId: string, uploadId: string) =>
  `${userId}/meeting-uploads/${uploadId}`;
const partPath = (userId: string, uploadId: string, part: number, ext: string) =>
  `${prefixFor(userId, uploadId)}/${String(part).padStart(3, "0")}.${ext}`;
const chunkPath = (userId: string, uploadId: string, index: number, ext: string) =>
  `${prefixFor(userId, uploadId)}/chunks/${String(index).padStart(3, "0")}.${ext}`;

const mimeForExt = (e: string) =>
  e === "mp3" ? "audio/mpeg"
  : e === "webm" ? "audio/webm"
  : e === "wav" ? "audio/wav"
  : e === "ogg" || e === "oga" ? "audio/ogg"
  : e === "flac" ? "audio/flac"
  : "audio/mp4";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

type Admin = ReturnType<typeof createAdminClient>;

// Storage can lag between a successful write and the object being readable,
// so a download that 404s immediately after an upload is worth retrying.
async function downloadWithRetry(admin: Admin, path: string): Promise<Buffer> {
  const delays = [0, 500, 1000, 2000, 4000];
  let last = "not found";
  for (const delay of delays) {
    if (delay) await sleep(delay);
    const { data, error } = await admin.storage.from("recordings").download(path);
    if (data) return Buffer.from(await data.arrayBuffer());
    last = error?.message || last;
  }
  throw new Error(`Could not read the upload (${last})`);
}

async function uploadWithRetry(admin: Admin, path: string, bytes: Buffer, type: string) {
  let last = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { error } = await admin.storage
      .from("recordings")
      .upload(path, bytes, { contentType: type, upsert: true });
    if (!error) return;
    last = error.message;
    if (attempt < 3) await sleep(attempt * 1000);
  }
  throw new Error(`Could not stage the audio (${last})`);
}

// Remove everything under an upload's prefix, chunks included.
async function purge(admin: Admin, userId: string, uploadId: string) {
  try {
    const root = prefixFor(userId, uploadId);
    const paths: string[] = [];
    for (const sub of ["", "/chunks"]) {
      const { data } = await admin.storage.from("recordings").list(root + sub);
      for (const entry of data || []) {
        if (entry.id) paths.push(`${root}${sub}/${entry.name}`);
      }
    }
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

  try {
    if (body.action === "sign") {
      const ext = String(body.ext || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      if (!ALLOWED_EXT.has(ext)) {
        return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });
      }
      const part = Number(body.part);
      if (!Number.isInteger(part) || part < 0 || part > 999) {
        return NextResponse.json({ error: "Bad part number" }, { status: 400 });
      }
      const { data: signed, error } = await admin.storage
        .from("recordings")
        .createSignedUploadUrl(partPath(user.id, uploadId, part, ext));
      if (error || !signed) {
        return NextResponse.json({ error: "Could not start the upload" }, { status: 500 });
      }
      return NextResponse.json({ signedUrl: signed.signedUrl });
    }

    if (body.action === "discard") {
      await purge(admin, user.id, uploadId);
      return NextResponse.json({ ok: true });
    }

    // Reassemble the uploaded parts, split the audio, and stage the chunks.
    // Bounded by ffmpeg, not by transcription — that's what keeps it inside
    // the time limit however long the recording is.
    if (body.action === "prepare") {
      const ext = String(body.ext || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      if (!ALLOWED_EXT.has(ext)) {
        return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });
      }
      const parts = Number(body.parts);
      if (!Number.isInteger(parts) || parts < 1 || parts > 1000) {
        return NextResponse.json({ error: "Bad part count" }, { status: 400 });
      }

      const buffers: Buffer[] = [];
      for (let i = 0; i < parts; i++) {
        buffers.push(await downloadWithRetry(admin, partPath(user.id, uploadId, i, ext)));
      }
      const input = Buffer.concat(buffers);
      buffers.length = 0;

      const { chunks, ext: chunkExt } = await chunkAudio(input, ext);
      if (chunks.length === 0) {
        await purge(admin, user.id, uploadId);
        return NextResponse.json({ error: "No audio found in that file" }, { status: 400 });
      }

      const type = mimeForExt(chunkExt);
      await Promise.all(
        chunks.map((c) =>
          uploadWithRetry(
            admin,
            chunkPath(user.id, uploadId, c.index, chunkExt),
            c.bytes,
            type,
          ),
        ),
      );

      // The source parts have served their purpose; only the chunks are read
      // from here on, and they go too as each is transcribed.
      const root = prefixFor(user.id, uploadId);
      const { data: listed } = await admin.storage.from("recordings").list(root);
      const stale = (listed || []).filter((e) => e.id).map((e) => `${root}/${e.name}`);
      if (stale.length) await admin.storage.from("recordings").remove(stale);

      return NextResponse.json({ totalChunks: chunks.length, chunkExt });
    }

    // One chunk, one request. The client drives the loop, so a three-hour
    // recording is just more requests rather than one that times out.
    if (body.action === "chunk") {
      const chunkExt = String(body.chunkExt || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      if (!chunkExt) {
        return NextResponse.json({ error: "Bad chunk type" }, { status: 400 });
      }
      const index = Number(body.index);
      if (!Number.isInteger(index) || index < 0 || index > 9999) {
        return NextResponse.json({ error: "Bad chunk index" }, { status: 400 });
      }
      const path = chunkPath(user.id, uploadId, index, chunkExt);
      const bytes = await downloadWithRetry(admin, path);
      const text = await whisper(bytes, `chunk-${index}.${chunkExt}`, mimeForExt(chunkExt));
      // Consumed — drop it now rather than waiting for the final sweep.
      await admin.storage.from("recordings").remove([path]);
      return NextResponse.json({ text });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || "Transcription failed" },
      { status: 500 },
    );
  }
}
