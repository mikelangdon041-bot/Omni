"use client";

import dynamic from "next/dynamic";
import { useRef, useState } from "react";
import { MapPin, Square } from "lucide-react";
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
  const noAddress = kols.filter((k) => !k.address).length;

  const [geocoding, setGeocoding] = useState(false);
  const [progress, setProgress] = useState(0);
  const [failed, setFailed] = useState(0);
  const cancel = useRef(false);

  async function geocodeMissing() {
    setGeocoding(true);
    setFailed(0);
    setProgress(0);
    cancel.current = false;
    let done = 0;
    let misses = 0;
    for (const k of missing) {
      if (cancel.current) break;
      try {
        const res = await fetch("/api/territory/geocode", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ address: k.address }),
        });
        const { lat, lng } = await res.json();
        if (lat != null && lng != null) await update(k.id, { latitude: lat, longitude: lng });
        else misses++;
      } catch {
        misses++;
      }
      done++;
      setProgress(done);
      setFailed(misses);
      // Be gentle to the public geocoders (Nominatim asks for ~1 req/sec).
      await new Promise((r) => setTimeout(r, 800));
    }
    setGeocoding(false);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">
          <span className="font-medium text-ink">{pinned.length}</span> of {kols.length} on
          the map
          {missing.length > 0 && <> · {missing.length} to locate</>}
          {noAddress > 0 && <> · {noAddress} with no address</>}
          {failed > 0 && !geocoding && (
            <> · <span className="text-status-error">{failed} couldn&apos;t be located</span></>
          )}
        </p>
        {missing.length > 0 && (
          <div className="flex items-center gap-2">
            {geocoding ? (
              <>
                <span className="text-xs text-muted">
                  Locating {progress}/{missing.length}…
                </span>
                <Button size="sm" variant="secondary" onClick={() => (cancel.current = true)}>
                  <Square size={13} /> Stop
                </Button>
              </>
            ) : (
              <Button size="sm" onClick={geocodeMissing}>
                <MapPin size={14} />
                Locate {missing.length} address{missing.length === 1 ? "" : "es"}
              </Button>
            )}
          </div>
        )}
      </div>
      {geocoding && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-canvas">
          <div
            className="h-full rounded-full bg-[var(--accent)] transition-all"
            style={{ width: `${Math.round((progress / Math.max(missing.length, 1)) * 100)}%` }}
          />
        </div>
      )}
      <KolMapInner kols={kols} />
    </div>
  );
}
