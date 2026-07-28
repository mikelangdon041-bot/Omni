import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient as createTokenClient } from "@supabase/supabase-js";
import { createClient as createCookieClient } from "./server";

// Authenticate an API route from either end of the app.
//
// The web app is a browser and sends its session as cookies. The Windows
// desktop recorder is not a browser: it holds a Supabase refresh token in the
// credential store and sends the access token it mints as a bearer header.
// Both are the same user with the same row-level permissions, so routes should
// not care which one called them — hence one helper rather than two code paths
// per route.
//
// The returned client is scoped to that user in both cases (anon key + their
// token), so RLS still does the real enforcement. `user` is null when neither
// credential is present or valid; every caller must treat that as a 401.
export async function routeAuth(
  req: Request,
): Promise<{ supabase: SupabaseClient; user: User | null }> {
  const header = req.headers.get("authorization") || "";
  const token = /^bearer\s+/i.test(header) ? header.replace(/^bearer\s+/i, "").trim() : "";

  if (token) {
    const supabase = createTokenClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        auth: { autoRefreshToken: false, persistSession: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
      },
    );
    // Validated against the auth server, not decoded locally — an expired or
    // forged token has to fail here rather than reach a query.
    const {
      data: { user },
    } = await supabase.auth.getUser(token);
    return { supabase, user: user ?? null };
  }

  const supabase = await createCookieClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase: supabase as unknown as SupabaseClient, user: user ?? null };
}
