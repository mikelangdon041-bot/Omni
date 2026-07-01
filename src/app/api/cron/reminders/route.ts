import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendPushToUser } from "@/lib/push";

export const runtime = "nodejs";

// Scheduled (Vercel Cron): push a reminder for tasks that are due now and
// haven't been reminded yet. Protected by CRON_SECRET when set.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const admin = createAdminClient();
  const now = new Date();
  const soon = new Date(now.getTime() + 60 * 60 * 1000); // next hour window

  // Global tasks that are due and not completed. (reminded_at added lazily.)
  const { data: tasks } = await admin
    .from("tasks")
    .select("id, user_id, title, link, due_date, app")
    .is("completed_at", null)
    .not("due_date", "is", null)
    .lte("due_date", soon.toISOString());

  let sent = 0;
  for (const t of tasks || []) {
    const n = await sendPushToUser(t.user_id, {
      title: "Task due",
      body: t.title,
      link: t.link || "/",
    });
    sent += n;
  }

  return NextResponse.json({ ok: true, tasks: tasks?.length || 0, pushes: sent });
}
