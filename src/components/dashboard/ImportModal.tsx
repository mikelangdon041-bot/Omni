"use client";

import { useState } from "react";
import type * as XLSX from "xlsx";
import { Upload, Loader2, Check } from "lucide-react";
import { readWorkbookFile, sheetToRows } from "@/lib/xlsx";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import type { ImportColumn } from "@/lib/dashboard/types";

type Step = "upload" | "sheet" | "preview";

function inferColumns(headers: string[], sampleRows: string[][]): ImportColumn[] {
  return headers.map((h, i) => {
    const values = sampleRows.map((r) => r[i]).filter((v) => v !== "" && v !== undefined);
    const numeric = values.length > 0 && values.every((v) => !Number.isNaN(Number(v)));
    const key = h.trim() || `column_${i + 1}`;
    return { key, label: h.trim() || `Column ${i + 1}`, type: numeric ? "number" : "string" };
  });
}

function rowsToObjects(headers: string[], columns: ImportColumn[], rows: string[][]) {
  return rows.map((r) => {
    const obj: Record<string, string | number> = {};
    columns.forEach((c, i) => {
      const raw = r[i] ?? "";
      obj[c.key] = c.type === "number" && raw !== "" ? Number(raw) : raw;
    });
    return obj;
  });
}

export function ImportModal({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}) {
  const [step, setStep] = useState<Step>("upload");
  const [book, setBook] = useState<XLSX.WorkBook | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [dataRows, setDataRows] = useState<string[][]>([]);
  const [columns, setColumns] = useState<ImportColumn[]>([]);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setStep("upload");
    setBook(null);
    setHeaders([]);
    setDataRows([]);
    setColumns([]);
    setTitle("");
    setError(null);
  }

  function loadSheet(wb: XLSX.WorkBook, name: string) {
    const rows = sheetToRows(wb, name);
    if (rows.length < 2) {
      setError("That sheet doesn't have a header row plus at least one data row.");
      return;
    }
    const [hdr, ...data] = rows;
    setHeaders(hdr);
    setDataRows(data);
    setColumns(inferColumns(hdr, data.slice(0, 50)));
    setStep("preview");
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setTitle(file.name.replace(/\.(xlsx|xls|csv)$/i, ""));
    try {
      const wb = await readWorkbookFile(file);
      setBook(wb);
      if (wb.SheetNames.length === 1) loadSheet(wb, wb.SheetNames[0]);
      else setStep("sheet");
    } catch {
      setError("Could not read that file. Make sure it's a valid .xlsx, .xls, or .csv.");
    }
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/dashboard/imports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          title: title.trim() || "Imported data",
          columns,
          rows: rowsToObjects(headers, columns, dataRows),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not save import");
      onImported();
      onClose();
      reset();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save import");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        onClose();
        reset();
      }}
      title="Import data"
      size="md"
    >
      {step === "upload" && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-10 text-center">
          <Upload size={22} className="text-muted" />
          <p className="text-sm text-muted">
            Upload an .xlsx, .xls, or .csv file. Once imported, ask to visualize it just like any
            other app&apos;s data.
          </p>
          <label className="cursor-pointer rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-fg)]">
            Choose file
            <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onFile} />
          </label>
          {error && <p className="text-sm text-status-error">{error}</p>}
        </div>
      )}

      {step === "sheet" && book && (
        <div className="flex flex-col gap-2">
          <p className="mb-1 text-sm text-ink">This workbook has multiple sheets — pick one:</p>
          {book.SheetNames.map((name) => (
            <button
              key={name}
              onClick={() => loadSheet(book, name)}
              className="rounded-lg border border-border bg-surface px-3 py-2 text-left text-sm hover:border-[var(--accent)]"
            >
              {name}
            </button>
          ))}
        </div>
      )}

      {step === "preview" && (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-ink">Title</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
            />
          </label>

          <p className="text-xs text-muted">
            {dataRows.length} rows · {columns.length} columns. String columns become groupings;
            number columns become measures.
          </p>

          <div className="max-h-64 overflow-auto rounded-lg border border-border">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-canvas">
                <tr>
                  {columns.map((c) => (
                    <th key={c.key} className="whitespace-nowrap px-2.5 py-1.5 font-semibold text-ink">
                      {c.label}
                      <span className="ml-1 font-normal text-muted">({c.type})</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dataRows.slice(0, 8).map((r, i) => (
                  <tr key={i} className="border-t border-border">
                    {r.map((cell, j) => (
                      <td key={j} className="whitespace-nowrap px-2.5 py-1.5 text-ink">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {error && <p className="text-sm text-status-error">{error}</p>}

          <div className="flex justify-end gap-2 border-t border-border pt-3">
            <Button variant="secondary" onClick={reset}>
              Start over
            </Button>
            <Button onClick={save} disabled={busy || !title.trim()}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              Import
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
