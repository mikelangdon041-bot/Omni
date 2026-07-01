// The analysis engine: turn survey responses into chart-ready data.
// Pure functions only (no React/Supabase) so the workbench can re-run instantly
// as the user tweaks the spec.

import type { KOL } from "@/lib/territory/types";
import { RELATIONSHIP_LABELS, kolFullName } from "@/lib/territory/utils";
import type {
  AnalysisFilter,
  AnalysisSpec,
  AnswerValue,
  SurveyAnswer,
  SurveyOption,
  SurveyQuestion,
  SurveyResponse,
} from "./types";

export interface AnalyticsData {
  kols: KOL[];
  responses: SurveyResponse[];
  answers: SurveyAnswer[];
  questions: SurveyQuestion[];
  options: SurveyOption[];
}

// One analysable record = a KOL together with the answers on their response.
interface Record_ {
  kol: KOL;
  answers: Map<string, AnswerValue>;
}

export interface AnalysisResult {
  kind: "category" | "scatter" | "text";
  categories: string[]; // x-axis / pie slices
  seriesKeys: string[]; // stacked / grouped series
  rows: Array<Record<string, number | string>>; // recharts rows: { name, [series]: n }
  scatter: Array<{ x: number; y: number; label: string }>;
  textRows: Array<{ label: string; text: string }>;
  valueLabel: string; // default y-axis label
  empty: boolean;
}

const UNKNOWN = "Unknown";

function buildRecords(data: AnalyticsData): Record_[] {
  const kolById = new Map(data.kols.map((k) => [k.id, k]));
  const respById = new Map(data.responses.map((r) => [r.id, r]));
  const byResponse = new Map<string, Map<string, AnswerValue>>();
  for (const a of data.answers) {
    let m = byResponse.get(a.response_id);
    if (!m) {
      m = new Map();
      byResponse.set(a.response_id, m);
    }
    m.set(a.question_id, a.value);
  }
  const records: Record_[] = [];
  for (const r of data.responses) {
    const kol = kolById.get(r.kol_id);
    if (!kol) continue;
    records.push({ kol, answers: byResponse.get(r.id) || new Map() });
  }
  // Guard against orphan responses in respById lint (kept for symmetry).
  void respById;
  return records;
}

function optionLabel(options: SurveyOption[], id: string): string {
  return options.find((o) => o.id === id)?.label || id;
}

// Render an answer to a single comparable string (used for grouping/filtering).
function answerToString(
  qId: string,
  answers: Map<string, AnswerValue>,
  questions: SurveyQuestion[],
  options: SurveyOption[],
): string {
  const q = questions.find((x) => x.id === qId);
  const v = answers.get(qId);
  if (!q || !v) return "Unanswered";
  switch (q.type) {
    case "single":
    case "multi":
    case "boolean": {
      const labels = (v.optionIds || []).map((id) => optionLabel(options, id));
      return labels.length ? labels.join(", ") : "Unanswered";
    }
    case "scale":
      return typeof v.scale === "number" ? String(v.scale) : "Unanswered";
    case "number":
      return typeof v.number === "number" ? String(v.number) : "Unanswered";
    case "text":
      return v.text?.trim() || "Unanswered";
  }
}

function fieldValue(
  field: string,
  rec: Record_,
  questions: SurveyQuestion[],
  options: SurveyOption[],
): string {
  if (field.startsWith("answer:")) {
    return answerToString(field.slice(7), rec.answers, questions, options);
  }
  const k = rec.kol as unknown as Record<string, unknown>;
  switch (field) {
    case "specialty":
      return rec.kol.specialty || UNKNOWN;
    case "tier":
      return rec.kol.tier || "Untiered";
    case "institution":
      return rec.kol.institution || UNKNOWN;
    case "relationship_level":
      return RELATIONSHIP_LABELS[rec.kol.relationship_level] || UNKNOWN;
    case "kol":
      return kolFullName(rec.kol);
    default:
      return String(k[field] ?? UNKNOWN);
  }
}

