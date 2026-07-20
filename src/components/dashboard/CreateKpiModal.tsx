"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, Building2, Users, User } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { DASHBOARD_DATASETS } from "@/lib/dashboard/catalog";
import type { ChartResult, ChartSpec, ChartType, DatasetDef, Scope } from "@/lib/dashboard/types";
import { defaultChartSpec } from "@/lib/dashboard/types";
import { ChartCanvas } from "./ChartCanvas";

const CHART_TYPES: { value: ChartType; label: string }[] = [
  { value: "bar", label: "Bar" },
  { value: "stackedBar", label: "Stacked bar" },
  { value: "line", label: "Line" },
  { value: "pie", label: "Pie" },
  { value: "donut", label: "Donut" },
];

const SCOPE_ORDER: Scope[] = ["self", "team", "org"];
const SCOPE_META: Record<Scope, { icon: typeof User; label: string }> = {
  self: { icon: User, label: "Just me" },
  team: { icon: Users, label: "My team" },
  org: { icon: Building2, label: "Whole company" },
};

// A no-AI, pick-from-dropdowns alternative to the chat, for anyone who'd
// rather build a KPI directly than phrase it as a question.
export function CreateKpiModal({
  open,
  onClose,
  maxScope,
  extraDatasets,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  maxScope: Scope;
  extraDatasets: DatasetDef[];
  onSaved: () => void;
}) {
  const allDatasets = useMemo(() => [...DASHBOARD_DATASETS, ...extraDatasets], [extraDatasets]);
  const availableScopes = SCOPE_ORDER.slice(0, SCOPE_ORDER.indexOf(maxScope) + 1);

  const [spec, setSpec] = useState<ChartSpec>(() => defaultChartSpec(allDatasets[0]?.id));
  const [title, setTitle] = useState("");
  const [result, setResult] = useState<ChartResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dataset = allDatasets.find((d) => d.id === spec.datasetId);

  // Reset to a sane default whenever the modal opens or the dataset list changes.
  useEffect(() => {
    if (!open || !allDatasets.length) return;
    const first = allDatasets[0];
    const s = defaultChartSpec(first.id);
    s.groupBy = first.dimensions[0]?.key || "";
    s.measure = first.measures[0]?.key || "*";
    s.scope = availableScopes[availableScopes.length - 1];
    setSpec(s);
    setTitle(`${first.label} by ${first.dimensions[0]?.label || "group"}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, allDatasets.length]);

  useEffect(() => {
    if (!open || !dataset || !spec.groupBy || !spec.measure) return;
    let active = true;
    setLoading(true);
    fetch("/api/dashboard/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ action: "run", spec }),
    })
      .then((r) => r.json())
      .then((json) => {
        if (active) setResult(json.result || null);
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [open, dataset, spec]);

  function patch(p: Partial<ChartSpec>) {
    setSpec((s) => ({ ...s, ...p }));
  }

  function selectDataset(id: string) {
    const d = allDatasets.find((x) => x.id === id);
    if (!d) return;
    setSpec((s) => ({
      ...s,
      datasetId: id,
      groupBy: d.dimensions[0]?.key || "",
      measure: d.measures[0]?.key || "*",
    }));
    setTitle(`${d.label} by ${d.dimensions[0]?.label || "group"}`);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/dashboard/tiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ title: title.trim() || "Untitled KPI", datasetId: spec.datasetId, spec }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not save KPI");
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save KPI");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Create a KPI" size="lg">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[280px_1fr]">
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-ink">Data source</span>
            <select
              value={spec.datasetId}
              onChange={(e) => selectDataset(e.target.value)}
              className="rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
            >
              {allDatasets.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.moduleLabel} · {d.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-ink">Group by</span>
            <select
              value={spec.groupBy}
              onChange={(e) => patch({ groupBy: e.target.value })}
              className="rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
            >
              {dataset?.dimensions.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-ink">Measure</span>
            <select
              value={spec.measure}
              onChange={(e) => patch({ measure: e.target.value })}
              className="rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
            >
              {dataset?.measures.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-ink">Chart type</span>
            <select
              value={spec.chartType}
              onChange={(e) => patch({ chartType: e.target.value as ChartType })}
              className="rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
            >
              {CHART_TYPES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>

          {availableScopes.length > 1 && dataset?.ownerScoped && (
            <div>
              <span className="mb-1.5 block text-sm font-medium text-ink">Who</span>
              <div className="inline-flex rounded-lg border border-border bg-canvas p-0.5">
                {availableScopes.map((s) => {
                  const meta = SCOPE_META[s];
                  const Icon = meta.icon;
                  return (
                    <button
                      key={s}
                      onClick={() => patch({ scope: s })}
                      className={
                        spec.scope === s
                          ? "inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-2.5 py-1.5 text-xs font-medium text-[var(--accent-fg)]"
                          : "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted hover:text-ink"
                      }
                    >
                      <Icon size={13} /> {meta.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-ink">Title</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
            />
          </label>
        </div>

        <div className="flex flex-col gap-3">
          <div className="rounded-xl border border-border bg-canvas p-3">
            {loading && !result ? (
              <div className="grid h-[280px] place-items-center">
                <Loader2 size={18} className="animate-spin text-muted" />
              </div>
            ) : result ? (
              <ChartCanvas result={result} chartType={spec.chartType} height={280} />
            ) : (
              <div className="grid h-[280px] place-items-center text-sm text-muted">
                Pick a data source to preview
              </div>
            )}
          </div>
          {error && <p className="text-sm text-status-error">{error}</p>}
          <div className="flex justify-end gap-2 border-t border-border pt-3">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving || !result}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              Save KPI
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
