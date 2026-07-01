// AI for the Insights workbench: translate a free-text request into a structured
// AnalysisSpec, and suggest interesting analyses. Uses the shared openai() client.

import { openai } from "@/lib/openai";
import { defaultSpec, type AnalysisSpec } from "./types";
import type {
  ImportDraft,
  ImportDraftQuestion,
  QuestionType,
  SurveyOption,
  SurveyQuestion,
} from "./types";

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

// ------------------------------------------------------------------
// Document import: turn a survey worksheet's raw text into a structured,
// branching draft the user can review and edit before importing.
// ------------------------------------------------------------------
const IMPORT_SYSTEM_PROMPT = `You convert a medical-affairs survey/worksheet document into a structured branching survey. Return ONLY JSON of the form:
{"title":"...","questions":[{"tempId":"q1","section":"...","text":"...","type":"single|multi|boolean|scale|number|text","options":["..."],"parentTempId":null,"parentOptionLabel":null,"required":false}]}

How to read the document:
- Each QUESTION is a prompt line, usually followed by its ANSWER OPTIONS on the lines beneath it (one option per line). Options may start with bullets/dashes ("-PSNP") — strip the leading dash.
- A SECTION HEADER is a standalone line that is neither a question nor an option (e.g. "Required Questions for all MSL Interactions", "Qutenza awareness", "CASPAR", "Off-label Qutenza use"). Apply it as the "section" of the questions beneath it until the next header.

Choosing "type":
- "boolean": exactly Yes/No.
- "single": one ordered/labeled choice list (e.g. "Never/Rarely/Sometimes/Often/Always", knowledge or impression levels, or a Yes/No/Unsure set).
- "multi": the prompt implies several may apply — plurals like "Reason(s)", "improvements", "screens and/or questionnaires", "How did you first hear" style lists, or where selecting several is natural.
- "text": the prompt asks for free text and lists no real choices (e.g. ends with "(free text)" or "Free text", or "Average QTZ duration…"). Use empty options.
- "number"/"scale": only if clearly numeric.

Options:
- Keep option labels concise but faithful to the document (you may trim long parenthetical explanations into the label).
- If an option is "Other (free text)" or similar, include an option labeled "Other".

Branching (IMPORTANT):
- Lines like "If never,", "If yes,", "If no,", "If selected Other" mean the following question(s) are FOLLOW-UPS that only appear when that option was chosen on the most recent relevant question. For such a follow-up set: parentTempId = that question's tempId and parentOptionLabel = the triggering option label ("Never","Yes","No","Other", …). The "If …" line itself is NOT a question.
- Otherwise parentTempId and parentOptionLabel are null (top-level question).

Output rules:
- tempIds are "q1","q2",… in document order. A parent always appears before its children.
- parentOptionLabel must EXACTLY match one of the parent's option labels.
- Do not invent questions that aren't in the document. Preserve original order.`;

export async function parseSurveyDoc(text: string): Promise<ImportDraft> {
  const res = await openai().chat.completions.create({
    model: MODEL,
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: IMPORT_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Convert this survey document into the JSON structure:\n\n${text}`,
      },
    ],
  });
  const parsed = safeParse(res.choices[0]?.message?.content || "{}");
  return coerceImportDraft(parsed);
}

const QUESTION_TYPES: QuestionType[] = [
  "single",
  "multi",
  "boolean",
  "scale",
  "number",
  "text",
];

// Normalise the model output into a valid ImportDraft (fix types, prune broken
// branch links, keep parents before children).
function coerceImportDraft(raw: Record<string, unknown>): ImportDraft {
  const title =
    typeof raw.title === "string" && raw.title.trim()
      ? raw.title.trim()
      : "Imported survey";
  const rawQs = Array.isArray(raw.questions) ? raw.questions : [];

  const seen = new Set<string>();
  const questions: ImportDraftQuestion[] = [];
  for (let i = 0; i < rawQs.length; i++) {
    const q = (rawQs[i] || {}) as Record<string, unknown>;
    const text = String(q.text ?? "").trim();
    if (!text) continue;

    let tempId = String(q.tempId ?? `q${i + 1}`);
    if (seen.has(tempId)) tempId = `q${i + 1}`;
    seen.add(tempId);

    let type: QuestionType = QUESTION_TYPES.includes(q.type as QuestionType)
      ? (q.type as QuestionType)
      : "single";

    const options = (Array.isArray(q.options) ? q.options : [])
      .map((o) =>
        typeof o === "string"
          ? o.trim()
          : String((o as { label?: unknown })?.label ?? "").trim(),
      )
      .filter(Boolean)
      .map((label) => ({ label }));

    // A choice type with no options is really free text.
    if (
      (type === "single" || type === "multi" || type === "boolean") &&
      options.length === 0
    ) {
      type = "text";
    }

    questions.push({
      tempId,
      section: String(q.section ?? "").trim(),
      text,
      type,
      options,
      parentTempId: q.parentTempId ? String(q.parentTempId) : null,
      parentOptionLabel: q.parentOptionLabel
        ? String(q.parentOptionLabel).trim()
        : null,
      required: q.required === true,
    });
  }

  // Prune branch links that point at a missing parent / non-existent option.
  const byId = new Map(questions.map((q) => [q.tempId, q]));
  for (const q of questions) {
    if (!q.parentTempId) {
      q.parentOptionLabel = null;
      continue;
    }
    const parent = byId.get(q.parentTempId);
    const optOk =
      parent &&
      q.parentOptionLabel &&
      parent.options.some(
        (o) => o.label.toLowerCase() === q.parentOptionLabel!.toLowerCase(),
      );
    if (!parent || !optOk) {
      q.parentTempId = null;
      q.parentOptionLabel = null;
    } else {
      // Normalise to the parent's exact option casing.
      q.parentOptionLabel =
        parent.options.find(
          (o) => o.label.toLowerCase() === q.parentOptionLabel!.toLowerCase(),
        )?.label ?? q.parentOptionLabel;
    }
  }

  return { title, questions };
}
