import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeUsername } from "@/lib/auth";

export const runtime = "nodejs";

// Verify the caller owns the candidate; returns user or an error response.
async function requireOwner(candidateId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const { data: candidate } = await supabase
    .from("candidates")
    .select("id")
    .eq("id", candidateId)
    .eq("user_id", user.id)
    .single();
  if (!candidate)
    return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  return { user, supabase };
}

// Resolve usernames for a set of user ids via the admin (service-role) client.
async function usernamesFor(ids: string[]) {
  if (ids.length === 0) return new Map<string, string>();
  const admin = createAdminClient();
  const { data } = await admin
    .from("profiles")
    .select("id, username")
    .in("id", ids);
  return new Map((data || []).map((p) => [p.id, p.username as string]));
}

// POST: create/update a share.  body: { candidateId, username, scope }
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const candidateId = String(body.candidateId || "");
  const username = normalizeUsername(String(body.username || ""));
  const scope =
    body.scope && typeof body.scope === "object" ? body.scope : { all: true };
  if (!candidateId || !username) {
    return NextResponse.json({ error: "candidateId and username required" }, { status: 400 });
  }

  const owner = await requireOwner(candidateId);
  if ("error" in owner) return owner.error;

  const admin = createAdminClient();
  const { data: target } = await admin
    .from("profiles")
    .select("id, username")
    .eq("username", username)
    .single();
  if (!target) {
    return NextResponse.json({ error: "No user with that username" }, { status: 404 });
  }
  if (target.id === owner.user.id) {
    return NextResponse.json({ error: "You already own this candidate" }, { status: 400 });
  }

  const { error } = await owner.supabase.from("candidate_shares").upsert(
    {
      candidate_id: candidateId,
      shared_with: target.id,
      scope,
      created_by: owner.user.id,
    },
    { onConflict: "candidate_id,shared_with" },
  );
  if (error) {
    return NextResponse.json({ error: "Could not share" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

// GET: list shares for a candidate (with usernames).  ?candidateId=
export async function GET(req: Request) {
  const candidateId = new URL(req.url).searchParams.get("candidateId") || "";
  const owner = await requireOwner(candidateId);
  if ("error" in owner) return owner.error;

  const { data: shares } = await owner.supabase
    .from("candidate_shares")
    .select("id, shared_with, scope, created_at")
    .eq("candidate_id", candidateId);

  const names = await usernamesFor((shares || []).map((s) => s.shared_with));
  const result = (shares || []).map((s) => ({
    id: s.id,
    username: names.get(s.shared_with) || "(unknown)",
    scope: s.scope,
  }));
  return NextResponse.json({ shares: result });
}

// DELETE: remove a share.  ?id=
export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id") || "";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // RLS (cs_owner_all → is_candidate_owner) ensures only the candidate owner deletes.
  const { error } = await supabase.from("candidate_shares").delete().eq("id", id);
  if (error) return NextResponse.json({ error: "Could not remove" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
