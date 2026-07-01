import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionProfile, isAdmin } from "@/lib/authz";
import { isValidUsername, normalizeUsername, usernameToEmail } from "@/lib/auth";
import { sendEmail, appUrl } from "@/lib/email";

export const runtime = "nodejs";

// Assign an interview to a teammate, or invite someone new to run it.
// - mode "existing": set the assignee to an existing org member.
// - mode "invite": create the account (temp password), add to org, assign,
//   send an email invite (if email configured), and record an in-app invite.
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { profile } = await getSessionProfile();
  if (!profile?.org_id) {
    return NextResponse.json({ error: "No organization" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const interviewId = String(body.interviewId || "");
  if (!interviewId) {
    return NextResponse.json({ error: "interviewId required" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Load the interview + candidate to check permissions and craft the message.
  const { data: interview } = await admin
    .from("interviews")
    .select("id, title, candidate_id")
    .eq("id", interviewId)
    .single();
  if (!interview) {
    return NextResponse.json({ error: "Interview not found" }, { status: 404 });
  }
  const { data: candidate } = await admin
    .from("candidates")
    .select("id, user_id, first_name, last_name")
    .eq("id", interview.candidate_id)
    .single();
  if (!candidate) {
    return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
  }
  // Only the candidate owner or an org admin/owner may assign.
  const canManage = candidate.user_id === user.id || isAdmin(profile);
  if (!canManage) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const candidateName = `${candidate.first_name} ${candidate.last_name}`.trim();
  const link = `/interview-prep/interview/${interviewId}`;

  async function notify(recipientId: string, invite = false) {
    await admin.from("notifications").insert({
      user_id: recipientId,
      type: "interview_assigned",
      title: invite
        ? `You're invited to interview ${candidateName}`
        : `Interview assigned: ${candidateName}`,
      body: interview!.title || "Interview",
      link,
    });
  }

  async function emailAssignee(email: string, extra = "") {
    return sendEmail({
      to: email,
      subject: `Interview assigned: ${candidateName}`,
      html: `<p>You've been assigned to run an interview: <strong>${interview!.title}</strong> with <strong>${candidateName}</strong>.</p>${extra}<p><a href="${appUrl(link)}">Open the interview in Omni</a></p>`,
      text: `You've been assigned to interview ${candidateName} (${interview!.title}). Open: ${appUrl(link)}`,
    });
  }

  // ---- Assign an existing teammate ----------------------------------
  if (body.mode === "existing" || body.assigneeId) {
    const assigneeId = String(body.assigneeId || "");
    if (!assigneeId) {
      return NextResponse.json({ error: "assigneeId required" }, { status: 400 });
    }
    const { data: member } = await admin
      .from("profiles")
      .select("id, org_id, username, display_name")
      .eq("id", assigneeId)
      .single();
    if (!member || member.org_id !== profile.org_id) {
      return NextResponse.json({ error: "Not in your company" }, { status: 400 });
    }
    await admin.from("interviews").update({ assignee_id: assigneeId }).eq("id", interviewId);
    await notify(assigneeId);
    // Best-effort email to the member's login email (synthetic alias unless set).
    const email = usernameToEmail(member.username);
    const emailRes = await emailAssignee(email);
    return NextResponse.json({
      ok: true,
      assigneeId,
      username: member.username,
      emailSent: emailRes.sent,
    });
  }

  // ---- Invite someone new -------------------------------------------
  const username = normalizeUsername(String(body.username || ""));
  const email = String(body.email || "").trim();
  const displayName = String(body.displayName || "").trim();
  if (!isValidUsername(username)) {
    return NextResponse.json({ error: "Invalid username" }, { status: 400 });
  }

  const tempPassword = `Omni-${Math.random().toString(36).slice(2, 8)}${Math.floor(
    Math.random() * 90 + 10,
  )}`;

  // If the username already exists in the org, just assign them.
  const { data: existing } = await admin
    .from("profiles")
    .select("id, org_id")
    .eq("username", username)
    .maybeSingle();

  let assigneeId: string;
  let created = false;
  if (existing) {
    if (existing.org_id !== profile.org_id) {
      return NextResponse.json({ error: "That username is taken" }, { status: 409 });
    }
    assigneeId = existing.id;
  } else {
    const { data: newUser, error: createErr } = await admin.auth.admin.createUser({
      email: usernameToEmail(username),
      password: tempPassword,
      email_confirm: true,
      user_metadata: { username, display_name: displayName || username },
    });
    if (createErr || !newUser.user) {
      return NextResponse.json({ error: "Could not create user" }, { status: 500 });
    }
    const { error: profErr } = await admin.from("profiles").insert({
      id: newUser.user.id,
      username,
      display_name: displayName || username,
      org_id: profile.org_id,
      role: "member",
    });
    if (profErr) {
      await admin.auth.admin.deleteUser(newUser.user.id);
      return NextResponse.json({ error: "Could not create user" }, { status: 500 });
    }
    assigneeId = newUser.user.id;
    created = true;
  }

  await admin.from("interviews").update({ assignee_id: assigneeId }).eq("id", interviewId);
  await notify(assigneeId, true);

  const token = crypto.randomUUID();
  await admin.from("interview_invites").insert({
    interview_id: interviewId,
    email,
    username,
    token,
    invited_by: user.id,
  });

  // Email the invite (best-effort). Include the temp password for new accounts.
  let emailSent = false;
  if (email) {
    const creds = created
      ? `<p>Sign in with username <strong>${username}</strong> and this temporary password: <strong>${tempPassword}</strong> (you can change it after signing in).</p>`
      : `<p>Sign in with username <strong>${username}</strong>.</p>`;
    const res = await emailAssignee(email, creds);
    emailSent = res.sent;
  }

  return NextResponse.json({
    ok: true,
    assigneeId,
    username,
    created,
    tempPassword: created ? tempPassword : null,
    inviteLink: appUrl(link),
    emailSent,
  });
}
