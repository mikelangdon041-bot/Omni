import { NextResponse } from "next/server";
import { requireRecordingOwner } from "@/lib/routeAuth";
import { createAdminClient } from "@/lib/supabase/admin";
import { transcribeChunk } from "@/lib/openai";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await requireRecordingOwner(id);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { recording, userId } = auth;

  const body = await req.json().catch(() => ({}));
  const index = Number(body.index);
  if (!Number.isInteger(index) || index < 0 || index >= recording.total_chunks) {
    return NextResponse.json({ error: "Bad chunk index" }, { status: 400 });
  }

  const admin = createAdminClient();
  const chunkPath = `${userId}/${recording.id}/chunks/${String(index).padStart(3, "0")}.wav`;

  try {
    const { data: blob, error: dlErr } = await admin.storage
      .from("recordings")
      .download(chunkPath);
    if (dlErr || !blob) throw new Error(dlErr?.message || "chunk download failed");

    const text = await transcribeChunk(await blob.arrayBuffer(), `chunk-${index}.wav`);

    // Re-read transcript, append this chunk's text, write back. The worker calls
    // chunks sequentially so this read-modify-write stays ordered.
    const { data: fresh } = await admin
      .from("recordings")
      .select("transcript, chunks_done")
      .eq("id", recording.id)
      .single();

    const prior = fresh?.transcript || "";
    const merged = prior ? `${prior}\n\n${text}`.trim() : text;
    const chunksDone = Math.max(fresh?.chunks_done || 0, index + 1);

    await admin
      .from("recordings")
      .update({ transcript: merged, chunks_done: chunksDone })
      .eq("id", recording.id);

    // Best-effort cleanup of the consumed chunk.
    await admin.storage.from("recordings").remove([chunkPath]);

    return NextResponse.json({
      chunksDone,
      totalChunks: recording.total_chunks,
      done: chunksDone >= recording.total_chunks,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Transcription failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
