import { NextResponse } from "next/server";
import { requireRecordingOwner } from "@/lib/routeAuth";
import { createAdminClient } from "@/lib/supabase/admin";
import { purgeRecordingAudio } from "@/lib/recordingAudio";
import { chunkAudio } from "@/lib/ffmpeg";

export const runtime = "nodejs";
export const maxDuration = 300; // chunking large files can take a while

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await requireRecordingOwner(id);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { recording, userId } = auth;

  if (!recording.storage_path) {
    return NextResponse.json({ error: "No upload found" }, { status: 400 });
  }

  // Idempotent: if we already chunked, just report.
  if (recording.total_chunks > 0 && recording.status !== "uploading") {
    return NextResponse.json({ totalChunks: recording.total_chunks });
  }

  const admin = createAdminClient();

  try {
    const { data: blob, error: dlErr } = await admin.storage
      .from("recordings")
      .download(recording.storage_path);
    if (dlErr || !blob) throw new Error(dlErr?.message || "download failed");

    const inputBuf = Buffer.from(await blob.arrayBuffer());
    const ext = recording.storage_path.split(".").pop() || "bin";
    const { chunks, ext: chunkExt } = await chunkAudio(inputBuf, ext);

    if (chunks.length === 0) throw new Error("No audio chunks produced");

    const chunkType = chunkExt === "mp3" ? "audio/mpeg" : "audio/wav";
    const base = `${userId}/${recording.id}/chunks`;
    for (const chunk of chunks) {
      const name = `${base}/${String(chunk.index).padStart(3, "0")}.${chunkExt}`;
      const { error: upErr } = await admin.storage
        .from("recordings")
        .upload(name, chunk.bytes, { contentType: chunkType, upsert: true });
      if (upErr) throw new Error(`chunk upload failed: ${upErr.message}`);
    }

    // The chunks are now the source of truth for transcription, so the
    // uploaded original has no further use. Delete it here rather than after
    // summarizing: a run that errors out later used to leave the full
    // meeting audio sitting in storage indefinitely.
    await admin.storage.from("recordings").remove([recording.storage_path]);

    await admin
      .from("recordings")
      .update({
        total_chunks: chunks.length,
        chunks_done: 0,
        status: "transcribing",
        error: null,
      })
      .eq("id", recording.id);

    return NextResponse.json({ totalChunks: chunks.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Chunking failed";
    // Failed the same way: don't strand the audio. Everything under this
    // recording's prefix goes.
    await purgeRecordingAudio(admin, userId, recording.id);
    await admin
      .from("recordings")
      .update({ status: "error", error: message })
      .eq("id", recording.id);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
