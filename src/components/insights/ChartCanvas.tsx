"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
  LabelList,
  ResponsiveContainer,
} from "recharts";
import { DEFAULT_PALETTE } from "@/lib/insights/types";
import type { AnalysisResult } from "@/lib/insights/analytics";
import type { AnalysisSpec } from "@/lib/insights/types";

const SCATTER_SHAPE: Record<string, "circle" | "square" | "triangle" | "diamond" | "star"> = {
  circle: "circle",
  square: "square",
  triangle: "triangle",
  diamond: "diamond",
  none: "circle",
};

export function ChartCanvas({
  result,
  spec,
  height = 380,
}: {
  result: AnalysisResult;
  spec: AnalysisSpec;
  height?: number;
}) {
  const colors = spec.style.colors.length ? spec.style.colors : DEFAULT_PALETTE;
  const color = (i: number) => colors[i % colors.length];

  if (result.empty) {
    return (
      <div className="grid h-[380px] place-items-center rounded-xl border border-dashed border-border bg-canvas text-center">
        <p className="max-w-xs text-sm text-muted">
          No data to chart yet. Pick a question and make sure some KOLs have
          answered it.
        </p>
      </div>
    );
  }

  const xLabel = spec.style.xTitle;
  const yLabel = spec.style.yTitle || result.valueLabel;

  // ---- Scatter ------------------------------------------------------
  if (result.kind === "scatter") {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <ScatterChart margin={{ top: 16, right: 24, bottom: 24, left: 8 }}>
          {spec.style.showGrid && <CartesianGrid strokeDasharray="3 3" stroke="#e7e5f2" />}
          <XAxis
            type="number"
            dataKey="x"
            name={xLabel || "x"}
            label={xLabel ? { value: xLabel, position: "bottom" } : undefined}
            tick={{ fontSize: 12 }}
          />
          <YAxis
            type="number"
            dataKey="y"
            name={yLabel}
            label={yLabel ? { value: yLabel, angle: -90, position: "insideLeft" } : undefined}
            tick={{ fontSize: 12 }}
          />
          <ZAxis range={[80, 80]} />
          <Tooltip cursor={{ strokeDasharray: "3 3" }} />
          {spec.style.showLegend && <Legend />}
          <Scatter
            name={yLabel}
            data={result.scatter}
            fill={color(0)}
            shape={SCATTER_SHAPE[spec.style.symbol] || "circle"}
          />
        </ScatterChart>
      </ResponsiveContainer>
    );
  }

  // ---- Text: show responses (+ a small count bar underneath) --------
  if (result.kind === "text") {
    return (
      <div className="flex flex-col gap-4">
        <div className="max-h-64 space-y-2 overflow-y-auto rounded-xl border border-border bg-surface p-4">
          {result.textRows.map((t, i) => (
            <div key={i} className="border-b border-border pb-2 last:border-b-0">
              <p className="text-xs font-semibold text-muted">{t.label}</p>
              <p className="text-sm text-ink">{t.text || "—"}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ---- Pie / Donut --------------------------------------------------
  if (spec.chartType === "pie" || spec.chartType === "donut") {
    const pie = toPieData(result);
    return (
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Tooltip />
          {spec.style.showLegend && <Legend />}
          <Pie
            data={pie}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            outerRadius={height * 0.36}
            innerRadius={spec.chartType === "donut" ? height * 0.2 : 0}
            label={
              spec.style.showValues
                ? (e: { name?: string; value?: number }) =>
                    `${e.name ?? ""}: ${e.value ?? 0}`
                : undefined
            }
          >
            {pie.map((_, i) => (
              <Cell key={i} fill={color(i)} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
    );
  }

  // ---- Radar --------------------------------------------------------
  if (spec.chartType === "radar") {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <RadarChart data={result.rows} outerRadius={height * 0.38}>
          <PolarGrid />
          <PolarAngleAxis dataKey="name" tick={{ fontSize: 12 }} />
          <PolarRadiusAxis tick={{ fontSize: 11 }} />
          <Tooltip />
          {spec.style.showLegend && <Legend />}
          {result.seriesKeys.map((key, i) => (
            <Radar
              key={key}
              name={key}
              dataKey={key}
              stroke={color(i)}
              fill={color(i)}
              fillOpacity={0.35}
            />
          ))}
        </RadarChart>
      </ResponsiveContainer>
    );
  }

  // ---- Line ---------------------------------------------------------
  if (spec.chartType === "line") {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={result.rows} margin={{ top: 16, right: 24, bottom: 24, left: 8 }}>
          {spec.style.showGrid && <CartesianGrid strokeDasharray="3 3" stroke="#e7e5f2" />}
          <XAxis
            dataKey="name"
            tick={{ fontSize: 12 }}
            label={xLabel ? { value: xLabel, position: "bottom" } : undefined}
          />
          <YAxis
            tick={{ fontSize: 12 }}
            label={yLabel ? { value: yLabel, angle: -90, position: "insideLeft" } : undefined}
          />
          <Tooltip />
          {spec.style.showLegend && <Legend />}
          {result.seriesKeys.map((key, i) => (
            <Line
              key={key}
              type={spec.style.smooth ? "monotone" : "linear"}
              dataKey={key}
              stroke={color(i)}
              strokeWidth={2}
              dot={spec.style.symbol !== "none"}
            >
              {spec.style.showValues && <LabelList dataKey={key} position="top" fontSize={11} />}
            </Line>
          ))}
        </LineChart>
      </ResponsiveContainer>
    );
  }

  // ---- Bar / Stacked bar (default) ----------------------------------
  const stacked = spec.chartType === "stackedBar";
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={result.rows} margin={{ top: 16, right: 24, bottom: 24, left: 8 }}>
        {spec.style.showGrid && <CartesianGrid strokeDasharray="3 3" stroke="#e7e5f2" />}
        <XAxis
          dataKey="name"
          tick={{ fontSize: 12 }}
          label={xLabel ? { value: xLabel, position: "bottom" } : undefined}
        />
        <YAxis
          tick={{ fontSize: 12 }}
          label={yLabel ? { value: yLabel, angle: -90, position: "insideLeft" } : undefined}
        />
        <Tooltip />
        {spec.style.showLegend && <Legend />}
        {result.seriesKeys.map((key, i) => (
          <Bar
            key={key}
            dataKey={key}
            stackId={stacked ? "a" : undefined}
            fill={color(i)}
            radius={stacked ? 0 : [4, 4, 0, 0]}
          >
            {spec.style.showValues && <LabelList dataKey={key} position="top" fontSize={11} />}
          </Bar>
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

// Pie slices: one series → slice per category; many series → slice per series
// (summed across categories).
function toPieData(result: AnalysisResult): { name: string; value: number }[] {
  if (result.seriesKeys.length <= 1) {
    const key = result.seriesKeys[0];
    return result.rows.map((r) => ({
      name: String(r.name),
      value: Number(r[key]) || 0,
    }));
  }
  return result.seriesKeys.map((key) => ({
    name: key,
    value: result.rows.reduce((sum, r) => sum + (Number(r[key]) || 0), 0),
  }));
}
