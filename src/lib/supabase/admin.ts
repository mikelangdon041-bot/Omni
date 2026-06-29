import { createClient } from "@supabase/supabase-js";

// Service-role Supabase client — bypasses RLS. SERVER ONLY.
// Used for storage signing, chunking jobs, and privileged writes.
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  }
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
