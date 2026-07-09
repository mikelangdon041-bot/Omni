"use client";

// MSL activity report: per-month (or per-quarter) counts for every
// category — KOL meetings, outreach, presentations, MIRFs, trainings, and
// congress activity (auto-linked from Conference Planning attendance).
// Entries missed at the time can be backfilled with a date; org admins can
// rename the categories company-wide.

import { useMemo, useState } from "react";
import { BarChart3, Plus, Pencil, Info } from "lucide-react";
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
  const [renameOpen, setRenameOpen] = useState(false);

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
                      <td key={p.key} className="px-3 py-2.5 text-right tabular-nums">
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
        open={addOpen}
        onClose={() => setAddOpen(false)}
        userId={userId}
        kols={kols}
        labels={labels}
        onAdded={refresh}
      />
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
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  userId: string | null;
  kols: { id: string; first_name: string; last_name: string }[];
  labels: Record<string, string>;
  onAdded: () => Promise<void> | void;
}) {
  const [type, setType] = useState("clinical_presentation");
  const [kolId, setKolId] = useState("");
  const [date, setDate] = useState(() => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  });
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
