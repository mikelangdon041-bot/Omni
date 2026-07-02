// iCalendar export for schedule events.
//
// Times are emitted as UTC instants ("...Z"), which every calendar client
// renders unambiguously in the viewer's own timezone — the storage is already
// UTC, so no local-time/VTIMEZONE ambiguity can creep in. Each VEVENT carries
// a 15-minute display alarm.

import type { ConfEvent, Conference } from "./types";
import { EVENT_TYPES } from "./types";

function icsStamp(iso: string): string {
  const d = new Date(iso);
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function escapeText(s: string): string {
  return (s || "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

// RFC 5545 lines fold at 75 octets.
function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 73) {
    out.push(rest.slice(0, 73));
    rest = " " + rest.slice(73);
  }
  out.push(rest);
  return out.join("\r\n");
}

function vevent(ev: ConfEvent, conf: Conference): string {
  const title =
    ev.event_type === "booth" ? `Booth — ${ev.title}` : ev.title;
  const lines = [
    "BEGIN:VEVENT",
    `UID:omni-conf-${ev.id}@omni.app`,
    `DTSTAMP:${icsStamp(new Date().toISOString())}`,
    `DTSTART:${icsStamp(ev.starts_at)}`,
    `DTEND:${icsStamp(ev.ends_at)}`,
    fold(`SUMMARY:${escapeText(title)}`),
    ev.location ? fold(`LOCATION:${escapeText(ev.location)}`) : "",
    fold(
      `DESCRIPTION:${escapeText(
        [EVENT_TYPES[ev.event_type]?.label, conf.name, ev.description]
          .filter(Boolean)
          .join(" · "),
      )}`,
    ),
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    fold(`DESCRIPTION:${escapeText(title)}`),
    "TRIGGER:-PT15M",
    "END:VALARM",
    "END:VEVENT",
  ];
  return lines.filter(Boolean).join("\r\n");
}

export function buildICS(events: ConfEvent[], conf: Conference): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Omni//Conference Planning//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    fold(`X-WR-CALNAME:${escapeText(conf.name)}`),
    fold(`X-WR-TIMEZONE:${conf.timezone}`),
    ...events.map((e) => vevent(e, conf)),
    "END:VCALENDAR",
  ].join("\r\n");
}

// Trigger a download of an .ics file. iOS Safari doesn't fire blob downloads,
// so open a data URI there instead.
export function downloadICS(filename: string, ics: string): void {
  const isIOS =
    typeof navigator !== "undefined" &&
    /iPhone|iPad|iPod/.test(navigator.userAgent);
  if (isIOS) {
    window.open(`data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`);
    return;
  }
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".ics") ? filename : `${filename}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// "Add to Google Calendar" link for one event.
export function googleCalendarUrl(ev: ConfEvent, conf: Conference): string {
  const fmt = (iso: string) => icsStamp(iso);
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: ev.title,
    dates: `${fmt(ev.starts_at)}/${fmt(ev.ends_at)}`,
    details: [EVENT_TYPES[ev.event_type]?.label, conf.name, ev.description]
      .filter(Boolean)
      .join(" · "),
    location: ev.location || "",
    ctz: conf.timezone,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
