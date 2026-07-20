import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionProfile } from "@/lib/authz";

export const runtime = "nodejs";

// Replace the caller's team roster wholesale — simplest model for a
// checklist-style "who's on my team" UI. Always re-validates every id
// against the caller's own org, since dashboard_team_members has no org_id
// column of its own to lean on for that.
export async function PUT(req: Request) {
  const { userId, profile } = await getSessionProfile();
  if (!userId || !profile?.org_id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const memberIds: string[] = Array.isArray(body.memberIds) ? body.memberIds.filter((id: unknown) => typeof id === "string") : [];

  const admin = createAdminClient();
  const { data: team } = await admin
    .from("dashboard_teams")
    .select("id")
    .eq("manager_id", userId)
    .maybeSingle();
  if (!team) return NextResponse.json({ error: "Create your team first" }, { status: 400 });

  // Never let team membership smuggle in someone from another company.
  const validIds: string[] = [];
  if (memberIds.length) {
    const { data: valid } = await admin
      .from("profiles")
      .select("id")
      .eq("org_id", profile.org_id)
      .in("id", memberIds);
    validIds.push(...((valid || []).map((r) => r.id as string)));
  }

  await admin.from("dashboard_team_members").delete().eq("team_id", team.id);
  if (validIds.length) {
    await admin.from("dashboard_team_members").insert(validIds.map((user_id) => ({ team_id: team.id, user_id })));
  }

  return NextResponse.json({ ok: true, memberIds: validIds });
}
