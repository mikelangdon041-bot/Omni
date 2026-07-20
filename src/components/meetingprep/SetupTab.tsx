"use client";

// Meeting Prep — Setup: everything the AI needs to know. Autosaves.
// Mirrors Writing Studio's intake pattern: one prominent, always-open box up
// top — "Explain" — and everything else folded away in collapsible
// IntakeSection panels until you want to fine-tune it.

import { useState } from "react";
import {
  ArrowRight,
  CalendarClock,
  FileText,
  ListChecks,
  MessageCircle,
  Mic,
  Paperclip,
  Plus,
  Sparkles,
  Trash2,
  Users,
  Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Input";
import { RichText } from "@/components/ui/RichText";
import { useToast } from "@/components/ui/Feedback";
import { TranscriptCapture } from "@/components/studio/TranscriptCapture";
import { IntakeSection } from "@/components/writer/IntakeSection";
import { htmlToPlain } from "@/lib/writer/types";
import { KolLink } from "./KolLink";
import { ConferencePeopleButton } from "./ConferencePeople";
import {
  MEETING_TYPES,
  meetingTypeLabel,
  type Attendee,
  type MeetingFormat,
  type MeetingType,
  type MpDocument,
  type MpMeeting,
} from "@/lib/meetingprep/types";

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const textToHtml = (s: string) =>
  s
    .split(/\n+/)
    .filter((l) => l.trim())
    .map((l) => `<p>${esc(l.trim())}</p>`)
    .join("");

// Accent-tinted card header used across the setup cards.
function CardTitle({
  icon: Icon,
  children,
}: {
  icon: React.ComponentType<{ size?: number | string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]">
        <Icon size={15} />
      </span>
      <h2 className="text-sm font-semibold tracking-tight">{children}</h2>
    </div>
  );
}

export function SetupTab({
  m,
  save,
  userId,
  busy,
  briefStale,
  hasBrief,
  onGenerate,
  onViewBrief,
}: {
  m: MpMeeting;
  save: (p: Partial<MpMeeting>) => void;
  userId: string | null;
  busy: string | null;
  briefStale: boolean;
  hasBrief: boolean;
  onGenerate: () => void;
  onViewBrief: () => void;
}) {
  const toast = useToast();
  const [autofilling, setAutofilling] = useState(false);
  const [uploadingDoc, setUploadingDoc] = useState(false);

  const attendees: Attendee[] = m.attendees?.length
    ? m.attendees
    : [{ name: "", role: "", org: "", notes: "" }];
  const documents: MpDocument[] = m.documents || [];

  const setAttendee = (i: number, partial: Partial<Attendee>) => {
    const next = attendees.map((a, j) => (j === i ? { ...a, ...partial } : a));
    save({ attendees: next });
  };

  const addAttendee = (a: Attendee) => {
    // Replace a leading blank row instead of stacking under it.
    const real = attendees.filter(
      (x) => x.name.trim() || x.role.trim() || x.org.trim() || x.notes.trim(),
    );
    save({ attendees: [...real, a] });
  };

  // Read Explain (plus Background/documents, if used) and fill in the
  // structured fields — attendees mentioned, objectives, title, date…
  async function autofill() {
    setAutofilling(true);
    try {
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

      const p: Partial<MpMeeting> = {};
      let changes = 0;

      if (json.title && !m.title.trim()) {
        p.title = json.title;
        changes++;
      }
      if (json.location && !m.location.trim()) {
        p.location = json.location;
        changes++;
      }
      if (json.durationMin && m.duration_min === 30 && json.durationMin !== 30) {
        p.duration_min = json.durationMin;
        changes++;
      }
      if (json.date && !m.date) {
        const t = Date.parse(json.date);
        if (!isNaN(t)) {
          p.date = new Date(t).toISOString();
          changes++;
        }
      }
      if (json.objectives && !htmlToPlain(m.objectives).trim()) {
        p.objectives = textToHtml(json.objectives);
        changes++;
      }
      if (json.concerns && !htmlToPlain(m.concerns).trim()) {
        p.concerns = textToHtml(json.concerns);
        changes++;
      }

      // Merge extracted attendees: new people are appended; known people get
      // their blank fields filled in.
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
        p.attendees = next;
      }

      if (changes) {
        save(p);
        toast(
          "success",
          `Filled in ${changes} thing${changes === 1 ? "" : "s"} below from what you wrote`,
        );
      } else {
        toast("info", "Nothing new found to fill in — the fields already cover it.");
      }
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setAutofilling(false);
    }
  }

  async function uploadDoc(file: File | null) {
    if (!file) return;
    setUploadingDoc(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/meeting/extract", {
        method: "POST",
        credentials: "same-origin",
        body: form,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not read that document");
      save({
        documents: [
          ...documents,
          { id: `d${Date.now()}`, name: file.name, note: "", text: json.text || "" },
        ],
      });
      toast("success", `"${file.name}" attached — tell me what to look for in it.`);
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setUploadingDoc(false);
    }
  }

  const setDoc = (id: string, partial: Partial<MpDocument>) =>
    save({ documents: documents.map((d) => (d.id === id ? { ...d, ...partial } : d)) });

  const specificsFilled = [m.objectives, m.background, m.concerns].filter((v) =>
    htmlToPlain(v).trim(),
  ).length;
  const canAutofill = Boolean(htmlToPlain(m.explain).trim() || htmlToPlain(m.background).trim());
  const attendeesFilled = attendees.filter((a) => a.name.trim()).length;

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section className="space-y-4 rounded-xl border border-border bg-surface p-4 shadow-sm">
        <CardTitle icon={CalendarClock}>The meeting</CardTitle>
        <Input
          label="Title"
          value={m.title}
          onChange={(e) => save({ title: e.target.value })}
          placeholder='e.g. "Intro meeting with Dr. Chen"'
        />
        <div className="grid grid-cols-2 gap-3">
          <Select
            label="Type"
            value={m.meeting_type}
            onChange={(e) => save({ meeting_type: e.target.value as MeetingType })}
          >
            {MEETING_TYPES.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </Select>
          <Select
            label="Format"
            value={m.format}
            onChange={(e) => save({ format: e.target.value as MeetingFormat })}
          >
            <option value="in_person">In person</option>
            <option value="video_call">Video call</option>
            <option value="phone">Phone</option>
          </Select>
          <Input
            label="Date & time"
            type="datetime-local"
            value={toLocalInput(m.date)}
            onChange={(e) =>
              save({ date: e.target.value ? new Date(e.target.value).toISOString() : null })
            }
          />
          <Input
            label="Duration (min)"
            type="number"
            min={5}
            step={5}
            value={m.duration_min}
            onChange={(e) => save({ duration_min: Number(e.target.value) || 30 })}
          />
        </div>
        <Input
          label="Location / link"
          value={m.location}
          onChange={(e) => save({ location: e.target.value })}
          placeholder="Office, restaurant, Teams…"
        />
        <KolLink userId={userId} kolId={m.kol_id} onLink={(id) => save({ kol_id: id })} />
      </section>

      {/* Explain — the fast path. Right after the meeting basics, before
          anything else, so this is the first thing you fill in. */}
      <section className="space-y-3 rounded-xl border border-[var(--accent)]/30 bg-gradient-to-br from-[var(--accent-soft)]/40 to-transparent p-4 shadow-sm">
        <CardTitle icon={MessageCircle}>Explain</CardTitle>
        <p className="text-xs leading-snug text-muted">
          The fast way: just type out what&apos;s going on, in your own words —
          who&apos;s involved, what you want, any backstory or worries. Press{" "}
          <b className="text-ink">Fill in the details</b> and I&apos;ll pick out
          attendees, objectives, and concerns and drop them into the specific
          boxes below. You can also answer those directly instead — or as well,
          for extra sharpness on any one of them — and anything you leave blank
          there, I&apos;ll pull from what you write here when I build the brief
          either way.
        </p>
        <RichText
          value={m.explain}
          onChange={(html) => save({ explain: html })}
          placeholder='e.g. "Meeting with Dr. Chen and her VP, Melissa, about renewing the research grant. I want to leave with a signed LOI. They were burned by a late shipment last year so tread carefully there."'
          minHeight="min-h-32"
        />
        <div className="flex justify-end">
          <Button
            size="sm"
            disabled={autofilling || !canAutofill}
            onClick={() => void autofill()}
          >
            <Wand2 size={14} /> {autofilling ? "Reading…" : "Fill in the details"}
          </Button>
        </div>
      </section>

      <IntakeSection
        icon={Users}
        title="Who's in the room"
        tint="bg-sky-100 text-sky-600"
        badge={attendeesFilled ? `${attendeesFilled} added` : undefined}
      >
        <ConferencePeopleButton
          existingNames={attendees.map((a) => a.name)}
          onAdd={addAttendee}
        />
        {attendees.map((a, i) => (
          <div
            key={i}
            className="space-y-2 rounded-lg border border-border bg-canvas/40 p-3"
          >
            <div className="grid grid-cols-2 gap-2">
              <Input
                placeholder="Name"
                value={a.name}
                onChange={(e) => setAttendee(i, { name: e.target.value })}
              />
              <Input
                placeholder="Role / title"
                value={a.role}
                onChange={(e) => setAttendee(i, { role: e.target.value })}
              />
            </div>
            <Input
              placeholder="Organization"
              value={a.org}
              onChange={(e) => setAttendee(i, { org: e.target.value })}
            />
            <div className="flex items-start gap-2">
              <Input
                placeholder="What you know about them (style, interests, history…)"
                value={a.notes}
                onChange={(e) => setAttendee(i, { notes: e.target.value })}
                className="flex-1"
              />
              {attendees.length > 1 && (
                <button
                  className="mt-2 rounded p-1 text-muted hover:text-red-600"
                  aria-label="Remove attendee"
                  onClick={() => save({ attendees: attendees.filter((_, j) => j !== i) })}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>
        ))}
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            save({ attendees: [...attendees, { name: "", role: "", org: "", notes: "" }] })
          }
        >
          <Plus size={14} /> Add attendee
        </Button>
        <p className="text-[11px] leading-snug text-muted">
          Tip: you don&apos;t have to fill this by hand — mention people in the
          Explain box above and press <b>Fill in the details</b>; anyone you say
          will be there gets added here automatically.
        </p>
      </IntakeSection>

      {/* Folded away, same as Writing Studio's dials — Explain does this job
          for most meetings; these are the "answer directly instead (or as
          well, for extra sharpness)" path. */}
      <IntakeSection
        icon={ListChecks}
        title="Answer more specifically"
        tint="bg-violet-100 text-violet-600"
        badge={specificsFilled ? `${specificsFilled}/3 filled` : undefined}
      >
        <div>
          <p className="mb-1.5 text-sm font-medium text-ink">
            Your objective — what does success look like?
          </p>
          <RichText
            value={m.objectives}
            onChange={(html) => save({ objectives: html })}
            placeholder="What you want out of this meeting…"
            minHeight="min-h-20"
          />
        </div>
        <div>
          <p className="mb-1.5 text-sm font-medium text-ink">Background</p>
          <RichText
            value={m.background}
            onChange={(html) => save({ background: html })}
            placeholder="History, prior emails, context — paste anything relevant…"
            minHeight="min-h-20"
          />
        </div>
        <div>
          <p className="mb-1.5 text-sm font-medium text-ink">
            Concerns / what could go wrong
          </p>
          <RichText
            value={m.concerns}
            onChange={(html) => save({ concerns: html })}
            placeholder="Sensitive topics, expected pushback, worries…"
            minHeight="min-h-20"
          />
        </div>
      </IntakeSection>

      {/* Supporting documents, with a per-document relevance note. */}
      <IntakeSection
        icon={Paperclip}
        title="Supporting documents"
        tint="bg-amber-100 text-amber-600"
        badge={documents.length ? `${documents.length} attached` : undefined}
      >
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-muted transition hover:text-ink">
          <FileText size={14} />
          {uploadingDoc ? "Reading document…" : "Upload PDF / Word / text"}
          <input
            type="file"
            accept=".pdf,.doc,.docx,.txt,.md,text/plain"
            className="hidden"
            disabled={uploadingDoc}
            onChange={(e) => {
              void uploadDoc(e.target.files?.[0] || null);
              e.target.value = "";
            }}
          />
        </label>
        <p className="text-xs text-muted">
          Attach agendas, slide decks, reports, emails — then tell me what to
          look for in each one and I&apos;ll work it into the brief.
        </p>
        {documents.length > 0 && (
          <ul className="space-y-2">
            {documents.map((d) => (
              <li key={d.id} className="rounded-lg border border-border bg-canvas/40 p-3">
                <div className="mb-2 flex items-center gap-2">
                  <FileText size={15} className="shrink-0 text-[var(--accent)]" />
                  <p className="min-w-0 flex-1 truncate text-sm font-medium">{d.name}</p>
                  <span className="shrink-0 text-[10px] text-muted">
                    {d.text.length.toLocaleString()} chars
                  </span>
                  <button
                    className="shrink-0 rounded p-1 text-muted hover:text-red-600"
                    aria-label="Remove document"
                    onClick={() => save({ documents: documents.filter((x) => x.id !== d.id) })}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
                <Input
                  value={d.note}
                  onChange={(e) => setDoc(d.id, { note: e.target.value })}
                  placeholder='What should I look for in this? How is it relevant? e.g. "Pull the Q2 numbers from page 3 for the talking points"'
                />
              </li>
            ))}
          </ul>
        )}
      </IntakeSection>

      <IntakeSection
        icon={Mic}
        title="Previous meeting with these people?"
        tint="bg-teal-100 text-teal-600"
        badge={m.prior_transcript ? "Attached" : undefined}
      >
        <p className="text-xs text-muted">
          Record, upload, or paste it — the brief will build on what was
          already said.
        </p>
        {m.prior_transcript ? (
          <div className="space-y-2">
            <details>
              <summary className="cursor-pointer text-xs font-medium text-[var(--accent)]">
                Transcript attached ({m.prior_transcript.length.toLocaleString()} chars) — view
              </summary>
              <p className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap text-xs text-muted">
                {m.prior_transcript}
              </p>
            </details>
            <Button size="sm" variant="ghost" onClick={() => save({ prior_transcript: "" })}>
              Remove transcript
            </Button>
          </div>
        ) : (
          <TranscriptCapture onTranscript={(text) => save({ prior_transcript: text })} />
        )}
      </IntakeSection>

      {/* Generate straight from Setup — it jumps to the Brief tab and keeps
          working in the background. */}
      <section className="flex flex-col gap-3 rounded-xl border border-[var(--accent)]/30 bg-gradient-to-r from-[var(--accent-soft)]/60 to-transparent p-4 shadow-sm sm:flex-row sm:items-center lg:col-span-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            {!hasBrief
              ? "Ready? Generate your brief."
              : briefStale
                ? "Your setup changed since the last brief."
                : "Your brief is up to date."}
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {!hasBrief
              ? "I'll write the full brief from everything above — you can edit, refine, or redo any section afterwards."
              : briefStale
                ? "Regenerate it so it reflects your latest changes, or open it as-is."
                : "Open it on the Brief tab — refine it there or redo any section."}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {hasBrief && (
            <Button variant="secondary" onClick={onViewBrief}>
              View brief <ArrowRight size={15} />
            </Button>
          )}
          {(!hasBrief || briefStale) && (
            <Button disabled={busy === "all"} onClick={onGenerate}>
              <Sparkles size={15} />
              {busy === "all"
                ? "Building your brief…"
                : hasBrief
                  ? "Update the brief"
                  : "Generate my brief"}
            </Button>
          )}
        </div>
      </section>
    </div>
  );
}
