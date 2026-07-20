"use client";

import { useCallback, useEffect, useState } from "react";
import { Trash2, Loader2 } from "lucide-react";
import { getDataset } from "@/lib/dashboard/catalog";
import { getModule } from "@/lib/modules";
import type { ChartResult, DashboardTile, DatasetDef } from "@/lib/dashboard/types";
import { ChartCanvas } from "./ChartCanvas";

// Poll for fresh data while the dashboard is open — simpler and more robust
// than wiring per-table realtime channels for every dataset kind, and "auto-
// updates within half a minute" covers the "watch it tick up live" use case.
const LIVE_REFRESH_MS = 20000;

export function TileCard({
  tile,
  extraDatasets,
  canDelete,
  onDeleted,
}: {
  tile: DashboardTile;
  extraDatasets: DatasetDef[];
  canDelete: boolean;
  onDeleted: () => void;
}) {
  const [result, setResult] = useState<ChartResult | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [pulsing, setPulsing] = useState(false);
  const dataset = getDataset(tile.dataset_id, extraDatasets);
  const sourceModule = dataset ? getModule(dataset.module) : undefined;
  const accent = sourceModule?.theme.accent || "var(--accent)";

  const load = useCallback(
    async (silent: boolean) => {
      const res = await fetch("/api/dashboard/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ action: "run", spec: tile.spec }),
      });
      const json = await res.json();
      if (json.result) {
        setResult(json.result);
        if (silent) {
          setPulsing(true);
          setTimeout(() => setPulsing(false), 600);
        }
      }
    },
    [tile.spec],
  );

  useEffect(() => {
    void load(false);
    const id = setInterval(() => void load(true), LIVE_REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  async function remove() {
    setDeleting(true);
    await fetch(`/api/dashboard/tiles/${tile.id}`, { method: "DELETE", credentials: "same-origin" });
    onDeleted();
  }

  return (
    <div
      className="flex flex-col rounded-2xl border border-border bg-surface p-4 shadow-sm transition-shadow"
      style={{ borderTop: `3px solid ${accent}`, boxShadow: pulsing ? `0 0 0 2px ${accent}40` : undefined }}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-ink">{tile.title}</h3>
          <p className="mt-0.5 flex items-center gap-1.5 text-[11px] font-medium" style={{ color: accent }}>
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ backgroundColor: accent }} />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ backgroundColor: accent }} />
            </span>
            {dataset?.moduleLabel || tile.dataset_id} · Live
          </p>
        </div>
        {canDelete && (
          <button
            onClick={remove}
            disabled={deleting}
            aria-label="Delete tile"
            className="shrink-0 rounded-lg p-1.5 text-muted transition hover:bg-canvas hover:text-status-error disabled:opacity-60"
          >
            {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
          </button>
        )}
      </div>
      {result ? (
        <ChartCanvas result={result} chartType={tile.spec.chartType} height={260} />
      ) : (
        <div className="grid h-[260px] place-items-center">
          <Loader2 size={18} className="animate-spin text-muted" />
        </div>
      )}
    </div>
  );
}
