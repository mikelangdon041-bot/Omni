"use client";

// Material the writer adds to a meeting, and the people it names.
//
// Every piece of material comes with the writer's reason for adding it, and
// the reason decides what happens: an agenda is read for who is speaking,
// background goes on the reading list, and so on. Both of these run longer
// than a render, so they read the meeting fresh through `getMeeting` at the
// moment they save: saving from a copy taken when they started would put back
// whatever the writer changed while they waited.

import {
  meetingTypeLabel,
  type Attendee,
  type MaterialFindings,
  type MaterialPurpose,
  type MpDocument,
  type MpMeeting,
  type Reading,
  type ReadingSource,
} from "./types";

export type GetMeeting = () => MpMeeting | null;
export type SaveMeeting = (p: Partial<MpMeeting>) => void;

/** The meeting as the AI route wants it. */
export function meetingPayload(m: MpMeeting) {
  return {
    title: m.title,
    topic: m.topic,
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
    documents: (m.documents || []).map((d) => ({
      name: d.name,
      note: d.note,
      text: d.text,
      purpose: d.purpose,
    })),
  };
}

export const newId = (p: string) => `${p}${Date.now()}${Math.random().toString(36).slice(2, 6)}`;

async function post<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(body),
    signal,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Something went wrong");
  return json as T;
}

export type MaterialInput =
  | { kind: "file"; file: File }
  | { kind: "url"; url: string }
  | { kind: "paste"; text: string; name: string };

