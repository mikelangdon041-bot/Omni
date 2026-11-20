import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

// The PC side of reminders and follow-ups (public/outlook/omni-runner.ps1).
// It has no browser session, only the token it was installed with, so it is
// checked here against outlook_runners and everything below runs with the
// service role, scoped by hand to that one user.
//
// GET  → { me, items }: reminders still to hand to Outlook, follow-ups still
//        being watched. Also records the check-in.
// POST { note?, updates: [{ id, reminder_status?, followup_status?, result? }] }

async function runnerUser(req: Request) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (token.length < 20) return null;
  const hash = createHash("sha256").update(token).digest("hex");
  const admin = createAdminClient();
  const { data } = await admin
    .from("outlook_runners")
    .select("user_id")
    .eq("token_hash", hash)
    .maybeSingle();
  return data ? { admin, userId: data.user_id as string } : null;
}

export async function GET(req: Request) {
  const who = await runnerUser(req);
  if (!who) return NextResponse.json({ error: "Unknown runner" }, { status: 401 });
  const { admin, userId } = who;
  const note = new URL(req.url).searchParams.get("note") || "ok";
  await admin
    .from("outlook_runners")
    .update({ last_seen: new Date().toISOString(), last_note: note.slice(0, 200) })
    .eq("user_id", userId);
  const { data, error } = await admin
    .from("email_followups")
    .select(
      "id, message_id, thread_subject, to_people, subject, reminder_at, reminder_body, reminder_status, followup_at, followup_body, followup_mode, followup_status, created_at",
    )
    .eq("user_id", userId)
    .or("reminder_status.eq.pending,followup_status.eq.waiting")
    .order("created_at")
    .limit(50);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data || [] });
}

const REMINDER = new Set(["scheduled", "failed"]);
const FOLLOWUP = new Set(["waiting", "replied", "drafted", "sent", "failed"]);

export async function POST(req: Request) {
  const who = await runnerUser(req);
  if (!who) return NextResponse.json({ error: "Unknown runner" }, { status: 401 });
  const { admin, userId } = who;
  const body = await req.json().catch(() => null);
  if (body?.note)
    await admin
      .from("outlook_runners")
      .update({ last_seen: new Date().toISOString(), last_note: String(body.note).slice(0, 200) })
      .eq("user_id", userId);
  const updates: { id?: unknown; reminder_status?: unknown; followup_status?: unknown; result?: unknown }[] =
    Array.isArray(body?.updates) ? body.updates.slice(0, 50) : [];
  let done = 0;
  for (const u of updates) {
    const patch: Record<string, string> = {};
    if (typeof u.reminder_status === "string" && REMINDER.has(u.reminder_status))
      patch.reminder_status = u.reminder_status;
    if (typeof u.followup_status === "string" && FOLLOWUP.has(u.followup_status))
      patch.followup_status = u.followup_status;
    if (typeof u.result === "string") patch.result = u.result.slice(0, 500);
    if (!Object.keys(patch).length || typeof u.id !== "string") continue;
    // Only rows that are still open: a reminder cancelled in the pane while
    // the PC was mid-run stays cancelled.
    let q = admin.from("email_followups").update(patch).eq("id", u.id).eq("user_id", userId);
    if (patch.reminder_status) q = q.eq("reminder_status", "pending");
    if (patch.followup_status && patch.followup_status !== "waiting")
      q = q.eq("followup_status", "waiting");
    const { data } = await q.select("id");
    if (data?.length) done++;
  }
  return NextResponse.json({ updated: done });
}
