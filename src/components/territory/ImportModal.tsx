"use client";

import { useState } from "react";
import { Upload, Sparkles, ArrowLeft, Check } from "lucide-react";
import * as XLSX from "xlsx";
import type { KOL } from "@/lib/territory/types";
import {
  PROFILE_FIELDS,
  BOOLEAN_FIELDS,
  SPECIAL_NAME,
  IGNORE,
  CITY,
  STATE,
  ZIP,
} from "@/lib/territory/profileFields";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";

type Step = "upload" | "sheet" | "mapping" | "preview" | "importing" | "done";
interface ColumnInfo {
  index: number;
  header: string;
  field: string;
  reason: string;
  samples: string[];
}

const TRUTHY = new Set(["yes", "y", "true", "t", "1", "x", "✓", "user"]);

function splitName(full: string): { first_name: string; last_name: string } {
  const t = full.trim();
  if (t.includes(",")) {
    const [last, ...rest] = t.split(",");
    return { first_name: rest.join(",").trim(), last_name: last.trim() };
  }
  const p = t.split(/\s+/);
  if (p.length === 1) return { first_name: p[0], last_name: "" };
  return { first_name: p[0], last_name: p.slice(1).join(" ") };
}

export function ImportModal({
  open,
  onClose,
  onImport,
}: {
  open: boolean;
  onClose: () => void;
  onImport: (rows: Partial<KOL>[]) => Promise<void>;
}) {
  const [step, setStep] = useState<Step>("upload");
  const [wb, setWb] = useState<XLSX.WorkBook | null>(null);
  const [rows, setRows] = useState<string[][]>([]);
  const [headerRow, setHeaderRow] = useState(0);
  const [columns, setColumns] = useState<ColumnInfo[]>([]);
  const [summary, setSummary] = useState("");
  const [guidance, setGuidance] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [profiles, setProfiles] = useState<Partial<KOL>[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [count, setCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setStep("upload");
    setWb(null);
    setRows([]);
    setColumns([]);
    setSummary("");
    setGuidance("");
    setProfiles([]);
    setSelected(new Set());
    setError(null);
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    const buf = await file.arrayBuffer();
    const book = XLSX.read(new Uint8Array(buf), { type: "array" });
    setWb(book);
    if (book.SheetNames.length === 1) loadSheet(book, book.SheetNames[0]);
    else setStep("sheet");
  }

  function loadSheet(book: XLSX.WorkBook, name: string) {
    const sheet = book.Sheets[name];
    const raw = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: "" });
    const r = raw
      .map((row) => row.map((c) => String(c ?? "")))
      .filter((row) => row.some((c) => c.trim()));
    setRows(r);
    setStep("mapping");
    void analyze(r, "");
  }

  async function analyze(r: string[][], g: string) {
    setAnalyzing(true);
    setError(null);
    try {
      const sheetText = r.map((row) => row.join("\t")).join("\n");
      const res = await fetch("/api/territory/import-map", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ sheetText, guidance: g }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not analyze");
      const hr = data.headerRow ?? 0;
      setHeaderRow(hr);
      setSummary(data.summary || "");
      const maxCols = Math.max(...r.map((row) => row.length), 0);
      const aiByIndex = new Map<number, { field: string; reason: string }>(
        (data.columns || []).map((c: { index: number; field: string; reason: string }) => [
          c.index,
          { field: c.field, reason: c.reason },
        ]),
      );
      const cols: ColumnInfo[] = [];
      for (let i = 0; i < maxCols; i++) {
        const samples = r
          .slice(hr + 1)
          .map((row) => (row[i] || "").trim())
          .filter(Boolean)
          .slice(0, 3);
        const hasData = samples.length > 0;
        const ai = aiByIndex.get(i);
        cols.push({
          index: i,
          header: (r[hr]?.[i] || `Column ${i + 1}`).trim() || `Column ${i + 1}`,
          field: ai?.field || (hasData ? "notes" : IGNORE),
          reason: ai?.reason || "",
          samples,
        });
      }
      setColumns(cols);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setAnalyzing(false);
    }
  }

  const hasName =
    columns.some((c) => c.field === SPECIAL_NAME) ||
    (columns.some((c) => c.field === "first_name") &&
      columns.some((c) => c.field === "last_name"));

  function buildProfiles(): Partial<KOL>[] {
    const out: Partial<KOL>[] = [];
    for (const row of rows.slice(headerRow + 1)) {
      const kol: Record<string, unknown> = {};
      const street: string[] = [];
      let city = "",
        state = "",
        zip = "";
      const notes: string[] = [];
      for (const col of columns) {
        if (col.field === IGNORE) continue;
        const val = (row[col.index] ?? "").trim();
        if (!val) continue;
        if (col.field === SPECIAL_NAME) {
          const { first_name, last_name } = splitName(val);
          kol.first_name = first_name;
          kol.last_name = last_name;
        } else if (col.field === "address") street.push(val);
        else if (col.field === CITY) city = city ? `${city} ${val}` : val;
        else if (col.field === STATE) state = val;
        else if (col.field === ZIP) zip = val;
        else if (col.field === "notes") notes.push(val);
        else if (BOOLEAN_FIELDS.has(col.field))
          kol[col.field] = TRUTHY.has(val.toLowerCase());
        else kol[col.field] = kol[col.field] ? `${kol[col.field]}\n${val}` : val;
      }
      const address = [...street, city, [state, zip].filter(Boolean).join(" ")]
        .filter(Boolean)
        .join(", ");
      if (address) kol.address = address;
      if (notes.length) kol.other_info = notes.join("\n");
      if (kol.first_name || kol.last_name) out.push(kol as Partial<KOL>);
    }
    return out;
  }

  function goPreview() {
    const built = buildProfiles();
    setProfiles(built);
    setSelected(new Set(built.map((_, i) => i)));
    setStep("preview");
  }

  async function doImport() {
    setError(null);
    setStep("importing");
    const chosen = profiles.filter((_, i) => selected.has(i));
    try {
      await onImport(chosen);
      setCount(chosen.length);
      setStep("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
      setStep("preview");
    }
  }

  function close() {
    reset();
    onClose();
  }

  return (
    <Modal open={open} onClose={close} title="Import KOLs" size="lg">
      {error && <p className="mb-3 text-sm text-status-error">{error}</p>}

      {step === "upload" && (
        <label className="grid cursor-pointer place-items-center gap-2 rounded-xl border border-dashed border-border py-12 text-sm text-muted transition hover:border-[var(--accent)] hover:text-ink">
          <Upload size={24} />
          Choose a spreadsheet (.xlsx, .xls, .csv)
          <span className="text-xs">
            The AI reads it and maps the columns — any layout works.
          </span>
          <input type="file" accept=".xlsx,.xls,.csv" onChange={onFile} className="hidden" />
        </label>
      )}

      {step === "sheet" && wb && (
        <div className="space-y-2">
          <p className="text-sm text-muted">Pick a sheet to import:</p>
          {wb.SheetNames.map((n) => (
            <button
              key={n}
              onClick={() => loadSheet(wb, n)}
              className="block w-full rounded-lg border border-border px-4 py-3 text-left text-sm transition hover:border-[var(--accent)]"
            >
              {n}
            </button>
          ))}
        </div>
      )}

      {step === "mapping" && (
        <div className="space-y-4">
          {analyzing ? (
            <p className="py-8 text-center text-sm text-muted">
              <Sparkles size={16} className="mr-1 inline" /> AI is reading your sheet…
            </p>
          ) : (
            <>
              {summary && (
                <p className="rounded-lg bg-[var(--accent-soft)] px-3 py-2 text-sm text-ink">
                  {summary}
                </p>
              )}
              <div className="max-h-64 overflow-auto rounded-lg border border-border">
                <table className="w-full text-xs">
                  <tbody>
                    {rows.slice(0, 50).map((row, ri) => (
                      <tr
                        key={ri}
                        className={ri === headerRow ? "bg-canvas font-medium" : ""}
                      >
                        {row.map((cell, ci) => (
                          <td key={ci} className="max-w-40 truncate border border-border px-2 py-1">
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="space-y-2">
                {columns.map((c) => (
                  <div key={c.index} className="flex flex-wrap items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{c.header}</p>
                      <p className="truncate text-xs text-muted">
                        {c.samples.join(" · ") || "(no data)"}
                      </p>
                    </div>
                    <select
                      value={c.field}
                      onChange={(e) =>
                        setColumns((prev) =>
                          prev.map((x) =>
                            x.index === c.index ? { ...x, field: e.target.value } : x,
                          ),
                        )
                      }
                      className="rounded-lg border border-border bg-surface px-2 py-1.5 text-xs outline-none focus:border-[var(--accent)]"
                    >
                      {PROFILE_FIELDS.map((f) => (
                        <option key={f.key} value={f.key}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  value={guidance}
                  onChange={(e) => setGuidance(e.target.value)}
                  placeholder="Tell the AI anything (e.g. 'column C is the institution')…"
                  className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
                />
                <Button variant="secondary" onClick={() => analyze(rows, guidance)}>
                  <Sparkles size={14} /> Re-map
                </Button>
              </div>

              <div className="flex justify-between border-t border-border pt-4">
                <Button variant="secondary" onClick={reset}>
                  <ArrowLeft size={14} /> Start over
                </Button>
                <Button onClick={goPreview} disabled={!hasName}>
                  Preview {!hasName && "(need a name column)"}
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {step === "preview" && (
        <div className="space-y-3">
          <p className="text-sm text-muted">
            {selected.size} of {profiles.length} rows selected.
          </p>
          <div className="max-h-72 overflow-auto rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-canvas">
                <tr>
                  <th className="px-2 py-1.5" />
                  <th className="px-2 py-1.5 text-left">Name</th>
                  <th className="px-2 py-1.5 text-left">Specialty</th>
                  <th className="px-2 py-1.5 text-left">Institution</th>
                  <th className="px-2 py-1.5 text-left">Email</th>
                </tr>
              </thead>
              <tbody>
                {profiles.map((p, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="px-2 py-1.5">
                      <input
                        type="checkbox"
                        checked={selected.has(i)}
                        onChange={(e) =>
                          setSelected((prev) => {
                            const n = new Set(prev);
                            if (e.target.checked) n.add(i);
                            else n.delete(i);
                            return n;
                          })
                        }
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      {p.first_name} {p.last_name}
                    </td>
                    <td className="px-2 py-1.5">{p.specialty}</td>
                    <td className="px-2 py-1.5">{p.institution}</td>
                    <td className="px-2 py-1.5">{p.email}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-between border-t border-border pt-4">
            <Button variant="secondary" onClick={() => setStep("mapping")}>
              <ArrowLeft size={14} /> Back to mapping
            </Button>
            <Button onClick={doImport} disabled={selected.size === 0}>
              Import {selected.size}
            </Button>
          </div>
        </div>
      )}

      {step === "importing" && (
        <p className="py-12 text-center text-sm text-muted">Importing…</p>
      )}

      {step === "done" && (
        <div className="py-10 text-center">
          <Check size={28} className="mx-auto mb-2 text-status-complete" />
          <p className="text-sm font-medium">Imported {count} KOLs.</p>
          <Button className="mt-4" onClick={close}>
            Done
          </Button>
        </div>
      )}
    </Modal>
  );
}
