import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createAdminClient } from "@/lib/supabase/admin";
import { REMEMBER_COOKIE, REMEMBER_MAX_AGE } from "@/lib/auth";
import { checkOutlookKey } from "@/lib/outlook-keys";

export const runtime = "nodejs";

// Trade the Outlook pane's saved key for an ordinary session, when Outlook has
// opened the pane in a fresh browser folder with no cookie in it. See
// lib/outlook-keys.ts.
//
// The session is minted the way Supabase mints any passwordless one: a
// magic-link token generated with the service role — no email is sent; the
// token only ever exists inside this request — and verified straight away
// through the same cookie adapter the login route uses, so what comes back is
// indistinguishable from signing in with the password.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const key = String(body.key || "").slice(0, 200);

  const user = await checkOutlookKey(key).catch(() => null);
  // One answer for malformed, unknown and revoked alike: which of them it was
  // is nobody's business but the server's. `forget` tells the pane to drop it.
  if (!user?.email)
    return NextResponse.json({ error: "Saved sign-in is no longer valid", forget: true }, { status: 401 });

  const admin = createAdminClient();
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: user.email,
  });
  const tokenHash = link?.properties?.hashed_token;
  if (linkError || !tokenHash)
    return NextResponse.json({ error: "Couldn't sign you back in" }, { status: 502 });

  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        },
      },
    },
  );
  const { error } = await supabase.auth.verifyOtp({ type: "email", token_hash: tokenHash });
  if (error) return NextResponse.json({ error: "Couldn't sign you back in" }, { status: 502 });

  // A key only exists because "Remember me" was left on, so the restored
  // session is long-lived too — and stays so through the proxy's refreshes.
  cookieStore.set(REMEMBER_COOKIE, "1", { path: "/", sameSite: "lax", maxAge: REMEMBER_MAX_AGE });
  return NextResponse.json({ ok: true });
}
