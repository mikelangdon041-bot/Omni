import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

// List the caller's company members (for assigning to candidates).
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: me } = await supabase
    .from("profiles")
    .select("org_id")
    .eq("id", user.id)
    .single();
  if (!me?.org_id) return NextResponse.json({ members: [] });

  const admin = createAdminClient();
  const { data } = await admin
    .from("profiles")
    .select("id, username, display_name")
    .eq("org_id", me.org_id)
    .eq("is_active", true)
    .neq("id", user.id)
    .order("username", { ascending: true });

  return NextResponse.json({ members: data || [] });
}
