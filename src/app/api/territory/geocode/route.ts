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

  // 1) Census geocoder — best for full US street addresses (exact pin).
  const censusUrl =
    "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress" +
    `?address=${encodeURIComponent(address)}&benchmark=Public_AR_Current&format=json`;
  try {
    const res = await fetch(censusUrl, { signal: AbortSignal.timeout(8000) });
    const data = await res.json();
    const match = data?.result?.addressMatches?.[0]?.coordinates;
    if (match && typeof match.x === "number" && typeof match.y === "number") {
      return NextResponse.json({ lat: match.y, lng: match.x, approximate: false });
    }
  } catch {
    // fall through to the more forgiving geocoder
  }

  // 2) OpenStreetMap Nominatim — forgiving fallback that resolves partial
  //    addresses (just a city + state, an institution, etc.) to a general
  //    location so the KOL still lands roughly on the map.
  try {
    const nomUrl =
      "https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=0" +
      `&q=${encodeURIComponent(address)}`;
    const res = await fetch(nomUrl, {
      signal: AbortSignal.timeout(8000),
      headers: {
        // Nominatim requires an identifying User-Agent.
        "User-Agent": "Omni-Territory/1.0 (territory mapping)",
        "Accept-Language": "en",
      },
    });
    const data = await res.json();
    const hit = Array.isArray(data) ? data[0] : null;
    const lat = hit ? Number(hit.lat) : NaN;
    const lng = hit ? Number(hit.lon) : NaN;
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return NextResponse.json({ lat, lng, approximate: true });
    }
  } catch {
    // fall through
  }

  return NextResponse.json({ lat: null, lng: null });
}
