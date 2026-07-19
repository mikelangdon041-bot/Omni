// AI for the dashboard chat: translate a free-text "can we visualize X from
// app Y" request into a strict, validated ChartSpec against the real catalog.
// Mirrors the Insights workbench's nlToAnalysisSpec/coerceSpec pattern.

import { openai } from "@/lib/openai";
import { DASHBOARD_DATASETS, catalogText, getDataset } from "./catalog";
import { defaultChartSpec, type ChartSpec, type ChartType } from "./types";

const MODEL = process.env.OPENAI_SUMMARY_MODEL || "gpt-4o";

const SPEC_SHAPE = `ChartSpec JSON shape:
{
  "datasetId": "<one id from the catalog>",
  "groupBy": "<one dimension key from that dataset>",
  "measure": "<one measure key from that dataset — '*' means count of rows>",
  "chartType": "bar" | "stackedBar" | "line" | "pie" | "donut",
  "title": "<short human title>",
  "explanation": "<one plain-English sentence describing what you're about to show, so the user can confirm before it's built>"
}
Rules:
- datasetId MUST be one of the catalog ids. Pick the one whose app/description best matches what the user asked about.
- groupBy MUST be one of that dataset's dimension keys.
- measure MUST be one of that dataset's measure keys.
- Prefer "pie"/"donut" for a single simple distribution, "bar" for comparing categories, "line" only if the dimension is naturally sequential (rare in this catalog — default to "bar").
- If the request doesn't clearly match any dataset, still return your best guess but say so plainly in "explanation".`;

export interface ProposedChart {
  spec: ChartSpec;
  explanation: string;
}

export async function proposeChartSpec(prompt: string): Promise<ProposedChart> {
  const system = `You convert a plain-English request into a strict ChartSpec JSON for a cross-app analytics dashboard. Return ONLY the JSON object, no prose.

Available datasets (one per app):
${catalogText()}

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
  return coerce(parsed);
}

function safeParse(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

const CHART_TYPES: ChartType[] = ["bar", "stackedBar", "line", "pie", "donut"];

function coerce(raw: Record<string, unknown>): ProposedChart {
  const dataset = getDataset(String(raw.datasetId || "")) || DASHBOARD_DATASETS[0];
  const spec = defaultChartSpec(dataset.id);

  const dim = dataset.dimensions.find((d) => d.key === raw.groupBy);
  spec.groupBy = dim?.key || dataset.dimensions[0]?.key || "";

  const measure = dataset.measures.find((m) => m.key === raw.measure);
  spec.measure = measure?.key || dataset.measures[0]?.key || "*";

  spec.chartType = CHART_TYPES.includes(raw.chartType as ChartType)
    ? (raw.chartType as ChartType)
    : "bar";

  spec.title = typeof raw.title === "string" && raw.title.trim() ? raw.title.trim() : `${dataset.label} by ${dim?.label || "group"}`;

  const explanation =
    typeof raw.explanation === "string" && raw.explanation.trim()
      ? raw.explanation.trim()
      : `A ${spec.chartType} chart of ${dataset.label.toLowerCase()} from ${dataset.moduleLabel}, grouped by ${dim?.label || "group"}.`;

  return { spec, explanation };
}
