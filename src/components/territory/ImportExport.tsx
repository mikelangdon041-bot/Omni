"use client";

import { useState } from "react";
import { Download, Upload } from "lucide-react";
import type { KOL } from "@/lib/territory/types";
import { ImportModal } from "@/components/territory/ImportModal";
import { ExportModal } from "@/components/territory/ExportModal";

export function ImportExport({
  kols,
  onImport,
}: {
  kols: KOL[];
  onImport: (rows: Partial<KOL>[]) => Promise<void>;
}) {
  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={() => setImportOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-muted transition hover:text-ink"
        title="Import from a spreadsheet (AI-assisted)"
      >
        <Upload size={15} /> Import
      </button>
      <button
        onClick={() => setExportOpen(true)}
        disabled={kols.length === 0}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-muted transition hover:text-ink disabled:opacity-60"
        title="Export to spreadsheet"
      >
        <Download size={15} /> Export
      </button>

      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImport={onImport}
      />
      <ExportModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        kols={kols}
      />
    </div>
  );
}
