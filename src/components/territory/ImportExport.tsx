"use client";

import { useState } from "react";
import { Download, Upload } from "lucide-react";
import * as XLSX from "xlsx";
import type { KOL } from "@/lib/territory/types";
import { ImportModal } from "@/components/territory/ImportModal";

const EXPORT_FIELDS: (keyof KOL)[] = [
  "first_name",
  "last_name",
  "title_position",
  "specialty",
  "institution",
  "email",
  "phone",
  "address",
  "tier",
  "list_name",
  "relationship_level",
  "engagement_score",
  "priority",
];

export function ImportExport({
  kols,
  onImport,
}: {
  kols: KOL[];
  onImport: (rows: Partial<KOL>[]) => Promise<void>;
}) {
  const [importOpen, setImportOpen] = useState(false);

  function exportXlsx() {
    const rows = kols.map((k) =>
      Object.fromEntries(EXPORT_FIELDS.map((f) => [f, k[f] ?? ""])),
    );
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "KOLs");
    XLSX.writeFile(wb, "territory-kols.xlsx");
  }

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
        onClick={exportXlsx}
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
    </div>
  );
}
