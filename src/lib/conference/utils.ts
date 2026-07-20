// Timezone-correct date helpers for Conference Planning.
//
// Storage is UTC (timestamptz); every conference has a timezone, and all event
// times are created and displayed in the conference's timezone regardless of
// the device's location. Poster dates are free text and must never crash a
// parse (guard everything).

import type { Conference } from "./types";

const dtfCache = new Map<string, Intl.DateTimeFormat>();

function dtf(tz: string): Intl.DateTimeFormat {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    dtfCache.set(tz, f);
  }
  return f;
}

export interface TzParts {
  y: number;
  m: number; // 1-12
  d: number;
  hh: number;
  mm: number;
}

// Wall-clock parts of an instant in a timezone.
export function partsInTz(date: Date, tz: string): TzParts {
  const parts = dtf(tz).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value || 0);
  // "24" can appear for midnight in some environments.
  const hh = get("hour") % 24;
  return { y: get("year"), m: get("month"), d: get("day"), hh, mm: get("minute") };
}

// "YYYY-MM-DD" of an instant in a timezone (day bucketing).
export function dateKeyInTz(iso: string | Date, tz: string): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (isNaN(d.getTime())) return "";
  const p = partsInTz(d, tz);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

// Minutes since midnight of an instant, in a timezone (calendar positioning).
export function minutesInTz(iso: string | Date, tz: string): number {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (isNaN(d.getTime())) return 0;
  const p = partsInTz(d, tz);
  return p.hh * 60 + p.mm;
}

// Convert a conference-local wall time ("YYYY-MM-DD" + "HH:MM") to a UTC ISO
// string. Two-pass: guess the instant as if the wall time were UTC, measure
// the zone offset at that instant, correct, and re-verify (handles DST edges).
export function localToUtcISO(dateStr: string, timeStr: string, tz: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = timeStr.split(":").map(Number);
  const wallAsUtc = Date.UTC(y, m - 1, d, hh, mm, 0);

  const offsetAt = (t: number) => {
    const p = partsInTz(new Date(t), tz);
    const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, 0);
    return asUtc - t; // zone offset in ms at instant t
  };

  let guess = wallAsUtc - offsetAt(wallAsUtc);
  guess = wallAsUtc - offsetAt(guess);
  return new Date(guess).toISOString();
}

// "9:30 AM" in the conference timezone.
export function fmtTime(iso: string | Date, tz: string): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

// "HH:MM" (24h) for time inputs, in the conference timezone.
export function timeInputValue(iso: string, tz: string): string {
  const p = partsInTz(new Date(iso), tz);
  return `${String(p.hh).padStart(2, "0")}:${String(p.mm).padStart(2, "0")}`;
}

// "Wed, Jun 12" from a YYYY-MM-DD key (no timezone math — it's already local).
export function fmtDayKey(key: string, opts?: { weekday?: boolean; year?: boolean }): string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(key)) return key;
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return new Intl.DateTimeFormat("en-US", {
    weekday: opts?.weekday === false ? undefined : "short",
    month: "short",
    day: "numeric",
    year: opts?.year ? "numeric" : undefined,
  }).format(date);
}

export function fmtDayKeyLong(key: string): string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(key)) return key;
  const [y, m, d] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(y, m - 1, d));
}

// All day keys from start to end inclusive (plain date strings, no tz math).
export function listDays(startDate: string, endDate: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}/.test(startDate) || !/^\d{4}-\d{2}-\d{2}/.test(endDate))
    return [];
  const out: string[] = [];
  const [sy, sm, sd] = startDate.split("-").map(Number);
  const [ey, em, ed] = endDate.split("-").map(Number);
  const cur = new Date(Date.UTC(sy, sm - 1, sd));
  const end = new Date(Date.UTC(ey, em - 1, ed));
  let guard = 0;
  while (cur.getTime() <= end.getTime() && guard++ < 60) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

export function addDaysKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

// Today's day key in the conference timezone.
export function todayKey(tz: string): string {
  return dateKeyInTz(new Date(), tz);
}

// Is the conference live right now (today within start..end in its tz)?
export function conferenceStatus(c: Conference): "upcoming" | "live" | "past" {
  const today = todayKey(c.timezone);
  if (today < c.start_date) return "upcoming";
  if (today > c.end_date) return "past";
  return "live";
}

export function daysAway(c: Conference): number {
  const today = todayKey(c.timezone);
  const [ty, tm, td] = today.split("-").map(Number);
  const [sy, sm, sd] = c.start_date.split("-").map(Number);
  return Math.round(
    (Date.UTC(sy, sm - 1, sd) - Date.UTC(ty, tm - 1, td)) / 86400000,
  );
}

export function fmtDateRange(c: Conference): string {
  const s = fmtDayKey(c.start_date, { weekday: false });
  const e = fmtDayKey(c.end_date, { weekday: false, year: true });
  return `${s} – ${e}`;
}

// ------------------------------------------------------------------
// Free-text poster dates — defensive parsing (spec §18.2).
// May look like "April 22, WEDNESDAY", "APRIL 22", "2026-04-22", or garbage.
// Never throw; return null when unparseable.
// ------------------------------------------------------------------
const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