/** Step 1: plain text out of whatever was handed over. */
export async function readMaterial(
  input: MaterialInput,
  signal?: AbortSignal,
): Promise<{ text: string; name: string; url?: string }> {
  if (input.kind === "paste") {
    const text = input.text.trim();
    if (!text) throw new Error("Nothing pasted yet.");
    return { text, name: input.name.trim() || "Pasted text" };
  }
  if (input.kind === "url") {
    const out = await post<{ text: string; name: string }>("/api/meeting/extract", { url: input.url }, signal);
    return { ...out, url: input.url.trim() };
  }
  const form = new FormData();
  form.append("file", input.file);
  const res = await fetch("/api/meeting/extract", {
    method: "POST",
    credentials: "same-origin",
    body: form,
    signal,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Could not read that document");
  return { text: json.text || "", name: input.file.name };
}

interface Digest {
  title: string;
  outlet: string;
  date: string;
  summary: string;
  findings: string[];
  why: string;
  people: MaterialFindings["people"];
  session: MaterialFindings["session"];
}

const sameName = (a: string, b: string) =>
  a.trim().toLowerCase().replace(/^(dr|prof)\.?\s+/, "") ===
  b.trim().toLowerCase().replace(/^(dr|prof)\.?\s+/, "");

/**
 * Step 2: read it for the reason given, and file the result.
 * Returns what to tell the writer.
 */
export async function addMaterial({
  input,
  purpose,
  note,
  getMeeting,
  save,
  onStage,
  signal,
}: {
  input: MaterialInput;
  purpose: MaterialPurpose;
  note: string;
  getMeeting: GetMeeting;
  save: SaveMeeting;
  onStage?: (s: string) => void;
  /** Cancel: stop waiting, and save nothing. */
  signal?: AbortSignal;
}): Promise<string> {
  if (!note.trim()) throw new Error("Say what this is and what you want out of it.");
  onStage?.(input.kind === "url" ? "Opening the page…" : "Reading it…");
  const read = await readMaterial(input, signal);
  const start = getMeeting();
  if (!start) throw new Error("The meeting isn't loaded yet.");

  onStage?.(purpose === "agenda" ? "Finding the people and the session…" : "Working out what's in it…");
  const d = await post<Digest>("/api/meeting/ai", {
    action: "material",
    meeting: meetingPayload(start),
    doc: { name: read.name, text: read.text, purpose, note, url: read.url },
  }, signal);

  const m = getMeeting() || start;
  const docId = newId("d");
  const existing = (m.attendees || []).map((a) => a.name);
  const people = d.people.filter((p) => !existing.some((n) => sameName(n, p.name)));
  const s = d.session;
  const sessionNews = Boolean(
    (s.topic && s.topic !== m.topic) ||
      (s.durationMin && s.durationMin !== m.duration_min) ||
      (s.date && !m.date) ||
      (s.location && !m.location),
  );
  const doc: MpDocument = {
    id: docId,
    name: d.title || read.name,
    note: note.trim(),
    text: read.text,
    purpose,
    ...(read.url ? { url: read.url } : {}),
    ...(people.length || sessionNews ? { findings: { people, session: s } } : {}),
  };

  const patch: Partial<MpMeeting> = { documents: [...(m.documents || []), doc] };
  // Everything but an agenda is something to read, so it joins the reading
  // list alongside what the search found, marked as theirs.
  if (purpose !== "agenda") {
    const src: ReadingSource = {
      id: newId("r"),
      title: d.title || read.name,
      outlet: d.outlet,
      date: d.date,
      url: read.url || "",
      kind: "yours",
      docId,
      summary: d.summary,
      findings: d.findings,
      why: d.why,
      priority: "must",
    };
    const reading: Reading = m.reading || {};
    patch.reading = { ...reading, sources: [src, ...(reading.sources || [])] };
  }
  save(patch);

  if (people.length || sessionNews)
    return `Read "${doc.name}". ${
      people.length
        ? `Found ${people.length} ${people.length === 1 ? "person" : "people"}`
        : "Found session details"
    }: check them on Setup to add.`;
  return purpose === "agenda"
    ? `Read "${doc.name}". Nobody new in it.`
    : `Added "${doc.name}" to your reading list.`;
}

/** Take the material out, and its entry on the reading list with it. */
export function removeMaterial(docId: string, getMeeting: GetMeeting, save: SaveMeeting) {
  const m = getMeeting();
  if (!m) return;
  const reading = m.reading || {};
  save({
    documents: (m.documents || []).filter((d) => d.id !== docId),
    reading: { ...reading, sources: (reading.sources || []).filter((s) => s.docId !== docId) },
  });
}

/**
 * Look people up one at a time, saving each as it lands, so the first card
 * fills in while the rest are still searching. Matched by name, not by
 * position: the writer can add or remove someone while this runs.
 */
export async function lookUpPeople({
  names,
  getMeeting,
  save,
  onEach,
  signal,
}: {
  names: string[];
  getMeeting: GetMeeting;
  save: SaveMeeting;
  onEach?: (name: string, ok: boolean) => void;
  /** Cancel: stop after the person in flight, and save nothing more. */
  signal?: AbortSignal;
}) {
  for (const name of names) {
    if (signal?.aborted) return;
    const m = getMeeting();
    const a = m?.attendees?.find((x) => sameName(x.name, name));
    if (!m || !a) continue;
    try {
      const out = await post<{ text: string; sources: { title: string; url: string }[] }>(
        "/api/meeting/ai",
        { action: "person", person: a, subject: m.topic || m.title },
        signal,
      );
      const now = getMeeting();
      if (!now || !out.text) {
        onEach?.(name, false);
        continue;
      }
      save({
        attendees: (now.attendees || []).map((x) =>
          sameName(x.name, name)
            ? { ...x, profile: { text: out.text, sources: out.sources, at: new Date().toISOString() } }
            : x,
        ),
      });
      onEach?.(name, true);
    } catch {
      onEach?.(name, false);
    }
  }
}

/** Accept what an agenda turned up. Returns the names added. */
export function applyFindings({
  docId,
  people,
  session,
  getMeeting,
  save,
}: {
  docId: string;
  people: Attendee[];
  session: Partial<{ topic: string; duration_min: number; date: string; location: string }>;
  getMeeting: GetMeeting;
  save: SaveMeeting;
}): string[] {
  const m = getMeeting();
  if (!m) return [];
  const real = (m.attendees || []).filter(
    (x) => x.name.trim() || x.role.trim() || x.org.trim() || x.notes.trim(),
  );
  const fresh = people.filter((p) => !real.some((x) => sameName(x.name, p.name)));
  const patch: Partial<MpMeeting> = {
    attendees: [...real, ...fresh],
    documents: (m.documents || []).map((d) =>
      d.id === docId && d.findings ? { ...d, findings: { ...d.findings, done: true } } : d,
    ),
  };
  if (session.topic) patch.topic = session.topic;
  if (session.duration_min) patch.duration_min = session.duration_min;
  if (session.location) patch.location = session.location;
  if (session.date) {
    const t = new Date(session.date);
    if (!Number.isNaN(t.getTime())) {
      patch.date = t.toISOString();
      patch.no_date = false;
    }
  }
  save(patch);
  return fresh.map((p) => p.name);
}
