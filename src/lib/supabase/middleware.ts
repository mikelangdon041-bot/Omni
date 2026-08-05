import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { REMEMBER_COOKIE, safeNext } from "@/lib/auth";

// The sign-in pages. No session needed to reach them, and a signed-in user has
// no business on them — they get sent home.
const AUTH_PATHS = ["/login", "/register"];

// Open to everyone, signed in or not, and never redirected either way.
//
// The Outlook add-in lives here and needs both halves of that. Outlook fetches
// the manifest from its own servers with no cookies at all, so a manifest that
// 307s to /login is a manifest Outlook cannot read — "add from URL" fails, and
// so does the ribbon button, because the pane it points at answers the same
// way. And the pane itself has to be allowed to render its own sign-in prompt:
// bouncing it to /login puts a full login page inside a 400px panel whose
// post-login redirect goes to the dashboard, with no way back to the add-in.
const OPEN_PATHS = ["/outlook"];

// The proxy already pays for one `getUser()` on every request. It forwards the
// verified id on this request header so server components don't have to make
// the same network round trip a second time. Never trust an inbound value —
// it is stripped below before anything else runs.
export const UID_HEADER = "x-omni-uid";

export async function updateSession(request: NextRequest) {
  // Request headers forwarded downstream. Built from a copy (Next's
  // documented way to add request headers) and stripped of any inbound
  // UID_HEADER first, so a client can never forge one — only the value set
  // after getUser() below can survive into a server component.
  const forwardedHeaders = new Headers(request.headers);
  forwardedHeaders.delete(UID_HEADER);
  const nextOptions = () => ({ request: { headers: forwardedHeaders } });

  let supabaseResponse = NextResponse.next(nextOptions());

  // User declined "Remember me" at login → refreshed auth cookies must stay
  // browser-session-scoped instead of picking up the default 400-day maxAge.
  const sessionOnly = request.cookies.get(REMEMBER_COOKIE)?.value === "0";

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next(nextOptions());
          cookiesToSet.forEach(({ name, value, options }) => {
            const opts = { ...options };
            if (sessionOnly) {
              delete opts.maxAge;
              delete opts.expires;
            }
            supabaseResponse.cookies.set(name, value, opts);
          });
        },
      },
    },
  );

  // IMPORTANT: do not run code between createServerClient and getUser().
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isAuthPage = AUTH_PATHS.some((p) => path.startsWith(p));
  const isOpen = isAuthPage || OPEN_PATHS.some((p) => path.startsWith(p));

  if (!user && !isOpen) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && isAuthPage) {
    const url = request.nextUrl.clone();
    // Honour ?next= here too. Signing in from the Outlook pane lands back on
    // /login for a moment on the way through, and sending them home at that
    // point would undo the redirect the pane asked for before the form ever
    // gets to read it.
    url.pathname = safeNext(request.nextUrl.searchParams.get("next")) || "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Hand the verified id downstream. The response has to be rebuilt: request
  // headers are snapshotted when NextResponse.next() is called, so setting
  // this on `forwardedHeaders` afterwards wouldn't reach the app. Any refreshed
  // auth cookies Supabase set along the way are carried over.
  if (user) {
    forwardedHeaders.set(UID_HEADER, user.id);
    const forwarded = NextResponse.next(nextOptions());
    for (const cookie of supabaseResponse.cookies.getAll()) {
      forwarded.cookies.set(cookie);
    }
    return forwarded;
  }

  return supabaseResponse;
}
