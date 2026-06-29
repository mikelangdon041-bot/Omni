import { NextResponse } from "next/server";
import { requireRecordingOwner } from "@/lib/routeAuth";
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
