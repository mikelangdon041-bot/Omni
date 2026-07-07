"use client";

// AI-assisted schedule / poster import (spec §7.16, §10.3).
// Upload a workbook (or paste any schedule text) → pick a sheet → preview the
// raw grid with optional free-text guidance → AI normalizes it into rows →
// review wizard (edit, select/deselect, validate, resolve names against the
// roster) → events, booth shifts, and posters are created on confirm.

import { useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { createClient } from "@/lib/supabase/client";
import {
  ChevronDown,
  ChevronRight,
  FileSpreadsheet,
  Sparkles,
  TriangleAlert,
  Upload,
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";
import { ProgressBar } from "@/components/conference/Bits";
import { cn } from "@/lib/ui";
import { useConferenceCtx } from "@/components/conference/ConferenceContext";
import {
  EVENT_TYPES,
  EVENT_TYPE_ORDER,
  type EventType,
  type Priority,
} from "@/lib/conference/types";
import {
  fmtDayKey,
  listDays,
  localToUtcISO,
} from "@/lib/conference/utils";

const supabase = createClient();

type ImportEventType = Exclude<EventType, "poster">;

interface ImportRow {
  key: string;
  checked: boolean;
  kind: "event" | "poster";
  event_type: ImportEventType;
  // The type the AI originally suggested. Grouping keys off this — never off
  // the current type — so editing a row's type updates it in place instead of
  // teleporting it into another group mid-review.
  suggested: ImportEventType | "poster";
  title: string;
  description: string;
  location: string;
  date: string; // YYYY-MM-DD
  start_time: string; // HH:MM
  end_time: string;
  people: string[];
  authors: string;
  abstract: string;
  session_label: string;
  priority: Priority | null;
}

type Step = "source" | "sheet" | "preview" | "review" | "done";

// name → attendee id, "__create__", or "__skip__"
type Resolution = Record<string, string>;

export function ImportScheduleModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { conference, attendees, me } = useConferenceCtx();
  const tz = conference.timezone;
  const days = useMemo(
    () => listDays(conference.start_date, conference.end_date),
    [conference.start_date, conference.end_date],
  );

  const [step, setStep] = useState<Step>("source");
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [rawText, setRawText] = useState(""); // serialized grid or pasted doc
  const [previewGrid, setPreviewGrid] = useState<string[][] | null>(null);
  const [pasted, setPasted] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [guidance, setGuidance] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parsePct, setParsePct] = useState(0);
  const [parseFound, setParseFound] = useState(0);
  const [error, setError] = useState("");
  const [rows, setRows] = useState<ImportRow[]>([]);
  // Batch-selection for bulk type assignment — independent of the "will
  // import" checkboxes, so several different batches can be typed in turn.
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [resolution, setResolution] = useState<Resolution>({});
  const [importing, setImporting] = useState(false);
  const [importPct, setImportPct] = useState(0);
  const [result, setResult] = useState({ events: 0, posters: 0, people: 0 });
  const fileRef = useRef<HTMLInputElement>(null);

  function reset() {
    setStep("source");
    setWorkbook(null);
    setRawText("");
    setPreviewGrid(null);
    setPasted("");
    setSourceName("");
    setGuidance("");
    setRows([]);
    setSelectedKeys(new Set());
    setCollapsedGroups(new Set());
    setResolution({});
    setError("");
  }

  function close() {
    reset();
    onClose();
  }

  // ---- Step 1: source --------------------------------------------------
  async function onFile(file: File | null) {
    if (!file) return;
    setError("");
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { cellDates: false });
      setSourceName(file.name);
      if (wb.SheetNames.length > 1) {
        setWorkbook(wb);
        setStep("sheet");
      } else {
        setRawText(serializeSheet(wb, wb.SheetNames[0]));
        setPreviewGrid(gridPreview(wb, wb.SheetNames[0]));
        setStep("preview");
      }
    } catch {
      setError("Couldn't read that file — is it a valid Excel/CSV workbook?");
    }
  }

  function pickSheet(name: string) {
    if (!workbook) return;
    setSourceName((s) => `${s} · ${name}`);
    setRawText(serializeSheet(workbook, name));
    setPreviewGrid(gridPreview(workbook, name));
    setStep("preview");
  }

  function useDocument() {
    if (!pasted.trim()) return;
    setSourceName("Pasted document");
    setRawText(pasted.trim());
    setPreviewGrid(null);
    setStep("preview");
  }

  // ---- Step 3: AI parse --------------------------------------------------
  // Large sources are parsed in chunks (a 200-row master schedule would blow
  // the model's output limit in one go). Each chunk streams back as it is
  // generated; every row has exactly one "title" field, so counting titles in
  // the partial text gives a live row count → real progress across the run.
  async function parse() {
    setParsing(true);
    setParsePct(0);
    setParseFound(0);
    setError("");
    try {
      const isGrid = !!previewGrid;
      const lines = rawText.split("\n").filter((l) => l.trim());
      const header = isGrid ? lines[0] || "" : "";
      const data = isGrid ? lines.slice(1) : lines;
      const chunkSize = isGrid ? 35 : 60;
      const batches: string[][] = [];
      for (let i = 0; i < data.length; i += chunkSize) {
        batches.push(data.slice(i, i + chunkSize));
      }
      const expected = isGrid
        ? Math.max(1, data.length)
        : estimateSourceRows(rawText, false);
      const dateLike =
        /(\d{1,2}\/\d{1,2}\/\d{2,4})|(\d{4}-\d{2}-\d{2})|\b(mon|tues|wednes|thurs|fri|satur|sun)day\b/i;

      // Each chunk's date context comes from the SOURCE text (day headers /
      // merged date cells above it), not from earlier results — so chunks are
      // independent and can run in parallel. 4 at a time keeps a 6-chunk
      // master schedule to ~1-2 chunk durations instead of 6.
      const batchInfos = batches.map((batch, i) => {
        let context = "";
        if (i > 0) {
          for (let j = i * chunkSize - 1; j >= 0; j--) {
            if (dateLike.test(data[j])) {
              context = data[j];
              break;
            }
          }
        }
        const chunkText = [
          header,
          context
            ? `(Date context from earlier rows, ALREADY imported — do not re-emit: ${context})`
            : "",
          ...batch,
        ]
          .filter(Boolean)
          .join("\n");
        return { chunkText, len: batch.length };
      });

      const results: Partial<ImportRow>[][] = new Array(batchInfos.length);
      const foundBy: number[] = new Array(batchInfos.length).fill(0);
      const doneBy: boolean[] = new Array(batchInfos.length).fill(false);
      const report = () => {
        setParseFound(foundBy.reduce((a, b) => a + b, 0));
        const progressed = batchInfos.reduce(
          (acc, info, i) =>
            acc + (doneBy[i] ? info.len : Math.min(foundBy[i], info.len)),
          0,
        );
        setParsePct(
          Math.min(97, Math.max(2, Math.round((progressed / expected) * 100))),
        );
      };

      let nextChunk = 0;
      const worker = async () => {
        while (nextChunk < batchInfos.length) {
          const i = nextChunk++;
          const payload = {
            action: "parse_schedule",
            text: batchInfos[i].chunkText,
            guidance,
            days,
            attendees: attendees.map((a) => a.name),
          };
          const onFound = (n: number) => {
            foundBy[i] = n;
            report();
          };
          try {
            results[i] = await streamParseChunk(payload, onFound);
          } catch {
            // One retry per chunk — a hiccup shouldn't sink the whole run.
            results[i] = await streamParseChunk(payload, onFound);
          }
          doneBy[i] = true;
          foundBy[i] = results[i].length;
          report();
        }
      };
      await Promise.all(
        Array.from(
          { length: Math.min(4, batchInfos.length) },
          () => worker(),
        ),
      );
      const all: Partial<ImportRow>[] = results.flat();
      setParsePct(100);
      const parsed: ImportRow[] = all.map(
        (r: Partial<ImportRow>, i: number) => ({
          key: `row-${i}`,
          checked: true,
          kind: r.kind === "poster" ? "poster" : "event",
          event_type: isImportEventType(r.event_type) ? r.event_type : "session",
          suggested:
            r.kind === "poster"
              ? ("poster" as const)
              : isImportEventType(r.event_type)
                ? r.event_type
                : ("session" as const),
          title: String(r.title || "").trim(),
          description: String(r.description || ""),
          location: String(r.location || ""),
          date: /^\d{4}-\d{2}-\d{2}$/.test(String(r.date || "")) ? String(r.date) : "",
          start_time: /^\d{2}:\d{2}$/.test(String(r.start_time || ""))
            ? String(r.start_time)
            : "",
          end_time: /^\d{2}:\d{2}$/.test(String(r.end_time || "")) ? String(r.end_time) : "",
          people: Array.isArray(r.people) ? r.people.map(String).filter(Boolean) : [],
          authors: String(r.authors || ""),
          abstract: String(r.abstract || ""),
          session_label: String(r.session_label || ""),
          priority:
            r.priority === "high" || r.priority === "medium" || r.priority === "low"
              ? r.priority
              : null,
        }),
      );
      if (parsed.length === 0) {
        setError("The AI found no importable rows. Try adding guidance below and re-run.");
        return;
      }
      setRows(parsed);
      setSelectedKeys(new Set());
      setCollapsedGroups(new Set());
      setResolution(autoResolve(parsed, attendees));
      setStep("review");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setParsing(false);
    }
  }

  // ---- Step 4: review helpers -------------------------------------------
  const distinctNames = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) for (const p of r.people) set.add(p);
    return [...set].sort();
  }, [rows]);

  const unresolved = distinctNames.filter((n) => !resolution[n]);

  function rowValid(r: ImportRow): boolean {
    if (!r.title) return false;
    if (r.kind === "event") return !!r.date && !!r.start_time;
    return true;
  }

  function updateRow(key: string, partial: Partial<ImportRow>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...partial } : r)));
  }

  function setChecked(keys: string[], checked: boolean) {
    const set = new Set(keys);
    setRows((prev) => (prev.map((r) => (set.has(r.key) ? { ...r, checked } : r))));
  }

  // Bulk type assignment: retag every given row at once (e.g. "these 10 are
  // all educational sessions") instead of editing rows one by one.
  function applyType(keys: string[], v: string) {
    const set = new Set(keys);
    setRows((prev) =>
      prev.map((r) => {
        if (!set.has(r.key)) return r;
        return v === "poster"
          ? { ...r, kind: "poster" as const }
          : { ...r, kind: "event" as const, event_type: v as ImportEventType };
      }),
    );
  }

  function toggleSelected(key: string) {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Type the current batch, clear the selection, ready for the next batch.
  function applyTypeToSelection(v: string) {
    applyType([...selectedKeys], v);
    setSelectedKeys(new Set());
  }

  const selected = rows.filter((r) => r.checked && rowValid(r));

  // Rows grouped by the AI's ORIGINAL suggestion, not the current type —
  // groups are stable while reviewing, so a row whose type you correct stays
  // exactly where it is (its dropdown and color update in place).
  const groups = useMemo(
    () =>
      EVENT_TYPE_ORDER.map((t) => ({
        type: t,
        rows: rows.filter((r) => r.suggested === t),
      })).filter((g) => g.rows.length > 0),
    [rows],
  );

  // ---- Step 5: import ----------------------------------------------------
  // Everything inserts in bulk (one round-trip per table, chunked at 100 rows)
  // instead of one insert per row — a 180-row import is a handful of requests
  // rather than hundreds.
  async function runImport() {
    setImporting(true);
    setImportPct(0);
    setError("");
    const CHUNK = 100;
    try {
      // Resolve names → attendee ids, creating new attendees where chosen.
      const nameToId: Record<string, string> = {};
      let created = 0;
      for (const name of distinctNames) {
        const r = resolution[name];
        if (r && r !== "__skip__" && r !== "__create__") nameToId[name] = r;
      }
      const toCreate = distinctNames.filter((n) => resolution[n] === "__create__");
      if (toCreate.length) {
        const { data, error: aErr } = await supabase
          .from("conference_attendees")
          .insert(toCreate.map((name) => ({ conference_id: conference.id, name })))
          .select("id, name");
        if (aErr) throw new Error(aErr.message);
        for (const a of data || []) {
          nameToId[a.name] = a.id;
          created++;
        }
      }
      setImportPct(10);

      const evRows = selected.filter((r) => r.kind === "event");
      const poRows = selected.filter((r) => r.kind === "poster");
      const peopleIdsFor = (r: ImportRow) =>
        r.people.map((p) => nameToId[p]).filter(Boolean) as string[];

      // Events, then their assignments + booth shifts, each as bulk inserts.
      let events = 0;
      const assignments: Record<string, unknown>[] = [];
      const shifts: Record<string, unknown>[] = [];
      for (let i = 0; i < evRows.length; i += CHUNK) {
        const slice = evRows.slice(i, i + CHUNK);
        const payload = slice.map((r) => {
          const starts_at = localToUtcISO(r.date, r.start_time, tz);
          const ends_at = localToUtcISO(
            r.date,
            r.end_time && r.end_time > r.start_time ? r.end_time : addHour(r.start_time),
            tz,
          );
          return {
            conference_id: conference.id,
            title: r.title,
            event_type: r.event_type,
            description: r.description,
            location: r.location,
            starts_at,
            ends_at,
            suspected_priority: r.priority,
            created_by: me?.id,
          };
        });
        // Returned rows follow insert order, so index j maps back to slice[j].
        const { data, error: eErr } = await supabase
          .from("conf_events")
          .insert(payload)
          .select("id");
        if (eErr) throw new Error(eErr.message);
        (data || []).forEach((ev, j) => {
          const r = slice[j];
          for (const [k, attendee_id] of peopleIdsFor(r).entries()) {
            assignments.push({
              conference_id: conference.id,
              event_id: ev.id,
              attendee_id,
            });
            // Booth-duty rows also get coverage shifts spanning the event.
            if (r.event_type === "booth") {
              shifts.push({
                conference_id: conference.id,
                event_id: ev.id,
                attendee_id,
                starts_at: payload[j].starts_at,
                ends_at: payload[j].ends_at,
                sort_order: k,
              });
            }
          }
          events++;
        });
        setImportPct(10 + Math.round(((i + slice.length) / Math.max(1, evRows.length)) * 45));
      }
      for (let i = 0; i < assignments.length; i += CHUNK) {
        const { error: asErr } = await supabase
          .from("conf_event_assignments")
          .insert(assignments.slice(i, i + CHUNK));
        if (asErr) throw new Error(asErr.message);
      }
      setImportPct(65);
      for (let i = 0; i < shifts.length; i += CHUNK) {
        const { error: shErr } = await supabase
          .from("conf_event_shifts")
          .insert(shifts.slice(i, i + CHUNK));
        if (shErr) throw new Error(shErr.message);
      }
      setImportPct(72);

      // Posters + their reps, same pattern.
      let posters = 0;
      const reps: Record<string, unknown>[] = [];
      for (let i = 0; i < poRows.length; i += CHUNK) {
        const slice = poRows.slice(i, i + CHUNK);
        const { data, error: pErr } = await supabase
          .from("conf_posters")
          .insert(
            slice.map((r) => ({
              conference_id: conference.id,
              title: r.title,
              date: r.date ? fmtDayKey(r.date, { weekday: true }) : "",
              time: r.start_time,
              location: r.location,
              authors: r.authors,
              abstract: r.abstract,
              session_label: r.session_label,
              suspected_priority: r.priority,
            })),
          )
          .select("id");
        if (pErr) throw new Error(pErr.message);
        (data || []).forEach((p, j) => {
          for (const attendee_id of peopleIdsFor(slice[j])) {
            reps.push({
              conference_id: conference.id,
              poster_id: p.id,
              attendee_id,
            });
          }
          posters++;
        });
        setImportPct(72 + Math.round(((i + slice.length) / Math.max(1, poRows.length)) * 23));
      }
      for (let i = 0; i < reps.length; i += CHUNK) {
        const { error: rErr } = await supabase
          .from("conf_poster_reps")
          .insert(reps.slice(i, i + CHUNK));
        if (rErr) throw new Error(rErr.message);
      }
      setImportPct(100);
      setResult({ events, posters, people: created });
      setStep("done");
    } catch (e) {
      setError((e as Error).message || "Import failed part-way — check the schedule tab.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <Modal open={open} onClose={close} title="Import schedule / posters" size="lg">
      <Stepper step={step} />

      {/* ---- Source ---- */}
      {step === "source" && (
        <div className="space-y-5">
          <button
            onClick={() => fileRef.current?.click()}
            className="group grid w-full place-items-center gap-2.5 rounded-2xl border-2 border-dashed border-[var(--accent)]/40 bg-gradient-to-br from-[var(--accent-soft)]/60 to-transparent px-6 py-10 text-center transition hover:border-[var(--accent)] hover:from-[var(--accent-soft)]"
          >
            <span className="grid h-14 w-14 place-items-center rounded-2xl bg-[var(--accent)] text-white shadow-md transition group-hover:scale-105">
              <FileSpreadsheet size={26} />
            </span>
            <span className="text-sm font-semibold">Upload a spreadsheet</span>
            <span className="text-xs text-muted">
              .xlsx · .xlsm · .xls · .csv — day sheets, booth-duty rosters, poster lists
            </span>
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xlsm,.xlsb,.xls,.csv"
            className="hidden"
            onChange={(e) => onFile(e.target.files?.[0] || null)}
          />
          <div className="flex items-center gap-3">
            <span className="h-px flex-1 bg-border" />
            <span className="rounded-full bg-canvas px-3 py-1 text-xs font-medium text-muted">
              or paste any schedule text
            </span>
            <span className="h-px flex-1 bg-border" />
          </div>
          <Textarea
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder="Paste an agenda email, a program excerpt, a poster list…"
            className="min-h-32"
          />
          {error && <ErrorNote text={error} />}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button onClick={useDocument} disabled={!pasted.trim()}>
              <Upload size={15} /> Use pasted text
            </Button>
          </div>
        </div>
      )}

      {/* ---- Sheet picker ---- */}
      {step === "sheet" && workbook && (
        <div className="space-y-3">
          <p className="text-sm">
            <b>{sourceName}</b>{" "}
            <span className="text-muted">
              has {workbook.SheetNames.length} sheets — which one holds the schedule?
            </span>
          </p>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {workbook.SheetNames.map((name, i) => (
              <button
                key={name}
                onClick={() => pickSheet(name)}
                className="flex w-full items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-left text-sm font-medium shadow-sm transition hover:-translate-y-0.5 hover:border-[var(--accent)] hover:shadow-md"
              >
                <span
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white"
                  style={{ background: SHEET_COLORS[i % SHEET_COLORS.length] }}
                >
                  <FileSpreadsheet size={15} />
                </span>
                <span className="truncate">{name}</span>
              </button>
            ))}
          </div>
          <Button variant="ghost" onClick={reset}>
            ← Different file
          </Button>
        </div>
      )}

      {/* ---- Preview + guidance ---- */}
      {step === "preview" && (
        <div className="space-y-4">
          <p className="text-sm text-muted">
            Raw data from <b className="text-ink">{sourceName}</b> — the AI will
            normalize it into events, booth coverage, and posters for your
            review (nothing is created yet).
          </p>
          {previewGrid ? (
            <div className="max-h-56 overflow-auto rounded-xl border border-border">
              <table className="w-full text-[11px]">
                <tbody>
                  {previewGrid.map((row, i) => (
                    <tr
                      key={i}
                      className={cn(
                        i === 0
                          ? "bg-[var(--accent)] text-white"
                          : i % 2
                            ? "bg-canvas/60"
                            : "bg-surface",
                      )}
                    >
                      <td className="w-8 px-2 py-1.5 text-right font-mono text-[10px] opacity-50">
                        {i + 1}
                      </td>
                      {row.map((cell, j) => (
                        <td
                          key={j}
                          className={cn(
                            "max-w-40 truncate px-2 py-1.5",
                            i === 0 && "font-semibold",
                          )}
                        >
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <pre className="max-h-56 overflow-auto rounded-xl border border-border bg-canvas p-3 text-[11px] leading-relaxed">
              {rawText.slice(0, 4000)}
              {rawText.length > 4000 ? "\n…" : ""}
            </pre>
          )}
          <Textarea
            label="Guidance for the AI (optional)"
            value={guidance}
            onChange={(e) => setGuidance(e.target.value)}
            placeholder='e.g. "Column F is the rep covering; times are Eastern; rows in red are competitor talks"'
          />
          {error && <ErrorNote text={error} />}
          {parsing && (
            <ProgressBar
              percent={parsePct}
              label={
                parseFound > 0
                  ? `AI is normalizing rows — ${parseFound} found so far…`
                  : "AI is reading the schedule…"
              }
            />
          )}
          <div className="flex justify-between gap-2">
            <Button variant="ghost" onClick={reset} disabled={parsing}>
              ← Start over
            </Button>
            <Button onClick={parse} disabled={parsing}>
              <Sparkles size={15} /> {parsing ? "Parsing…" : "Parse with AI"}
            </Button>
          </div>
        </div>
      )}

      {/* ---- Review wizard ---- */}
      {step === "review" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">
              {selected.length} of {rows.length} rows will import
            </span>
            <span className="flex-1" />
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                setChecked(rows.map((r) => r.key), !rows.every((r) => r.checked))
              }
            >
              {rows.every((r) => r.checked) ? "Uncheck all" : "Check all"}
            </Button>
          </div>

          {/* Batch typing: tap rows (or a group's Select button) to build a
              selection, assign one type to all of them, repeat per batch. */}
          <div
            className={cn(
              "flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm transition",
              selectedKeys.size > 0
                ? "border-[var(--accent)]/50 bg-[var(--accent-soft)]/60"
                : "border-border bg-canvas",
            )}
          >
            {selectedKeys.size > 0 ? (
              <>
                <span className="font-semibold text-[var(--accent)]">
                  {selectedKeys.size} row{selectedKeys.size === 1 ? "" : "s"} selected
                </span>
                <select
                  value=""
                  onChange={(e) =>
                    e.target.value && applyTypeToSelection(e.target.value)
                  }
                  className="rounded-md border border-[var(--accent)]/50 bg-surface px-2 py-1 text-xs font-semibold text-[var(--accent)] outline-none"
                >
                  <option value="" disabled>
                    Make these…
                  </option>
                  <TypeOptions />
                </select>
              </>
            ) : (
              <span className="text-xs text-muted">
                Tap rows to select a batch, then set their type in one go —
                repeat per batch (e.g. 10 sessions, then 5 KOL meetings).
              </span>
            )}
            <span className="flex-1" />
            <button
              onClick={() =>
                setSelectedKeys((prev) =>
                  prev.size === rows.length
                    ? new Set()
                    : new Set(rows.map((r) => r.key)),
                )
              }
              className="rounded-md border border-border bg-surface px-2 py-1 text-[11px] font-medium transition hover:border-[var(--accent)]"
            >
              {selectedKeys.size === rows.length ? "Select none" : "Select all"}
            </button>
            {selectedKeys.size > 0 && selectedKeys.size < rows.length && (
              <button
                onClick={() =>
                  setSelectedKeys(
                    new Set(
                      rows.filter((r) => !selectedKeys.has(r.key)).map((r) => r.key),
                    ),
                  )
                }
                title="Swap the selection to all currently unselected rows"
                className="rounded-md border border-border bg-surface px-2 py-1 text-[11px] font-medium transition hover:border-[var(--accent)]"
              >
                Select the rest ({rows.length - selectedKeys.size})
              </button>
            )}
            {selectedKeys.size > 0 && (
              <button
                onClick={() => setSelectedKeys(new Set())}
                className="rounded-md border border-border bg-surface px-2 py-1 text-[11px] font-medium transition hover:border-[var(--accent)]"
              >
                Clear
              </button>
            )}
          </div>

          {/* Rows, grouped by type so whole batches can be re-typed at once */}
          <div className="max-h-80 space-y-3 overflow-y-auto pr-1">
            {groups.map((g) => (
              <div key={g.type} className="space-y-2">
                {/* Not sticky on purpose: a sticky header floats over rows as
                    you scroll and taps meant for a row's own type dropdown hit
                    the group-wide one instead. */}
                <div className="flex flex-wrap items-center gap-2 rounded-lg bg-canvas px-2.5 py-1.5">
                  <button
                    onClick={() =>
                      setCollapsedGroups((prev) => {
                        const next = new Set(prev);
                        if (next.has(g.type)) next.delete(g.type);
                        else next.add(g.type);
                        return next;
                      })
                    }
                    className="flex min-w-0 items-center gap-2 text-left"
                    title={collapsedGroups.has(g.type) ? "Expand group" : "Collapse group"}
                  >
                    {collapsedGroups.has(g.type) ? (
                      <ChevronRight size={14} className="shrink-0 text-muted" />
                    ) : (
                      <ChevronDown size={14} className="shrink-0 text-muted" />
                    )}
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: EVENT_TYPES[g.type].color }}
                    />
                    <span className="text-xs font-semibold">
                      {EVENT_TYPES[g.type].label}
                    </span>
                    <span className="text-xs text-muted">
                      ({g.rows.length} suggested by AI
                      {collapsedGroups.has(g.type)
                        ? `, ${g.rows.filter((r) => r.checked).length} will import`
                        : ""})
                    </span>
                  </button>
                  <span className="flex-1" />
                  <button
                    onClick={() =>
                      setSelectedKeys((prev) => {
                        const keys = g.rows.map((r) => r.key);
                        const allIn = keys.every((k) => prev.has(k));
                        const next = new Set(prev);
                        keys.forEach((k) => (allIn ? next.delete(k) : next.add(k)));
                        return next;
                      })
                    }
                    title="Add this whole group to the batch selection"
                    className={cn(
                      "rounded-md border px-2 py-1 text-[11px] font-medium transition",
                      g.rows.every((r) => selectedKeys.has(r.key))
                        ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                        : "border-border bg-surface hover:border-[var(--accent)]",
                    )}
                  >
                    Select
                  </button>
                  <button
                    onClick={() =>
                      setChecked(
                        g.rows.map((r) => r.key),
                        !g.rows.every((r) => r.checked),
                      )
                    }
                    className="rounded-md border border-border bg-surface px-2 py-1 text-[11px] font-medium transition hover:border-[var(--accent)]"
                  >
                    {g.rows.every((r) => r.checked) ? "Uncheck all" : "Check all"}
                  </button>
                  <select
                    value=""
                    onChange={(e) =>
                      e.target.value &&
                      applyType(g.rows.map((r) => r.key), e.target.value)
                    }
                    className="rounded-md border border-dashed border-border bg-surface px-1.5 py-1 text-[11px] font-medium text-muted outline-none"
                    title={`Change all ${g.rows.length} rows in this group to another type`}
                  >
                    <option value="" disabled>
                      Change whole group ({g.rows.length})…
                    </option>
                    <TypeOptions />
                  </select>
                </div>
                {!collapsedGroups.has(g.type) &&
                g.rows.map((r) => {
              const valid = rowValid(r);
              const isSelected = selectedKeys.has(r.key);
              return (
                <div
                  key={r.key}
                  onClick={(e) => {
                    // Tap the card to (de)select for batch typing; taps on the
                    // inputs/selects inside keep their normal behavior.
                    const t = e.target as HTMLElement;
                    if (t.closest("input,select,button,textarea,label")) return;
                    toggleSelected(r.key);
                  }}
                  className={cn(
                    "cursor-pointer rounded-lg border p-2.5 transition",
                    !valid
                      ? "border-red-300 bg-red-50/50"
                      : r.checked
                        ? "border-border bg-surface shadow-sm"
                        : "border-border bg-canvas opacity-60",
                    isSelected &&
                      "border-[var(--accent)] ring-2 ring-[var(--accent)]/40",
                  )}
                  style={{
                    borderLeft: `4px solid ${
                      r.kind === "poster"
                        ? EVENT_TYPES.poster.color
                        : EVENT_TYPES[r.event_type].color
                    }`,
                  }}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="checkbox"
                      checked={r.checked}
                      onChange={(e) => updateRow(r.key, { checked: e.target.checked })}
                      title="Include in the import"
                    />
                    <select
                      value={r.kind === "poster" ? "poster" : r.event_type}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "poster") updateRow(r.key, { kind: "poster" });
                        else
                          updateRow(r.key, {
                            kind: "event",
                            event_type: v as ImportEventType,
                          });
                      }}
                      className={cn(
                        "rounded-md border bg-surface px-1.5 py-1 text-xs font-medium outline-none",
                        (r.kind === "poster" ? "poster" : r.event_type) !== r.suggested
                          ? "border-[var(--accent)]"
                          : "border-border",
                      )}
                      style={{
                        color:
                          r.kind === "poster"
                            ? EVENT_TYPES.poster.color
                            : EVENT_TYPES[r.event_type].color,
                      }}
                    >
                      <TypeOptions />
                    </select>
                    {(r.kind === "poster" ? "poster" : r.event_type) !== r.suggested && (
                      <span className="rounded-full bg-[var(--accent-soft)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--accent)]">
                        changed
                      </span>
                    )}
                    <input
                      value={r.title}
                      onChange={(e) => updateRow(r.key, { title: e.target.value })}
                      placeholder="Title *"
                      className="min-w-32 flex-1 rounded-md border border-border bg-surface px-2 py-1 text-sm outline-none focus:border-[var(--accent)]"
                    />
                    <button
                      onClick={() => toggleSelected(r.key)}
                      title={isSelected ? "Remove from batch" : "Add to batch for bulk typing"}
                      className={cn(
                        "grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[11px] font-bold transition",
                        isSelected
                          ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                          : "border-border bg-surface text-transparent hover:border-[var(--accent)]",
                      )}
                    >
                      ✓
                    </button>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                    <select
                      value={days.includes(r.date) ? r.date : r.date ? "__other__" : ""}
                      onChange={(e) => {
                        if (e.target.value !== "__other__")
                          updateRow(r.key, { date: e.target.value });
                      }}
                      className={cn(
                        "rounded-md border bg-surface px-1.5 py-1 outline-none",
                        r.kind === "event" && !r.date ? "border-red-400" : "border-border",
                      )}
                    >
                      <option value="">No date</option>
                      {days.map((d) => (
                        <option key={d} value={d}>
                          {fmtDayKey(d)}
                        </option>
                      ))}
                      {r.date && !days.includes(r.date) && (
                        <option value="__other__">{r.date}</option>
                      )}
                    </select>
                    <input
                      type="time"
                      value={r.start_time}
                      onChange={(e) => updateRow(r.key, { start_time: e.target.value })}
                      className={cn(
                        "rounded-md border bg-surface px-1.5 py-1 outline-none",
                        r.kind === "event" && !r.start_time
                          ? "border-red-400"
                          : "border-border",
                      )}
                    />
                    <span className="text-muted">–</span>
                    <input
                      type="time"
                      value={r.end_time}
                      onChange={(e) => updateRow(r.key, { end_time: e.target.value })}
                      className="rounded-md border border-border bg-surface px-1.5 py-1 outline-none"
                    />
                    <input
                      value={r.location}
                      onChange={(e) => updateRow(r.key, { location: e.target.value })}
                      placeholder="Location"
                      className="min-w-24 flex-1 rounded-md border border-border bg-surface px-2 py-1 outline-none"
                    />
                    {r.people.length > 0 && (
                      <span className="text-muted">
                        👤 {r.people.join(", ")}
                      </span>
                    )}
                  </div>
                  {!valid && (
                    <p className="mt-1 text-[11px] font-medium text-red-600">
                      Needs a title{r.kind === "event" ? ", date, and start time" : ""} to import.
                    </p>
                  )}
                </div>
              );
            })}
              </div>
            ))}
          </div>

          {/* People — optional; unmatched names simply import unassigned */}
          {distinctNames.length > 0 && (
            <details className="rounded-lg bg-canvas">
              <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold text-muted">
                Match people to your roster ({distinctNames.length} name
                {distinctNames.length === 1 ? "" : "s"}
                {unresolved.length > 0 ? `, ${unresolved.length} unmatched` : ""})
                — optional, unmatched names import without an assignment
              </summary>
              <div className="grid grid-cols-1 gap-1.5 px-3 pb-3 sm:grid-cols-2">
                {distinctNames.map((name) => {
                  const matched = attendees.find((a) => a.id === resolution[name]);
                  return (
                    <div key={name} className="flex items-center gap-2 text-sm">
                      <span className="min-w-0 flex-1 truncate">{name}</span>
                      <select
                        value={resolution[name] || ""}
                        onChange={(e) =>
                          setResolution((prev) => ({ ...prev, [name]: e.target.value }))
                        }
                        className="rounded-md border border-border bg-surface px-2 py-1 text-xs outline-none"
                      >
                        <option value="">Leave unassigned</option>
                        {matched && <option value={matched.id}>→ {matched.name}</option>}
                        {attendees
                          .filter((a) => a.id !== resolution[name])
                          .map((a) => (
                            <option key={a.id} value={a.id}>
                              → {a.name}
                            </option>
                          ))}
                        <option value="__create__">＋ Create new attendee</option>
                        <option value="__skip__">Skip this name</option>
                      </select>
                    </div>
                  );
                })}
              </div>
            </details>
          )}

          {error && <ErrorNote text={error} />}
          {importing && (
            <ProgressBar percent={importPct} label="Creating events, shifts, and posters…" />
          )}
          <div className="flex justify-between gap-2 border-t border-border pt-3">
            <Button variant="ghost" onClick={() => setStep("preview")} disabled={importing}>
              ← Re-parse with guidance
            </Button>
            <Button onClick={runImport} disabled={importing || selected.length === 0}>
              {importing
                ? "Importing…"
                : `Import ${selected.length} row${selected.length === 1 ? "" : "s"}`}
            </Button>
          </div>
        </div>
      )}

      {/* ---- Done ---- */}
      {step === "done" && (
        <div className="space-y-5 py-4 text-center">
          <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-100 text-3xl">
            🎉
          </span>
          <p className="text-base font-semibold">Import complete</p>
          <div className="mx-auto flex max-w-sm justify-center gap-3">
            <DoneStat value={result.events} label="events" color="#0284c7" />
            <DoneStat value={result.posters} label="posters" color="#d97706" />
            <DoneStat value={result.people} label="new attendees" color="#10b981" />
          </div>
          <div className="flex justify-center gap-2">
            <Button variant="secondary" onClick={reset}>
              Import more
            </Button>
            <Button onClick={close}>Done</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------

const SHEET_COLORS = ["#0d9488", "#7c3aed", "#d97706", "#0284c7", "#be123c", "#4f46e5"];

const STEPS: { key: Step; label: string }[] = [
  { key: "source", label: "Source" },
  { key: "preview", label: "AI parse" },
  { key: "review", label: "Review" },
  { key: "done", label: "Done" },
];

function Stepper({ step }: { step: Step }) {
  const norm = step === "sheet" ? "source" : step;
  const activeIdx = STEPS.findIndex((s) => s.key === norm);
  return (
    <div className="mb-5 flex items-center gap-1.5">
      {STEPS.map((s, i) => (
        <div key={s.key} className="flex flex-1 items-center gap-1.5">
          <span
            className={cn(
              "grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold transition",
              i < activeIdx
                ? "bg-emerald-500 text-white"
                : i === activeIdx
                  ? "bg-[var(--accent)] text-white shadow-sm"
                  : "bg-canvas text-muted",
            )}
          >
            {i < activeIdx ? "✓" : i + 1}
          </span>
          <span
            className={cn(
              "hidden text-xs font-medium sm:block",
              i === activeIdx ? "text-ink" : "text-muted",
            )}
          >
            {s.label}
          </span>
          {i < STEPS.length - 1 && (
            <span
              className={cn(
                "h-0.5 flex-1 rounded-full",
                i < activeIdx ? "bg-emerald-400" : "bg-border",
              )}
            />
          )}
        </div>
      ))}
    </div>
  );
}

// Every importable type (events + poster) as <option>s, shared by the per-row,
// per-group, and bulk "set type" selects.
function TypeOptions() {
  return (
    <>
      {(Object.keys(EVENT_TYPES) as EventType[])
        .filter((t) => t !== "poster")
        .map((t) => (
          <option key={t} value={t}>
            {EVENT_TYPES[t].label}
          </option>
        ))}
      <option value="poster">Poster</option>
    </>
  );
}

function ErrorNote({ text }: { text: string }) {
  return (
    <p className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
      <TriangleAlert size={15} className="mt-0.5 shrink-0" /> {text}
    </p>
  );
}

function DoneStat({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div className="flex-1 rounded-xl border border-border bg-surface px-4 py-3 shadow-sm">
      <p className="text-2xl font-bold" style={{ color }}>
        {value}
      </p>
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</p>
    </div>
  );
}

// First rows × columns of a sheet for the visual preview table.
function gridPreview(wb: XLSX.WorkBook, sheetName: string): string[][] {
  const grid: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
    header: 1,
    raw: false,
    defval: "",
  });
  const out: string[][] = [];
  for (const row of grid.slice(0, 12)) {
    const cells = (row || []).slice(0, 8).map((c) => String(c ?? "").trim());
    if (cells.every((c) => !c)) continue;
    out.push(cells);
  }
  return out;
}

// ------------------------------------------------------------------

function isImportEventType(v: unknown): v is ImportEventType {
  return (
    typeof v === "string" &&
    ["booth", "educational", "competitor", "contact_meeting", "session", "custom"].includes(v)
  );
}

// POST one chunk to the parse endpoint and read the streamed model output,
// reporting the number of rows seen so far via onFound. Returns the rows.
async function streamParseChunk(
  payload: Record<string, unknown>,
  onFound: (n: number) => void,
): Promise<Partial<ImportRow>[]> {
  const res = await fetch("/api/conference/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(payload),
  });
  if (!res.ok || !res.body) {
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(json.error || "AI parse failed");
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let acc = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    acc += decoder.decode(value, { stream: true });
    onFound(acc.split('"title"').length - 1);
  }
  acc += decoder.decode();
  let json: { rows?: Partial<ImportRow>[] };
  try {
    json = JSON.parse(acc);
  } catch {
    throw new Error("The AI returned an unreadable result — please re-run the parse.");
  }
  return Array.isArray(json.rows) ? json.rows : [];
}

// Rough count of importable rows in the source, used as the denominator for
// parse progress. Sheets: one row per serialized line (minus the header).
// Pasted prose: lines carrying a time are the best proxy for events.
function estimateSourceRows(text: string, isGrid: boolean): number {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (isGrid) return Math.max(1, lines.length - 1);
  const timed = lines.filter((l) => /\b\d{1,2}[:.]\d{2}\b/.test(l)).length;
  return Math.max(1, timed >= 3 ? timed : lines.length);
}

function addHour(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const min = Math.min(h * 60 + m + 60, 23 * 60 + 59);
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

// Serialize a sheet to compact pipe-separated text for the AI (caps size).
function serializeSheet(wb: XLSX.WorkBook, sheetName: string): string {
  const sheet = wb.Sheets[sheetName];
  const grid: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: false,
    defval: "",
  });
  const lines: string[] = [];
  for (let i = 0; i < Math.min(grid.length, 400); i++) {
    const cells = (grid[i] || []).map((c) => String(c ?? "").trim());
    if (cells.every((c) => !c)) continue;
    lines.push(`Row ${i + 1}: ${cells.join(" | ")}`);
  }
  return lines.join("\n");
}

// Match source names to the roster: exact (case-insensitive), then unique
// first-name match. Unmatched names stay unresolved for manual mapping.
function autoResolve(
  rows: ImportRow[],
  attendees: { id: string; name: string }[],
): Resolution {
  const out: Resolution = {};
  const names = new Set<string>();
  for (const r of rows) for (const p of r.people) names.add(p);
  for (const name of names) {
    const lower = name.trim().toLowerCase();
    const exact = attendees.find((a) => a.name.trim().toLowerCase() === lower);
    if (exact) {
      out[name] = exact.id;
      continue;
    }
    const first = lower.split(/\s+/)[0];
    const firstMatches = attendees.filter(
      (a) => a.name.trim().toLowerCase().split(/\s+/)[0] === first,
    );
    if (firstMatches.length === 1) out[name] = firstMatches[0].id;
  }
  return out;
}
