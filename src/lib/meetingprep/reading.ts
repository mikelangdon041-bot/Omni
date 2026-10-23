// The reading list, as the rest of Meeting Prep sees it.

import { setupFingerprint, type MpMeeting, type ReadingSource } from "./types";
import { housesLine, sourceNames } from "./spokenSources";

/**
 * The research a question is written from, with the reading list added.
 *
 * So that the source note under a question names a piece the writer can see
 * and open on the Reading tab, rather than one that only existed in notes
 * they never get shown. A list built for a subject the meeting has since
 * left is not backing for anything, the same rule the research follows.
 */
export function withReading(research: string, m: MpMeeting): string {
  const r = m.reading;
  if (!r?.at || r.fingerprint !== setupFingerprint(m)) return research;
  const found = (r.sources || []).filter((s) => s.kind === "found");
  const list = found
    .map(
      (s) =>
        `- ${s.title} (${[s.outlet, s.date].filter(Boolean).join(", ")}): ${s.findings.join("; ")}`,
    )
    .join("\n");
  // The overview and the open arguments are the background a question is
  // set up with, so they travel with the sources rather than staying on the
  // Reading tab.
  const unsettled = (r.unsettled || [])
    .map((u) => `- ${u.point}\n${u.sides.map((x) => `    ${x.position} (${x.who})`).join("\n")}`)
    .join("\n");
  return [
    research,
    r.overview && `The subject in brief, from the writer's reading:\n${r.overview}`,
    unsettled && `What is unsettled about it:\n${unsettled}`,
    (r.agreed || []).length > 0 &&
      `What the sources broadly agree on:\n${(r.agreed || []).map((a) => `- ${a.point} (${a.who})`).join("\n")}`,
    list && `On the writer's reading list (cite these by outlet and year where they back a question):\n${list}`,
    // Read back by the name check on everything said aloud, as well as by
    // the model: see housesIn.
    housesLine(sourceNames((r.sources || []).map((s) => s.outlet))),
  ]
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

const GENERIC = new Set(["the", "and", "of", "for", "in", "on", "a", "an", "journal", "report", "review", "news", "inc", "llc"]);

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !GENERIC.has(w));

/**
 * Which reading-list piece a source note is talking about, if any. A note
 * reads like "McKinsey, 2025: 62% of ...", so the outlet is the strongest
 * signal; the title's distinctive words are the fallback.
 */
export function matchSource(note: string, sources: ReadingSource[]): ReadingSource | null {
  if (!note.trim() || !sources.length) return null;
  const n = ` ${note.toLowerCase().replace(/[^a-z0-9 ]+/g, " ")} `;
  for (const s of sources) {
    const o = words(s.outlet).join(" ");
    if (o.length >= 3 && n.includes(` ${o} `)) return s;
  }
  let best: ReadingSource | null = null;
  let bestHits = 0;
  for (const s of sources) {
    const t = words(s.title);
    const hits = t.filter((w) => n.includes(` ${w} `)).length;
    if (t.length && hits >= Math.min(3, t.length) && hits > bestHits) {
      best = s;
      bestHits = hits;
    }
  }
  return best;
}
