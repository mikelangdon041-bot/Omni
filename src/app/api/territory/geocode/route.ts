import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Geocode a US address via the free Census geocoder (no API key needed).
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const address = String(body.address || "").trim();
  if (!address) return NextResponse.json({ lat: null, lng: null });

  const url =
    "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress" +
    `?address=${encodeURIComponent(address)}&benchmark=Public_AR_Current&format=json`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const data = await res.json();
    const match = data?.result?.addressMatches?.[0]?.coordinates;
    if (match && typeof match.x === "number" && typeof match.y === "number") {
      return NextResponse.json({ lat: match.y, lng: match.x });
    }
  } catch {
    // fall through
  }
  return NextResponse.json({ lat: null, lng: null });
}
