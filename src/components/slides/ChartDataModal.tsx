"use client";

// PowerPoint-style chart insertion: a chart is data first. This modal is a
// small spreadsheet — type into cells, paste a range straight from Excel /
// Google Sheets, or import an .xlsx/.csv — with chart-type choice and a live
// preview. Used both to insert a new chart and to edit an existing one.

import { useMemo, useState } from "react";
import {
  AreaChart,
  BarChart3,
  Circle,
  FileUp,
  LineChart,
  PieChart,
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Feedback";
import { SlideCanvas } from "./SlideCanvas";
import { uid, type SlideElement, type SlideTheme } from "@/lib/slides/types";

export interface ChartData {
  chartType: NonNullable<SlideElement["chartType"]>;
  labels: string[];
  series: { name: string; values: number[] }[];
}

const CHART_TYPES: { value: ChartData["chartType"]; label: string; icon: React.ReactNode }[] = [
  { value: "bar", label: "Bar", icon: <BarChart3 size={15} /> },
  { value: "line", label: "Line", icon: <LineChart size={15} /> },
  { value: "area", label: "Area", icon: <AreaChart size={15} /> },
  { value: "pie", label: "Pie", icon: <PieChart size={15} /> },
  { value: "doughnut", label: "Doughnut", icon: <Circle size={15} /> },
];

// Grid model: header row = ["", series names…]; body rows = [label, values…].
function toGrid(data: ChartData | null): string[][] {
  if (!data || !data.series.length) {
    return [
      ["", "Series 1"],
      ["Category 1", ""],
      ["Category 2", ""],
      ["Category 3", ""],
    ];
  }
  const rows = Math.max(data.labels.length, ...data.series.map((s) => s.values.length));
  const grid: string[][] = [["", ...data.series.map((s) => s.name)]];
  for (let r = 0; r < rows; r++) {
    grid.push([
      data.labels[r] || "",
      ...data.series.map((s) => (s.values[r] !== undefined ? String(s.values[r]) : "")),
    ]);
  }
  return grid;
}

function fromGrid(grid: string[][], chartType: ChartData["chartType"]): ChartData | null {
  const header = grid[0] || [];
  const body = grid.slice(1).filter((row) => row.some((c, i) => i > 0 && c.trim() !== ""));
  const nCols = header.length;
  const series: ChartData["series"] = [];
  for (let c = 1; c < nCols; c++) {
    const values = body.map((row) => Number(String(row[c] ?? "").replace(/[,%$\s]/g, "")) || 0);
    if (body.some((row) => String(row[c] ?? "").trim() !== "")) {
      series.push({ name: header[c]?.trim() || `Series ${c}`, values });
    }
  }
  if (!series.length) return null;
  return {
    chartType,
    labels: body.map((row, i) => row[0]?.trim() || `Item ${i + 1}`),
    series,
  };
}

export function ChartDataModal({
  open,
  onClose,
  initial,
  theme,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  initial: ChartData | null; // null = inserting a new chart
  theme: SlideTheme;
  onSave: (data: ChartData) => void;
}) {
  const toast = useToast();
  const [chartType, setChartType] = useState<ChartData["chartType"]>(
    initial?.chartType || "bar",
  );
  const [grid, setGrid] = useState<string[][]>(() => toGrid(initial));
  const [importing, setImporting] = useState(false);

  const data = useMemo(() => fromGrid(grid, chartType), [grid, chartType]);

  const previewSlide = useMemo(
    () => ({
      id: "preview",
      notes: "",
      elements: data
        ? [{ id: uid(), type: "chart" as const, x: 0.6, y: 0.35, w: 8.8, h: 4.9, ...data }]
        : [],
    }),
    [data],
  );

  function setCell(r: number, c: number, v: string) {
    setGrid((g) => g.map((row, ri) => (ri === r ? row.map((cell, ci) => (ci === c ? v : cell)) : row)));
  }

  // Paste a block (TSV from Excel/Sheets, or CSV) starting at the focused cell.
  function onPaste(e: React.ClipboardEvent, r: number, c: number) {
    const text = e.clipboardData.getData("text/plain");
    if (!text || (!text.includes("\t") && !text.includes("\n"))) return; // single value → default paste
    e.preventDefault();
    const sep = text.includes("\t") ? "\t" : ",";
    const rows = text
      .replace(/\r/g, "")
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => line.split(sep));
    setGrid((g) => {
      const next = g.map((row) => [...row]);
      const needRows = r + rows.length;
      const needCols = c + Math.max(...rows.map((x) => x.length));
      while (next.length < needRows) next.push(new Array(next[0].length).fill(""));
      if (needCols > next[0].length) {
        for (const row of next) while (row.length < needCols) row.push("");
        for (let cc = g[0].length; cc < needCols; cc++)
          next[0][cc] = next[0][cc] || `Series ${cc}`;
      }
      rows.forEach((row, ri) =>
        row.forEach((cell, ci) => {
          next[r + ri][c + ci] = cell.trim();
        }),
      );
      return next;
    });
  }

  async function importFile(file: File | null) {
    if (!file) return;
    setImporting(true);
    try {
      const XLSX = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
      const cleaned = rows
        .map((row) => (row as unknown[]).map((c) => String(c ?? "").trim()))
        .filter((row) => row.some((c) => c !== ""));
      if (cleaned.length < 2) throw new Error("Couldn't find a data range in that file.");
      // Assume row 1 = headers (first cell may be blank), col 1 = labels.
      const width = Math.max(...cleaned.map((r) => r.length));
      const norm = cleaned.map((row) => {
        const r = [...row];
        while (r.length < width) r.push("");
        return r;
      });
      if (!norm[0][0]) norm[0][0] = "";
      setGrid(norm.slice(0, 40).map((r) => r.slice(0, 13)));
      toast("success", `Imported ${file.name} — first sheet, ${cleaned.length - 1} rows.`);
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setImporting(false);
    }
  }

  const singleSeries = chartType === "pie" || chartType === "doughnut";

  return (
    <Modal open={open} onClose={onClose} title={initial ? "Edit chart data" : "Insert chart"} size="lg">
      <div className="space-y-4">
        {/* Type picker */}
        <div className="flex flex-wrap gap-1.5">
          {CHART_TYPES.map((t) => (
            <button
              key={t.value}
              onClick={() => setChartType(t.value)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                chartType === t.value
                  ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                  : "border-border text-muted hover:border-[var(--accent)]/40 hover:text-ink"
              }`}
            >
              {t.icon} {t.label}
            </button>
          ))}
          <span className="flex-1" />
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted transition hover:border-[var(--accent)]/40 hover:text-ink">
            <FileUp size={14} /> {importing ? "Importing…" : "Import .xlsx / .csv"}
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              disabled={importing}
              onChange={(e) => {
                void importFile(e.target.files?.[0] || null);
                e.target.value = "";
              }}
            />
          </label>
        </div>

        <p className="text-xs text-muted">
          Type into the cells, or copy a range in Excel / Google Sheets and paste it into the
          top-left cell. First row = series names, first column = category labels.
          {singleSeries && " Pie and doughnut charts use the first series only."}
        </p>

        {/* Data grid */}
        <div className="max-h-64 overflow-auto rounded-lg border border-border">
          <table className="w-full border-collapse text-xs">
            <tbody>
              {grid.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c} className="border border-border/60 p-0">
                      <input
                        value={cell}
                        onChange={(e) => setCell(r, c, e.target.value)}
                        onPaste={(e) => onPaste(e, r, c)}
                        placeholder={
                          r === 0 ? (c === 0 ? "" : `Series ${c}`) : c === 0 ? `Category ${r}` : "0"
                        }
                        className={`w-full min-w-20 bg-transparent px-2 py-1.5 outline-none focus:bg-[var(--accent-soft)]/40 ${
                          r === 0 || c === 0 ? "bg-canvas font-semibold" : ""
                        } ${r === 0 && singleSeries && c > 1 ? "opacity-40" : ""}`}
                      />
                    </td>
                  ))}
                  <td className="w-7 border-0 pl-1">
                    {r > 0 && grid.length > 2 && (
                      <button
                        title="Remove row"
                        className="rounded p-0.5 text-muted hover:text-red-600"
                        onClick={() => setGrid((g) => g.filter((_, ri) => ri !== r))}
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setGrid((g) => [...g, new Array(g[0].length).fill("")])}
          >
            <Plus size={13} /> Row
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={singleSeries}
            onClick={() =>
              setGrid((g) =>
                g.map((row, r) => [...row, r === 0 ? `Series ${row.length}` : ""]),
              )
            }
          >
            <Plus size={13} /> Series
          </Button>
          {grid[0].length > 2 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setGrid((g) => g.map((row) => row.slice(0, -1)))}
            >
              <Trash2 size={13} /> Last series
            </Button>
          )}
        </div>

        {/* Live preview */}
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Preview</p>
          {data ? (
            <div className="pointer-events-none flex justify-center rounded-lg bg-canvas p-2">
              <SlideCanvas slide={previewSlide} theme={theme} width={380} />
            </div>
          ) : (
            <p className="rounded-lg bg-canvas px-3 py-6 text-center text-xs text-muted">
              Enter at least one value to see the preview.
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!data}
            onClick={() => {
              if (!data) return;
              onSave(
                singleSeries ? { ...data, series: data.series.slice(0, 1) } : data,
              );
            }}
          >
            {initial ? "Update chart" : "Insert chart"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
