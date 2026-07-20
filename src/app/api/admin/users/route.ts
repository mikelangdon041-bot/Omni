import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionProfile, isAdmin } from "@/lib/authz";
import { generateTempPassword, isValidUsername, normalizeUsername, usernameToEmail } from "@/lib/auth";

export const runtime = "nodejs";

async function requireAdmin() {
  const { userId, profile } = await getSessionProfile();
  if (!userId || !isAdmin(profile) || !profile?.org_id) return null;
  return { userId, profile };
}

// List the caller's org members.
export async function GET() {
  const ctx = await requireAdmin();
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const admin = createAdminClient();
  const { data } = await admin
    .from("profiles")
    .select("id, username, display_name, role, is_active, created_at")
    .eq("org_id", ctx.profile.org_id)
    .order("created_at", { ascending: true });

  return NextResponse.json({ users: data || [], me: ctx.userId });
}

// Add a member to the caller's org. Returns a one-time temp password.
export async function POST(req: Request) {
  const ctx = await requireAdmin();
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const username = normalizeUsername(String(body.username || ""));
  const displayName = String(body.displayName || "").trim();
  const role = body.role === "admin" ? "admin" : "member";
  if (!isValidUsername(username)) {
    return NextResponse.json({ error: "Invalid username" }, { status: 400 });
  }

  const tempPassword = generateTempPassword();

  const admin = createAdminClient();
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: usernameToEmail(username),
    password: tempPassword,
    email_confirm: true,
    user_metadata: { username, display_name: displayName || username },
  });
  if (createErr || !created.user) {
    if (/already|exists|registered|duplicate/i.test(createErr?.message || "")) {
      return NextResponse.json({ error: "That username is taken" }, { status: 409 });
    }
    return NextResponse.json({ error: "Could not create user" }, { status: 500 });
  }

  const { error: profErr } = await admin.from("profiles").insert({
    id: created.user.id,
    username,
    display_name: displayName || username,
    org_id: ctx.profile.org_id,
    role,
  });
  if (profErr) {
    await admin.auth.admin.deleteUser(created.user.id);
    return NextResponse.json({ error: "Could not create user" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, username, tempPassword });
}

// Change a member's role or active status (same org; owners are protected).
export async function PATCH(req: Request) {
  const ctx = await requireAdmin();
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const targetId = String(body.userId || "");
  if (!targetId) return NextResponse.json({ error: "userId required" }, { status: 400 });

  const admin = createAdminClient();
  const { data: target } = await admin
    .from("profiles")
    .select("org_id, role")
    .eq("id", targetId)
    .single();
  if (!target || target.org_id !== ctx.profile.org_id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Reset a member's password to a fresh one-time temp password. Anyone may
  // reset their own; resetting someone else's owner account is blocked (same
  // protection as role/active changes below) to stop one admin locking out
  // another admin/the owner.
  if (body.resetPassword === true) {
    if (target.role === "owner" && targetId !== ctx.userId) {
      return NextResponse.json({ error: "Cannot reset the owner's password" }, { status: 403 });
    }
    const tempPassword = generateTempPassword();
    const { error } = await admin.auth.admin.updateUserById(targetId, { password: tempPassword });
    if (error) return NextResponse.json({ error: "Could not reset password" }, { status: 500 });
    return NextResponse.json({ ok: true, tempPassword });
  }

  if (target.role === "owner") {
    return NextResponse.json({ error: "Cannot modify the owner" }, { status: 403 });
  }

  const patch: Record<string, unknown> = {};
  if (body.role === "admin" || body.role === "member") patch.role = body.role;
  if (typeof body.is_active === "boolean") patch.is_active = body.is_active;
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  await admin.from("profiles").update(patch).eq("id", targetId);
  return NextResponse.json({ ok: true });
}
