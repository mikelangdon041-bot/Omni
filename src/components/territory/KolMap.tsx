"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { MapPin } from "lucide-react";
import type { KOL } from "@/lib/territory/types";
import { Button } from "@/components/ui/Button";

const KolMapInner = dynamic(() => import("./KolMapInner"), {
  ssr: false,
  loading: () => (
    <div className="grid h-[480px] place-items-center rounded-xl border border-border bg-surface text-sm text-muted">
      Loading map…
    </div>
  ),
});

export function KolMap({
  kols,
  update,
}: {
  kols: KOL[];
  update: (id: string, partial: Partial<KOL>) => Promise<void>;
}) {
  const missing = kols.filter(
    (k) => k.address && (k.latitude == null || k.longitude == null),
  );
  const pinned = kols.filter((k) => k.latitude != null && k.longitude != null);
  const [geocoding, setGeocoding] = useState(false);
  const [progress, setProgress] = useState(0);

  async function geocodeMissing() {
    setGeocoding(true);
    let done = 0;
    for (const k of missing) {
      try {
        const res = await fetch("/api/territory/geocode", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ address: k.address }),
        });
        const { lat, lng } = await res.json();
        if (lat != null && lng != null)
          await update(k.id, { latitude: lat, longitude: lng });
      } catch {
        // skip
      }
      done++;
      setProgress(done);
      await new Promise((r) => setTimeout(r, 250)); // be gentle to the geocoder
    }
    setGeocoding(false);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">
          {pinned.length} of {kols.length} KOLs on the map.
        </p>
        {missing.length > 0 && (
          <Button size="sm" onClick={geocodeMissing} disabled={geocoding}>
            <MapPin size={14} />
            {geocoding
              ? `Geocoding ${progress}/${missing.length}…`
              : `Geocode ${missing.length} address${missing.length === 1 ? "" : "es"}`}
          </Button>
        )}
      </div>
      <KolMapInner kols={kols} />
    </div>
  );
}
