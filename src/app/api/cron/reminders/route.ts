import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendPushToUser } from "@/lib/push";

export const runtime = "nodejs";
export const maxDuration = 120;

// Scheduled reminders. Safe to call as often as every few minutes — each
// notification is deduped via conf_sent_reminders so nothing fires twice.
// Vercel Hobby only allows a daily cron, so for minute-level conference
// reminders point an external scheduler (e.g. cron-job.org) at this route.
// Protected by CRON_SECRET when set (Authorization: Bearer <secret>).
//
// Sends:
//  1. Task-due pushes (original behavior).
//  2. Conference event reminders: ~15 minutes before and at start, to the
//     assigned people, computed in the conference's timezone.
//  3. 7 AM (conference-local) reminder to the day's food coordinator(s).
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
  const stats = { tasks: 0, before15: 0, start: 0, food: 0 };

  // ---- 1. Task-due pushes (original behavior) --------------------------
  const soon = new Date(now.getTime() + 60 * 60 * 1000);
  const { data: tasks } = await admin
    .from("tasks")
    .select("id, user_id, title, link")
    .is("completed_at", null)
    .not("due_date", "is", null)
    .lte("due_date", soon.toISOString());
  for (const t of tasks || []) {
    await sendPushToUser(t.user_id, {
      title: "Task due",
      body: t.title,
      link: t.link || "/",
    });
    stats.tasks++;
  }

  // ---- Conference reminders --------------------------------------------
  // Live-ish conferences only (start-1d .. end+1d covers tz skew).
  const today = now.toISOString().slice(0, 10);
  const { data: conferences } = await admin
    .from("conferences")
    .select("id, name, timezone, start_date, end_date")
    .eq("active", true)
    .lte("start_date", addDays(today, 1))
    .gte("end_date", addDays(today, -1));

  for (const conf of conferences || []) {
    const link = `/conference-planning/${conf.id}/schedule`;

    // Attendee → user map for this conference.
    const { data: attendees } = await admin
      .from("conference_attendees")
      .select("id, user_id")
      .eq("conference_id", conf.id)
      .eq("active", true)
      .not("user_id", "is", null);
    const userOf = new Map((attendees || []).map((a) => [a.id, a.user_id as string]));
    if (userOf.size === 0) continue;

    // ---- 2. Event reminders (15-min-before window, and at-start window).
    const in20 = new Date(now.getTime() + 20 * 60 * 1000).toISOString();
    const ago5 = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
    const { data: events } = await admin
      .from("conf_events")
      .select("id, title, location, starts_at")
      .eq("conference_id", conf.id)
      .eq("cancelled", false)
      .gte("starts_at", ago5)
      .lte("starts_at", in20);

    for (const ev of events || []) {
      const minsAway = (new Date(ev.starts_at).getTime() - now.getTime()) / 60000;
      const kind = minsAway <= 2 ? "start" : minsAway <= 17 ? "before15" : null;
      if (!kind) continue;

      const { data: assigns } = await admin
        .from("conf_event_assignments")
        .select("attendee_id")
        .eq("event_id", ev.id);
      const userIds = [
        ...new Set(
          (assigns || [])
            .map((a) => userOf.get(a.attendee_id))
            .filter(Boolean) as string[],
        ),
      ];
      for (const userId of userIds) {
        if (!(await claim(admin, conf.id, kind, ev.id, userId))) continue;
        const when =
          kind === "start"
            ? "starting now"
            : `in ${Math.max(1, Math.round(minsAway))} min`;
        await sendPushToUser(userId, {
          title: `${ev.title} — ${when}`,
          body: ev.location ? `📍 ${ev.location}` : conf.name,
          link,
        });
        if (kind === "start") stats.start++;
        else stats.before15++;
      }
    }

    // ---- 3. Food coordinator reminder at 7 AM conference-local time.
    const local = localParts(now, conf.timezone);
    if (local.hh === 7) {
      const { data: assignment } = await admin
        .from("conf_food_assignments")
        .select("id, attendee_ids, skipped")
        .eq("conference_id", conf.id)
        .eq("date", local.dateKey)
        .maybeSingle();
      if (assignment && !assignment.skipped) {
        for (const attendeeId of assignment.attendee_ids || []) {
          const userId = userOf.get(attendeeId);
          if (!userId) continue;
          if (!(await claim(admin, conf.id, "food7am", assignment.id, userId))) continue;
          await sendPushToUser(userId, {
            title: "You're the food coordinator today 🍽️",
            body: `Start today's group order for ${conf.name}.`,
            link: `/conference-planning/${conf.id}/food`,
          });
          stats.food++;
        }
      }
    }
  }

  return NextResponse.json({ ok: true, ...stats });
}

// Atomically claim a (kind, item, user) reminder; false when already sent.
async function claim(
  admin: ReturnType<typeof createAdminClient>,
  conferenceId: string,
  kind: string,
  itemId: string,
  userId: string,
): Promise<boolean> {
  const { error } = await admin.from("conf_sent_reminders").insert({
    conference_id: conferenceId,
    kind,
    item_id: itemId,
    user_id: userId,
  });
  return !error; // unique violation = someone (or an earlier run) already sent it
}

function addDays(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function localParts(date: Date, tz: string): { hh: number; dateKey: string } {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hour12: false,
    }).formatToParts(date);
    const get = (t: string) => parts.find((p) => p.type === t)?.value || "00";
    return {
      hh: Number(get("hour")) % 24,
      dateKey: `${get("year")}-${get("month")}-${get("day")}`,
    };
  } catch {
    return { hh: -1, dateKey: "" };
  }
}
