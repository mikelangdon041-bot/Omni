import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireRecordingOwner } from "@/lib/routeAuth";
import { createAdminClient } from "@/lib/supabase/admin";
import { summarizeTranscript } from "@/lib/openai";
import { parseOutline } from "@/lib/summaryTree";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await requireRecordingOwner(id);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { recording } = auth;

  const transcript = (recording.transcript || "").trim();
  if (!transcript) {
    return NextResponse.json({ error: "Nothing to summarize yet" }, { status: 400 });
  }

  const admin = createAdminClient();

  try {
    await admin.from("recordings").update({ status: "summarizing" }).eq("id", recording.id);

    const outline = await summarizeTranscript(transcript);
    const bullets = parseOutline(outline);
    if (bullets.length === 0) throw new Error("Summary was empty");

    // Convert flat {content, depth} bullets into adjacency-list rows. A stack
    // holds the most recent node id at each depth so each bullet can find its
    // parent (the nearest ancestor at depth-1).
    const parentByDepth: string[] = [];
    const rows = bullets.map((b, i) => {
      const nodeId = randomUUID();
      const parentId = b.depth > 0 ? parentByDepth[b.depth - 1] || null : null;
      parentByDepth[b.depth] = nodeId;
      parentByDepth.length = b.depth + 1; // drop deeper stale entries
      return {
        id: nodeId,
        recording_id: recording.id,
        parent_id: parentId,
        content: b.content,
        depth: b.depth,
        sort_order: i,
      };
    });

    // Idempotent re-run: clear any prior nodes first.
    await admin.from("summary_nodes").delete().eq("recording_id", recording.id);
    const { error: insErr } = await admin.from("summary_nodes").insert(rows);
    if (insErr) throw new Error(insErr.message);

    // Transcript is all we needed — drop the original audio to save storage.
    if (recording.storage_path) {
      await admin.storage.from("recordings").remove([recording.storage_path]);
    }

    await admin
      .from("recordings")
      .update({ status: "complete", error: null })
      .eq("id", recording.id);

    return NextResponse.json({ ok: true, nodes: rows.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Summarization failed";
    await admin
      .from("recordings")
      .update({ status: "error", error: message })
      .eq("id", recording.id);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