function passesFilter(
  f: AnalysisFilter,
  rec: Record_,
  questions: SurveyQuestion[],
  options: SurveyOption[],
): boolean {
  const raw = fieldValue(f.field, rec, questions, options);
  switch (f.op) {
    case "is":
      return raw.toLowerCase() === f.value.toLowerCase();
    case "is_not":
      return raw.toLowerCase() !== f.value.toLowerCase();
    case "contains":
      return raw.toLowerCase().includes(f.value.toLowerCase());
    case "gte":
      return Number(raw) >= Number(f.value);
    case "lte":
      return Number(raw) <= Number(f.value);
  }
}

function groupOf(
  spec: AnalysisSpec,
  rec: Record_,
  questions: SurveyQuestion[],
  options: SurveyOption[],
): string {
  if (spec.groupBy === "none") return "All";
  return fieldValue(spec.groupBy, rec, questions, options);
}

function numericAnswer(v: AnswerValue | undefined): number | null {
  if (!v) return null;
  if (typeof v.scale === "number") return v.scale;
  if (typeof v.number === "number") return v.number;
  return null;
}

export function runAnalysis(
  spec: AnalysisSpec,
  data: AnalyticsData,
): AnalysisResult {
  const empty: AnalysisResult = {
    kind: "category",
    categories: [],
    seriesKeys: [],
    rows: [],
    scatter: [],
    textRows: [],
    valueLabel: "",
    empty: true,
  };

  const question = data.questions.find((q) => q.id === spec.questionId);
  if (!question) return empty;

  let records = buildRecords(data);
  for (const f of spec.filters) {
    records = records.filter((r) =>
      passesFilter(f, r, data.questions, data.options),
    );
  }
  // Keep only records that actually answered the metric question.
  const answered = records.filter((r) => {
    const v = r.answers.get(spec.questionId);
    if (!v) return false;
    if (question.type === "text") return !!v.text?.trim();
    if (question.type === "scale" || question.type === "number")
      return numericAnswer(v) !== null;
    return (v.optionIds?.length || 0) > 0;
  });

  if (answered.length === 0) return empty;

  const isChoice =
    question.type === "single" ||
    question.type === "multi" ||
    question.type === "boolean";
  const isNumeric = question.type === "scale" || question.type === "number";

  // ---- Scatter (numeric metric only) ---------------------------------
  if (spec.chartType === "scatter" && isNumeric) {
    // y = metric value; x = a numeric groupBy answer if available, else index.
    const xField =
      spec.groupBy.startsWith("answer:") &&
      isNumericQuestion(spec.groupBy.slice(7), data.questions)
        ? spec.groupBy.slice(7)
        : null;
    const scatter = answered.map((r, i) => {
      const y = numericAnswer(r.answers.get(spec.questionId))!;
      const x = xField
        ? numericAnswer(r.answers.get(xField)) ?? i
        : i + 1;
      return { x, y, label: kolFullName(r.kol) };
    });
    return {
      ...empty,
      empty: false,
      kind: "scatter",
      scatter,
      valueLabel: question.text,
    };
  }

  // ---- Text metric ---------------------------------------------------
  if (question.type === "text") {
    const textRows = answered.map((r) => ({
      label: kolFullName(r.kol),
      text: r.answers.get(spec.questionId)?.text?.trim() || "",
    }));
    // Also provide a per-group count so it can still chart if desired.
    const groups = groupCounts(answered, spec, data.questions, data.options);
    return {
      ...empty,
      empty: false,
      kind: "text",
      textRows,
      categories: groups.categories,
      seriesKeys: ["Responses"],
      rows: groups.categories.map((c) => ({
        name: c,
        Responses: groups.counts.get(c) || 0,
      })),
      valueLabel: "Responses",
    };
  }

  // ---- Numeric metric: avg / count / percent per group ---------------
  if (isNumeric && spec.aggregate === "avg") {
    const sums = new Map<string, { sum: number; n: number }>();
    for (const r of answered) {
      const g = groupOf(spec, r, data.questions, data.options);
      const val = numericAnswer(r.answers.get(spec.questionId))!;
      const cur = sums.get(g) || { sum: 0, n: 0 };
      cur.sum += val;
      cur.n += 1;
      sums.set(g, cur);
    }
    const categories = [...sums.keys()].sort(sortCat);
    return {
      ...empty,
      empty: false,
      kind: "category",
      categories,
      seriesKeys: ["Average"],
      rows: categories.map((c) => {
        const s = sums.get(c)!;
        return { name: c, Average: round(s.sum / s.n) };
      }),
      valueLabel: `Average ${question.text}`,
    };
  }

  // ---- Choice metric, or numeric with count/percent ------------------
  if (isChoice) {
    // Stacked series = each option; category = group. (groupBy none → one bar
    // per option, i.e. a distribution.)
    const definedOptions = data.options.some(
      (o) => o.question_id === question.id,
    );
    const optionLabels = definedOptions
      ? sortedOptionLabels(question.id, data.options)
      : distinctChoiceLabels(answered, spec.questionId, data.options);
    const table = new Map<string, Map<string, number>>(); // group -> option -> count
    const groupTotals = new Map<string, number>();
    for (const r of answered) {
      const g = groupOf(spec, r, data.questions, data.options);
      const ids = r.answers.get(spec.questionId)?.optionIds || [];
      let row = table.get(g);
      if (!row) {
        row = new Map();
        table.set(g, row);
      }
      for (const id of ids) {
        const label = optionLabel(data.options, id);
        row.set(label, (row.get(label) || 0) + 1);
      }
      groupTotals.set(g, (groupTotals.get(g) || 0) + 1);
    }
    const categories = [...table.keys()].sort(sortCat);
    const rows = categories.map((c) => {
      const row: Record<string, number | string> = { name: c };
      const total = groupTotals.get(c) || 1;
      for (const label of optionLabels) {
        const raw = table.get(c)?.get(label) || 0;
        row[label] =
          spec.aggregate === "percent" ? round((raw / total) * 100) : raw;
      }
      return row;
    });
    return {
      ...empty,
      empty: false,
      kind: "category",
      categories,
      seriesKeys: optionLabels,
      rows,
      valueLabel: spec.aggregate === "percent" ? "% of KOLs" : "KOLs",
    };
  }

  // Numeric metric with count / percent → count KOLs per group.
  const counts = groupCounts(answered, spec, data.questions, data.options);
  const totalN = answered.length;
  return {
    ...empty,
    empty: false,
    kind: "category",
    categories: counts.categories,
    seriesKeys: ["KOLs"],
    rows: counts.categories.map((c) => {
      const raw = counts.counts.get(c) || 0;
      return {
        name: c,
        KOLs: spec.aggregate === "percent" ? round((raw / totalN) * 100) : raw,
      };
    }),
    valueLabel: spec.aggregate === "percent" ? "% of KOLs" : "KOLs",
  };
}

