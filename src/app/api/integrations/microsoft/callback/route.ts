import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { exchangeCode } from "@/lib/microsoft/graph";
import { safeNext } from "@/lib/auth";

export const runtime = "nodejs";

// Step two: Microsoft sends them back with a code. Swap it for tokens.
//
// Everything that can go wrong here ends on a page with words on it rather than
// a JSON body — this URL is somewhere a browser lands, not something code calls.
function cookie(request: Request, name: string): string | null {
  const raw = request.headers
    .get("cookie")
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${name}=`));
  if (!raw) return null;
  try {
    return decodeURIComponent(raw.slice(name.length + 1));
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const back = safeNext(cookie(request, "ms-oauth-next")) || "/settings";

  const fail = (why: string) => {
    const to = new URL(back, url.origin);
    to.searchParams.set("onenote", "error");
    to.searchParams.set("why", why.slice(0, 200));
    return NextResponse.redirect(to);
  };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", url.origin));

  // Microsoft reports a declined consent screen here, not as an exception.
  const denied = url.searchParams.get("error");
  if (denied) {
    return fail(url.searchParams.get("error_description") || denied);
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expected = cookie(request, "ms-oauth-state");
  if (!code) return fail("Microsoft didn't send a code back.");
  if (!state || !expected || state !== expected) {
    // Either a stale tab or someone else's callback. Both are refusals.
    return fail("That sign-in link didn't match this browser. Try connecting again.");
  }

  try {
    await exchangeCode(user.id, code, url.origin);
  } catch (e) {
    return fail((e as Error).message || "Microsoft wouldn't complete the sign-in.");
  }

  const to = new URL(back, url.origin);
  to.searchParams.set("onenote", "connected");
  const res = NextResponse.redirect(to);
  res.cookies.delete("ms-oauth-state");
  res.cookies.delete("ms-oauth-next");
  return res;
}
