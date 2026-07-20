import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSessionProfile } from "@/lib/authz";
import type { ImportColumn } from "@/lib/dashboard/types";

export const runtime = "nodejs";

const MAX_ROWS = 20000;
const MAX_COLS = 60;

// GET  -> metadata only (no row data — the catalog just needs shape)
// POST { title, columns, rows } -> store a parsed workbook as a dataset
export async function GET() {
  const supabase = await createClient();
  const { userId } = await getSessionProfile();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("dashboard_imports")
    .select("id, org_id, created_by, title, columns, row_count, created_at")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ imports: data || [] });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { userId, profile } = await getSessionProfile();
  if (!userId || !profile?.org_id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const title: string = String(body.title || "").trim().slice(0, 120);
  const columns: ImportColumn[] = Array.isArray(body.columns) ? body.columns.slice(0, MAX_COLS) : [];
  const rows: Record<string, unknown>[] = Array.isArray(body.rows) ? body.rows.slice(0, MAX_ROWS) : [];

  if (!title) return NextResponse.json({ error: "Title is required" }, { status: 400 });
  if (!columns.length) return NextResponse.json({ error: "No columns found" }, { status: 400 });
  if (!rows.length) return NextResponse.json({ error: "No rows found" }, { status: 400 });

  const { data, error } = await supabase
    .from("dashboard_imports")
    .insert({
      org_id: profile.org_id,
      created_by: userId,
      title,
      columns,
      rows,
      row_count: rows.length,
    })
    .select("id, org_id, created_by, title, columns, row_count, created_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ import: data });
}
