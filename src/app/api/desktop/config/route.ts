import { NextResponse } from "next/server";

export const runtime = "nodejs";

// What the Windows tray recorder needs to sign in, given only the Omni URL
// you typed into it.
//
// These are the same two values every page of the web app already ships to
// the browser in its JavaScript bundle, so publishing them here gives nothing
// away. The alternative was baking them into the desktop binary at build time,
// which means rebuilding and reinstalling the app if the project ever moves.
//
// Deliberately unauthenticated: it is what you call *before* you have
// credentials.
export function GET() {
  return NextResponse.json(
    {
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || "",
      supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
      // Usernames are mapped onto a synthetic email domain, and the desktop
      // app has to build the same address the web login does.
      emailDomain: "omni.local",
    },
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
}
