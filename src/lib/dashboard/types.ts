// Types shared between the dashboard catalog, the AI propose/run route, and
// the chat + tile UI. Kept dependency-free (no supabase/react imports) so the
// catalog metadata can be imported from both server and client code.

export type ChartType = "bar" | "stackedBar" | "line" | "pie" | "donut";
export type MeasureAgg = "count" | "sum" | "avg";
export type Scope = "self" | "org";

export interface DatasetField {
  key: string; // dimension key usable as groupBy
  label: string;
}

export interface DatasetMeasure {
  key: string; // "*" = count of rows; otherwise a numeric field key
  label: string;
  agg: MeasureAgg;
}

// Metadata only — no fetch logic here, so this file is safe to import from
// the client (chat UI needs the field/measure lists to render + validate).
export interface DatasetDef {
  id: string; // "territory.kols"
  module: string; // module slug this data lives in, e.g. "territory-planning"
  moduleLabel: string;
  label: string; // "KOLs"
  description: string; // fed to the AI so it can pick the right dataset
  ownerScoped: boolean; // true = per-rep data (manager can see org-wide; IC sees own only)
  dimensions: DatasetField[];
  measures: DatasetMeasure[];
}

export interface ChartSpec {
  datasetId: string;
  groupBy: string; // a dimension key from the dataset
  measure: string; // a measure key from the dataset
  chartType: ChartType;
  scope: Scope; // "org" only has effect for admins/owners; ICs always get "self"
  title: string;
}

export function defaultChartSpec(datasetId = ""): ChartSpec {
  return {
    datasetId,
    groupBy: "",
    measure: "*",
    chartType: "bar",
    scope: "org",
    title: "",
  };
}

export interface ChartResult {
  empty: boolean;
  categories: string[];
  seriesKey: string; // single measure series name (value axis label)
  rows: Array<{ name: string; value: number }>;
}

export interface DashboardTile {
  id: string;
  org_id: string | null;
  created_by: string;
  title: string;
  dataset_id: string;
  spec: ChartSpec;
  created_at: string;
  updated_at: string;
}
