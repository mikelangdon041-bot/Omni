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
  Tooltip,
  XAxis,
  YAxis,
  ResponsiveContainer,
} from "recharts";
import type { ChartResult, ChartType } from "@/lib/dashboard/types";

// Validated categorical order (dataviz skill reference palette) — CVD-safe in
// fixed order for adjacent pairs (stacked segments, bars, pie slices). Never
// cycle or reorder per-chart.
const PALETTE = [
  "#2a78d6", // blue
  "#008300", // green
  "#e87ba4", // magenta
  "#eda100", // yellow
  "#1baf7a", // aqua
  "#eb6834", // orange
  "#4a3aa7", // violet
  "#e34948", // red
];

export function ChartCanvas({
  result,
  chartType,
  height = 320,
}: {
  result: ChartResult;
  chartType: ChartType;
  height?: number;
}) {
  const color = (i: number) => PALETTE[i % PALETTE.length];

  if (result.empty) {
    return (
      <div
        className="grid place-items-center rounded-xl border border-dashed border-border bg-canvas text-center"
        style={{ height }}
      >
        <p className="max-w-xs text-sm text-muted">No data to chart yet.</p>
      </div>
    );
  }

  if (chartType === "pie" || chartType === "donut") {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Tooltip />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Pie
            data={result.rows}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            outerRadius={height * 0.36}
            innerRadius={chartType === "donut" ? height * 0.2 : 0}
          >
            {result.rows.map((_, i) => (
              <Cell key={i} fill={color(i)} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
    );
  }

  if (chartType === "line") {
    return (
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={result.rows} margin={{ top: 16, right: 24, bottom: 8, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e1e0d9" />
          <XAxis dataKey="name" tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} />
          <Tooltip />
          <Line type="monotone" dataKey="value" name={result.seriesKey} stroke={color(0)} strokeWidth={2} dot />
        </LineChart>
      </ResponsiveContainer>
    );
  }

  // Bar / stacked bar (single series here, so plain bar either way).
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={result.rows} margin={{ top: 16, right: 24, bottom: 8, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e1e0d9" />
        <XAxis dataKey="name" tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} />
        <Tooltip />
        <Bar dataKey="value" name={result.seriesKey} fill={color(0)} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
