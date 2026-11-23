// Wall-clock time in a named zone, without a date library.
//
// Graph is asked for everything in UTC and the formatting happens here, so an
// IANA zone ("America/New_York") works everywhere without relying on Graph's
// patchy support for IANA names in Prefer headers.

import { ToolError } from "./errors";

export function defaultTimeZone(): string {
  return process.env.MCP_DEFAULT_TIMEZONE || "America/New_York";
}

export function checkTimeZone(tz: string | undefined): string {
  const zone = (tz || "").trim() || defaultTimeZone();
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
  } catch {
    throw new ToolError(`Unknown time zone "${zone}". Use an IANA name such as America/New_York.`);
  }
  return zone;
}

function offsetMs(utcMs: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute"), g("second"));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

function wallToUtc(y: number, mo: number, d: number, h: number, mi: number, s: number, tz: string): Date {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const off1 = offsetMs(guess, tz);
  let t = guess - off1;
  const off2 = offsetMs(t, tz);
  if (off2 !== off1) t = guess - off2;
  return new Date(t);
}

/**
 * ISO 8601 in, an instant out. A bare date is midnight in `tz` (or the next
 * midnight when `endOfDay`, so "end: 2026-11-24" covers the whole 24th). A
 * date-time without an offset is wall-clock time in `tz`.
 */
export function parseWhen(input: string, tz: string, endOfDay = false): Date {
  const s = (input || "").trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const d = wallToUtc(+m[1], +m[2], +m[3], 0, 0, 0, tz);
    return endOfDay ? wallToUtc(+m[1], +m[2], +m[3] + 1, 0, 0, 0, tz) : d;
  }
  if (/(Z|[+-]\d{2}:?\d{2})$/i.test(s)) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d;
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/);
  if (m) return wallToUtc(+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] || 0), tz);
  throw new ToolError(`"${input}" is not a date. Use ISO 8601, e.g. 2026-11-24 or 2026-11-24T09:30.`);
}

/** "2026-11-24T09:30:00" in tz, the shape Graph wants beside a timeZone. */
export function toWall(d: Date, tz: string): string {
  const shifted = new Date(d.getTime() + offsetMs(d.getTime(), tz));
  return shifted.toISOString().slice(0, 19);
}

export function fmtDateTime(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

export function fmtDay(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" }).format(d);
}

export function fmtTime(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(d);
}

/** Graph timestamps in UTC come back without a Z ("2026-11-24T14:00:00.0000000"). */
export function graphUtc(s: string): Date {
  return new Date(/[zZ]|[+-]\d{2}:\d{2}$/.test(s) ? s : `${s}Z`);
}

/**
 * Windows names for the zones people here actually use. Events made in their
 * own zone show that zone in Outlook's editor; anything unmapped is written in
 * UTC, which is still the right instant for every attendee.
 */
const WINDOWS_ZONES: Record<string, string> = {
  "America/New_York": "Eastern Standard Time",
  "America/Detroit": "Eastern Standard Time",
  "America/Chicago": "Central Standard Time",
  "America/Denver": "Mountain Standard Time",
  "America/Phoenix": "US Mountain Standard Time",
  "America/Los_Angeles": "Pacific Standard Time",
  "America/Anchorage": "Alaskan Standard Time",
  "Pacific/Honolulu": "Hawaiian Standard Time",
  "America/Toronto": "Eastern Standard Time",
  "Europe/London": "GMT Standard Time",
  "Europe/Dublin": "GMT Standard Time",
  "Europe/Rome": "W. Europe Standard Time",
  "Europe/Berlin": "W. Europe Standard Time",
  "Europe/Amsterdam": "W. Europe Standard Time",
  "Europe/Zurich": "W. Europe Standard Time",
  "Europe/Paris": "Romance Standard Time",
  "Europe/Madrid": "Romance Standard Time",
  "Europe/Brussels": "Romance Standard Time",
  UTC: "UTC",
  "Etc/UTC": "UTC",
};

export function graphZone(d: Date, tz: string): { dateTime: string; timeZone: string } {
  const win = WINDOWS_ZONES[tz];
  if (win) return { dateTime: toWall(d, tz), timeZone: win };
  return { dateTime: d.toISOString().slice(0, 19), timeZone: "UTC" };
}
