import { NextResponse } from "next/server";
import { forgetOutlookKey } from "@/lib/outlook-keys";

export const runtime = "nodejs";

// Revoke the Outlook pane's saved sign-in. The key is its own proof of whose it
// is, so no session is needed — which matters, because the pane calls this as
// it signs out, and on the way to replacing a key that belongs to someone else.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const key = String(body.key || "").slice(0, 200);
  await forgetOutlookKey(key).catch(() => {});
  return NextResponse.json({ ok: true });
}
