import { NextResponse } from "next/server";
import { routeAuth } from "@/lib/supabase/route";

export const runtime = "nodejs";

// Rename a folder, relink it to a different KOL, or delete it. Deleting
// leaves its meetings in place — mp_meetings.folder_id references this row
// ON DELETE SET NULL, so they fall back to Uncategorized rather than
// disappearing.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await routeAuth(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Expected JSON" }, { status: 400 });

  const patch: { name?: string; kol_id?: string | null } = {};
  if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();
  if ("kolId" in body) patch.kol_id = body.kolId ? String(body.kolId) : null;
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("mp_folders")
    .update(patch)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id, kind, name, kol_id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "A folder with that name already exists" },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    folder: { id: data.id, kind: data.kind, name: data.name, kolId: data.kol_id },
  });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, user } = await routeAuth(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { error } = await supabase
    .from("mp_folders")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
