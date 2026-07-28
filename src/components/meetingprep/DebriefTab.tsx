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
  Mail,
  MessageSquareText,
  Minimize2,
  Replace,
  Undo2,
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
import { useSessionProfile } from "@/lib/session";
import { TranscriptCapture } from "@/components/studio/TranscriptCapture";
import { useKolLite } from "./KolLink";
import { MentionedPeople } from "./MentionedPeople";
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
  const { profile } = useSessionProfile();
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
  const [emphasizeNotes, setEmphasizeNotes] = useState(true);
  const [pct, setPct] = useState(0);
  const [pickLi, setPickLi] = useState<HTMLLIElement | null>(null);
  const [simplifying, setSimplifying] = useState(false);
  const [undoNotes, setUndoNotes] = useState<string | null>(null);
  const [mailOpen, setMailOpen] = useState(false);
  const [mailBusy, setMailBusy] = useState(false);
  const [mailSubject, setMailSubject] = useState("");
  const [mailBody, setMailBody] = useState("");
  const [mailCopied, setMailCopied] = useState(false);
  const [picking, setPicking] = useState(false);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
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
    // The editable node itself, not the wrapper around it: the wrapper also
    // holds the toolbar and the floating rename popup, and serialising those
    // is what made the paste land one level indented with stray markup.
    const el = notesRef.current?.querySelector<HTMLElement>('[contenteditable="true"]');
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
  // Follow-ups not already on the to-do list.
  const pendingIndexes = actions
    .map((a, i) => (a.taskId ? -1 : i))
    .filter((i) => i >= 0);
  const pendingCount = pendingIndexes.length;

  // Everything here rides the meeting's existing debounced autosave, so
  // typing in a section behaves like every other field in the module.
  const notesText = DEBRIEF_QUESTIONS.map((q) =>
    (notes[q.key] || "").trim() ? `${q.label}\n${notes[q.key].trim()}` : "",
  )
    .filter(Boolean)
    .join("\n\n");
  const hasMaterial = Boolean(notesText || (debrief.transcript || "").trim());

  const setNote = (key: string, value: string) =>
    save({ debrief: { ...debrief, notes: { ...notes, [key]: value } } });

  async function analyze(transcriptOverride?: string) {
    const source = (transcriptOverride ?? debrief.transcript ?? "").trim();
    // Anything typed into the debrief questions is the writer's own notes —
    // it goes in as such, so it gets the priority weighting, rather than
    // being glued onto the front of the transcript as more transcript.
    if (!source && !notesText) return;
    setBusy(true);
    setPct(0);
    // The model reports no progress, so this is an estimate paced off how much
    // text it has to read. It eases toward 95% and only reaches 100 when the
    // notes actually land — it never claims to be done before it is.
    const expectedMs = Math.min(120_000, 15_000 + (source.length + notesText.length) * 3);
    const startedAt = Date.now();
    const ticker = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      setPct(Math.min(95, Math.round((1 - Math.exp(-elapsed / (expectedMs / 2.5))) * 95)));
    }, 250);
    try {
      const res = await fetch("/api/meeting/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        // Same action the recorder uses, so a typed debrief and a recorded
        // one both come back as editable sections rather than one blob.
        body: JSON.stringify({
          action: "capture",
          transcript: source || notesText,
          hint: meetingContextText(m),
          ownNotes: source ? notesText : "",
          emphasizeNotes,
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
      setPct(100);
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      clearInterval(ticker);
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
    if (!sel || !el || !sel.rangeCount || !el.contains(sel.anchorNode)) {
      setPick(null);
      setPickLi(null);
      return;
    }
    const li = enclosingLi();
    setPickLi(li);

    const text = sel.isCollapsed ? "" : sel.toString().trim();
    const anchor = sel.isCollapsed ? li : null;
    const rect = text
      ? sel.getRangeAt(0).getBoundingClientRect()
      : anchor?.getBoundingClientRect();
    if (!rect || (!text && !li)) return setPick(null);

    const box = el.getBoundingClientRect();
    setPick({
      text: text && text.length <= 60 ? text : "",
      top: rect.top - box.top - 38,
      left: Math.max(0, rect.left - box.left),
    });
  }

  // The <li> the caret or selection currently sits in, plus its nesting depth.
  // Simplifying works on a whole bullet and everything under it, which is the
  // unit people actually think in.
  function enclosingLi(): HTMLLIElement | null {
    const sel = window.getSelection();
    const root = notesRef.current;
    if (!sel?.anchorNode || !root || !root.contains(sel.anchorNode)) return null;
    let node: Node | null = sel.anchorNode;
    while (node && node !== root) {
      if (node instanceof HTMLLIElement) return node;
      node = node.parentNode;
    }
    return null;
  }

  // Condense one bullet in place. The rest of the notes are untouched, and the
  // previous version is kept so a too-aggressive trim can be put back.
  async function simplifyBullet() {
    const li = pickLi;
    const editable = notesRef.current?.querySelector<HTMLElement>('[contenteditable="true"]');
    if (!li || !editable) return;
    setPick(null);
    setSimplifying(true);
    try {
      const res = await fetch("/api/meeting/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ action: "simplify", fragment: li.outerHTML }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not simplify that point");
      const fragment = String(json.fragment || "").trim();
      if (!/^<li[\s>]/i.test(fragment)) throw new Error("Could not simplify that point");

      setUndoNotes(notesHtml);
      li.outerHTML = fragment;
      save({ debrief: { ...debrief, notesHtml: editable.innerHTML } });
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setSimplifying(false);
      setPickLi(null);
    }
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

    // Every place a name lives, not just the notes. Missing one leaves the
    // meeting half-renamed, which reads worse than not renaming at all.
    const typedNotes: Record<string, string> = {};
    for (const [k, v] of Object.entries(notes)) {
      typedNotes[k] = renameInText(String(v || ""), what, to);
    }

    save({
      title: renameInText(m.title || "", what, to),
      attendees: (m.attendees || []).map((a) => ({
        ...a,
        name: renameInText(a.name || "", what, to),
        role: renameInText(a.role || "", what, to),
        notes: renameInText(a.notes || "", what, to),
      })),
      debrief: {
        ...debrief,
        notesHtml: renameInHtml(notesHtml, what, to),
        notes: typedNotes,
        actions: actions.map((a) => ({ ...a, text: renameInText(a.text, what, to) })),
        ...(debrief.transcript
          ? { transcript: renameInText(debrief.transcript, what, to) }
          : {}),
        // Remembered, so re-running the notes doesn't undo it.
        nameMap: { ...(debrief.nameMap || {}), [what]: to },
      },
    });

    // A drafted email is on screen and saved nowhere, so it has to be renamed
    // in place or it silently keeps the old name.
    setMailSubject((v) => renameInText(v, what, to));
    setMailBody((v) => renameInText(v, what, to));

    setFindOpen(false);
    setFindWhat("");
    setFindWith("");
    toast("success", `"${what}" is now "${to}" throughout.`);
  }

  // --- recap email --------------------------------------------------------
  // Drafted from the notes that already exist, so it stays consistent with
  // what was agreed rather than being a second, divergent summary.
  async function draftRecap() {
    setMailBusy(true);
    try {
      const res = await fetch("/api/meeting/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          action: "recap_email",
          notes: notesHtml,
          actions: actions.filter((a) => a.selected !== false).map((a) => a.text),
          title: m.title,
          when: m.date ? new Date(m.date).toLocaleDateString() : "",
          sender: profile?.displayName || "",
          recipients: (m.attendees || []).map((a) => a.name).filter(Boolean),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not draft the email");
      setMailSubject(json.subject || m.title || "Meeting recap");
      setMailBody(json.body || "");
    } catch (e) {
      toast("error", (e as Error).message);
      setMailOpen(false);
    } finally {
      setMailBusy(false);
    }
  }

  async function copyMail() {
    await navigator.clipboard
      .writeText(`${mailSubject}\n\n${mailBody}`)
      .catch(() => {});
    setMailCopied(true);
    setTimeout(() => setMailCopied(false), 1800);
  }

  function openMail(where: "outlook" | "gmail" | "default") {
    // Attendees are stored by name only, so the recipient line is left for
    // the user to fill in wherever they compose.
    const to = "";
    const s = encodeURIComponent(mailSubject);
    const b = encodeURIComponent(mailBody);
    const url =
      where === "gmail"
        ? `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${s}&body=${b}`
        : where === "outlook"
          ? `https://outlook.office.com/mail/deeplink/compose?to=${encodeURIComponent(to)}&subject=${s}&body=${b}`
          : `mailto:${to}?subject=${s}&body=${b}`;
    window.open(url, where === "default" ? "_self" : "_blank", "noopener");
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
    setPicking(false);
    setChosen(new Set());
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
                onClick={async () => {
                  if (
                    await confirm({
                      title: "Delete the transcript?",
                      message:
                        "The recording it came from was already deleted, so this cannot be recovered. You will also lose the ability to redo the notes from it.",
                      confirmLabel: "Delete transcript",
                      danger: true,
                    })
                  ) {
                    save({ debrief: { ...debrief, transcript: "" } });
                  }
                }}
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
                {undoNotes !== null && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      save({ debrief: { ...debrief, notesHtml: undoNotes } });
                      setUndoNotes(null);
                    }}
                  >
                    <Undo2 size={14} /> Undo shorten
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setMailOpen(true);
                    void draftRecap();
                  }}
                >
                  <Mail size={14} /> Email recap
                </Button>
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
            {busy && (
              <div className="mb-3 rounded-lg border border-border bg-canvas p-4">
                <div className="flex items-center gap-3">
                  <p className="flex flex-1 items-center gap-2 text-sm font-medium">
                    <Sparkles size={15} className="animate-pulse text-[var(--accent)]" />
                    Rewriting your notes
                  </p>
                  <span className="shrink-0 font-mono text-sm font-semibold tabular-nums text-[var(--accent)]">
                    {pct}%
                  </span>
                </div>
                <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-surface">
                  <div
                    className="h-full rounded-full bg-[var(--accent)] transition-all duration-300"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            )}

            <div
              ref={notesRef}
              className="relative"
              onMouseUp={onNotesSelect}
              onKeyUp={onNotesSelect}
            >
              {pick && (pick.text || pickLi) && (
                <div
                  onMouseDown={(e) => e.preventDefault()}
                  style={{ top: pick.top, left: pick.left }}
                  className="absolute z-20 flex items-center gap-1 rounded-lg border border-border bg-surface p-1 shadow-lg"
                >
                  {pick.text && (
                    <button
                      type="button"
                      onClick={() => openRenameFor(pick.text)}
                      className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition hover:bg-canvas"
                    >
                      <Replace size={12} /> Rename &ldquo;{pick.text.slice(0, 20)}
                      {pick.text.length > 20 ? "…" : ""}&rdquo;
                    </button>
                  )}
                  {pickLi && (
                    <button
                      type="button"
                      disabled={simplifying}
                      onClick={() => void simplifyBullet()}
                      className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition hover:bg-canvas disabled:opacity-60"
                      title="Shorten this bullet and everything under it"
                    >
                      <Minimize2 size={12} /> {simplifying ? "Shortening…" : "Too detailed"}
                    </button>
                  )}
                </div>
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

          <MentionedPeople
            notesHtml={notesHtml}
            userId={userId}
            linkedKolId={m.kol_id}
            onLinkKol={(kolId) => save({ kol_id: kolId })}
          />

          <section className="rounded-xl border border-border bg-surface p-4 shadow-sm">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
                Follow-ups ({actions.length})
              </h2>
              {/* Default is one Add per item plus Add all. Tick boxes only
                  appear if you ask for them, because most of the time you
                  either want one or you want the lot. */}
              <div className="flex flex-wrap gap-2">
                {pendingCount > 0 &&
                  (picking ? (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setPicking(false);
                          setChosen(new Set());
                        }}
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        disabled={chosen.size === 0}
                        onClick={() => void pushActionsToTasks([...chosen])}
                      >
                        <ListTodo size={14} /> Add {chosen.size} selected
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setPicking(true);
                          setChosen(new Set(pendingIndexes));
                        }}
                      >
                        Choose some
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => void pushActionsToTasks(pendingIndexes)}
                      >
                        <ListTodo size={14} /> Add all to to-do list
                      </Button>
                    </>
                  ))}
              </div>
            </div>
            {actions.length === 0 ? (
              <p className="text-sm text-muted">No follow-ups detected.</p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {actions.map((a, i) => (
                  <li key={i} className="flex items-start gap-2">
                    {picking && !a.taskId && (
                      <input
                        type="checkbox"
                        checked={chosen.has(i)}
                        onChange={(e) =>
                          setChosen((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(i);
                            else next.delete(i);
                            return next;
                          })
                        }
                        className="mt-1 h-4 w-4 shrink-0 accent-[var(--accent)]"
                        aria-label={`Include: ${a.text}`}
                      />
                    )}
                    <span className="flex-1 text-sm">{a.text}</span>
                    {a.taskId ? (
                      <span className="mt-0.5 flex shrink-0 items-center gap-1 text-[11px] font-medium text-emerald-700">
                        <CheckCircle2 size={12} /> On your list
                      </span>
                    ) : (
                      !picking && (
                        <button
                          onClick={() => void pushActionsToTasks([i])}
                          className="mt-0.5 flex shrink-0 items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[11px] font-medium text-muted transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
                          title="Add this one to your to-do list"
                        >
                          <ListTodo size={11} /> Add
                        </button>
                      )
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      <Modal
        open={mailOpen}
        onClose={() => setMailOpen(false)}
        title="Email recap"
        size="lg"
      >
        <div className="space-y-3">
          {mailBusy ? (
            <p className="flex items-center gap-2 py-8 text-sm text-muted">
              <Sparkles size={15} className="animate-pulse text-[var(--accent)]" />
              Drafting the recap…
            </p>
          ) : (
            <>
              <p className="text-sm text-muted">
                The note people send round afterwards so everyone has the same
                understanding of what was agreed. Edit it before you send.
              </p>
              <Input
                label="Subject"
                value={mailSubject}
                onChange={(e) => setMailSubject(e.target.value)}
              />
              <Textarea
                label="Message"
                value={mailBody}
                onChange={(e) => setMailBody(e.target.value)}
                className="min-h-72 text-sm"
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button variant="secondary" size="sm" onClick={() => void copyMail()}>
                  <Copy size={14} /> {mailCopied ? "Copied" : "Copy"}
                </Button>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" size="sm" onClick={() => openMail("outlook")}>
                    Open in Outlook
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => openMail("gmail")}>
                    Open in Gmail
                  </Button>
                  <Button size="sm" onClick={() => openMail("default")}>
                    <Mail size={14} /> Mail app
                  </Button>
                </div>
              </div>
              <p className="text-[11px] text-muted">
                Long recaps can exceed what a compose link will carry. If the
                message opens truncated, use Copy and paste it in.
              </p>
            </>
          )}
        </div>
      </Modal>

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
            Re-runs the notes and follow-ups from the saved transcript — no
            need to upload anything again. It always uses the current version,
            so this is how you pick up any improvement to how notes are
            written. The existing notes and follow-ups are replaced; names you
            renamed are reapplied.
          </p>

          {notesText && (
            <label className="flex cursor-pointer items-start gap-2.5 rounded-lg bg-canvas p-3 text-xs">
              <input
                type="checkbox"
                checked={emphasizeNotes}
                onChange={(e) => setEmphasizeNotes(e.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 accent-[var(--accent)]"
              />
              <span>
                <span className="font-medium">
                  Treat my typed answers as the priority
                </span>
                <span className="mt-0.5 block text-muted">
                  What you wrote in the questions above leads its topic and is
                  never dropped. Untick to weigh it the same as the transcript.
                </span>
              </span>
            </label>
          )}

          {detected.length <= 1 && (
            <p className="rounded-lg bg-canvas p-3 text-xs text-muted">
              This transcript has no speaker labels, so there is nobody to name
              here — it was transcribed as one stream and the notes will stay
              impersonal rather than guess who said what. Recordings made from
              now on separate the voices. To put a real name on something like
              &ldquo;the manager&rdquo;, select it in the notes and use Rename.
            </p>
          )}

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
