"use client";

import { useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import * as XLSX from "xlsx";
import type { KOL } from "@/lib/territory/types";

// Map a flexible spreadsheet header to a KOL field.
const HEADER_MAP: Record<string, keyof KOL> = {
  firstname: "first_name",
  first: "first_name",
  lastname: "last_name",
  last: "last_name",
  specialty: "specialty",
  institution: "institution",
  organization: "institution",
  email: "email",
  phone: "phone",
  address: "address",
  title: "title_position",
  titleposition: "title_position",
  position: "title_position",
  tier: "tier",
  list: "list_name",
  listname: "list_name",
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

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
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  function exportXlsx() {
    const rows = kols.map((k) =>
      Object.fromEntries(EXPORT_FIELDS.map((f) => [f, k[f] ?? ""])),
    );
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "KOLs");
    XLSX.writeFile(wb, "territory-kols.xlsx");
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setMsg(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);

      const rows: Partial<KOL>[] = [];
      for (const r of raw) {
        const kol: Partial<KOL> = {};
        for (const [key, value] of Object.entries(r)) {
          const field = HEADER_MAP[norm(key)];
          if (field && value != null && value !== "") {
            // numeric fields
            if (field === "engagement_score" || field === "priority") {
              (kol as Record<string, unknown>)[field] = Number(value) || 0;
            } else {
              (kol as Record<string, unknown>)[field] = String(value).trim();
            }
          }
        }
        if (kol.first_name && kol.last_name) rows.push(kol);
      }

      if (rows.length === 0) {
        setMsg("No rows with First name + Last name found.");
      } else {
        await onImport(rows);
        setMsg(`Imported ${rows.length} KOL${rows.length === 1 ? "" : "s"}.`);
      }
    } catch {
      setMsg("Could not read that file.");
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        onChange={onFile}
        className="hidden"
      />
      <button
        onClick={() => fileRef.current?.click()}
        disabled={importing}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-muted transition hover:text-ink disabled:opacity-60"
        title="Import from spreadsheet"
      >
        <Upload size={15} /> {importing ? "Importing…" : "Import"}
      </button>
      <button
        onClick={exportXlsx}
        disabled={kols.length === 0}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-muted transition hover:text-ink disabled:opacity-60"
        title="Export to spreadsheet"
      >
        <Download size={15} /> Export
      </button>
      {msg && <span className="text-xs text-muted">{msg}</span>}
    </div>
  );
}
