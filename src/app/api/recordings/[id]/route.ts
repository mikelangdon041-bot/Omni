import { NextResponse } from "next/server";
import { requireRecordingOwner } from "@/lib/routeAuth";
import { createAdminClient } from "@/lib/supabase/admin";
import { purgeRecordingAudio } from "@/lib/recordingAudio";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Status polling: returns the recording plus its summary nodes.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await requireRecordingOwner(id);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { recording } = auth;

  const supabase = await createClient();
  const { data: nodes } = await supabase
    .from("summary_nodes")
    .select("id, parent_id, content, depth, sort_order")
    .eq("recording_id", id)
    .order("sort_order", { ascending: true });

  return NextResponse.json({ recording, nodes: nodes || [] });
}

// Deleting a recording must take its audio with it. Deleting the row alone
// (what the client used to do directly) left any audio that hadn't been
// consumed yet orphaned in storage with nothing left pointing at it.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await requireRecordingOwner(id);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  await purgeRecordingAudio(createAdminClient(), auth.userId, id);

  const supabase = await createClient();
  // summary_nodes cascade from the recording row.
  const { error } = await supabase.from("recordings").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
