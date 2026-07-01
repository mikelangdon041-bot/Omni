"use client";

import { useMemo, useState } from "react";
import {
  Sparkles,
  Plus,
  X,
  Save,
  Trash2,
  Wand2,
  BarChart3,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { useUserId } from "@/lib/territory/hooks";
import { useKOLs } from "@/lib/territory/hooks";
import {
  useOrgProfile,
  useResponses,
  useSavedAnalyses,
  useSurveyDefinition,
} from "@/lib/insights/hooks";
import { runAnalysis, type AnalyticsData } from "@/lib/insights/analytics";
import {
  defaultSpec,
  type AnalysisSpec,
  type ChartType,
  type GroupBy,
  type SurveyQuestion,
} from "@/lib/insights/types";
import { ChartCanvas } from "./ChartCanvas";
import { ChartEditor } from "./ChartEditor";

const KOL_GROUPINGS: { value: GroupBy; label: string }[] = [
  { value: "none", label: "No grouping" },
  { value: "specialty", label: "Specialty" },
  { value: "tier", label: "Tier" },
  { value: "relationship_level", label: "Relationship" },
  { value: "institution", label: "Institution" },
  { value: "kol", label: "Individual KOL" },
];

const FILTER_OPS: { value: string; label: string }[] = [
  { value: "is", label: "is" },
  { value: "is_not", label: "is not" },
  { value: "contains", label: "contains" },
  { value: "gte", label: "≥" },
  { value: "lte", label: "≤" },
];

export function AnalysisWorkbench() {
  const { userId } = useUserId();
  const { orgId } = useOrgProfile();
  const { template, questions, options, loading: defLoading } =
    useSurveyDefinition();
  const { responses, answers, loading: respLoading } = useResponses(userId);
  const { kols } = useKOLs(userId);
  const saved = useSavedAnalyses(userId);

  const [spec, setSpec] = useState<AnalysisSpec>(defaultSpec());
  const [prompt, setPrompt] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [suggestBusy, setSuggestBusy] = useState(false);
  const [suggestions, setSuggestions] = useState<{ title: string; spec: AnalysisSpec }[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Default the metric question to the first one once loaded.
  const activeSpec = useMemo(() => {
    if (spec.questionId) return spec;
    if (questions.length) return { ...spec, questionId: questions[0].id };
    return spec;
  }, [spec, questions]);

  const data: AnalyticsData = useMemo(
    () => ({ kols, responses, answers, questions, options }),
    [kols, responses, answers, questions, options],
  );

  const result = useMemo(
    () => runAnalysis(activeSpec, data),
    [activeSpec, data],
  );

  const metric = questions.find((q) => q.id === activeSpec.questionId);
  const recommended = recommendedType(activeSpec, metric);

  function patch(p: Partial<AnalysisSpec>) {
    setSpec((s) => ({ ...(s.questionId ? s : activeSpec), ...p }));
  }

  async function runAi() {
    if (!prompt.trim() || !template) return;
    setAiBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/insights/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ prompt, templateId: template.id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not analyze");
      setSpec(normalizeSpec(json.spec));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not analyze");
    } finally {
      setAiBusy(false);
    }
  }

  async function loadSuggestions() {
    if (!template) return;
    setSuggestBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/insights/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ templateId: template.id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not suggest");
      setSuggestions((json.suggestions || []).map((s: { title: string; spec: AnalysisSpec }) => ({
        title: s.title,
        spec: normalizeSpec(s.spec),
      })));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not suggest");
    } finally {
      setSuggestBusy(false);
    }
  }

  async function handleSave() {
    const title = activeSpec.title.trim() || metric?.text || "Untitled analysis";
    await saved.save(title, activeSpec, template?.id ?? null, orgId);
  }

  if (defLoading || respLoading) {
    return <p className="py-12 text-center text-sm text-muted">Loading…</p>;
  }
  if (!template) {
    return (
      <EmptyState
        title="No survey to analyze"
        hint="Publish a survey and collect a few responses, then come back to explore the data."
      />
    );
  }
  if (responses.length === 0) {
    return (
      <EmptyState
        title="No responses yet"
        hint="Add KOLs and answer some surveys in the KOLs tab. Your analytics will appear here."
      />
    );
  }

  // Fields available for grouping/filtering (KOL fields + answerable questions).
  const answerGroupings: { value: GroupBy; label: string }[] = questions
    .filter((q) => q.id !== activeSpec.questionId)
    .map((q) => ({ value: `answer:${q.id}` as GroupBy, label: `Answer · ${short(q.text)}` }));

  return (
    <div className="flex flex-col gap-5">
      {/* AI free-text bar */}
      <div className="rounded-2xl border border-border bg-gradient-to-br from-accent-soft/60 to-surface p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <Wand2 size={18} className="shrink-0 text-[var(--accent)]" />
          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runAi()}
            placeholder="Ask in plain English — e.g. “average efficacy by specialty for KOLs who use Drug X”"
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted"
          />
          <Button onClick={runAi} disabled={aiBusy || !prompt.trim()}>
            {aiBusy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            Analyze
          </Button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            onClick={loadSuggestions}
            disabled={suggestBusy}
            className="inline-flex items-center gap-1.5 rounded-full bg-surface px-2.5 py-1 text-xs font-medium text-[var(--accent)] shadow-sm transition hover:bg-white disabled:opacity-60"
          >
            {suggestBusy ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
            Suggest insights
          </button>
          {suggestions.map((s, i) => (
            <button
              key={i}
              onClick={() => setSpec(s.spec)}
              className="rounded-full border border-border bg-surface px-2.5 py-1 text-xs text-ink transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
            >
              {s.title}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-status-error">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_300px]">
        {/* Chart + manual controls */}
        <div className="flex flex-col gap-4">
          {/* Manual builder */}
          <div className="flex flex-wrap gap-2 rounded-xl border border-border bg-surface p-3 shadow-sm">
            <ControlSelect
              label="Measure"
              value={activeSpec.questionId}
              onChange={(v) => patch({ questionId: v })}
              options={questions.map((q) => ({ value: q.id, label: short(q.text) }))}
            />
            <ControlSelect
              label="Group by"
              value={activeSpec.groupBy}
              onChange={(v) => patch({ groupBy: v as GroupBy })}
              options={[...KOL_GROUPINGS, ...answerGroupings]}
            />
            <ControlSelect
              label="Show"
              value={activeSpec.aggregate}
              onChange={(v) => patch({ aggregate: v as AnalysisSpec["aggregate"] })}
              options={aggregateOptions(metric)}
            />
          </div>

          {/* Filters */}
          <FilterBar
            spec={activeSpec}
            questions={questions}
            onChange={patch}
          />

          {/* Chart */}
          <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
            {activeSpec.title && (
              <h3 className="mb-3 text-center text-sm font-semibold text-ink">
                {activeSpec.title}
              </h3>
            )}
            <ChartCanvas result={result} spec={activeSpec} />
            <div className="mt-3 flex justify-end">
              <Button variant="secondary" size="sm" onClick={handleSave}>
                <Save size={14} /> Save analysis
              </Button>
            </div>
          </div>

          {/* Saved analyses */}
          {saved.analyses.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                Saved analyses
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {saved.analyses.map((a) => (
                  <div
                    key={a.id}
                    className="group flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 shadow-sm"
                  >
                    <BarChart3 size={15} className="shrink-0 text-[var(--accent)]" />
                    <button
                      onClick={() => setSpec(normalizeSpec(a.spec))}
                      className="min-w-0 flex-1 truncate text-left text-sm font-medium text-ink hover:text-[var(--accent)]"
                    >
                      {a.title}
                    </button>
                    <button
                      onClick={() => saved.remove(a.id)}
                      className="shrink-0 text-muted opacity-0 transition group-hover:opacity-100 hover:text-status-error"
                      aria-label="Delete"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Editor panel */}
        <ChartEditor
          spec={activeSpec}
          onChange={patch}
          seriesKeys={result.seriesKeys}
          recommended={recommended}
        />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
function FilterBar({
  spec,
  questions,
  onChange,
}: {
  spec: AnalysisSpec;
  questions: SurveyQuestion[];
  onChange: (p: Partial<AnalysisSpec>) => void;
}) {
  const fieldOptions = [
    { value: "specialty", label: "Specialty" },
    { value: "tier", label: "Tier" },
    { value: "relationship_level", label: "Relationship" },
    { value: "institution", label: "Institution" },
    ...questions.map((q) => ({ value: `answer:${q.id}`, label: `Answer · ${short(q.text)}` })),
  ];

  function update(i: number, patch: Partial<AnalysisSpec["filters"][number]>) {
    const filters = spec.filters.map((f, idx) => (idx === i ? { ...f, ...patch } : f));
    onChange({ filters });
  }
  function remove(i: number) {
    onChange({ filters: spec.filters.filter((_, idx) => idx !== i) });
  }
  function add() {
    onChange({
      filters: [...spec.filters, { field: "specialty", op: "is", value: "" }],
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {spec.filters.map((f, i) => (
        <div
          key={i}
          className="flex items-center gap-1 rounded-lg border border-border bg-surface px-2 py-1.5 text-xs shadow-sm"
        >
          <select
            value={f.field}
            onChange={(e) => update(i, { field: e.target.value })}
            className="bg-transparent outline-none"
          >
            {fieldOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <select
            value={f.op}
            onChange={(e) => update(i, { op: e.target.value as AnalysisSpec["filters"][number]["op"] })}
            className="bg-transparent outline-none"
          >
            {FILTER_OPS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <input
            value={f.value}
            onChange={(e) => update(i, { value: e.target.value })}
            placeholder="value"
            className="w-20 rounded border border-border bg-canvas px-1.5 py-0.5 outline-none focus:border-[var(--accent)]"
          />
          <button
            onClick={() => remove(i)}
            className="text-muted hover:text-status-error"
            aria-label="Remove filter"
          >
            <X size={13} />
          </button>
        </div>
      ))}
      <button
        onClick={add}
        className="inline-flex items-center gap-1 rounded-lg border border-dashed border-border px-2.5 py-1.5 text-xs font-medium text-muted transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
      >
        <Plus size={13} /> Add filter
      </button>
    </div>
  );
}

function ControlSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs">
      <span className="font-medium text-muted">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="max-w-[200px] truncate rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-[var(--accent)]"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function aggregateOptions(metric: SurveyQuestion | undefined) {
  const numeric = metric?.type === "scale" || metric?.type === "number";
  const opts = [
    { value: "count", label: "Count of KOLs" },
    { value: "percent", label: "% of KOLs" },
  ];
  if (numeric) opts.push({ value: "avg", label: "Average value" });
  return opts;
}

function short(text: string, n = 40): string {
  return text.length > n ? text.slice(0, n - 1) + "…" : text;
}

function recommendedType(
  spec: AnalysisSpec,
  metric: SurveyQuestion | undefined,
): ChartType {
  if (!metric) return "bar";
  const numeric = metric.type === "scale" || metric.type === "number";
  const choice =
    metric.type === "single" || metric.type === "multi" || metric.type === "boolean";
  if (numeric && spec.groupBy.startsWith("answer:")) return "scatter";
  if (numeric && spec.aggregate === "avg") return "bar";
  if (choice && spec.groupBy === "none") return "pie";
  if (choice) return "stackedBar";
  return "bar";
}

// Ensure a spec coming from AI/saved has a full style object.
function normalizeSpec(raw: AnalysisSpec): AnalysisSpec {
  const base = defaultSpec(raw.questionId);
  return {
    ...base,
    ...raw,
    style: { ...base.style, ...(raw.style || {}) },
    filters: Array.isArray(raw.filters) ? raw.filters : [],
  };
}
