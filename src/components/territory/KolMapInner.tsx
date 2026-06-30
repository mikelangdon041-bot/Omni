"use client";

import { MapContainer, TileLayer, CircleMarker, Popup } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import Link from "next/link";
import type { KOL } from "@/lib/territory/types";
import { kolFullName } from "@/lib/territory/utils";

export default function KolMapInner({ kols }: { kols: KOL[] }) {
  const pinned = kols.filter(
    (k) => typeof k.latitude === "number" && typeof k.longitude === "number",
  );

  // Center on the average of pinned KOLs, else the continental US.
  const center: [number, number] = pinned.length
    ? [
        pinned.reduce((s, k) => s + (k.latitude as number), 0) / pinned.length,
        pinned.reduce((s, k) => s + (k.longitude as number), 0) / pinned.length,
      ]
    : [39.5, -98.35];

  return (
    <MapContainer
      center={center}
      zoom={pinned.length ? 5 : 4}
      style={{ height: 480, width: "100%", borderRadius: 12 }}
      scrollWheelZoom
    >
      <TileLayer
        attribution='&copy; OpenStreetMap'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {pinned.map((k) => (
        <CircleMarker
          key={k.id}
          center={[k.latitude as number, k.longitude as number]}
          radius={8}
          pathOptions={{
            color: "#0d9488",
            fillColor: "#0d9488",
            fillOpacity: 0.7,
          }}
        >
          <Popup>
            <div className="text-sm">
              <p className="font-semibold">{kolFullName(k)}</p>
              {k.institution && <p>{k.institution}</p>}
              <Link
                href={`/territory-planning/kol/${k.id}`}
                className="text-[#0d9488] underline"
              >
                Open
              </Link>
            </div>
          </Popup>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}
