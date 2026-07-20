import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionProfile } from "@/lib/authz";

export const runtime = "nodejs";

// Any org member can build a team roster — this is a functional "who do I
// want to see rolled up together" grouping, not tied to the org-admin role.
// GET  -> { team: {id,name,members:[...]} | null, orgRoster: [...] }
// POST { name? } -> create/rename the caller's own team
export async function GET() {
  const { userId, profile } = await getSessionProfile();
  if (!userId || !profile?.org_id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: team } = await admin
    .from("dashboard_teams")
    .select("id, name, manager_id")
    .eq("manager_id", userId)
    .maybeSingle();

  let members: { id: string; username: string; display_name: string | null }[] = [];
  if (team) {
    const { data: rows } = await admin.from("dashboard_team_members").select("user_id").eq("team_id", team.id);
    const ids = (rows || []).map((r) => r.user_id as string);
    if (ids.length) {
      const { data: profiles } = await admin
        .from("profiles")
        .select("id, username, display_name")
        .in("id", ids);
      members = profiles || [];
    }
  }

  const { data: roster } = await admin
    .from("profiles")
    .select("id, username, display_name")
    .eq("org_id", profile.org_id)
    .order("username", { ascending: true });

  return NextResponse.json({
    team: team ? { ...team, members } : null,
    orgRoster: roster || [],
  });
}

export async function POST(req: Request) {
  const { userId, profile } = await getSessionProfile();
  if (!userId || !profile?.org_id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const name = String(body.name || "My Team").trim().slice(0, 60) || "My Team";

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("dashboard_teams")
    .upsert({ manager_id: userId, org_id: profile.org_id, name }, { onConflict: "manager_id" })
    .select("id, name, manager_id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ team: data });
}
