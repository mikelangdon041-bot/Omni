import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { REMEMBER_COOKIE } from "@/lib/auth";
import { mintOutlookKey } from "@/lib/outlook-keys";

export const runtime = "nodejs";

// Mint the Outlook pane's saved sign-in, once it is signed in. See
// lib/outlook-keys.ts for why the pane needs one at all.
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Unticking "Remember me" at sign-in asked for exactly this not to happen.
  const cookieStore = await cookies();
  if (cookieStore.get(REMEMBER_COOKIE)?.value === "0")
    return NextResponse.json({ key: null, reason: "remember-off" });

  const body = await req.json().catch(() => ({}));
  const replace = typeof body.replace === "string" ? body.replace.slice(0, 200) : undefined;
  try {
    const key = await mintOutlookKey(user.id, replace);
    return NextResponse.json({ key });
  } catch {
    return NextResponse.json({ error: "Couldn't save the sign-in" }, { status: 500 });
  }
}
