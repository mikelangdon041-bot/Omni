// Email framework. Wired now, configured later: if RESEND_API_KEY is set we
// send through Resend; otherwise we no-op (and log) so the app keeps working
// without email configured. Swap in any provider by editing send() below.

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface EmailResult {
  sent: boolean;
  provider: "resend" | "none";
  error?: string;
}

const FROM = process.env.EMAIL_FROM || "Omni <onboarding@resend.dev>";

export async function sendEmail(msg: EmailMessage): Promise<EmailResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    // Not configured yet — don't fail the request, just record it.
    console.log(`[email:disabled] would send to ${msg.to}: ${msg.subject}`);
    return { sent: false, provider: "none" };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM,
        to: msg.to,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { sent: false, provider: "resend", error: body || `HTTP ${res.status}` };
    }
    return { sent: true, provider: "resend" };
  } catch (e) {
    return {
      sent: false,
      provider: "resend",
      error: e instanceof Error ? e.message : "send failed",
    };
  }
}

export function appUrl(path = ""): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    "https://omni.app";
  return `${base.replace(/\/$/, "")}${path}`;
}
