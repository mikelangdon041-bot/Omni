"use client";

// Meeting Prep — Setup: everything the AI needs to know. Autosaves.

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { RichText } from "@/components/ui/RichText";
import { TranscriptCapture } from "@/components/studio/TranscriptCapture";
import { KolLink } from "./KolLink";
import {
  MEETING_TYPES,
  type Attendee,
  type MeetingFormat,
  type MeetingType,
  type MpMeeting,
} from "@/lib/meetingprep/types";

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export function SetupTab({
  m,
  save,
  userId,
}: {
  m: MpMeeting;
  save: (p: Partial<MpMeeting>) => void;
  userId: string | null;
}) {
  const attendees: Attendee[] = m.attendees?.length
    ? m.attendees
    : [{ name: "", role: "", org: "", notes: "" }];

  const setAttendee = (i: number, partial: Partial<Attendee>) => {
    const next = attendees.map((a, j) => (j === i ? { ...a, ...partial } : a));
    save({ attendees: next });
  };

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section className="space-y-4 rounded-xl border border-border bg-surface p-4 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
          The meeting
        </h2>
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

      <section className="space-y-3 rounded-xl border border-border bg-surface p-4 shadow-sm">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
          Who&apos;s in the room
        </h2>
        {attendees.map((a, i) => (
          <div key={i} className="space-y-2 rounded-lg border border-border p-3">
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
      </section>

      <section className="space-y-4 rounded-xl border border-border bg-surface p-4 shadow-sm lg:col-span-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
          What I should know
        </h2>
        <div className="grid gap-4 lg:grid-cols-3">
          <div>
            <p className="mb-1.5 text-sm font-medium text-ink">
              Your objective — what does success look like?
            </p>
            <RichText
              value={m.objectives}
              onChange={(html) => save({ objectives: html })}
              placeholder="What you want out of this meeting…"
              minHeight="min-h-24"
            />
          </div>
          <div>
            <p className="mb-1.5 text-sm font-medium text-ink">Background</p>
            <RichText
              value={m.background}
              onChange={(html) => save({ background: html })}
              placeholder="History, prior emails, context — paste anything relevant…"
              minHeight="min-h-24"
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
              minHeight="min-h-24"
            />
          </div>
        </div>

        <div className="rounded-lg border border-border p-3">
          <p className="mb-1 text-sm font-medium text-ink">
            Previous meeting with these people?
          </p>
          <p className="mb-2 text-xs text-muted">
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
              <Button
                size="sm"
                variant="ghost"
                onClick={() => save({ prior_transcript: "" })}
              >
                Remove transcript
              </Button>
            </div>
          ) : (
            <TranscriptCapture
              onTranscript={(text) => save({ prior_transcript: text })}
            />
          )}
        </div>
      </section>
    </div>
  );
}