// ------------------------------------------------------------------
// Small helpers
// ------------------------------------------------------------------
function round(n: number): number {
  return Math.round(n * 10) / 10;
}

// Numeric-looking categories sort numerically; otherwise alphabetically.
function sortCat(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  return a.localeCompare(b);
}

function isNumericQuestion(qId: string, questions: SurveyQuestion[]): boolean {
  const q = questions.find((x) => x.id === qId);
  return q?.type === "scale" || q?.type === "number";
}

function sortedOptionLabels(qId: string, options: SurveyOption[]): string[] {
  return options
    .filter((o) => o.question_id === qId)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((o) => o.label);
}

function distinctChoiceLabels(
  records: Record_[],
  qId: string,
  options: SurveyOption[],
): string[] {
  const set = new Set<string>();
  for (const r of records) {
    for (const id of r.answers.get(qId)?.optionIds || [])
      set.add(optionLabel(options, id));
  }
  return [...set].sort();
}

function groupCounts(
  records: Record_[],
  spec: AnalysisSpec,
  questions: SurveyQuestion[],
  options: SurveyOption[],
): { categories: string[]; counts: Map<string, number> } {
  const counts = new Map<string, number>();
  for (const r of records) {
    const g = groupOf(spec, r, questions, options);
    counts.set(g, (counts.get(g) || 0) + 1);
  }
  return { categories: [...counts.keys()].sort(sortCat), counts };
}

