import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateTempPassword, normalizeUsername, usernameToEmail } from "@/lib/auth";

export const runtime = "nodejs";

// Self-service password reset, right from the login screen — no email exists
// to send a link to, so this issues a fresh temp password directly to
// whoever knows the username. That's a real tradeoff (no proof of identity
// beyond the username), acceptable for a small trusted-team tool; revisit if
// this ever needs to hold up against untrusted users.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const username = normalizeUsername(String(body.username || ""));
  if (!username) {
    return NextResponse.json({ error: "Username is required." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("id")
    .eq("username", username)
    .maybeSingle();

  if (!profile) {
    return NextResponse.json({ error: "No account with that username." }, { status: 404 });
  }

  const tempPassword = generateTempPassword();
  const { error } = await admin.auth.admin.updateUserById(profile.id, { password: tempPassword });
  if (error) {
    return NextResponse.json({ error: "Could not reset password." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, username, tempPassword });
}
