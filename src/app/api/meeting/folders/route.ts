import { NextResponse } from "next/server";
import { routeAuth } from "@/lib/supabase/route";

export const runtime = "nodejs";

// Person / topic folders a recording can be filed under. Used by the web
// library view and, over a bearer token, by the desktop recorder's
// destination picker (see desktop/src-tauri/src/omni.rs — list_folders /
// create_folder).
//
//   GET  -> every folder, alphabetical within kind, with the linked KOL's
//           name resolved so the picker doesn't need a second round trip.
//   POST -> create a folder, or hand back the existing one if the name
//           (case-insensitive) already exists — so typing "Sam" mid-meeting
//           twice reuses the folder instead of erroring.
export async function GET(req: Request) {
  const { supabase, user } = await routeAuth(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("mp_folders")
    .select("id, kind, name, kol_id, kols(first_name, last_name)")
    .eq("user_id", user.id)
    .order("kind", { ascending: true })
    .order("name", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const folders = (data || []).map((f) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const kol = (f as any).kols as { first_name: string; last_name: string } | null;
    return {
      id: f.id as string,
      kind: f.kind as "person" | "topic",
      name: f.name as string,
      kolId: f.kol_id as string | null,
      kolName: kol ? `${kol.first_name} ${kol.last_name}`.trim() : null,
    };
  });

  return NextResponse.json({ folders });
}

export async function POST(req: Request) {
  const { supabase, user } = await routeAuth(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Expected JSON" }, { status: 400 });

  const kind: "person" | "topic" = body.kind === "topic" ? "topic" : "person";
  const kolId = kind === "person" && body.kolId ? String(body.kolId) : null;

  let name = String(body.name || "").trim();
  if (!name && kolId) {
    const { data: kol } = await supabase
      .from("kols")
      .select("first_name, last_name")
      .eq("id", kolId)
      .maybeSingle();
    if (kol) name = `${kol.first_name} ${kol.last_name}`.trim();
  }
  if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });

  const { data: inserted, error } = await supabase
    .from("mp_folders")
    .insert({ user_id: user.id, kind, name, kol_id: kolId })
    .select("id, kind, name, kol_id")
    .single();

  if (error) {
    // Unique violation on (user_id, kind, lower(name)) or (user_id, kol_id):
    // the folder already exists — hand it back rather than fail the picker.
    if (error.code === "23505") {
      const existing = kolId
        ? await supabase
            .from("mp_folders")
            .select("id, kind, name, kol_id")
            .eq("user_id", user.id)
            .eq("kol_id", kolId)
            .maybeSingle()
        : await supabase
            .from("mp_folders")
            .select("id, kind, name, kol_id")
            .eq("user_id", user.id)
            .eq("kind", kind)
            .ilike("name", name)
            .maybeSingle();
      if (existing.data) {
        return NextResponse.json({
          folder: {
            id: existing.data.id,
            kind: existing.data.kind,
            name: existing.data.name,
            kolId: existing.data.kol_id,
          },
        });
      }
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    folder: { id: inserted.id, kind: inserted.kind, name: inserted.name, kolId: inserted.kol_id },
  });
}
