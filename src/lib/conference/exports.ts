"use client";

// Client-side document exports (spec §16): insights → XLSX / DOCX / PDF,
// per-KOL DOCX profile, all-photos ZIP, and Outlook meeting-request ICS.

import * as XLSX from "xlsx";
import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from "docx";
import { jsPDF } from "jspdf";
import JSZip from "jszip";
import type {
  ConfEvent,
  Conference,
  Contact,
  ContactMeeting,
  Insight,
} from "./types";
import { resolvePriority, PRIORITIES } from "./types";
import { fmtDayKeyLong, stripHtml } from "./utils";

export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export interface InsightRowCtx {
  dayOf: (i: Insight) => string;
  childrenOf: (parentId: string) => Insight[];
  nameOf: (userId: string | null) => string;
}

function priorityLabel(i: Insight): string {
  const r = resolvePriority(i.suspected_priority, i.confirmed_priority);
  return r ? PRIORITIES[r].label : "";
}

// ---------------------------------------------------------------- XLSX
export function exportInsightsXlsx(
  insights: Insight[],
  ctx: InsightRowCtx,
  filename: string,
): void {
  const rows = insights.map((i) => ({
    Day: ctx.dayOf(i),
    Insight: i.title,
    Details: ctx.childrenOf(i.id).map((c) => `• ${c.title}`).join("\n"),
    Notes: stripHtml(i.notes),
    Source: i.source_type,
    "Captured by": ctx.nameOf(i.user_id),
    Priority: priorityLabel(i),
    Categories: [...new Set([i, ...ctx.childrenOf(i.id)].flatMap((x) => x.categories))].join(", "),
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = [
    { wch: 11 }, { wch: 60 }, { wch: 70 }, { wch: 40 },
    { wch: 22 }, { wch: 18 }, { wch: 10 }, { wch: 30 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Insights");
  XLSX.writeFile(wb, filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`);
}

// ---------------------------------------------------------------- DOCX
export async function exportInsightsDocx(
  insights: Insight[],
  ctx: InsightRowCtx,
  title: string,
  filename: string,
): Promise<void> {
  const byDay = new Map<string, Insight[]>();
  for (const i of insights) {
    const d = ctx.dayOf(i) || "No date";
    byDay.set(d, [...(byDay.get(d) || []), i]);
  }
  const children: Paragraph[] = [
    new Paragraph({ text: title, heading: HeadingLevel.TITLE }),
  ];
  for (const [day, list] of [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    children.push(
      new Paragraph({
        text: day === "No date" ? day : fmtDayKeyLong(day),
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 300 },
      }),
    );
    for (const i of list) {
      const meta = [i.source_type, ctx.nameOf(i.user_id), priorityLabel(i)]
        .filter(Boolean)
        .join(" · ");
      children.push(
        new Paragraph({
          spacing: { before: 160 },
          children: [new TextRun({ text: i.title, bold: true })],
        }),
      );
      if (meta) {
        children.push(
          new Paragraph({
            children: [new TextRun({ text: meta, italics: true, size: 18, color: "666666" })],
          }),
        );
      }
      const notes = stripHtml(i.notes);
      if (notes) children.push(new Paragraph({ text: notes }));
      for (const c of ctx.childrenOf(i.id)) {
        children.push(new Paragraph({ text: c.title, bullet: { level: 0 } }));
      }
    }
  }
  const doc = new Document({ sections: [{ children }] });
  saveBlob(await Packer.toBlob(doc), filename.endsWith(".docx") ? filename : `${filename}.docx`);
}

// ---------------------------------------------------------------- PDF
export function exportInsightsPdf(
  insights: Insight[],
  ctx: InsightRowCtx,
  title: string,
  filename: string,
): void {
  const pdf = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 48;
  let y = margin;

  const write = (text: string, size: number, opts?: { bold?: boolean; indent?: number; gap?: number }) => {
    pdf.setFontSize(size);
    pdf.setFont("helvetica", opts?.bold ? "bold" : "normal");
    const indent = opts?.indent || 0;
    const lines = pdf.splitTextToSize(text, pageW - margin * 2 - indent);
    for (const line of lines) {
      if (y > pageH - margin) {
        pdf.addPage();
        y = margin;
      }
      pdf.text(line, margin + indent, y);
      y += size * 1.35;
    }
    y += opts?.gap || 0;
  };

  write(title, 16, { bold: true, gap: 8 });
  const byDay = new Map<string, Insight[]>();
  for (const i of insights) {
    const d = ctx.dayOf(i) || "No date";
    byDay.set(d, [...(byDay.get(d) || []), i]);
  }
  for (const [day, list] of [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    write(day === "No date" ? day : fmtDayKeyLong(day), 13, { bold: true, gap: 4 });
    for (const i of list) {
      write(i.title, 11, { bold: true });
      const meta = [i.source_type, ctx.nameOf(i.user_id), priorityLabel(i)]
        .filter(Boolean)
        .join(" · ");
      if (meta) write(meta, 9, { indent: 8 });
      const notes = stripHtml(i.notes);
      if (notes) write(notes, 10, { indent: 8 });
      for (const c of ctx.childrenOf(i.id)) write(`• ${c.title}`, 10, { indent: 16 });
      y += 6;
    }
    y += 6;
  }
  pdf.save(filename.endsWith(".pdf") ? filename : `${filename}.pdf`);
}

// ---------------------------------------------------------------- KOL DOCX
export async function exportKolDocx(
  contact: Contact,
  meetings: ContactMeeting[],
  insights: Insight[],
  childrenOf: (id: string) => Insight[],
): Promise<void> {
  const children: Paragraph[] = [
    new Paragraph({ text: contact.name, heading: HeadingLevel.TITLE }),
  ];
  const line = (label: string, value: string) => {
    if (!value) return;
    children.push(
      new Paragraph({
        children: [
          new TextRun({ text: `${label}: `, bold: true }),
          new TextRun({ text: value }),
        ],
      }),
    );
  };
  line("Tier", contact.tier);
  line("Title", contact.title);
  line("Institution", contact.institution);
  line("Email", contact.email);
  line("Phone", contact.phone);
  line("Interests", contact.interests.join(", "));
  for (const [k, v] of Object.entries(contact.custom_fields || {})) line(k, v);

  const section = (heading: string, html: string) => {
    if (!html?.trim()) return;
    children.push(
      new Paragraph({ text: heading, heading: HeadingLevel.HEADING_1, spacing: { before: 300 } }),
    );
    for (const para of stripHtml(html).split(/\n+/).filter(Boolean)) {
      children.push(
        para.startsWith("- ")
          ? new Paragraph({ text: para.slice(2), bullet: { level: 0 } })
          : new Paragraph({ text: para }),
      );
    }
  };
  section("Background", contact.background);
  section("Engagement activities", contact.engagement_activities);
  section("Meeting objectives", contact.meeting_objectives);
  section("AI meeting summary", contact.ai_summary);

  if (meetings.length) {
    children.push(
      new Paragraph({ text: "Meetings", heading: HeadingLevel.HEADING_1, spacing: { before: 300 } }),
    );
    for (const m of meetings) {
      children.push(
        new Paragraph({
          spacing: { before: 160 },
          children: [
            new TextRun({
              text: [fmtDayKeyLong(m.meeting_date), m.meeting_time, m.location]
                .filter(Boolean)
                .join(" · "),
              bold: true,
            }),
          ],
        }),
      );
      for (const para of stripHtml(m.notes).split(/\n+/).filter(Boolean)) {
        children.push(
          para.startsWith("- ")
            ? new Paragraph({ text: para.slice(2), bullet: { level: 0 } })
            : new Paragraph({ text: para }),
        );
      }
    }
  }

  if (insights.length) {
    children.push(
      new Paragraph({ text: "Field insights", heading: HeadingLevel.HEADING_1, spacing: { before: 300 } }),
    );
    for (const i of insights) {
      children.push(
        new Paragraph({
          spacing: { before: 120 },
          children: [new TextRun({ text: i.title, bold: true })],
        }),
      );
      for (const c of childrenOf(i.id)) {
        children.push(new Paragraph({ text: c.title, bullet: { level: 0 } }));
      }
    }
  }

  const doc = new Document({ sections: [{ children }] });
  saveBlob(await Packer.toBlob(doc), `${contact.name}.docx`);
}

// ---------------------------------------------------------------- Photos ZIP
export async function exportPhotosZip(
  urls: { url: string; folder: string }[],
  filename: string,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const zip = new JSZip();
  let done = 0;
  for (const { url, folder } of urls) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const blob = await res.blob();
        const name = decodeURIComponent(url.split("/").pop() || `photo-${done}.jpg`).split("?")[0];
        zip.folder(folder)?.file(name, blob);
      }
    } catch {
      // skip unfetchable photos
    }
    done++;
    onProgress?.(done, urls.length);
  }
  const blob = await zip.generateAsync({ type: "blob" });
  saveBlob(blob, filename.endsWith(".zip") ? filename : `${filename}.zip`);
}

// -------------------------------------------------- Outlook meeting request
// METHOD:REQUEST .ics where assigned people (with emails) are attendees and
// the sender is the organizer — opening it in Outlook starts a real meeting.
export function buildOutlookInvite(
  event: ConfEvent,
  conference: Conference,
  attendees: { name: string; email: string }[],
  organizer: { name: string; email: string },
): { ics: string; count: number } {
  const withEmail = attendees.filter((a) => /\S+@\S+\.\S+/.test(a.email));
  const stamp = (iso: string) =>
    new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const esc = (s: string) =>
    (s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Omni//Conference Planning//EN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:omni-invite-${event.id}@omni.app`,
    `DTSTAMP:${stamp(new Date().toISOString())}`,
    `DTSTART:${stamp(event.starts_at)}`,
    `DTEND:${stamp(event.ends_at)}`,
    `SUMMARY:${esc(event.title)}`,
    event.location ? `LOCATION:${esc(event.location)}` : "",
    `DESCRIPTION:${esc(`${conference.name}${event.description ? ` — ${event.description}` : ""}`)}`,
    `ORGANIZER;CN=${esc(organizer.name)}:mailto:${organizer.email}`,
    ...withEmail.map(
      (a) =>
        `ATTENDEE;CN=${esc(a.name)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${a.email}`,
    ),
    "STATUS:CONFIRMED",
    "SEQUENCE:0",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);
  return { ics: lines.join("\r\n"), count: withEmail.length };
}
