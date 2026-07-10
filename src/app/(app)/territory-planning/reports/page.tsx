"use client";

// MSL activity report: per-month (or per-quarter) counts for every
// category — KOL meetings, outreach, presentations, MIRFs, trainings, and
// congress activity (auto-linked from Conference Planning attendance).
// Entries missed at the time can be backfilled with a date; org admins can
// rename the categories company-wide.

import { useMemo, useState } from "react";
import { BarChart3, Plus, Pencil, Info, Trash2, Link2 } from "lucide-react";
import { BackButton } from "@/components/BackButton";
import { Modal } from "@/components/territory/ui/Modal";
import { Input, Select } from "@/components/territory/ui/Input";
import { Button } from "@/components/territory/ui/Button";
import { RichText } from "@/components/ui/RichText";
import { createClient } from "@/lib/supabase/client";
import { useKOLs, useUserId } from "@/lib/territory/hooks";
import {
  REPORT_CATEGORIES,
  lastMonths,
  lastQuarters,
  saveCategoryLabels,
  useCategoryLabels,
  useOrgRole,
  useTerritoryReport,
  type Period,
  type ReportEntry,
} from "@/lib/territory/reports";
import { EVENT_TYPES } from "@/lib/territory/activity";
import { cn, kolFullName } from "@/lib/territory/utils";

const supabase = createClient();

