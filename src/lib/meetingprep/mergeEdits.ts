// Combining this tab's unsaved edits with a newer copy of the meeting.
//
// The page saves whole columns: a tick in Ask mode writes the entire question
// list back. When something else changed the meeting after this tab loaded it
// (the chat, another tab, a fix made outside the app), that save put the
// tab's older copy over the newer one. Questions reworded elsewhere came back
// with their old words, and a panelist who had dropped out came back into
// the tips.
//
// So a save that finds the meeting has moved on is merged, three ways, against
// the copy the tab started from: what the tab changed wins, and everything it
// did not touch takes the newer version.

import type { MpMeeting } from "./types";

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

type Bag = Record<string, unknown>;
type Item = Bag & { id?: string };

/** The question list, one question at a time. */
function mergeQuestions(local: Bag, base: Bag | undefined, server: Bag | undefined): Bag {
  if (!server) return local;
  const out: Bag = { ...server };
  // Settings on the list itself: theirs where they changed them.
  for (const k of Object.keys(local)) {
    if (k === "items") continue;
    if (!base || !same(local[k], base[k])) out[k] = local[k];
  }
  const L = (Array.isArray(local.items) ? local.items : []) as Item[];
  const B = new Map(((Array.isArray(base?.items) ? base!.items : []) as Item[]).map((q) => [q.id, q]));
  const S = new Map(((Array.isArray(server.items) ? server.items : []) as Item[]).map((q) => [q.id, q]));
  const items: Item[] = [];
  const seen = new Set<unknown>();
  for (const q of L) {
    seen.add(q.id);
    const b = B.get(q.id);
    const s = S.get(q.id);
    // Untouched here and changed there: the newer one.
    items.push(b && s && same(q, b) ? s : q);
  }
  // Added elsewhere since this tab loaded.
  for (const [sid, s] of S) if (!seen.has(sid) && !B.has(sid)) items.push(s);
  out.items = items;
  return out;
}

/**
 * The edits to send, given the copy they were made against and the copy on
 * the server now. Columns the tab did not change are not sent at all.
 */
export function mergeEdits(pending: Partial<MpMeeting>, base: MpMeeting, server: MpMeeting): Partial<MpMeeting> {
  const out: Bag = {};
  for (const [k, v] of Object.entries(pending)) {
    if (k === "questions" && v && typeof v === "object") {
      out[k] = mergeQuestions(v as Bag, (base as unknown as Bag)[k] as Bag, (server as unknown as Bag)[k] as Bag);
    } else {
      out[k] = v;
    }
  }
  return out as Partial<MpMeeting>;
}