// ------------------------------------------------------------------
// Roster-level stats for the KOLs tab header + "fun stats"
// ------------------------------------------------------------------
export interface RosterStats {
  totalKols: number;
  started: number;
  notStarted: number;
  complete: number;
  avgCompletion: number; // 0..100
  mostAnswered: { question: string; count: number } | null;
  leastAnswered: { question: string; count: number } | null;
}

export function rosterStats(
  responses: SurveyResponse[],
  completions: Map<string, number>, // responseId -> pct
  answers: SurveyAnswer[],
  questions: SurveyQuestion[],
): RosterStats {
  const started = responses.filter((r) => r.status !== "not_started").length;
  const complete = responses.filter((r) => r.status === "complete").length;
  const pcts = responses.map((r) => completions.get(r.id) ?? 0);
  const avg =
    pcts.length === 0
      ? 0
      : Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length);

  // Answer counts per question across the roster.
  const perQ = new Map<string, number>();
  for (const a of answers) perQ.set(a.question_id, (perQ.get(a.question_id) || 0) + 1);

  let most: { question: string; count: number } | null = null;
  let least: { question: string; count: number } | null = null;
  for (const q of questions) {
    const count = perQ.get(q.id) || 0;
    if (count === 0) continue;
    if (!most || count > most.count) most = { question: q.text, count };
    if (!least || count < least.count) least = { question: q.text, count };
  }

  return {
    totalKols: responses.length,
    started,
    notStarted: responses.length - started,
    complete,
    avgCompletion: avg,
    mostAnswered: most,
    leastAnswered: least,
  };
}

// ------------------------------------------------------------------
// A compact, text summary of the ACTUAL answers — fed to the AI so its
// suggestions reflect real patterns in the data (not just the question list).
// ------------------------------------------------------------------
export function summarizeData(data: AnalyticsData, maxQuestions = 30): string {
  const records = buildRecords(data);
  if (records.length === 0) return "No responses yet.";

  const lines: string[] = [`KOLs with responses: ${records.length}.`];

  // KOL-field spreads that are useful for grouping.
  const specialties = tally(records.map((r) => r.kol.specialty || "Unknown"));
  const tiers = tally(records.map((r) => r.kol.tier || "Untiered"));
  lines.push(`Specialties: ${topTally(specialties, 6)}.`);
  lines.push(`Tiers: ${topTally(tiers, 6)}.`);

  let shown = 0;
  for (const q of data.questions) {
    if (shown >= maxQuestions) break;
    const vals = records
      .map((r) => r.answers.get(q.id))
      .filter((v): v is AnswerValue => !!v);
    if (vals.length === 0) continue;
    shown++;

    if (q.type === "scale" || q.type === "number") {
      const nums = vals
        .map((v) => (typeof v.scale === "number" ? v.scale : v.number))
        .filter((n): n is number => typeof n === "number");
      const avgV =
        nums.length > 0
          ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10
          : 0;
      lines.push(`Q "${q.text}" [${q.type}] — n=${nums.length}, avg=${avgV}.`);
    } else if (q.type === "text") {
      lines.push(`Q "${q.text}" [text] — ${vals.length} free-text responses.`);
    } else {
      const labels: string[] = [];
      for (const v of vals)
        for (const id of v.optionIds || [])
          labels.push(optionLabel(data.options, id));
      lines.push(
        `Q "${q.text}" [${q.type}] — n=${vals.length}: ${topTally(tally(labels), 6)}.`,
      );
    }
  }
  return lines.join("\n");
}

function tally(items: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const i of items) m.set(i, (m.get(i) || 0) + 1);
  return m;
}

function topTally(m: Map<string, number>, n: number): string {
  return [...m.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => `${k} (${v})`)
    .join(", ");
}
