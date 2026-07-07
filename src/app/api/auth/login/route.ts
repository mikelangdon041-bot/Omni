import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import {
  usernameToEmail,
  REMEMBER_COOKIE,
  REMEMBER_MAX_AGE,
} from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const username = String(body.username || "");
  const password = String(body.password || "");
  // Default true: an absent flag behaves like the pre-checkbox app (long-lived).
  const remember = body.rememberMe !== false;

  if (!username || !password) {
    return NextResponse.json(
      { error: "Username and password are required." },
      { status: 400 },
    );
  }

  // signInWithPassword sets the session cookies on the outgoing response via
  // this cookie adapter. "Remember me" keeps the library's long-lived maxAge;
  // otherwise we strip maxAge/expires so cookies die with the browser session.
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
          cookiesToSet.forEach(({ name, value, options }) => {
            const opts = { ...options };
            if (!remember) {
              delete opts.maxAge;
              delete opts.expires;
            }
            cookieStore.set(name, value, opts);
          });
        },
      },
    },
  );

  const { error } = await supabase.auth.signInWithPassword({
    email: usernameToEmail(username),
    password,
  });

  if (error) {
    return NextResponse.json(
      { error: "Invalid username or password." },
      { status: 401 },
    );
  }

  // Marker read by the session-refresh middleware so refreshed cookies keep
  // the same persistence the user chose at login.
  cookieStore.set(REMEMBER_COOKIE, remember ? "1" : "0", {
    path: "/",
    sameSite: "lax",
    ...(remember ? { maxAge: REMEMBER_MAX_AGE } : {}),
  });

  return NextResponse.json({ ok: true });
}
