"use client";

import { useEffect, useState } from "react";
import { Trash2, Loader2 } from "lucide-react";
import { getDataset } from "@/lib/dashboard/catalog";
import { getModule } from "@/lib/modules";
import type { ChartResult, DashboardTile } from "@/lib/dashboard/types";
import { ChartCanvas } from "./ChartCanvas";

export function TileCard({
  tile,
  canDelete,
  onDeleted,
}: {
  tile: DashboardTile;
  canDelete: boolean;
  onDeleted: () => void;
}) {
  const [result, setResult] = useState<ChartResult | null>(null);
  const [deleting, setDeleting] = useState(false);
  const dataset = getDataset(tile.dataset_id);
  const sourceModule = dataset ? getModule(dataset.module) : undefined;
  const accent = sourceModule?.theme.accent || "var(--accent)";

  useEffect(() => {
    let active = true;
    fetch("/api/dashboard/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ action: "run", spec: tile.spec }),
    })
      .then((r) => r.json())
      .then((json) => {
        if (active) setResult(json.result || null);
      });
    return () => {
      active = false;
    };
  }, [tile.spec]);

  async function remove() {
    setDeleting(true);
    await fetch(`/api/dashboard/tiles/${tile.id}`, { method: "DELETE", credentials: "same-origin" });
    onDeleted();
  }

  return (
    <div
      className="flex flex-col rounded-2xl border border-border bg-surface p-4 shadow-sm"
      style={{ borderTop: `3px solid ${accent}` }}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-ink">{tile.title}</h3>
          <p
            className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-medium"
            style={{ color: accent }}
          >
            {dataset?.moduleLabel || tile.dataset_id}
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