export function normalizeFreeDate(raw: string, confYear: number): string | null {
  const text = (raw || "").trim();
  if (!text) return null;
  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return isoMatch[0];

  const lower = text.toLowerCase();
  const mIdx = MONTHS.findIndex((m) => lower.includes(m));
  if (mIdx >= 0) {
    const dayMatch = lower.match(/(\d{1,2})/);
    if (dayMatch) {
      const day = Number(dayMatch[1]);
      if (day >= 1 && day <= 31) {
        const yearMatch = lower.match(/\b(20\d{2})\b/);
        const year = yearMatch ? Number(yearMatch[1]) : confYear;
        return `${year}-${String(mIdx + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      }
    }
  }
  // "4/22" or "4/22/2026"
  const slash = lower.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (slash) {
    const m = Number(slash[1]);
    const d = Number(slash[2]);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      let y = slash[3] ? Number(slash[3]) : confYear;
      if (y < 100) y += 2000;
      return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }
  return null;
}

// Parse a free-text poster time like "10:30 AM" → minutes since midnight.
export function parseFreeTime(raw: string): number | null {
  const m = (raw || "").trim().match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!m) return null;
  let hh = Number(m[1]);
  const mm = m[2] ? Number(m[2]) : 0;
  const ap = m[3]?.toLowerCase();
  if (hh > 24 || mm > 59) return null;
  if (ap === "pm" && hh < 12) hh += 12;
  if (ap === "am" && hh === 12) hh = 0;
  if (hh >= 24) return null;
  return hh * 60 + mm;
}

// ------------------------------------------------------------------
// Misc
// ------------------------------------------------------------------
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase())
    .slice(0, 2)
    .join("");
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function firstName(name: string): string {
  return (name || "").trim().split(/\s+/)[0] || "";
}

// Strip HTML to plain text (for search haystacks and AI payloads).
export function stripHtml(html: string): string {
  return (html || "")
    .replace(/<li[^>]*>/gi, "\n• ") // bullet, not a dash
    .replace(/<\/(p|div|ul|ol|h\d)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Like stripHtml, but preserves list nesting as indented bullets (•, then ◦
// one level down) instead of flattening every <li> to the same depth. Used
// for plain-text emails built from AI summaries, which nest sub-points under
// themes. Indentation uses non-breaking spaces — most email clients collapse
// runs of regular spaces, which silently un-indents plain-text mail.
export function nestedHtmlToPlainText(html: string): string {
  let s = html || "";
  const NBSP = "  ";
  // Flatten innermost lists (no <ul>/<ol> inside) first, as sub-bullets, and
  // repeat outward so any nesting depth collapses to "top bullet / sub bullet".
  const innerListRe = /<(ul|ol)[^>]*>((?:(?!<ul\b|<ol\b)[\s\S])*?)<\/\1>/gi;
  let prev: string;
  do {
    prev = s;
    s = s.replace(innerListRe, (_m, _tag, inner: string) => {
      const items = inner.split(/<li[^>]*>/gi).slice(1);
      return (
        "\n" +
        items
          .map((it) => `${NBSP}◦ ${it.replace(/<\/li>/gi, "").trim()}`)
          .join("\n")
      );
    });
  } while (s !== prev && /<(ul|ol)[^>]*>/i.test(s));
  // Anything left is a top-level <li> (no surviving nested markers above it).
  s = s.replace(/<li[^>]*>/gi, "\n• ").replace(/<\/li>/gi, "");
  return stripHtml(s);
}

// AI daily/meeting summaries generated before the AI started replying in
// HTML were stored as plain text with "- "/"  - " dash bullets. Handed
// straight to a contentEditable div's innerHTML, that text's newlines
// collapse (HTML ignores bare whitespace) into one run-on paragraph — so
// legacy content needs converting to real markup first. Nesting is inferred
// from each dash line's leading indent (2 spaces = one level down).
export function legacyPlainToHtml(text: string): string {
  if (!text?.trim()) return "";
  if (/<[a-z][\s\S]*>/i.test(text)) return text; // already HTML — leave it alone

  const out: string[] = [];
  let openLists = 0; // how many <ul> are currently open
  for (const raw of text.split("\n")) {
    const m = /^(\s*)[-•◦]\s+(.*)$/.exec(raw);
    if (!m) {
      if (!raw.trim()) continue;
      while (openLists > 0) { out.push("</ul>"); openLists--; }
      out.push(`<p>${raw.trim()}</p>`);
      continue;
    }
    const depth = Math.min(1, Math.floor(m[1].length / 2)); // one nested level, matches the AI prompt's shape
    while (openLists <= depth) { out.push("<ul>"); openLists++; }
    while (openLists > depth + 1) { out.push("</ul>"); openLists--; }
    out.push(`<li>${m[2]}</li>`);
  }
  while (openLists > 0) { out.push("</ul>"); openLists--; }
  return out.join("");
}

// Platform maps link for a location string.
export function mapsUrl(query: string): string {
  const q = encodeURIComponent(query);
  if (typeof navigator !== "undefined" && /iPhone|iPad|Macintosh/.test(navigator.userAgent)) {
    return `https://maps.apple.com/?q=${q}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}
