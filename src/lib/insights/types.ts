// Insights domain types — mirror the Supabase schema (0008_insights).

export type QuestionType =
  | "single" // one choice
  | "multi" // several choices
  | "boolean" // yes / no
  | "scale" // numeric slider (scale_min..scale_max)
  | "number" // free number
  | "text"; // free text

export type TemplateStatus = "draft" | "published" | "archived";
export type ResponseStatus = "not_started" | "in_progress" | "complete";

export interface SurveyTemplate {
  id: string;
  org_id: string;
  name: string;
  product: string;
  description: string;
  status: TemplateStatus;
  version: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SurveyOption {
  id: string;
  question_id: string;
  label: string;
  value: string;
  color: string;
  sort_order: number;
  created_at: string;
}

export interface SurveyQuestion {
  id: string;
  template_id: string;
  parent_question_id: string | null;
  parent_option_id: string | null;
  section: string;
  text: string;
  help_text: string;
  type: QuestionType;
  scale_min: number;
  scale_max: number;
  required: boolean;
  sort_order: number;
  created_at: string;
}

// Question joined with its options + child questions for tree walking.
export interface QuestionNode extends SurveyQuestion {
  options: SurveyOption[];
  children: QuestionNode[];
}

export interface SurveyResponse {
  id: string;
  template_id: string;
  kol_id: string;
  user_id: string;
  org_id: string | null;
  status: ResponseStatus;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

// The stored answer value. Only the field(s) relevant to the question type are set.
export interface AnswerValue {
  optionIds?: string[]; // single / multi / boolean
  scale?: number; // scale
  number?: number; // number
  text?: string; // text
}

export interface SurveyAnswer {
  id: string;
  response_id: string;
  question_id: string;
  value: AnswerValue;
  answered_at: string;
}

// ------------------------------------------------------------------
// Document import (parse a survey doc → editable draft the user confirms)
// ------------------------------------------------------------------
export interface ImportDraftOption {
  label: string;
  color?: string;
}

export interface ImportDraftQuestion {
  tempId: string; // stable ref within the draft (parents referenced by children)
  section: string;
  text: string;
  type: QuestionType;
  options: ImportDraftOption[];
  parentTempId: string | null; // gated follow-up: parent question's tempId
  parentOptionLabel: string | null; // …revealed by this option of the parent
  required: boolean;
}

export interface ImportDraft {
  title: string;
  questions: ImportDraftQuestion[];
}

// ------------------------------------------------------------------
// Analysis workbench
// ------------------------------------------------------------------
export type ChartType =
  | "bar"
  | "stackedBar"
  | "pie"
  | "donut"
  | "line"
  | "scatter"
  | "radar";

export type Aggregate = "count" | "percent" | "avg";

// KOL fields we allow grouping/filtering on (plus answer:<questionId>).
export type GroupBy =
  | "none"
  | "specialty"
  | "tier"
  | "relationship_level"
  | "institution"
  | "kol"
  | `answer:${string}`;

export type FilterOp = "is" | "is_not" | "gte" | "lte" | "contains";

export interface AnalysisFilter {
  field: string; // KOL field, or answer:<questionId>
  op: FilterOp;
  value: string; // compared as string / number as needed
}

export interface ChartStyle {
  colors: string[];
  xTitle: string;
  yTitle: string;
  showLegend: boolean;
  showGrid: boolean;
  showValues: boolean;
  symbol: "circle" | "square" | "triangle" | "diamond" | "none";
  smooth: boolean;
}

export interface AnalysisSpec {
  questionId: string; // the metric question being analysed
  groupBy: GroupBy;
  aggregate: Aggregate;
  filters: AnalysisFilter[];
  chartType: ChartType;
  title: string;
  style: ChartStyle;
}

export interface SavedAnalysis {
  id: string;
  user_id: string;
  org_id: string | null;
  template_id: string | null;
  title: string;
  spec: AnalysisSpec;
  created_at: string;
  updated_at: string;
}

// A sensible default palette (amber-forward to match the Insights theme).
export const DEFAULT_PALETTE = [
  "#f59e0b",
  "#5a4ff3",
  "#0d9488",
  "#ec4899",
  "#0ea5e9",
  "#84cc16",
  "#f43f5e",
  "#8b5cf6",
  "#14b8a6",
  "#eab308",
];

export function defaultStyle(): ChartStyle {
  return {
    colors: [...DEFAULT_PALETTE],
    xTitle: "",
    yTitle: "",
    showLegend: true,
    showGrid: true,
    showValues: false,
    symbol: "circle",
    smooth: false,
  };
}

export function defaultSpec(questionId = ""): AnalysisSpec {
  return {
    questionId,
    groupBy: "none",
    aggregate: "count",
    filters: [],
    chartType: "bar",
    title: "",
    style: defaultStyle(),
  };
}
