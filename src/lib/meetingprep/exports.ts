"use client";

// Meeting Prep exports: the brief as a Word document, and an Outlook-ready
// .ics meeting invite carrying the agenda.

import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { saveBlob } from "@/lib/conference/exports";
import { htmlToPlain } from "@/lib/writer/types";
import { meetingTypeLabel, type BriefSection, type MpMeeting } from "./types";

// HTML section content → docx paragraphs: bullets become real bullets,
// everything else becomes plain paragraphs.
function sectionParagraphs(html: string): Paragraph[] {
  const out: Paragraph[] = [];
  // Split list items out first so they keep bullet formatting.
  const withMarkers = html
    .replace(/<li[^>]*>/gi, "\n@@LI@@")
    .replace(/<\/(p|div|ul|ol|li|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n");
  for (const raw of withMarkers.split("\n")) {
    const isBullet = raw.includes("@@LI@@");
    const text = htmlToPlain(raw.replace(/@@LI@@/g, ""));
    if (!text) continue;
    out.push(
      isBullet
        ? new Paragraph({ text, bullet: { level: 0 } })
        : new Paragraph({ text, spacing: { after: 80 } }),
    );
  }
  return out;
}

export async function exportBriefDocx(m: MpMeeting): Promise<void> {
  const sections: BriefSection[] = m.brief?.sections || [];
  const when = m.date
    ? new Date(m.date).toLocaleString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "";

  const children: Paragraph[] = [
    new Paragraph({ text: m.title || "Meeting brief", heading: HeadingLevel.TITLE }),
    new Paragraph({
      children: [
        new TextRun({
          text: [meetingTypeLabel(m.meeting_type), when, m.location]
            .filter(Boolean)
            .join(" · "),
          italics: true,
          color: "666666",
        }),
      ],
      spacing: { after: 200 },
    }),
  ];

  const attendees = (m.attendees || []).filter((a) => a.name.trim());
  if (attendees.length) {
    children.push(
      new Paragraph({ text: "Attendees", heading: HeadingLevel.HEADING_1 }),
    );
    for (const a of attendees) {
      children.push(
        new Paragraph({
          text: [a.name, a.role, a.org].filter(Boolean).join(" — "),
          bullet: { level: 0 },
        }),
      );
    }
  }

  for (const s of sections) {
    children.push(
      new Paragraph({
        text: s.title,
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 280 },
      }),
    );
    children.push(...sectionParagraphs(s.content));
  }

  const doc = new Document({ sections: [{ children }] });
  saveBlob(
    await Packer.toBlob(doc),
    `${(m.title || "meeting-brief").replace(/[^\w\- ]+/g, "").trim() || "meeting-brief"}.docx`,
  );
}

// ------------------------------------------------------------------ ICS
function icsStamp(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function escapeText(s: string): string {
  return (s || "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

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

// Download an .ics for this meeting — opening it in Outlook creates the
// invite with the agenda in the body.
export function downloadMeetingInvite(m: MpMeeting): void {
  if (!m.date) return;
  const start = new Date(m.date);
  const end = new Date(start.getTime() + (m.duration_min || 30) * 60000);
  const agenda = (m.brief?.sections || []).find((s) => s.key === "agenda");
  const description = [
    meetingTypeLabel(m.meeting_type),
    agenda ? `Agenda:\n${htmlToPlain(agenda.content)}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Omni//Meeting Prep//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:omni-mp-${m.id}@omni.app`,
    `DTSTAMP:${icsStamp(new Date().toISOString())}`,
    `DTSTART:${icsStamp(start.toISOString())}`,
    `DTEND:${icsStamp(end.toISOString())}`,
    fold(`SUMMARY:${escapeText(m.title || "Meeting")}`),
    m.location ? fold(`LOCATION:${escapeText(m.location)}`) : "",
    fold(`DESCRIPTION:${escapeText(description)}`),
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    fold(`DESCRIPTION:${escapeText(m.title || "Meeting")}`),
    "TRIGGER:-PT30M",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ]
    .filter(Boolean)
    .join("\r\n");

  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(m.title || "meeting").replace(/[^\w\- ]+/g, "").trim() || "meeting"}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
