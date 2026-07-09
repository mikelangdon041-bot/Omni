"use client";

// Compact "⋯" tools menu for the roster toolbar: Import, Export, and —
// only when fuzzy matching actually finds candidates — Combine duplicates.

import { useEffect, useMemo, useRef, useState } from "react";
import { MoreVertical, Upload, Download, Wand2 } from "lucide-react";
import type { KOL } from "@/lib/territory/types";
import { groupSimilar } from "@/lib/territory/dedupe";
import { kolFullName } from "@/lib/territory/utils";
import { ImportModal } from "@/components/territory/ImportModal";
import { ExportModal } from "@/components/territory/ExportModal";
import { MergeKolsModal } from "@/components/territory/MergeKolsModal";

export function ToolsMenu({
  kols,
  onImport,
  onMerge,
}: {
  kols: KOL[];
  onImport: (rows: Partial<KOL>[]) => Promise<void>;
  onMerge: (primaryId: string, duplicateIds: string[], overrides: Partial<KOL>) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const dupGroups = useMemo(
    () => groupSimilar(kols, (k) => kolFullName(k)).filter((g) => g.items.length > 1).length,
    [kols],
  );

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center rounded-lg border border-border bg-surface p-2.5 text-muted transition hover:text-ink"
        title="Tools"
        aria-label="Tools"
      >
        <MoreVertical size={16} />
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-1.5 w-56 overflow-hidden rounded-xl border border-border bg-surface py-1.5 shadow-lg">
          <MenuItem
            icon={Upload}
            label="Import from spreadsheet"
            onClick={() => {
              setOpen(false);
              setImportOpen(true);
            }}
          />
          <MenuItem
            icon={Download}
            label="Export to Excel"
            disabled={kols.length === 0}
            onClick={() => {
              setOpen(false);
              setExportOpen(true);
            }}
          />
          {dupGroups > 0 && (
            <MenuItem
              icon={Wand2}
              label={`Combine duplicates (${dupGroups})`}
              onClick={() => {
                setOpen(false);
                setMergeOpen(true);
              }}
            />
          )}
        </div>
      )}

      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImport={onImport}
      />
      <ExportModal open={exportOpen} onClose={() => setExportOpen(false)} kols={kols} />
      <MergeKolsModal
        open={mergeOpen}
        onClose={() => setMergeOpen(false)}
        kols={kols}
        onMerge={onMerge}
      />
    </div>
  );
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  disabled,
}: {
  icon: React.ElementType;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-ink transition hover:bg-canvas disabled:opacity-50"
    >
      <Icon size={15} className="text-muted" />
      {label}
    </button>
  );
}
