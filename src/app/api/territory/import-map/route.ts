import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { openai } from "@/lib/openai";
import { fieldGuideForPrompt, isValidField, IGNORE } from "@/lib/territory/profileFields";

export const runtime = "nodejs";
export const maxDuration = 60;

function buildColHeaders(maxCols: number): string {
  return Array.from({ length: maxCols }, (_, i) =>
    i < 26
      ? String.fromCharCode(65 + i)
      : `A${String.fromCharCode(65 + (i - 26))}`,
  ).join("\t");
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { sheetText, guidance } = await req.json().catch(() => ({}));
  if (!sheetText?.trim()) {
    return NextResponse.json({ error: "No data to analyze." }, { status: 400 });
  }

  const lines: string[] = sheetText.split("\n");
  const maxCols = Math.max(...lines.slice(0, 8).map((l) => l.split("\t").length), 0);
  const colHeaders = buildColHeaders(maxCols);
  const sampleRows = lines.slice(0, 15);
  const sample = [
    `ROW\t${colHeaders}`,
    ...sampleRows.map((line, i) => `${i}\t${line}`),
  ].join("\n");
  const guidanceBlock = guidance?.trim()
    ? `\n\nThe user added this guidance — let it OVERRIDE your defaults:\n${guidance}`
    : "";

  const systemPrompt = `You are setting up an import of key-contact (KOL) profiles into a field-medical territory app. You are given a sample of raw spreadsheet rows. The first line shows column letters; each following line starts with its 0-based row index, then the cell values (tab-separated).

Your job: (1) identify which row is the HEADER row, and (2) for EVERY column, decide which ONE profile field it best maps to. Compare each column against the FULL list of fields below — judge by BOTH the header text AND the actual cell values, and capture as much as possible (do not leave a clearly-useful column unmapped).

Available profile fields (choose exactly one key per column):
${fieldGuideForPrompt()}
- ${IGNORE}: the column has no useful profile data (row numbers, blank, internal codes) — only use this when nothing else fits.

Rules:
- Use "__name__" when a SINGLE column holds the whole name (e.g. "Smith, Jane" or "Jane Smith"). Use "first_name"/"last_name" only when the name is already split across two columns.
- For location: map a full/street address column to "address", and map separate city, state/region, and zip columns to "__city__", "__state__", and "__zip__" respectively — they all combine into one address. A row with only a city and state (no street) is fine and still forms a usable general location, so DO map those columns.
- NEVER silently drop a column that contains real data. Prefer a specific field; if no specific field fits but the column still holds useful information, map it to "notes" so the data is preserved.
- Use "${IGNORE}" ONLY for columns that are clearly not profile data — sequential row numbers, internal record IDs, or entirely empty columns. When in doubt, choose "notes", not "${IGNORE}".
- header_row is the 0-based index of the row containing the column titles (usually 0).${guidanceBlock}

Respond ONLY with JSON of this exact shape:
{
  "header_row": <number>,
  "summary": "<one short sentence describing what this data is and the main fields you found>",
  "columns": [
    { "index": <0-based column number>, "field": "<one field key from the list>", "reason": "<a few words: header and/or value evidence>" }
  ]
}
Include one entry in "columns" for every column present in the data.`;

  try {
    const completion = await openai().chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Column letters and sample rows:\n\n${sample}` },
      ],
      max_tokens: 2000,
      temperature: 0,
      seed: 42,
      response_format: { type: "json_object" },
    });

    let parsed: {
      header_row?: number;
      summary?: string;
      columns?: { index?: number; field?: string; reason?: string }[];
    } = {};
    try {
      parsed = JSON.parse(completion.choices[0]?.message?.content || "{}");
    } catch {
      parsed = {};
    }
    const headerRow =
      typeof parsed.header_row === "number" && parsed.header_row >= 0
        ? parsed.header_row
        : 0;
    const columns = (parsed.columns || [])
      .filter((c) => typeof c.index === "number")
      .map((c) => ({
        index: c.index as number,
        field: isValidField(c.field) ? (c.field as string) : "notes",
        reason: typeof c.reason === "string" ? c.reason : "",
      }));
    return NextResponse.json({ headerRow, summary: parsed.summary || "", columns });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 },
    );
  }
}
