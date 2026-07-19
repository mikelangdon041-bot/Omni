import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSessionProfile } from "@/lib/authz";

export const runtime = "nodejs";

// RLS alone decides what comes back: the signed-in user's own tiles, plus —
// for org admins/owners — every tile in their org (see 0024_dashboard.sql).
export async function GET() {
  const supabase = await createClient();
  const { userId } = await getSessionProfile();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("dashboard_tiles")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tiles: data || [] });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { userId, profile } = await getSessionProfile();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const title: string = (body?.title || "").trim();
  const datasetId: string = body?.datasetId || "";
  const spec = body?.spec;
  if (!title || !datasetId || !spec) {
    return NextResponse.json({ error: "Missing title, datasetId, or spec" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("dashboard_tiles")
    .insert({
      org_id: profile?.org_id ?? null,
      created_by: userId,
      title,
      dataset_id: datasetId,
      spec,
    })
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tile: data });
}