export default function TerritoryReportsPage() {
  const { userId } = useUserId();
  const { kols } = useKOLs(userId);
  const { entries, loading, refresh } = useTerritoryReport(userId, kols);
  const { labels, refresh: refreshLabels } = useCategoryLabels();
  const { orgId, isAdmin } = useOrgRole(userId);

  const [view, setView] = useState<"month" | "quarter">("month");
  const [addOpen, setAddOpen] = useState(false);
  const [addInit, setAddInit] = useState<{ type?: string; date?: string } | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [cell, setCell] = useState<{ catKey: string; period: Period } | null>(null);

  const periods = useMemo(
    () => (view === "month" ? lastMonths(12) : lastQuarters(6)),
    [view],
  );

  // counts[categoryKey][periodKey] = { n, attendees }
  const counts = useMemo(() => {
    const map: Record<string, Record<string, { n: number; att: number }>> = {};
    for (const cat of REPORT_CATEGORIES) map[cat.key] = {};
    for (const e of entries) {
      const d = new Date(e.date);
      for (const p of periods) {
        if (p.contains(d)) {
          const cell = (map[e.category] ??= {});
          const c = (cell[p.key] ??= { n: 0, att: 0 });
          c.n += 1;
          c.att += e.attendees || 0;
          break;
        }
      }
    }
    return map;
  }, [entries, periods]);

  return (
    <>
      <BackButton label="Back to Territory Planning" />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <BarChart3 size={20} className="text-[var(--accent)]" /> Activity report
          </h1>
          <p className="text-sm text-muted">
            Everything you&apos;ve logged, counted per {view === "month" ? "month" : "quarter"}.
            Congress activity includes Conference Planning attendance automatically.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-border">
            <button
              onClick={() => setView("month")}
              className={cn(
                "px-3 py-2 text-sm font-medium",
                view === "month"
                  ? "bg-[var(--accent)] text-[var(--accent-fg)]"
                  : "bg-surface text-muted hover:text-ink",
              )}
            >
              Monthly
            </button>
            <button
              onClick={() => setView("quarter")}
              className={cn(
                "px-3 py-2 text-sm font-medium",
                view === "quarter"
                  ? "bg-[var(--accent)] text-[var(--accent-fg)]"
                  : "bg-surface text-muted hover:text-ink",
              )}
            >
              Quarterly
            </button>
          </div>
          {isAdmin && (
            <Button variant="secondary" size="sm" onClick={() => setRenameOpen(true)}>
              <Pencil size={14} /> Rename categories
            </Button>
          )}
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus size={14} /> Log past activity
          </Button>
        </div>
      </div>

      {loading ? (
        <p className="py-12 text-center text-sm text-muted">Loading…</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-sm">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border bg-canvas/60">
                <th className="sticky left-0 bg-canvas px-4 py-3 text-left font-semibold">
                  Category
                </th>
                {periods.map((p) => (
                  <th key={p.key} className="px-3 py-3 text-right font-semibold whitespace-nowrap">
                    {p.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {REPORT_CATEGORIES.map((cat) => (
                <tr key={cat.key} className="border-b border-border/60 last:border-0">
                  <td className="sticky left-0 bg-surface px-4 py-2.5 font-medium whitespace-nowrap">
                    {labels[cat.key] || cat.label}
                  </td>
                  {periods.map((p) => {
                    const c = counts[cat.key]?.[p.key];
                    return (
                      <td key={p.key} className="px-1 py-1 text-right tabular-nums">
                        <button
                          onClick={() => setCell({ catKey: cat.key, period: p })}
                          className="w-full rounded-md px-2 py-1.5 text-right transition hover:bg-[var(--accent)]/10"
                          title="View, add, or remove entries"
                        >
                          {c?.n ? (
                            <span>
                              {c.n}
                              {cat.attendees && c.att > 0 && (
                                <span className="text-xs text-muted"> · {c.att} att</span>
                              )}
                            </span>
                          ) : (
                            <span className="text-muted/50">—</span>
                          )}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 flex items-center gap-1.5 text-xs text-muted">
        <Info size={13} />
        Forgot to log something at the time? Use “Log past activity” and set the
        real date — it counts in that period.
      </p>

      <QuickAddModal
        key={addInit ? `${addInit.type}-${addInit.date}` : "plain"}
        open={addOpen}
        onClose={() => {
          setAddOpen(false);
          setAddInit(null);
        }}
        userId={userId}
        kols={kols}
        labels={labels}
        initial={addInit}
        onAdded={refresh}
      />
      {cell && (
        <CellDrilldown
          catKey={cell.catKey}
          period={cell.period}
          entries={entries}
          labels={labels}
          onClose={() => setCell(null)}
          onChanged={refresh}
          onAdd={(type, date) => {
            setCell(null);
            setAddInit({ type, date });
            setAddOpen(true);
          }}
        />
      )}
      {isAdmin && orgId && (
        <RenameModal
          open={renameOpen}
          onClose={() => setRenameOpen(false)}
          orgId={orgId}
          labels={labels}
          onSaved={refreshLabels}
        />
      )}
    </>
  );
}

// ------------------------------------------------------------------
// Backfill: log an activity that wasn't entered at the time.
// ------------------------------------------------------------------
const ADDABLE = [
  { key: "outbound", label: "Outreach attempt" },
  { key: "inbound", label: "KOL response" },
  ...EVENT_TYPES,
];

function QuickAddModal({
  open,
  onClose,
  userId,
  kols,
  labels,
  initial,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  userId: string | null;
  kols: { id: string; first_name: string; last_name: string }[];
  labels: Record<string, string>;
  initial?: { type?: string; date?: string } | null;
  onAdded: () => Promise<void> | void;
}) {
  // A cell drill-down passes `initial` (and the parent remounts via key) to
  // prefill the category and period being edited.
  const [type, setType] = useState(initial?.type || "clinical_presentation");
  const [kolId, setKolId] = useState("");
  const [date, setDate] = useState(() => initial?.date || toLocalInput(new Date()));
  const [attendees, setAttendees] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasAttendees = EVENT_TYPES.find((t) => t.key === type)?.attendees;
  const sorted = [...kols].sort((a, b) =>
    `${a.last_name}${a.first_name}`.localeCompare(`${b.last_name}${b.first_name}`),
  );

  async function submit() {
    if (!userId) return;
    setSaving(true);
    setError(null);
    // meeting_cycle 0 keeps backfilled entries out of the outreach stepper.
    const { error: err } = await supabase.from("activities").insert({
      user_id: userId,
      kol_id: kolId || null,
      type,
      status: "no_outreach",
      meeting_cycle: 0,
      date: new Date(date).toISOString(),
      notes,
      attendees: hasAttendees && attendees.trim() !== "" ? Number(attendees) || 0 : null,
    });
    setSaving(false);
    if (err) {
      setError(
        err.message.includes("user_id") || err.message.includes("column")
          ? "Run migration 0016 in Supabase first (adds report columns)."
          : err.message,
      );
      return;
    }
    setNotes("");
    setAttendees("");
    await onAdded();
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="Log past activity">
      <div className="space-y-4">
        <Select label="Category" value={type} onChange={(e) => setType(e.target.value)}>
          {ADDABLE.map((t) => (
            <option key={t.key} value={t.key}>
              {labels[t.key] || t.label}
            </option>
          ))}
        </Select>
        <Select label="KOL (optional)" value={kolId} onChange={(e) => setKolId(e.target.value)}>
          <option value="">— No specific KOL —</option>
          {sorted.map((k) => (
            <option key={k.id} value={k.id}>
              {kolFullName(k)}
            </option>
          ))}
        </Select>
        <Input
          label="Date & time it happened"
          type="datetime-local"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        {hasAttendees && (
          <Input
            label="Number of attendees (optional)"
            type="number"
            min={0}
            value={attendees}
            onChange={(e) => setAttendees(e.target.value)}
          />
        )}
        <div>
          <p className="mb-1.5 text-sm font-medium text-ink">Notes</p>
          <RichText value={notes} onChange={setNotes} minHeight="min-h-20" />
        </div>
        <p className="text-xs text-muted">
          To log a completed KOL meeting, use the KOL&apos;s Activity tab so the
          meeting record is created too.
        </p>
        {error && <p className="text-sm text-status-error">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? "Saving…" : "Add to report"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------
// Cell drill-down: the entries behind one count — delete manual ones,
// add another prefilled to this category and period.
// ------------------------------------------------------------------

// Report category → the activity type to prefill when adding from a cell.
// KOL meetings need a meeting record too, so they aren't addable here.
const CELL_ADD_TYPE: Record<string, string | null> = {
  meeting: null,
  outbound: "outbound",
  response: "inbound",
};

function toLocalInput(d: Date): string {
  const x = new Date(d);
  x.setMinutes(x.getMinutes() - x.getTimezoneOffset());
  return x.toISOString().slice(0, 16);
}

// Prefill date: today when the period is current, else its first day at noon.
function defaultDateFor(p: Period): Date {
  const now = new Date();
  if (p.contains(now)) return now;
  const d = new Date(p.start);
  d.setHours(12, 0, 0, 0);
  return d;
}

function CellDrilldown({
  catKey,
  period,
  entries,
  labels,
  onClose,
  onChanged,
  onAdd,
}: {
  catKey: string;
  period: Period;
  entries: ReportEntry[];
  labels: Record<string, string>;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
  onAdd: (type: string, date: string) => void;
}) {
  const cat = REPORT_CATEGORIES.find((c) => c.key === catKey);
  const list = useMemo(
    () =>
      entries
        .filter((e) => e.category === catKey && period.contains(new Date(e.date)))
        .sort((a, b) => b.date.localeCompare(a.date)),
    [entries, catKey, period],
  );
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const addType = catKey in CELL_ADD_TYPE ? CELL_ADD_TYPE[catKey] : catKey;

  async function remove(id: string) {
    setDeleting(id);
    setError(null);
    const { error: err } = await supabase.from("activities").delete().eq("id", id);
    setDeleting(null);
    if (err) {
      setError(err.message);
      return;
    }
    await onChanged();
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`${labels[catKey] || cat?.label || catKey} — ${period.label}`}
    >
      <div className="space-y-3">
        {list.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted">
            Nothing logged in this period yet.
          </p>
        ) : (
          <ul className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
            {list.map((e, i) => (
              <li
                key={e.id || `auto-${i}`}
                className="flex items-center gap-2.5 rounded-lg border border-border bg-canvas/50 px-3 py-2 text-sm"
              >
                <span className="whitespace-nowrap font-medium tabular-nums">
                  {new Date(e.date).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
                <span className="min-w-0 flex-1 truncate text-muted">
                  {e.label || "—"}
                  {e.attendees > 0 && ` · ${e.attendees} att`}
                </span>
                {e.auto ? (
                  <span
                    className="flex shrink-0 items-center gap-1 rounded-full bg-[var(--accent)]/10 px-2 py-0.5 text-[11px] font-medium text-[var(--accent)]"
                    title="Linked automatically from Conference Planning"
                  >
                    <Link2 size={11} /> Conference
                  </span>
                ) : e.id ? (
                  <button
                    onClick={() => remove(e.id!)}
                    disabled={deleting === e.id}
                    className="shrink-0 rounded-md p-1.5 text-muted transition hover:bg-status-error/10 hover:text-status-error disabled:opacity-50"
                    title="Delete this entry"
                  >
                    <Trash2 size={14} />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {list.some((e) => e.auto) && (
          <p className="text-xs text-muted">
            “Conference” entries are auto-linked from Conference Planning key
            contacts and can&apos;t be deleted here — you can still add your own
            alongside them.
          </p>
        )}
        {error && <p className="text-sm text-status-error">{error}</p>}
        <div className="flex items-center justify-between gap-2 border-t border-border pt-4">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          {addType ? (
            <Button onClick={() => onAdd(addType, toLocalInput(defaultDateFor(period)))}>
              <Plus size={14} /> Add to {period.label}
            </Button>
          ) : (
            <p className="text-xs text-muted">
              Log meetings from the KOL&apos;s Activity tab.
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------
// Admin: rename the categories org-wide.
// ------------------------------------------------------------------
function RenameModal({
  open,
  onClose,
  orgId,
  labels,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  orgId: string;
  labels: Record<string, string>;
  onSaved: () => Promise<void> | void;
}) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSaving(true);
    setError(null);
    const err = await saveCategoryLabels(orgId, draft);
    setSaving(false);
    if (err) {
      setError(
        err.includes("does not exist")
          ? "Run migration 0016 in Supabase first (adds the labels table)."
          : err,
      );
      return;
    }
    await onSaved();
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="Rename categories">
      <div className="space-y-3">
        <p className="text-sm text-muted">
          Renames apply to everyone in your organization — e.g. call clinical
          presentations “Scientific exchange”.
        </p>
        {REPORT_CATEGORIES.map((cat) => (
          <Input
            key={cat.key}
            label={cat.label}
            placeholder={cat.label}
            value={draft[cat.key] ?? labels[cat.key] ?? ""}
            onChange={(e) => setDraft((d) => ({ ...d, [cat.key]: e.target.value }))}
          />
        ))}
        {error && <p className="text-sm text-status-error">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
