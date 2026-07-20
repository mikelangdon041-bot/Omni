// Shared spreadsheet-reading helpers — the same read-file + sheet-to-rows
// pipeline the Territory import modal already used, factored out so any
// other importer (e.g. the Dashboard's) doesn't re-implement it.

import * as XLSX from "xlsx";

export async function readWorkbookFile(file: File): Promise<XLSX.WorkBook> {
  const buf = await file.arrayBuffer();
  return XLSX.read(new Uint8Array(buf), { type: "array" });
}

// A sheet as trimmed string rows (header:1 = raw arrays, not object-keyed),
// with fully-blank rows dropped.
export function sheetToRows(book: XLSX.WorkBook, sheetName: string): string[][] {
  const sheet = book.Sheets[sheetName];
  const raw = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: "" });
  return raw
    .map((row) => row.map((c) => String(c ?? "")))
    .filter((row) => row.some((c) => c.trim()));
}
