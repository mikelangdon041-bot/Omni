import { createAdminClient } from "@/lib/supabase/admin";
import { sendPushToUser } from "@/lib/push";

// One call to reach a user everywhere: an in-app notification (always) plus a
// web push (if they've enabled it and VAPID is configured).
export async function notifyUser(
  userId: string,
  n: { type?: string; title: string; body?: string; link?: string },
): Promise<void> {
  const admin = createAdminClient();
  await admin.from("notifications").insert({
    user_id: userId,
    type: n.type || "general",
    title: n.title,
    body: n.body || "",
    link: n.link || "",
  });
  await sendPushToUser(userId, { title: n.title, body: n.body, link: n.link });
}
