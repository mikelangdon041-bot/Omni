"use client";

// Meeting Prep — Debrief: after the meeting, capture what happened by typing
// answers to structured questions AND/OR recording/uploading/pasting the
// meeting itself. The AI turns all of it into a summary + follow-ups, which
// can be pushed to the to-do list and — when a KOL is linked — logged into
// Territory Planning.

import { useState } from "react";
import {
  CheckCircle2,
  FileAudio,
  ListTodo,
  MapPin,
  MessageSquareText,
  Sparkles,
  Trash2,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { RichText } from "@/components/ui/RichText";
import { useToast } from "@/components/ui/Feedback";
import { TranscriptCapture } from "@/components/studio/TranscriptCapture";
import { useKolLite } from "./KolLink";
import { logMeetingToTerritory } from "@/lib/meetingprep/territoryLog";
import {
  DEBRIEF_QUESTIONS,
  meetingContextText,
  type DebriefAction,
  type MpMeeting,
} from "@/lib/meetingprep/types";
import type { DueDatePreset } from "@/lib/territory/types";

const supabase = createClient();

function toLocalInput(iso: string | null): string {
  const d = iso ? new Date(iso) : new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export function DebriefTab({
  m,
  save,
  userId,
}: {
  m: MpMeeting;
  save: (p: Partial<MpMeeting>) => void;
  userId: string | null;
}) {
  const toast = useToast();
  const kol = useKolLite(m.kol_id);
  const [busy, setBusy] = useState(false);

  const debrief = m.debrief || {};
  const notes = debrief.notes || {};
  const actions: DebriefAction[] = debrief.actions || [];

  const notesText = DEBRIEF_QUESTIONS.map((q) =>
    (notes[q.key] || "").trim() ? `${q.label}\n${notes[q.key].trim()}` : "",
  )
    .filter(Boolean)
    .join("\n\n");
  const hasMaterial = Boolean(notesText || (debrief.transcript || "").trim());

  const setNote = (key: string, value: string) =>
    save({ debrief: { ...debrief, notes: { ...notes, [key]: value } } });

  async function analyze() {
    const combined = [
      notesText && `The writer's own debrief notes:\n${notesText}`,
      (debrief.transcript || "").trim() &&
        `Meeting transcript/notes:\n${debrief.transcript}`,
    ]
      .filter(Boolean)
      .join("\n\n");
    if (!combined) return;
    setBusy(true);
    try {
      const res = await fetch("/api/meeting/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          action: "debrief",
          transcript: combined,
          context: meetingContextText(m),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Debrief failed");
      save({
        debrief: {
          ...debrief,
          summary: json.summary || "",
          actions: (json.actions || []).map((text: string) => ({ text, done: false })),
        },
      });
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function pushActionsToTasks() {
    if (!userId) return;
    let n = 0;
    const next = [...actions];
    for (let i = 0; i < next.length; i++) {
      if (next[i].taskId) continue;
      const { data } = await supabase
        .from("tasks")
        .insert({
          user_id: userId,
          title: next[i].text,
          app: "meeting-prep",
          link: `/meeting-prep/${m.id}`,
          entity_label: m.title || "Meeting",
        })
        .select("id")
        .single();
      if (data) {
        next[i] = { ...next[i], taskId: data.id };
        n++;
      }
    }
    save({ debrief: { ...debrief, actions: next } });
    toast("success", n ? `${n} follow-up${n === 1 ? "" : "s"} added to your to-do list` : "Already added.");
  }

  return (
    <div className="space-y-5">
      {/* Capture: typed answers to the questions that matter + audio/paste. */}
      <section className="rounded-xl border border-border bg-surface p-4 shadow-sm">
        <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold tracking-tight">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]">
            <MessageSquareText size={15} />
          </span>
          How did it go?
        </h2>
        <p className="mb-4 text-sm text-muted">
          Type what you remember below — a few honest sentences per box is
          plenty — and/or attach the meeting recording. I&apos;ll turn all of it
          into a summary, pull out every follow-up, and remember it for next
          time you meet these people. Everything autosaves.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          {DEBRIEF_QUESTIONS.map((q) => (
            <Textarea
              key={q.key}
              label={q.label}
              value={notes[q.key] || ""}
              onChange={(e) => setNote(q.key, e.target.value)}
              placeholder={q.placeholder}
              className="min-h-20"
            />
          ))}
        </div>

        <div className="mt-4 rounded-lg border border-border bg-canvas/40 p-3">
          <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-ink">
            <FileAudio size={14} className="text-[var(--accent)]" />
            Recording or raw notes (optional)
          </p>
          {(debrief.transcript || "").trim() ? (
            <div className="flex items-center gap-2">
              <details className="min-w-0 flex-1">
                <summary className="cursor-pointer text-xs font-medium text-[var(--accent)]">
                  Transcript attached ({(debrief.transcript || "").length.toLocaleString()} chars) — view
                </summary>
                <p className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap text-xs text-muted">
                  {debrief.transcript}
                </p>
              </details>
              <button
                className="shrink-0 rounded p-1 text-muted hover:text-red-600"
                aria-label="Remove transcript"
                onClick={() => save({ debrief: { ...debrief, transcript: "" } })}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ) : (
            <TranscriptCapture
              onTranscript={(text) => save({ debrief: { ...debrief, transcript: text } })}
            />
          )}
        </div>

        <div className="mt-4 flex items-center justify-end gap-3">
          {!hasMaterial && (
            <p className="text-xs text-muted">
              Answer at least one question or attach a recording first.
            </p>
          )}
          <Button disabled={!hasMaterial || busy} onClick={() => void analyze()}>
            <Sparkles size={15} />
            {busy
              ? "Analyzing…"
              : debrief.summary
                ? "Re-analyze"
                : "Summarize & extract follow-ups"}
          </Button>
        </div>
      </section>

      {debrief.summary && (
        <>
          <section className="rounded-xl border border-border bg-surface p-4 shadow-sm">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">
              Summary
            </h2>
            <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">
              {debrief.summary}
            </pre>
          </section>

          <section className="rounded-xl border border-border bg-surface p-4 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
                Follow-ups ({actions.length})
              </h2>
              <Button size="sm" variant="secondary" onClick={pushActionsToTasks}>
                <ListTodo size={14} /> Add all to to-do list
              </Button>
            </div>
            {actions.length === 0 ? (
              <p className="text-sm text-muted">No follow-ups detected.</p>
            ) : (
              <ul className="space-y-1.5">
                {actions.map((a, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={a.done}
                      onChange={(e) =>
                        save({
                          debrief: {
                            ...debrief,
                            actions: actions.map((x, j) =>
                              j === i ? { ...x, done: e.target.checked } : x,
                            ),
                          },
                        })
                      }
                      className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
                    />
                    <span
                      className={`text-sm ${a.done ? "text-muted line-through" : ""}`}
                    >
                      {a.text}
                      {a.taskId && (
                        <CheckCircle2
                          size={12}
                          className="ml-1 inline text-emerald-600"
                          aria-label="On your to-do list"
                        />
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {/* Territory logging */}
      {m.kol_id && kol && (
        <TerritoryLogCard m={m} save={save} userId={userId} kolName={`${kol.first_name} ${kol.last_name}`} />
      )}
    </div>
  );
}

function TerritoryLogCard({
  m,
  save,
  userId,
  kolName,
}: {
  m: MpMeeting;
  save: (p: Partial<MpMeeting>) => void;
  userId: string | null;
  kolName: string;
}) {
  const toast = useToast();
  const [date, setDate] = useState(() => toLocalInput(m.date));
  const [method, setMethod] = useState(
    m.format === "video_call" ? "video_call" : m.format === "phone" ? "phone" : "in_person",
  );
  // Prefill from the debrief so the territory record starts complete.
  const [discussed, setDiscussed] = useState(() =>
    m.debrief?.summary
      ? `<p>${m.debrief.summary.replace(/\n/g, "<br>")}</p>`
      : "",
  );
  const [missed, setMissed] = useState("");
  const [followUps, setFollowUps] = useState(() =>
    m.debrief?.actions?.length
      ? `<ul>${m.debrief.actions.map((a) => `<li>${a.text}</li>`).join("")}</ul>`
      : "",
  );
  const [reminder, setReminder] = useState<DueDatePreset | "none">("1_month");
  const [logging, setLogging] = useState(false);

  if (m.territory_logged) {
    return (
      <section className="flex items-center gap-3 rounded-xl border border-teal-200 bg-teal-50 p-4">
        <CheckCircle2 size={18} className="text-teal-600" />
        <p className="text-sm text-teal-800">
          Logged to Territory Planning as a completed meeting with {kolName}.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-teal-300/60 bg-surface p-4 shadow-sm">
      <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-teal-700">
        <MapPin size={14} /> Log to Territory Planning
      </h2>
      <p className="mb-3 text-sm text-muted">
        Records this as a completed meeting with <b>{kolName}</b> — cycle,
        meeting history, and future AI prep all pick it up. Same fields
        Territory asks for.
      </p>
      <div className="mb-3 grid grid-cols-2 gap-3">
        <Input
          label="Date & time"
          type="datetime-local"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <Select label="Method" value={method} onChange={(e) => setMethod(e.target.value)}>
          <option value="in_person">In person</option>
          <option value="video_call">Video call</option>
          <option value="phone">Phone</option>
        </Select>
      </div>
      <div className="space-y-3">
        <div>
          <p className="mb-1.5 text-sm font-medium text-ink">Topics discussed</p>
          <RichText value={discussed} onChange={setDiscussed} minHeight="min-h-20" />
        </div>
        <div>
          <p className="mb-1.5 text-sm font-medium text-ink">Topics missed / to revisit</p>
          <RichText value={missed} onChange={setMissed} minHeight="min-h-16" />
        </div>
        <div>
          <p className="mb-1.5 text-sm font-medium text-ink">Follow-up actions</p>
          <RichText value={followUps} onChange={setFollowUps} minHeight="min-h-16" />
        </div>
        <Select
          label="Create a follow-up reminder?"
          value={reminder}
          onChange={(e) => setReminder(e.target.value as DueDatePreset | "none")}
        >
          <option value="none">No reminder</option>
          <option value="1_week">In 1 week</option>
          <option value="1_month">In 1 month</option>
          <option value="3_months">In 3 months</option>
        </Select>
      </div>
      <div className="mt-4 flex justify-end">
        <Button
          disabled={logging || !userId || !date}
          onClick={async () => {
            if (!userId || !m.kol_id) return;
            setLogging(true);
            try {
              await logMeetingToTerritory({
                kolId: m.kol_id,
                userId,
                dateISO: new Date(date).toISOString(),
                method,
                topicsDiscussed: discussed,
                topicsMissed: missed,
                followUpActions: followUps,
                reminder,
              });
              save({ territory_logged: true });
              toast("success", "Meeting logged to Territory Planning");
            } catch (e) {
              toast("error", (e as Error).message);
            } finally {
              setLogging(false);
            }
          }}
        >
          {logging ? "Logging…" : "Complete & log meeting"}
        </Button>
      </div>
    </section>
  );
}
