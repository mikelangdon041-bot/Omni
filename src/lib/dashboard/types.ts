// Types shared between the dashboard catalog, the AI propose/run route, and
// the chat + tile UI. Kept dependency-free (no supabase/react imports) so the
// catalog metadata can be imported from both server and client code.

export type ChartType = "bar" | "stackedBar" | "line" | "pie" | "donut";
export type MeasureAgg = "count" | "sum" | "avg";
// "team" = the caller's own dashboard_teams roster (any manager); "org" =
// every member of the company (org admins/owners only).
export type Scope = "self" | "team" | "org";

export interface DatasetField {
  key: string; // dimension key usable as groupBy
  label: string;
}

export interface DatasetMeasure {
  key: string; // "*" = count of rows; otherwise a numeric field key
  label: string;
  agg: MeasureAgg;
}

// The dimension key every owner-scoped dataset gets for free once more than
// one rep's rows are in play (team/org scope) — lets a manager group any
// metric by team member without each dataset having to declare it.
export const REP_DIMENSION: DatasetField = { key: "rep", label: "Team member" };

// Metadata only — no fetch logic here, so this file is safe to import from
// the client (chat UI needs the field/measure lists to render + validate).
export interface DatasetDef {
  id: string; // "territory.kols", or "import:<uuid>" for an uploaded workbook
  module: string; // module slug this data lives in, e.g. "territory-planning"
  moduleLabel: string;
  label: string; // "KOLs"
  description: string; // fed to the AI so it can pick the right dataset
  ownerScoped: boolean; // true = per-rep data (manager can see team/org-wide; IC sees own only)
  source?: "import"; // set for a dataset backed by an uploaded workbook
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

export interface ImportColumn {
  key: string;
  label: string;
  type: "string" | "number";
}

export interface DashboardImport {
  id: string;
  org_id: string;
  created_by: string;
  title: string;
  columns: ImportColumn[];
  row_count: number;
  created_at: string;
}

export interface TeamMember {
  id: string;
  username: string;
  display_name: string | null;
}

export interface DashboardTeam {
  id: string;
  name: string;
  manager_id: string;
  members: TeamMember[];
}
