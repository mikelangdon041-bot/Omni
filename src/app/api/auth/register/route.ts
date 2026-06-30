import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isValidUsername, normalizeUsername, usernameToEmail } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const username = normalizeUsername(String(body.username || ""));
  const password = String(body.password || "");
  const displayName = String(body.displayName || "").trim();
  const company = String(body.company || "").trim();

  if (!isValidUsername(username)) {
    return NextResponse.json(
      { error: "Username must be 3–30 chars: letters, numbers, . _ - only." },
      { status: 400 },
    );
  }
  if (password.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters." },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  // Create the auth user with a synthetic email, pre-confirmed (no email flow).
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: usernameToEmail(username),
    password,
    email_confirm: true,
    user_metadata: { username, display_name: displayName || username },
  });

  if (createErr || !created.user) {
    const msg = createErr?.message || "";
    if (/already|exists|registered|duplicate/i.test(msg)) {
      return NextResponse.json(
        { error: "That username is already taken." },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: "Could not create account. Please try again." },
      { status: 500 },
    );
  }

  // A self-registration creates a new company; the registrant is its owner.
  const { data: org, error: orgErr } = await admin
    .from("organizations")
    .insert({ name: company || `${displayName || username}'s Company` })
    .select("id")
    .single();
  if (orgErr || !org) {
    await admin.auth.admin.deleteUser(created.user.id);
    return NextResponse.json(
      { error: "Could not create account. Please try again." },
      { status: 500 },
    );
  }

  const { error: profileErr } = await admin.from("profiles").insert({
    id: created.user.id,
    username,
    display_name: displayName || username,
    org_id: org.id,
    role: "owner",
  });

  if (profileErr) {
    // Roll back the orphaned auth user + org so the username can be reused.
    await admin.auth.admin.deleteUser(created.user.id);
    await admin.from("organizations").delete().eq("id", org.id);
    if (/duplicate|unique/i.test(profileErr.message)) {
      return NextResponse.json(
        { error: "That username is already taken." },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: "Could not create account. Please try again." },
      { status: 500 },
    );
  }

  // Establish the session cookies.
  const supabase = await createClient();
  const { error: signInErr } = await supabase.auth.signInWithPassword({
    email: usernameToEmail(username),
    password,
  });
  if (signInErr) {
    // Account exists but auto sign-in failed — let the client send them to login.
    return NextResponse.json({ ok: true, signedIn: false });
  }
  return NextResponse.json({ ok: true });
}
