import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { authorizeUrl, microsoftConfigured } from "@/lib/microsoft/graph";
import { safeNext } from "@/lib/auth";

export const runtime = "nodejs";

// Step one of connecting OneNote: bounce to Microsoft to sign in and consent.
//
// The `state` is a CSRF guard, not decoration. Without it anyone can hand a
// signed-in user a crafted callback URL and have their account silently bound
// to an attacker's Microsoft tokens. It is signed into an httpOnly cookie here
// and checked on the way back.
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!microsoftConfigured()) {
    return NextResponse.json(
      { error: "Microsoft isn't configured on this deployment yet." },
      { status: 501 },
    );
  }

  const url = new URL(request.url);
  // Where to send them once it works — the meeting they started from, so the
  // connection is a detour rather than a place they have to find their way back
  // from.
  const back = safeNext(url.searchParams.get("next")) || "/settings";
  const state = crypto.randomUUID();

  const res = NextResponse.redirect(authorizeUrl(url.origin, state));
  res.cookies.set("ms-oauth-state", state, {
    httpOnly: true,
    secure: url.protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  res.cookies.set("ms-oauth-next", back, {
    httpOnly: true,
    secure: url.protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
