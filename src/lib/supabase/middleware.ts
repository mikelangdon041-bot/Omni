import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { REMEMBER_COOKIE } from "@/lib/auth";

// Public routes that never require a session.
const PUBLIC_PATHS = ["/login", "/register"];

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
  const isPublic = PUBLIC_PATHS.some((p) => path.startsWith(p));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
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
