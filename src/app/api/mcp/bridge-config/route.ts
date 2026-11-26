import { NextResponse } from "next/server";

export const runtime = "nodejs";

// Where the Omni bridge (public/outlook/omni-bridge.ps1) polls for work: the
// Supabase project URL and anon key. Both already ship to every browser in the
// app bundle, so this exposes nothing new; the bridge's own token is what
// authorizes it (mcp_bridge_poll checks its hash).
export async function GET() {
  return NextResponse.json(
    { supabase_url: process.env.NEXT_PUBLIC_SUPABASE_URL, anon_key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY },
    { headers: { "Cache-Control": "no-store" } },
  );
}
