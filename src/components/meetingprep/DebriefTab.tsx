"use client";

// Meeting Prep — Debrief: after the meeting, capture what happened by typing
// answers to structured questions AND/OR recording/uploading/pasting the
// meeting itself. The AI turns all of it into a summary + follow-ups, which
// can be pushed to the to-do list and — when a KOL is linked — logged into
// Territory Planning.

import { useRef, useState } from "react";
import {
  CheckCircle2,
  Copy,
  FileAudio,
  ListTodo,
  MapPin,
  MessageSquareText,
  Replace,
  Sparkles,
  Trash2,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { RichText } from "@/components/ui/RichText";
import { debriefNotesHtml, tidyNotesHtml } from "@/lib/meetingprep/notes";
import {
  applyNameMap,
  countMatchesInHtml,
  renameInHtml,
  renameInText,
} from "@/lib/meetingprep/rename";
import { useConfirm, useToast } from "@/components/ui/Feedback";
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

// Pull the speaker labels out of a stored transcript ("Speaker A:", "Dr. Chen:").
// A label is a short prefix before a colon that opens several lines — one line
// starting "Note:" is not a speaker.
// Escape a user-typed string so it can be used as a literal in a RegExp.
const escapeRx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function detectSpeakers(transcript: string): string[] {
  const counts = new Map<string, number>();
  for (const line of (transcript || "").split("\n")) {
    const m = line.match(/^([^:]{1,40}):\s/);
    if (!m) continue;
    const label = m[1].trim();
    if (!label || /[.!?]$/.test(label)) continue;
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return [...counts.entries()]
    .filter(([label, n]) => n >= 2 || /^Speaker /i.test(label))
    .map(([label]) => label)
    .sort();
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
  const confirm = useConfirm();
  const kol = useKolLite(m.kol_id);
  const [busy, setBusy] = useState(false);
  const [redoOpen, setRedoOpen] = useState(false);
  const [renames, setRenames] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [findWhat, setFindWhat] = useState("");
  const [findWith, setFindWith] = useState("");
  // Where in the notes the user last selected something, so the rename button
  // can appear next to it.
  const [pick, setPick] = useState<{ text: string; top: number; left: number } | null>(null);
  const notesRef = useRef<HTMLDivElement>(null);

  const debrief = m.debrief || {};
  const notes = debrief.notes || {};
  const actions: DebriefAction[] = debrief.actions || [];
  // Folds the two older shapes (sections, outline summary) into the one
  // document, so meetings saved before this still open with their notes.
  const notesHtml = debriefNotesHtml(debrief);

  // Copy as rich text so the bullet nesting survives the paste into OneNote
  // or Word; the plain-text flavour keeps indentation for anywhere else.
  async function copyNotes() {
    const el = notesRef.current;
    if (!el) return;
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([el.innerHTML], { type: "text/html" }),
          "text/plain": new Blob([el.innerText], { type: "text/plain" }),
        }),
      ]);
    } catch {
      await navigator.clipboard.writeText(el.innerText).catch(() => {});
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }
  // Ticked and not already pushed — what "Add to to-do list" will act on.
  const selectedPending = actions
    .map((a, i) => (a.selected !== false && !a.taskId ? i : -1))
    .filter((i) => i >= 0);

  // Everything here rides the meeting's existing debounced autosave, so
  // typing in a section behaves like every other field in the module.
  const setAction = (index: number, patch: Partial<DebriefAction>) =>
    save({
      debrief: {
        ...debrief,
        actions: actions.map((a, i) => (i === index ? { ...a, ...patch } : a)),
      },
    });

  const notesText = DEBRIEF_QUESTIONS.map((q) =>
    (notes[q.key] || "").trim() ? `${q.label}\n${notes[q.key].trim()}` : "",
  )
    .filter(Boolean)
    .join("\n\n");
  const hasMaterial = Boolean(notesText || (debrief.transcript || "").trim());

  const setNote = (key: string, value: string) =>
    save({ debrief: { ...debrief, notes: { ...notes, [key]: value } } });

  async function analyze(transcriptOverride?: string) {
    const source = transcriptOverride ?? debrief.transcript ?? "";
    const combined = [
      notesText && `The writer's own debrief notes:\n${notesText}`,
      source.trim() && `Meeting transcript/notes:\n${source}`,
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
        // Same action the recorder uses, so a typed debrief and a recorded
        // one both come back as editable sections rather than one blob.
        body: JSON.stringify({
          action: "capture",
          transcript: combined,
          hint: meetingContextText(m),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Debrief failed");
      save({
        debrief: {
          ...debrief,
          // Persist the relabelled transcript too, so the names stick.
          ...(transcriptOverride !== undefined
            ? { transcript: transcriptOverride }
            : {}),
          notesHtml: applyNameMap(
            tidyNotesHtml(json.notes || ""),
            debrief.nameMap,
            true,
          ),
          // A re-analysis replaces the notes; the two older shapes would
          // otherwise linger underneath the new document.
          sections: [],
          summary: "",
          actions: (json.actions || []).map((text: string) => ({
            text: applyNameMap(text, debrief.nameMap),
            done: false,
            selected: true,
          })),
        },
      });
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const detected = detectSpeakers(debrief.transcript || "");
  // The meeting already knows who was in the room — offer those rather than
  // making the same names get retyped (and mistyped) here.
  const attendeeNames = (m.attendees || [])
    .map((a) => (a.name || "").trim())
    .filter(Boolean);

  // The first thing each voice says, so a label can be recognised without
  // going back to the audio.
  function sampleFor(label: string): string {
    const line = (debrief.transcript || "")
      .split("\n")
      .find((l) => l.startsWith(`${label}:`));
    return line ? line.slice(label.length + 1).trim().slice(0, 90) : "";
  }

  // Re-run the notes, optionally relabelling speakers first. Renaming happens
  // here rather than in the model because the person who was in the room is
  // the only reliable source for who is who.
  async function redo() {
    const pairs = Object.entries(renames).filter(([, v]) => v.trim());
    let text = debrief.transcript || "";
    if (pairs.length) {
      text = text
        .split("\n")
        .map((line) => {
          for (const [label, name] of pairs) {
            if (line.startsWith(`${label}:`)) {
              return `${name.trim()}:${line.slice(label.length + 1)}`;
            }
          }
          return line;
        })
        .join("\n");
    }
    // Keep the roster in step with what was just applied.
    if (pairs.length) {
      const existing = new Set(attendeeNames);
      const added = pairs
        .map(([, name]) => name.trim())
        .filter((name) => name && !existing.has(name))
        .map((name) => ({ name, role: "", org: "", notes: "" }));
      if (added.length) save({ attendees: [...(m.attendees || []), ...added] });
    }
    setRedoOpen(false);
    setRenames({});
    await analyze(pairs.length ? text : undefined);
  }

  // A selection inside the notes is the natural way to say "this name" —
  // clicking a word or dragging over a phrase both land here.
  function onNotesSelect() {
    const sel = window.getSelection();
    const el = notesRef.current;
    if (!sel || sel.isCollapsed || !el || !sel.rangeCount) return setPick(null);
    const text = sel.toString().trim();
    if (!text || text.length > 60 || !el.contains(sel.anchorNode)) return setPick(null);
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    const box = el.getBoundingClientRect();
    setPick({
      text,
      top: rect.top - box.top - 38,
      left: Math.max(0, rect.left - box.left),
    });
  }

  function openRenameFor(text: string) {
    setFindWhat(text);
    setFindWith("");
    setPick(null);
    setFindOpen(true);
  }

  // Replace a name (or any wording) everywhere at once — notes, follow-ups
  // and the stored transcript. A name that came out wrong is usually wrong in
  // every place it appears, so fixing them one at a time is the wrong shape.
  function replaceEverywhere() {
    const what = findWhat.trim();
    const to = findWith.trim();
    if (!what || !to) return;

    save({
      debrief: {
        ...debrief,
        notesHtml: renameInHtml(notesHtml, what, to),
        actions: actions.map((a) => ({ ...a, text: renameInText(a.text, what, to) })),
        ...(debrief.transcript
          ? { transcript: renameInText(debrief.transcript, what, to) }
          : {}),
        // Remembered, so re-running the notes doesn't undo it.
        nameMap: { ...(debrief.nameMap || {}), [what]: to },
      },
    });
    setFindOpen(false);
    setFindWhat("");
    setFindWith("");
    toast("success", `"${what}" is now "${to}" throughout.`);
  }

  // Adds the follow-ups at `indexes` to the global to-do list, skipping any
  // already there. Used by both the per-item button and "add all".
  async function pushActionsToTasks(indexes?: number[]) {
    if (!userId) return;
    const targets = indexes ?? actions.map((_, i) => i);
    let n = 0;
    const next = [...actions];
    for (const i of targets) {
      if (!next[i] || next[i].taskId) continue;
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
          <Button
            disabled={!hasMaterial || busy}
            onClick={() =>
              (debrief.transcript || "").trim()
                ? setRedoOpen(true)
                : void analyze()
            }
          >
            <Sparkles size={15} />
            {busy
              ? "Analyzing…"
              : notesHtml
                ? "Re-analyze"
                : "Summarize & extract follow-ups"}
          </Button>
        </div>
      </section>

      {notesHtml.trim() !== "" && (
        <>
          <section className="rounded-xl border border-border bg-surface p-4 shadow-sm">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
                Notes
              </h2>
              <div className="flex items-center gap-3">
                <span className="text-[11px] text-muted">Edits save automatically</span>
                <Button size="sm" variant="secondary" onClick={() => setFindOpen(true)}>
                  <Replace size={14} /> Rename
                </Button>
                <Button size="sm" variant="secondary" onClick={() => void copyNotes()}>
                  <Copy size={14} /> {copied ? "Copied" : "Copy all"}
                </Button>
                {/* Regenerating belongs next to what it regenerates — it used
                    to live at the bottom of the capture section above, which
                    is not where anyone looks for it. */}
                {(debrief.transcript || "").trim() && (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => setRedoOpen(true)}
                  >
                    <Sparkles size={14} /> {busy ? "Working…" : "Redo from transcript"}
                  </Button>
                )}
              </div>
            </div>

            {/* One document, not a stack of cards: these get pasted whole
                into OneNote, and separate blocks can't be. Top-level bullets
                are the topics; everything nests beneath them. */}
            <div
              ref={notesRef}
              className="relative"
              onMouseUp={onNotesSelect}
              onKeyUp={onNotesSelect}
            >
              {pick && (
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => openRenameFor(pick.text)}
                  style={{ top: pick.top, left: pick.left }}
                  className="absolute z-20 flex items-center gap-1 rounded-lg border border-border bg-surface px-2 py-1 text-xs font-medium shadow-lg"
                >
                  <Replace size={12} /> Rename &ldquo;{pick.text.slice(0, 24)}
                  {pick.text.length > 24 ? "…" : ""}&rdquo;
                </button>
              )}
              <RichText
                value={notesHtml}
                onChange={(html) =>
                  save({ debrief: { ...debrief, notesHtml: html } })
                }
                minHeight="min-h-64"
              />
            </div>
          </section>

          <section className="rounded-xl border border-border bg-surface p-4 shadow-sm">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
                Follow-ups ({actions.length})
              </h2>
              <Button
                size="sm"
                variant="secondary"
                disabled={selectedPending.length === 0}
                onClick={() => void pushActionsToTasks(selectedPending)}
              >
                <ListTodo size={14} />
                {selectedPending.length === 0
                  ? "All ticked ones added"
                  : `Add ${selectedPending.length} to to-do list`}
              </Button>
            </div>
            <p className="mb-3 text-xs text-muted">
              Untick anything you don&apos;t want on your to-do list.
            </p>
            {actions.length === 0 ? (
              <p className="text-sm text-muted">No follow-ups detected.</p>
            ) : (
              <ul className="space-y-1.5">
                {actions.map((a, i) => {
                  const ticked = a.selected !== false;
                  return (
                    <li key={i} className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={ticked}
                        disabled={!!a.taskId}
                        onChange={(e) => setAction(i, { selected: e.target.checked })}
                        className="mt-0.5 h-4 w-4 accent-[var(--accent)] disabled:opacity-40"
                        aria-label={`Include: ${a.text}`}
                      />
                      <span
                        className={`flex-1 text-sm ${
                          a.taskId ? "" : ticked ? "" : "text-muted line-through"
                        }`}
                      >
                        {a.text}
                      </span>
                      {a.taskId ? (
                        <span className="mt-0.5 flex shrink-0 items-center gap-1 text-[11px] font-medium text-emerald-700">
                          <CheckCircle2 size={12} /> On your list
                        </span>
                      ) : (
                        <button
                          onClick={() => void pushActionsToTasks([i])}
                          className="mt-0.5 flex shrink-0 items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[11px] font-medium text-muted transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
                          title="Add just this one to your to-do list"
                        >
                          <ListTodo size={11} /> Add
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}

      <Modal
        open={findOpen}
        onClose={() => setFindOpen(false)}
        title={findWhat ? `Rename "${findWhat}"` : "Rename throughout"}
        size="sm"
      >
        <div className="space-y-3">
          <p className="text-sm text-muted">
            Changes every mention at once — in the notes, the follow-ups and the
            saved transcript — and remembers it, so redoing the notes from the
            transcript keeps the name.
          </p>
          {!findWhat && (
            <Input
              label="Who or what"
              value={findWhat}
              onChange={(e) => setFindWhat(e.target.value)}
              placeholder="the manager"
              autoFocus
            />
          )}
          <Input
            label="Call them"
            value={findWith}
            onChange={(e) => setFindWith(e.target.value)}
            placeholder="Sarah Chen"
            autoFocus={!!findWhat}
          />
          <button
            type="button"
            onClick={() => setFindWith("I")}
            className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-muted transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
          >
            This was me
          </button>
          {findWith.trim() === "I" && (
            <p className="text-xs text-muted">
              Object and possessive forms are handled too — &ldquo;send Zach the
              data&rdquo; becomes &ldquo;send me the data&rdquo;, &ldquo;Zach&apos;s
              territory&rdquo; becomes &ldquo;my territory&rdquo;.
            </p>
          )}
          {findWhat.trim() && (
            <p className="text-xs text-muted">
              {countMatchesInHtml(notesHtml, findWhat.trim())} in the notes,{" "}
              {actions.filter((a) => countMatchesInHtml(a.text, findWhat.trim())).length}{" "}
              follow-up(s). Whole words only — renaming &ldquo;Zach&rdquo; leaves
              &ldquo;Zachary&rdquo; alone.
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setFindOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!findWhat.trim() || !findWith.trim()}
              onClick={replaceEverywhere}
            >
              Rename everywhere
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={redoOpen}
        onClose={() => setRedoOpen(false)}
        title="Redo the notes"
        size="md"
      >
        <div className="space-y-3">
          <p className="text-sm text-muted">
            Re-runs the notes and follow-ups from the saved transcript. The
            current sections and follow-ups are replaced.
          </p>

          {detected.length > 1 && (
            <div className="rounded-lg border border-border p-3">
              <p className="text-sm font-medium">Who is who?</p>
              <p className="mt-0.5 text-xs text-muted">
                These labels appear in the transcript. Correcting them here
                fixes attribution for good — the names are written into the
                transcript, not guessed from context.
              </p>
              <datalist id="omni-attendees">
                {attendeeNames.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
              <div className="mt-3 space-y-2">
                {detected.map((label) => (
                  <div key={label} className="flex items-start gap-2">
                    <span className="mt-2 w-24 shrink-0 truncate text-xs font-semibold" title={label}>
                      {label}
                    </span>
                    <div className="min-w-0 flex-1">
                      <input
                        value={renames[label] ?? ""}
                        onChange={(e) =>
                          setRenames((r) => ({ ...r, [label]: e.target.value }))
                        }
                        list="omni-attendees"
                        placeholder={
                          attendeeNames.length
                            ? "Pick or type a name"
                            : "Correct name (leave blank to keep)"
                        }
                        className="w-full rounded-md border border-border bg-canvas px-2 py-1.5 text-sm outline-none transition focus:border-[var(--accent)]"
                      />
                      {sampleFor(label) && (
                        <p className="mt-1 truncate text-[11px] italic text-muted">
                          &ldquo;{sampleFor(label)}…&rdquo;
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRedoOpen(false)}>
              Cancel
            </Button>
            <Button disabled={busy} onClick={() => void redo()}>
              <Sparkles size={15} /> {busy ? "Working…" : "Redo notes"}
            </Button>
          </div>
        </div>
      </Modal>

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
