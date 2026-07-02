import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyUser } from "@/lib/notify";

export const runtime = "nodejs";

// Broadcast an announcement (or a silent push, e.g. "food order started") to
// everyone on the conference team except the sender. Never blocks on push
// failures; reports how many people were reached.
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const conferenceId: string = body?.conferenceId || "";
  const message: string = (body?.message || "").trim();
  const title: string = (body?.title || "").trim() || "Announcement";
  const link: string = body?.link || `/conference-planning/${conferenceId}`;
  const silent: boolean = !!body?.silent; // push only, no announcement row
  if (!conferenceId || !message) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  // RLS confirms the caller can see this conference.
  const { data: conf } = await supabase
    .from("conferences")
    .select("id, name")
    .eq("id", conferenceId)
    .single();
  if (!conf) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (!silent) {
    await supabase.from("conf_announcements").insert({
      conference_id: conferenceId,
      sender_id: user.id,
      message,
    });
  }

  // Notify linked attendees except the actor — all of them, or (when
  // `userIds` is given, e.g. schedule-change notifications) just those.
  const admin = createAdminClient();
  const { data: attendees } = await admin
    .from("conference_attendees")
    .select("user_id")
    .eq("conference_id", conferenceId)
    .eq("active", true)
    .not("user_id", "is", null)
    .neq("user_id", user.id);

  const targets: string[] | null = Array.isArray(body?.userIds) ? body.userIds : null;
  const ids = [...new Set((attendees || []).map((a) => a.user_id as string))].filter(
    (id) => !targets || targets.includes(id),
  );
  let reached = 0;
  await Promise.all(
    ids.map(async (id) => {
      try {
        await notifyUser(id, {
          type: "conference",
          title: `${conf.name}: ${title}`,
          body: message,
          link,
        });
        reached++;
      } catch {
        // fire-and-forget
      }
    }),
  );

  return NextResponse.json({ reached });
}
