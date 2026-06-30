import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const RETURN_COOKIE = "omni-admin-return";

export async function POST() {
  const jar = await cookies();
  const refresh = jar.get(RETURN_COOKIE)?.value;
  if (!refresh) {
    return NextResponse.json({ error: "Not impersonating" }, { status: 400 });
  }

  // Restore the admin's session from the stashed refresh token.
  const supabase = await createClient();
  const { data, error } = await supabase.auth.refreshSession({
    refresh_token: refresh,
  });
  jar.delete(RETURN_COOKIE);
  if (error || !data.user) {
    return NextResponse.json({ error: "Could not restore session" }, { status: 500 });
  }

  // Close the most recent open audit row for this admin.
  const admin = createAdminClient();
  const { data: open } = await admin
    .from("impersonation_audit")
    .select("id")
    .eq("admin_id", data.user.id)
    .is("ended_at", null)
    .order("started_at", { ascending: false })
    .limit(1);
  if (open && open[0]) {
    await admin
      .from("impersonation_audit")
      .update({ ended_at: new Date().toISOString() })
      .eq("id", open[0].id);
  }

  return NextResponse.json({ ok: true });
}
