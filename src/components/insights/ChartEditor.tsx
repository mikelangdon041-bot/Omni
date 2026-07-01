"use client";

import {
  BarChart3,
  BarChartHorizontal,
  PieChart,
  LineChart,
  ScatterChart,
  Hexagon,
  Layers,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/ui";
import { DEFAULT_PALETTE } from "@/lib/insights/types";
import type { AnalysisSpec, ChartStyle, ChartType } from "@/lib/insights/types";

const CHART_TYPES: { type: ChartType; label: string; icon: typeof BarChart3 }[] = [
  { type: "bar", label: "Bar", icon: BarChart3 },
  { type: "stackedBar", label: "Stacked", icon: Layers },
  { type: "line", label: "Line", icon: LineChart },
  { type: "pie", label: "Pie", icon: PieChart },
  { type: "donut", label: "Donut", icon: BarChartHorizontal },
  { type: "scatter", label: "Scatter", icon: ScatterChart },
  { type: "radar", label: "Radar", icon: Hexagon },
];

export function ChartEditor({
  spec,
  onChange,
  seriesKeys,
  recommended,
  defaultTitles,
}: {
  spec: AnalysisSpec;
  onChange: (patch: Partial<AnalysisSpec>) => void;
  seriesKeys: string[];
  recommended?: ChartType;
  defaultTitles?: { x: string; y: string };
}) {
  function setStyle(patch: Partial<ChartStyle>) {
    onChange({ style: { ...spec.style, ...patch } });
  }
  function setColor(i: number, hex: string) {
    const colors = [...spec.style.colors];
    while (colors.length <= i) colors.push(DEFAULT_PALETTE[colors.length % DEFAULT_PALETTE.length]);
    colors[i] = hex;
    setStyle({ colors });
  }

  return (
    <div className="flex flex-col gap-5 rounded-xl border border-border bg-surface p-4 shadow-sm">
      {/* Chart type */}
      <Section title="Chart type">
        <div className="grid grid-cols-4 gap-1.5">
          {CHART_TYPES.map(({ type, label, icon: Icon }) => {
            const active = spec.chartType === type;
            return (
              <button
                key={type}
                onClick={() => onChange({ chartType: type })}
                className={cn(
                  "relative flex flex-col items-center gap-1 rounded-lg border px-1 py-2 text-[11px] font-medium transition",
                  active
                    ? "border-[var(--accent)] bg-accent-soft text-[var(--accent)]"
                    : "border-border text-muted hover:text-ink",
                )}
                title={label}
              >
                <Icon size={16} />
                {label}
                {recommended === type && !active && (
                  <span className="absolute -right-1 -top-1 grid h-4 w-4 place-items-center rounded-full bg-[var(--accent)] text-white">
                    <Sparkles size={9} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {recommended && (
          <p className="mt-1.5 text-[11px] text-muted">
            <Sparkles size={10} className="mr-0.5 inline" />
            Recommended for this data: {labelFor(recommended)}
          </p>
        )}
      </Section>

      {/* Titles */}
      <Section title="Titles">
        <LabeledInput
          label="Chart title"
          value={spec.title}
          onChange={(v) => onChange({ title: v })}
          placeholder="Untitled analysis"
        />
        <div className="grid grid-cols-2 gap-2">
          <LabeledInput
            label="X-axis"
            value={spec.style.xTitle}
            onChange={(v) => setStyle({ xTitle: v })}
            placeholder={defaultTitles?.x}
          />
          <LabeledInput
            label="Y-axis"
            value={spec.style.yTitle}
            onChange={(v) => setStyle({ yTitle: v })}
            placeholder={defaultTitles?.y}
          />
        </div>
      </Section>

      {/* Colors */}
      <Section title="Colors">
        <div className="flex flex-wrap gap-2">
          {(seriesKeys.length ? seriesKeys : ["Series 1"]).map((key, i) => (
            <label
              key={key}
              className="flex items-center gap-1.5 rounded-lg border border-border px-2 py-1.5 text-xs"
              title={key}
            >
              <input
                type="color"
                value={spec.style.colors[i] || DEFAULT_PALETTE[i % DEFAULT_PALETTE.length]}
                onChange={(e) => setColor(i, e.target.value)}
                className="h-5 w-5 cursor-pointer rounded border-0 bg-transparent p-0"
              />
              <span className="max-w-24 truncate">{key}</span>
            </label>
          ))}
        </div>
      </Section>

      {/* Display toggles */}
      <Section title="Display">
        <Toggle
          label="Legend"
          checked={spec.style.showLegend}
          onChange={(v) => setStyle({ showLegend: v })}
        />
        <Toggle
          label="Gridlines"
          checked={spec.style.showGrid}
          onChange={(v) => setStyle({ showGrid: v })}
        />
        <Toggle
          label="Data labels"
          checked={spec.style.showValues}
          onChange={(v) => setStyle({ showValues: v })}
        />
        {spec.chartType === "line" && (
          <Toggle
            label="Smooth line"
            checked={spec.style.smooth}
            onChange={(v) => setStyle({ smooth: v })}
          />
        )}
        {(spec.chartType === "scatter" || spec.chartType === "line") && (
          <label className="flex items-center justify-between text-sm">
            <span className="text-ink">Marker</span>
            <select
              value={spec.style.symbol}
              onChange={(e) => setStyle({ symbol: e.target.value as ChartStyle["symbol"] })}
              className="rounded-lg border border-border bg-surface px-2 py-1 text-xs outline-none focus:border-[var(--accent)]"
            >
              <option value="circle">Circle</option>
              <option value="square">Square</option>
              <option value="triangle">Triangle</option>
              <option value="diamond">Diamond</option>
              <option value="none">None</option>
            </select>
          </label>
        )}
      </Section>
    </div>
  );
}

function labelFor(t: ChartType): string {
  return CHART_TYPES.find((c) => c.type === t)?.label ?? t;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">
        {title}
      </p>
      {children}
    </div>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-muted">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-[var(--accent)]"
      />
    </label>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between text-sm">
      <span className="text-ink">{label}</span>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-5 w-9 rounded-full transition",
          checked ? "bg-[var(--accent)]" : "bg-border",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all",
            checked ? "left-4" : "left-0.5",
          )}
        />
      </button>
    </label>
  );
}
