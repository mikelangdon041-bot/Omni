import webpush from "web-push";
import { createAdminClient } from "@/lib/supabase/admin";

// Web push framework. Wired now, configured later: set VAPID_PUBLIC_KEY /
// VAPID_PRIVATE_KEY (and optionally VAPID_SUBJECT). Generate a keypair with
// `npx web-push generate-vapid-keys`. Until keys exist, sends are no-ops.

let configured = false;
function ensureConfigured(): boolean {
  if (configured) return true;
  const pub = process.env.VAPID_PUBLIC_KEY || process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:tasks@omni.app", pub, priv);
  configured = true;
  return true;
}

export interface PushPayload {
  title: string;
  body?: string;
  link?: string;
}

// Send a push to every device the user has subscribed. Prunes dead endpoints.
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<number> {
  if (!ensureConfigured()) return 0;
  const admin = createAdminClient();
  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", userId);
  if (!subs || subs.length === 0) return 0;

  let sent = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(payload),
        );
        sent++;
      } catch (err) {
        // 404/410 = subscription gone; clean it up.
        const code = (err as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) {
          await admin.from("push_subscriptions").delete().eq("id", s.id);
        }
      }
    }),
  );
  return sent;
}
