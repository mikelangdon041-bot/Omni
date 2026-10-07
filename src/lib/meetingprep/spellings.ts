// Spellings the user has corrected, remembered from one meeting to the next.
//
// Speech recognition is consistent in its mistakes: the system everybody logs
// into, a product name, a colleague's surname come back wrong in the same way
// every time. A replace inside one meeting fixes that meeting, and the next
// recording arrives with the same word wrong again. So a correction can be
// kept (mp_settings.spellings) and every set of notes written afterwards gets
// it twice over: the model is told the right spelling before it writes, which
// catches mishearings that are close but not identical, and the wrong form is
// replaced in whatever comes back, which catches the model ignoring it.
//
// Pure functions plus one loader that takes the caller's client, so the same
// file serves the API routes and the browser.

import type { SupabaseClient } from "@supabase/supabase-js";
import { applyNameMap, type NameMap } from "./rename";

export interface Spelling {
  wrong: string;
  right: string;
}

/** Longest phrase worth remembering; anything longer is a sentence, not a spelling. */
const MAX_LEN = 60;

/** How many are sent to the model. Past this it is a glossary, not a hint. */
const PROMPT_LIMIT = 80;

/**
 * Whether a replace is the kind of thing that is true in the next meeting too.
 * "Santan" to "Salesforce" is. "Speaker A" to "Dr. Chen" is a fact about one
 * recording, and "this was me" depends on who was in the room that day.
 */
export function canRemember(wrong: string, right: string): boolean {
  const w = wrong.trim();
  const r = right.trim();
  if (!w || !r || w === r) return false;
  if (w.length > MAX_LEN || r.length > MAX_LEN) return false;
  if (/^(i|me|my)$/i.test(r)) return false;
  if (/^speaker\s+\S+$/i.test(w)) return false;
  return true;
}

export function normalizeSpellings(raw: unknown): Spelling[] {
  if (!Array.isArray(raw)) return [];
  const out: Spelling[] = [];
  for (const item of raw) {
    const s = item as Partial<Spelling>;
    const wrong = String(s?.wrong || "").trim();
    const right = String(s?.right || "").trim();
    if (canRemember(wrong, right)) out.push({ wrong, right });
  }
  return out;
}

/**
 * Add one correction to the list. A second correction of the same word
 * replaces the first, and a chain collapses: having taught it "Santan" is
 * "Santen" and then "Santen" is "Salesforce", "Santan" now means "Salesforce"
 * as well, rather than turning into a word that was itself corrected.
 */
export function rememberSpelling(list: Spelling[], wrong: string, right: string): Spelling[] {
  const w = wrong.trim();
  const r = right.trim();
  if (!canRemember(w, r)) return list;
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const next = list
    .filter((s) => !same(s.wrong, w) && !same(s.wrong, r))
    .map((s) => (same(s.right, w) ? { ...s, right: r } : s))
    .filter((s) => !same(s.wrong, s.right));
  return [...next, { wrong: w, right: r }];
}

export function forgetSpelling(list: Spelling[], wrong: string): Spelling[] {
  return list.filter((s) => s.wrong.toLowerCase() !== wrong.trim().toLowerCase());
}

function asMap(list: Spelling[]): NameMap {
  const map: NameMap = {};
  for (const s of list) map[s.wrong] = s.right;
  return map;
}

/** Replace every remembered wrong form in a string (or, with html, between tags). */
export function applySpellings(text: string, list: Spelling[] | undefined, html = false): string {
  if (!list?.length || !text) return text;
  return applyNameMap(text, asMap(list), html);
}

/** The part of a system prompt that tells the writer what it has been corrected on. */
export function spellingPromptBlock(list: Spelling[] | undefined): string {
  if (!list?.length) return "";
  const lines = list
    .slice(-PROMPT_LIMIT)
    .map((s) => `- "${s.wrong}" is "${s.right}"`)
    .join("\n");
  return `WORDS THIS PERSON HAS CORRECTED BEFORE. Speech recognition got these wrong in earlier meetings and they fixed them by hand. Where the transcript has the wrong form, or an obvious mishearing of the same word, write the right one. Do not otherwise change what was said.
${lines}`;
}

/** The signed-in user's remembered spellings. An empty list on any failure. */
export async function loadSpellings(
  supabase: SupabaseClient,
  userId: string,
): Promise<Spelling[]> {
  const { data, error } = await supabase
    .from("mp_settings")
    .select("spellings")
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return [];
  return normalizeSpellings((data as { spellings?: unknown }).spellings);
}
