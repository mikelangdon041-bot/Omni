"use client";

// Turning what you typed in Explain into the structured fields — attendees,
// objectives, concerns, title, date.
//
// This used to be a button on the Setup tab ("Fill in the details"). It isn't
// any more: it runs on its own as the first step of building a brief, because
// there was never a reason to want a brief WITHOUT it. Nothing already filled
// in is overwritten — every rule below only writes into a blank field.

import { htmlToPlain } from "@/lib/writer/types";
import { meetingTypeLabel, type Attendee, type MpMeeting } from "./types";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const textToHtml = (s: string) =>
  s
    .split(/\n+/)
    .filter((l) => l.trim())
    .map((l) => `<p>${esc(l.trim())}</p>`)
    .join("");

/** Is there anything worth reading? No prose, nothing to extract. */
export function canAutofill(m: MpMeeting): boolean {
  return Boolean(htmlToPlain(m.explain).trim() || htmlToPlain(m.background).trim());
}

export interface AutofillResult {
  patch: Partial<MpMeeting>;
  changes: number;
}

/**
 * Asks the model to read Explain (plus Background and any documents) and
 * returns the patch that fills in the blanks. It does not save — the caller
 * decides when to write.
 */
export async function runAutofill(m: MpMeeting): Promise<AutofillResult> {
  const documents = m.documents || [];
  const res = await fetch("/api/meeting/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({
      action: "autofill",
      meeting: {
        title: m.title,
        meetingType: meetingTypeLabel(m.meeting_type),
        date: m.date,
        durationMin: m.duration_min,
        format: m.format,
        location: m.location,
        attendees: m.attendees,
        explain: m.explain,
        objectives: m.objectives,
        background: m.background,
        concerns: m.concerns,
        priorTranscript: m.prior_transcript,
        documents: documents.map((d) => ({ name: d.name, note: d.note, text: d.text })),
      },
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || "Auto-fill failed");

  const patch: Partial<MpMeeting> = {};
  let changes = 0;

  if (json.title && !m.title.trim()) {
    patch.title = json.title;
    changes++;
  }
  if (json.location && !m.location.trim()) {
    patch.location = json.location;
    changes++;
  }
  if (json.durationMin && m.duration_min === 30 && json.durationMin !== 30) {
    patch.duration_min = json.durationMin;
    changes++;
  }
  if (json.date && !m.date) {
    const t = Date.parse(json.date);
    if (!isNaN(t)) {
      patch.date = new Date(t).toISOString();
      changes++;
    }
  }
  if (json.objectives && !htmlToPlain(m.objectives).trim()) {
    patch.objectives = textToHtml(json.objectives);
    changes++;
  }
  if (json.concerns && !htmlToPlain(m.concerns).trim()) {
    patch.concerns = textToHtml(json.concerns);
    changes++;
  }

  // Merge extracted attendees: new people are appended; known people get
  // their blank fields filled in.
  const attendees: Attendee[] = m.attendees?.length
    ? m.attendees
    : [{ name: "", role: "", org: "", notes: "" }];
  const extracted: Attendee[] = (json.attendees || []).filter((a: Attendee) =>
    (a.name || "").trim(),
  );
  if (extracted.length) {
    const next = attendees.map((a) => ({ ...a }));
    for (const e of extracted) {
      const hit = next.find(
        (a) => a.name.trim().toLowerCase() === e.name.trim().toLowerCase(),
      );
      if (hit) {
        let filled = false;
        if (!hit.role.trim() && e.role) {
          hit.role = e.role;
          filled = true;
        }
        if (!hit.org.trim() && e.org) {
          hit.org = e.org;
          filled = true;
        }
        if (!hit.notes.trim() && e.notes) {
          hit.notes = e.notes;
          filled = true;
        }
        if (filled) changes++;
      } else {
        const blank = next.find(
          (a) => !a.name.trim() && !a.role.trim() && !a.org.trim() && !a.notes.trim(),
        );
        if (blank) Object.assign(blank, e);
        else next.push(e);
        changes++;
      }
    }
    patch.attendees = next;
  }

  return { patch, changes };
}
