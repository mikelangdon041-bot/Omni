import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionProfile, isAdmin } from "@/lib/authz";
import { usernameToEmail } from "@/lib/auth";

export const runtime = "nodejs";

const RETURN_COOKIE = "omni-admin-return";

export async function POST(req: Request) {
  const { userId, profile } = await getSessionProfile();
  if (!userId || !isAdmin(profile) || !profile?.org_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const targetId = String(body.userId || "");
  if (!targetId) return NextResponse.json({ error: "userId required" }, { status: 400 });

  const admin = createAdminClient();
  const { data: target } = await admin
    .from("profiles")
    .select("username, org_id, role")
    .eq("id", targetId)
    .single();
  if (!target || target.org_id !== profile.org_id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (target.role !== "member") {
    return NextResponse.json(
      { error: "You can only impersonate members" },
      { status: 403 },
    );
  }

  const supabase = await createClient();

  // 1) Stash the admin's own refresh token so we can return later.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.refresh_token) {
    return NextResponse.json({ error: "No active session" }, { status: 400 });
  }
  const jar = await cookies();
  jar.set(RETURN_COOKIE, session.refresh_token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 8,
  });

  // 2) Mint a session for the target via a magic-link token, then verify it on
  //    the server client so its session cookies replace the admin's.
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: usernameToEmail(target.username),
  });
  const tokenHash = link?.properties?.hashed_token;
  if (linkErr || !tokenHash) {
    jar.delete(RETURN_COOKIE);
    return NextResponse.json({ error: "Could not impersonate" }, { status: 500 });
  }
  const { error: verifyErr } = await supabase.auth.verifyOtp({
    type: "magiclink",
    token_hash: tokenHash,
  });
  if (verifyErr) {
    jar.delete(RETURN_COOKIE);
    return NextResponse.json({ error: "Could not impersonate" }, { status: 500 });
  }

  await admin.from("impersonation_audit").insert({
    admin_id: userId,
    target_id: targetId,
    org_id: profile.org_id,
  });

  return NextResponse.json({ ok: true });
}
