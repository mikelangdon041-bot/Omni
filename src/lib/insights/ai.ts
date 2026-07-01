// AI for the Insights workbench: translate a free-text request into a structured
// AnalysisSpec, and suggest interesting analyses. Uses the shared openai() client.

import { openai } from "@/lib/openai";
import { defaultSpec, type AnalysisSpec } from "./types";
import type { SurveyOption, SurveyQuestion } from "./types";

const MODEL = process.env.OPENAI_SUMMARY_MODEL || "gpt-4o";

// KOL fields the engine can group/filter on (must match analytics.ts).
const KOL_FIELDS = [
  "specialty",
  "tier",
  "relationship_level",
  "institution",
  "kol",
];

// Compact catalog of the survey so the model can pick a real question id.
function catalog(questions: SurveyQuestion[], options: SurveyOption[]): string {
  return questions
    .map((q) => {
      const opts = options
        .filter((o) => o.question_id === q.id)
        .map((o) => o.label)
        .join(" | ");
      const range =
        q.type === "scale" ? ` (${q.scale_min}-${q.scale_max})` : "";
      return `- id=${q.id} | type=${q.type}${range} | "${q.text}"${
        opts ? ` | options: ${opts}` : ""
      }`;
    })
    .join("\n");
}

const SPEC_SHAPE = `AnalysisSpec JSON shape:
{
  "questionId": "<one id from the catalog — the question being measured>",
  "groupBy": "none" | "specialty" | "tier" | "relationship_level" | "institution" | "kol" | "answer:<question id>",
  "aggregate": "count" | "percent" | "avg",   // avg only for scale/number questions
  "filters": [ { "field": "<kol field or answer:<id>>", "op": "is"|"is_not"|"gte"|"lte"|"contains", "value": "<string>" } ],
  "chartType": "bar" | "stackedBar" | "pie" | "donut" | "line" | "scatter" | "radar",
  "title": "<short human title>"
}
Rules:
- questionId MUST be one of the catalog ids.
- Use "avg" only for scale/number questions; for choice questions use "count" or "percent".
- Prefer "pie"/"donut" when groupBy is "none" and the question is a choice; "bar"/"stackedBar" when comparing across a group; "scatter" for two numeric questions.
- Only add filters the user clearly asked for.`;

export async function nlToAnalysisSpec(opts: {
  prompt: string;
  questions: SurveyQuestion[];
  options: SurveyOption[];
}): Promise<AnalysisSpec> {
  const { prompt, questions, options } = opts;
  const system = `You convert an MSL's plain-English analytics request into a strict AnalysisSpec JSON for a KOL survey analytics tool. Return ONLY the JSON object, no prose.

Available KOL grouping/filter fields: ${KOL_FIELDS.join(", ")}.

Survey question catalog:
${catalog(questions, options)}

${SPEC_SHAPE}`;

  const res = await openai().chat.completions.create({
    model: MODEL,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
  });

  const parsed = safeParse(res.choices[0]?.message?.content || "{}");
  return coerceSpec(parsed, questions);
}

export async function suggestAnalyses(opts: {
  questions: SurveyQuestion[];
  options: SurveyOption[];
  count?: number;
}): Promise<{ title: string; spec: AnalysisSpec }[]> {
  const { questions, options, count = 5 } = opts;
  const system = `You are a medical-affairs insights analyst. Given a KOL survey catalog, propose ${count} genuinely interesting, non-obvious analyses an MSL would want. Return ONLY JSON: {"suggestions":[{"title":"...","spec":{...AnalysisSpec...}}]}.

Available KOL grouping/filter fields: ${KOL_FIELDS.join(", ")}.

Survey question catalog:
${catalog(questions, options)}

${SPEC_SHAPE}`;

  const res = await openai().chat.completions.create({
    model: MODEL,
    temperature: 0.7,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: `Suggest ${count} analyses.` },
    ],
  });

  const parsed = safeParse(res.choices[0]?.message?.content || "{}");
  const list = Array.isArray(parsed.suggestions) ? parsed.suggestions : [];
  return list
    .map((s: { title?: string; spec?: unknown }) => ({
      title: String(s.title || "Untitled"),
      spec: coerceSpec(s.spec, questions),
    }))
    .filter((s: { spec: AnalysisSpec }) => s.spec.questionId)
    .slice(0, count);
}

function safeParse(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

// Validate/normalise the model output into a usable AnalysisSpec, keeping only
// a real questionId and a sane chart type / aggregate for that question type.
function coerceSpec(raw: unknown, questions: SurveyQuestion[]): AnalysisSpec {
  const r = (raw || {}) as Record<string, unknown>;
  const spec = defaultSpec();
  const q = questions.find((x) => x.id === r.questionId);
  spec.questionId = q?.id || "";

  const isNumeric = q?.type === "scale" || q?.type === "number";
  const isChoice =
    q?.type === "single" || q?.type === "multi" || q?.type === "boolean";

  if (typeof r.groupBy === "string") spec.groupBy = r.groupBy as AnalysisSpec["groupBy"];
  if (
    r.aggregate === "count" ||
    r.aggregate === "percent" ||
    r.aggregate === "avg"
  ) {
    spec.aggregate = r.aggregate;
  }
  if (spec.aggregate === "avg" && !isNumeric) spec.aggregate = "count";

  const chartTypes = [
    "bar",
    "stackedBar",
    "pie",
    "donut",
    "line",
    "scatter",
    "radar",
  ];
  if (typeof r.chartType === "string" && chartTypes.includes(r.chartType)) {
    spec.chartType = r.chartType as AnalysisSpec["chartType"];
  } else {
    spec.chartType = isChoice && spec.groupBy === "none" ? "pie" : "bar";
  }
  if (spec.chartType === "scatter" && !isNumeric) spec.chartType = "bar";

  if (Array.isArray(r.filters)) {
    spec.filters = r.filters
      .filter(
        (f: unknown): f is { field: string; op: string; value: unknown } =>
          !!f && typeof (f as { field?: unknown }).field === "string",
      )
      .map((f) => ({
        field: f.field,
        op: (["is", "is_not", "gte", "lte", "contains"].includes(f.op)
          ? f.op
          : "is") as AnalysisSpec["filters"][number]["op"],
        value: String(f.value ?? ""),
      }));
  }

  spec.title = typeof r.title === "string" ? r.title : q?.text || "";
  return spec;
}
