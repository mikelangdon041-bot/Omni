import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { usernameToEmail } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const username = String(body.username || "");
  const password = String(body.password || "");

  if (!username || !password) {
    return NextResponse.json(
      { error: "Username and password are required." },
      { status: 400 },
    );
  }

  // signInWithPassword on the server client sets the session cookies on the
  // outgoing response via the cookie adapter in lib/supabase/server.ts.
  const supabase = await createClient();
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
  return NextResponse.json({ ok: true });
}
