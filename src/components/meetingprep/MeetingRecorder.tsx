"use client";

// Turn a meeting into notes, from either end of it:
//
//   Upload — drop in a recording you already have (Teams, a phone, a
//            dictaphone). Any length; big files stream through storage.
//   Record — capture a meeting happening right now: your mic, plus the
//            meeting's own audio if you share the Teams tab/screen. It ends
//            itself when the share ends, so nobody has to remember to stop it.
//
// Both land in the same place: transcript → nested-bullet notes → action
// items → a meeting created for you, with nothing to set up first.
//
// Audio is never kept. Recorded segments go to Whisper and are dropped, the
// local crash vault is wiped the moment recording stops, and an uploaded file
// is deleted server-side as soon as it has been read — on the failure paths
// too. The transcript is the only intermediate artifact, and the last step
// lets you delete that as well once the notes are in hand.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  ClipboardType,
  FileAudio,
  ListTodo,
  Loader2,
  Mic,
  MonitorSpeaker,
  ShieldCheck,
  Square,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { RichText } from "@/components/ui/RichText";
import { useToast } from "@/components/ui/Feedback";
import { startLiveCapture, type LiveCapture } from "@/lib/meetingprep/liveCapture";
import type { DebriefSection } from "@/lib/meetingprep/types";
import { transcribeUpload, type UploadProgress } from "@/lib/meetingprep/uploadCapture";

export interface CaptureAction {
  text: string;
  /** Ticked items are the ones that get saved as follow-ups. */
  selected: boolean;
}

export interface CaptureResult {
  title: string;
  sections: DebriefSection[];
  actions: CaptureAction[];
  transcript: string;
  /** Where the opening pleasantries end, when there were any we could locate. */
  smallTalk?: { description: string; cutAt: number };
}

type Phase =
  | "idle"
  | "starting"
  | "recording"
  | "uploading"
  | "deciding"
  | "summarizing"
  | "review"
  | "error";

// Teams, Zoom and Meet all export transcripts as WebVTT/SRT, so a pasted one
// usually arrives wrapped in cue numbers and timestamps. Strip those — they
// are noise to the model — but keep speaker labels, which materially improve
// the notes because they tell it who committed to what.
function cleanTranscript(raw: string): string {
  const rows: { speaker: string; text: string }[] = [];

  for (const line of raw.replace(/\r/g, "").split("\n")) {
    let t = line.trim();
    if (!t) continue;
    if (/^WEBVTT/i.test(t)) continue;
    if (/^(NOTE|STYLE|REGION)\b/i.test(t)) continue;
    if (/^\d+$/.test(t)) continue; // SRT cue number
    // 00:00:12.480 --> 00:00:15.200
    if (/^[\d:.,]+\s*-->\s*[\d:.,]+/.test(t)) continue;
    // Leading "[00:12:03]" or "00:12:03" on a spoken line
    t = t.replace(/^\[?\d{1,2}:\d{2}(:\d{2})?([.,]\d+)?\]?\s*/, "");

    // Teams wraps each cue in a voice tag: <v Dr. Chen>…</v>
    let speaker = "";
    const voice = t.match(/^<v\s+([^>]+)>([\s\S]*?)(?:<\/v>)?$/i);
    if (voice) {
      speaker = voice[1].trim();
      t = voice[2];
    }
    t = t.replace(/<[^>]+>/g, "").trim(); // any remaining cue markup
    if (!t) continue;

    // Zoom/Meet style: "Speaker Name: said this"
    if (!speaker) {
      const named = t.match(/^([A-Z][\w.'-]*(?:\s+[A-Z0-9][\w.'-]*){0,3}):\s+(.*)$/);
      if (named) {
        speaker = named[1];
        t = named[2];
      }
    }

    // Subtitle formats cut sentences mid-flow across cues. Continue the
    // previous row when the same person is still talking and the text picks
    // up where it left off, so the model reads prose not fragments.
    const prev = rows[rows.length - 1];
    const continues = /[a-z,;]$/.test(prev?.text ?? "") || /^[a-z,]/.test(t);
    if (prev && prev.speaker === speaker && continues) {
      prev.text = `${prev.text} ${t}`.replace(/\s+/g, " ");
    } else {
      rows.push({ speaker, text: t });
    }
  }

  return rows
    .map((r) => (r.speaker ? `${r.speaker}: ${r.text}` : r.text))
    .join("\n")
    .trim();
}

function mmss(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function MeetingRecorder({
  onSave,
  saving,
}: {
  /** Persist the finished notes. `transcript` is "" when the user drops it. */
  onSave: (result: CaptureResult) => Promise<void>;
  saving?: boolean;
}) {
  const toast = useToast();
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [includeMeetingAudio, setIncludeMeetingAudio] = useState(true);
  const [hint, setHint] = useState("");
  const [consent, setConsent] = useState(false);
  const [autoEnded, setAutoEnded] = useState(false);
  const [hasMeetingAudio, setHasMeetingAudio] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [result, setResult] = useState<CaptureResult | null>(null);
  const [keepTranscript, setKeepTranscript] = useState(true);
  const [upload, setUpload] = useState<UploadProgress | null>(null);
  const [fileName, setFileName] = useState("");
  const [notesPct, setNotesPct] = useState(0);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasted, setPasted] = useState("");
  const [trimSmallTalk, setTrimSmallTalk] = useState(true);
  const [ownNotes, setOwnNotes] = useState("");
  const [emphasizeNotes, setEmphasizeNotes] = useState(true);

  const captureRef = useRef<LiveCapture | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedRef = useRef(0);

  const clearTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  };

  // Leaving mid-recording must not orphan the mic/share.
  useEffect(() => {
    return () => {
      clearTimer();
      void captureRef.current?.discard();
    };
  }, []);

  // A recording in progress is easy to lose by reflex-closing the tab.
  useEffect(() => {
    if (phase !== "recording") return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [phase]);

  // "Stop sharing" and the Stop button can race — whichever lands first wins
  // and the other becomes a no-op, otherwise the second call finds a spent
  // capture and reports an empty recording.
  const finishingRef = useRef(false);

  const finish = useCallback(async () => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    clearTimer();
    setPhase("deciding");
    try {
      const text = (await captureRef.current?.stop()) || "";
      captureRef.current = null;
      setTranscript(text);
      if (!text.trim()) {
        setError("No speech was picked up in that recording.");
        setPhase("error");
      }
    } catch (e) {
      setError((e as Error).message);
      setPhase("error");
    }
  }, []);

  async function start() {
    setError("");
    setAutoEnded(false);
    finishingRef.current = false;
    setPhase("starting");
    try {
      const capture = await startLiveCapture(
        `mp-live-${Date.now()}`,
        includeMeetingAudio,
        {
          onSegment: () => {},
          onProgress: (done, total) => setProgress({ done, total }),
          onSourceEnded: () => {
            // The meeting window closed / they hit "Stop sharing" — that's
            // the end of the meeting, so wrap up without making them come
            // back to this tab to press stop.
            setAutoEnded(true);
            void finish();
          },
          onError: (m) => toast("error", m),
        },
      );
      captureRef.current = capture;
      setHasMeetingAudio(capture.hasMeetingAudio);
      elapsedRef.current = 0;
      setElapsed(0);
      setProgress({ done: 0, total: 0 });
      setPhase("recording");
      timerRef.current = setInterval(() => {
        elapsedRef.current += 1;
        setElapsed(elapsedRef.current);
      }, 1000);
    } catch (e) {
      const msg = (e as Error).message || "";
      setError(
        /denied|NotAllowed/i.test(msg)
          ? "Microphone or screen-share permission was denied, so there's nothing to record."
          : msg || "Could not start recording.",
      );
      setPhase("error");
    }
  }

  // Upload path: an existing recording of any length. Same destination as a
  // live capture — straight to the decision prompt with a transcript in hand.
  async function handleFile(file: File | null) {
    if (!file) return;
    setError("");
    setFileName(file.name);
    setUpload({ percent: 0, label: "Uploading" });
    setPhase("uploading");
    try {
      const text = await transcribeUpload(file, setUpload);
      setUpload(null);
      if (!text.trim()) {
        setError("No speech was picked up in that file.");
        setPhase("error");
        return;
      }
      setTranscript(text);
      // Reuse the file's name as the starting hint — it's often the only
      // clue about what the meeting was.
      setHint((h) => h || file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " "));
      setPhase("deciding");
    } catch (e) {
      setUpload(null);
      setError((e as Error).message || "Could not process that file.");
      setPhase("error");
    }
  }

  // A transcript you already have needs no upload and no transcription — it
  // joins the flow at the point the other two paths reach eventually.
  function useTranscript() {
    const text = cleanTranscript(pasted);
    if (!text) return;
    setError("");
    setTranscript(text);
    setPasteOpen(false);
    setPasted("");
    // Into the same confirm step the other two paths reach, so a pasted
    // transcript can carry your own notes and the hint as well.
    setPhase("deciding");
  }

  async function discardEverything() {
    await captureRef.current?.discard();
    captureRef.current = null;
    setTranscript("");
    setResult(null);
    setProgress({ done: 0, total: 0 });
    setUpload(null);
    setFileName("");
    setElapsed(0);
    setOwnNotes("");
    setPhase("idle");
  }

  // Review-screen edits live in local state — nothing is written until Save,
  // which is the point: you shouldn't have to save notes to fix them.
  const patchResult = (patch: Partial<CaptureResult>) =>
    setResult((r) => (r ? { ...r, ...patch } : r));

  const patchSection = (key: string, patch: Partial<DebriefSection>) =>
    setResult((r) =>
      r
        ? { ...r, sections: r.sections.map((s) => (s.key === key ? { ...s, ...patch } : s)) }
        : r,
    );

  const removeSection = (key: string) =>
    setResult((r) => (r ? { ...r, sections: r.sections.filter((s) => s.key !== key) } : r));

  const patchAction = (index: number, patch: Partial<CaptureAction>) =>
    setResult((r) =>
      r
        ? { ...r, actions: r.actions.map((a, i) => (i === index ? { ...a, ...patch } : a)) }
        : r,
    );

  const removeAction = (index: number) =>
    setResult((r) => (r ? { ...r, actions: r.actions.filter((_, i) => i !== index) } : r));

  const summarize = () => summarizeText(transcript);

  // Takes the text explicitly: the paste path calls this in the same tick it
  // sets `transcript`, so reading the state here would send an empty string.
  async function summarizeText(source: string) {
    setPhase("summarizing");
    setNotesPct(0);
    // The model gives no progress signal, so this is an estimate paced off
    // transcript length. It eases toward 95% and only reaches 100 when the
    // notes actually land — it never claims to be finished before it is.
    const expectedMs = Math.min(120_000, 15_000 + source.length * 3);
    const startedAt = Date.now();
    const ticker = setInterval(() => {
      const elapsedMs = Date.now() - startedAt;
      setNotesPct(Math.min(95, Math.round((1 - Math.exp(-elapsedMs / (expectedMs / 2.5))) * 95)));
    }, 250);
    try {
      const res = await fetch("/api/meeting/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          action: "capture",
          transcript: source,
          hint,
          ownNotes,
          emphasizeNotes,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not summarize the recording");
      // Only offer the trim if the quoted line is actually findable — a
      // paraphrase would otherwise silently cut the wrong place, or nothing.
      const marker = String(json.smallTalk?.firstSubstantiveLine || "").trim();
      const cutAt = json.smallTalk?.found && marker ? source.indexOf(marker) : -1;

      setResult({
        title: json.title || hint.trim() || "Recorded meeting",
        sections: json.sections || [],
        actions: (json.actions || []).map((text: string) => ({ text, selected: true })),
        transcript: source,
        smallTalk:
          cutAt > 0
            ? { description: String(json.smallTalk.description || "small talk"), cutAt }
            : undefined,
      });
      setTrimSmallTalk(true);
      setNotesPct(100);
      setKeepTranscript(true);
      setPhase("review");
    } catch (e) {
      setError((e as Error).message);
      setPhase("error");
    } finally {
      clearInterval(ticker);
    }
  }

  async function save() {
    if (!result) return;
    const trimmed =
      result.smallTalk && trimSmallTalk
        ? result.transcript.slice(result.smallTalk.cutAt)
        : result.transcript;
    await onSave({
      ...result,
      actions: result.actions.filter((a) => a.selected),
      transcript: keepTranscript ? trimmed : "",
    });
  }

  // ------------------------------------------------------------------
  // Recording
  // ------------------------------------------------------------------
  if (phase === "recording") {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-5">
        <div className="flex items-center gap-3">
          <span className="h-3 w-3 animate-pulse rounded-full bg-red-500" />
          <span className="font-mono text-2xl font-bold tabular-nums text-red-700">
            {mmss(elapsed)}
          </span>
          <span className="flex-1" />
          <Button variant="danger" onClick={() => void finish()}>
            <Square size={15} /> End &amp; review
          </Button>
        </div>
        <p className="mt-3 flex items-center gap-2 text-xs text-red-900/70">
          <MonitorSpeaker size={13} />
          {hasMeetingAudio
            ? "Capturing your mic and the meeting's audio. Ends automatically when you stop sharing."
            : "Capturing your microphone only."}
        </p>
        {progress.total > 0 && (
          <p className="mt-1 text-xs text-red-900/70">
            Transcribing as we go — {progress.done}/{progress.total} segments done.
          </p>
        )}
        <p className="mt-3 text-xs text-red-900/60">
          You can switch tabs and use Teams normally. Keep this tab open.
        </p>
      </div>
    );
  }

  // ------------------------------------------------------------------
  // Uploading an existing recording
  // ------------------------------------------------------------------
  if (phase === "uploading" || phase === "summarizing") {
    // One bar, one number, counting once from 0 to 100 per stage. Inline on
    // the page, not in a dialog — a dialog that closed on the way here left
    // the user staring at a screen that looked idle.
    const writing = phase === "summarizing";
    const pct = writing ? notesPct : (upload?.percent ?? 0);
    const label = writing ? "Writing your notes" : upload?.label || "Working";
    return (
      <div className="rounded-xl border border-border bg-surface p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <p className="flex flex-1 items-center gap-2 text-sm font-medium">
            <Loader2 size={15} className="animate-spin text-[var(--accent)]" />
            {label}
            {!writing && fileName && (
              <span className="truncate text-muted">· {fileName}</span>
            )}
          </p>
          <span className="shrink-0 font-mono text-sm font-semibold tabular-nums text-[var(--accent)]">
            {pct}%
          </span>
        </div>
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-canvas">
          <div
            className="h-full rounded-full bg-[var(--accent)] transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="mt-3 text-xs text-muted">
          {writing
            ? "Reading the transcript and pulling out the follow-ups."
            : "A full-length meeting can take a few minutes. Keep this tab open."}
        </p>
      </div>
    );
  }

  // ------------------------------------------------------------------
  // Wrapping up / the "what do you want to do with this?" prompt
  // ------------------------------------------------------------------
  if (phase === "deciding") {
    const wrapping = !transcript;
    return (
      <>
        <div className="rounded-xl border border-border bg-surface p-5 text-sm text-muted">
          <p className="flex items-center gap-2">
            <Loader2 size={15} className="animate-spin text-[var(--accent)]" />
            {progress.total > 0 && progress.done < progress.total
              ? `Finishing the transcript — ${progress.done}/${progress.total} left to go.`
              : "Finishing the transcript…"}
          </p>
        </div>

        <Modal
          open={!wrapping}
          onClose={() => {}}
          title={
            autoEnded
              ? "That meeting just ended"
              : elapsed > 0
                ? "Recording finished"
                : "Ready to write your notes"
          }
          size="sm"
        >
          <div className="space-y-4">
            {/* An uploaded file has no elapsed time — only a live recording
                does. Saying "00:00 captured" on the upload path was just
                wrong, so the timing line is scoped to the recorder. */}
            <p className="text-sm text-muted">
              {elapsed > 0
                ? `${mmss(elapsed)} captured. Want me to turn it into notes with follow-up actions?`
                : "Got it. Want me to turn this into notes with follow-up actions?"}
            </p>
            <Input
              label="Anything I should know about this meeting? (optional)"
              value={hint}
              onChange={(e) => setHint(e.target.value)}
              placeholder="e.g. advisory board with Dr. Chen and Dr. Ruiz"
            />

            {/* Anything the user wrote down themselves is, by definition, what
                they thought was worth writing down — so it can outrank the
                transcript rather than just sit alongside it. */}
            <Textarea
              label="Your own notes (optional)"
              value={ownNotes}
              onChange={(e) => setOwnNotes(e.target.value)}
              placeholder="Whatever you jotted down during or after the meeting…"
              className="min-h-24"
            />
            {ownNotes.trim() && (
              <label className="flex cursor-pointer items-start gap-2.5 rounded-lg bg-canvas p-3 text-xs">
                <input
                  type="checkbox"
                  checked={emphasizeNotes}
                  onChange={(e) => setEmphasizeNotes(e.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 accent-[var(--accent)]"
                />
                <span>
                  <span className="font-medium">Treat my notes as the priority</span>
                  <span className="mt-0.5 block text-muted">
                    Everything you wrote is carried into the notes and leads its
                    section — you wrote it down, so it mattered. Untick to weigh
                    them the same as the transcript.
                  </span>
                </span>
              </label>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => void discardEverything()}>
                <Trash2 size={15} /> Discard it
              </Button>
              <Button onClick={() => void summarize()}>Make my notes</Button>
            </div>
          </div>
        </Modal>
      </>
    );
  }

  // ------------------------------------------------------------------
  // Review the notes, decide the transcript's fate, save
  // ------------------------------------------------------------------
  if (phase === "review" && result) {
    const selectedCount = result.actions.filter((a) => a.selected).length;
    return (
      <div className="space-y-4">
        <section className="rounded-xl border border-border bg-surface p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--accent)]">
            Notes from your recording
          </p>
          <input
            value={result.title}
            onChange={(e) => patchResult({ title: e.target.value })}
            className="mt-1 w-full bg-transparent text-lg font-semibold tracking-tight outline-none"
            aria-label="Meeting title"
          />
          <p className="mb-3 mt-1 text-xs text-muted">
            Edit anything below before saving — nothing is written until you do.
          </p>

          <div className="space-y-4">
            {result.sections.map((sec) => (
              <div key={sec.key} className="rounded-lg border border-border">
                <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                  <input
                    value={sec.title}
                    onChange={(e) => patchSection(sec.key, { title: e.target.value })}
                    className="min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none"
                    aria-label="Section title"
                  />
                  <button
                    onClick={() => removeSection(sec.key)}
                    className="shrink-0 rounded p-1 text-muted transition hover:text-red-600"
                    aria-label={`Delete ${sec.title}`}
                    title="Delete this section"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <div className="p-3">
                  <RichText
                    value={sec.content}
                    onChange={(html) => patchSection(sec.key, { content: html })}
                  />
                </div>
              </div>
            ))}
            {result.sections.length === 0 && (
              <p className="text-sm text-muted">
                No notes left — everything was deleted.
              </p>
            )}
          </div>
        </section>

        <section className="rounded-xl border border-border bg-surface p-5 shadow-sm">
          <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted">
            <ListTodo size={15} /> Action items ({selectedCount}/{result.actions.length})
          </h3>
          {result.actions.length === 0 ? (
            <p className="text-sm text-muted">
              Nothing in the recording read as a commitment or a next step.
            </p>
          ) : (
            <>
              <p className="mb-3 text-xs text-muted">
                Untick anything you don&apos;t want kept, and edit the wording
                before it lands on your to-do list.
              </p>
              <ul className="space-y-2">
                {result.actions.map((a, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={a.selected}
                      onChange={(e) => patchAction(i, { selected: e.target.checked })}
                      className="mt-2 h-4 w-4 shrink-0 accent-[var(--accent)]"
                      aria-label={`Keep: ${a.text}`}
                    />
                    <input
                      value={a.text}
                      onChange={(e) => patchAction(i, { text: e.target.value })}
                      className={`min-w-0 flex-1 rounded-md border border-transparent bg-canvas px-2 py-1.5 text-sm outline-none transition focus:border-[var(--accent)] ${
                        a.selected ? "" : "text-muted line-through"
                      }`}
                      aria-label="Follow-up wording"
                    />
                    <button
                      onClick={() => removeAction(i)}
                      className="mt-1.5 shrink-0 rounded p-1 text-muted transition hover:text-red-600"
                      aria-label={`Delete ${a.text}`}
                      title="Remove this follow-up"
                    >
                      <Trash2 size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        {result.smallTalk && (
          <section className="rounded-xl border border-border bg-surface p-4 shadow-sm">
            <label className="flex cursor-pointer items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                checked={trimSmallTalk}
                onChange={(e) => setTrimSmallTalk(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
                disabled={!keepTranscript}
              />
              <span className={keepTranscript ? "" : "opacity-50"}>
                Cut the opening {result.smallTalk.description} from the transcript
                <span className="mt-0.5 block text-xs text-muted">
                  The first{" "}
                  {result.smallTalk.cutAt.toLocaleString()} characters are
                  pleasantries before anyone gets to the point. They were already
                  left out of the notes above — this drops them from the saved
                  transcript too.
                </span>
              </span>
            </label>
          </section>
        )}

        <section className="rounded-xl border border-border bg-surface p-4 shadow-sm">
          <label className="flex cursor-pointer items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={keepTranscript}
              onChange={(e) => setKeepTranscript(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
            />
            <span>
              Keep the full transcript ({result.transcript.length.toLocaleString()}{" "}
              characters)
              <span className="mt-0.5 block text-xs text-muted">
                Untick and only these notes are saved.
              </span>
            </span>
          </label>
        </section>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => void discardEverything()}>
            <Trash2 size={15} /> Discard everything
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            <Check size={15} /> {saving ? "Saving…" : "Save meeting"}
          </Button>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------------
  // Idle / error — pick how the recording gets here
  // ------------------------------------------------------------------
  return (
    <div className="space-y-4">
      {phase === "error" && (
        <p className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}

      {/* One consent gate for both paths — it's the same promise either way,
          and asking twice for the same thing just trains people to click
          past it. */}
      <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-border bg-surface p-4 text-sm shadow-sm">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
        />
        <span>
          <span className="font-medium">Everyone in the meeting knew it was being recorded and agreed to it.</span>
          <span className="mt-0.5 block text-xs text-muted">
            Recording it is allowed under my organization&apos;s policy and
            applicable law. Tick this to continue — it applies to uploading an
            existing recording as well as making a new one.
          </span>
        </span>
      </label>

      <div className={`grid gap-4 sm:grid-cols-2 ${consent ? "" : "pointer-events-none opacity-50"}`}>
        {/* Upload — the common case: the meeting already happened. */}
        <div className="flex flex-col rounded-xl border border-border bg-surface p-5 shadow-sm">
          <span className="mb-3 grid h-10 w-10 place-items-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
            <FileAudio size={20} />
          </span>
          <h2 className="font-semibold tracking-tight">Upload a recording</h2>
          <p className="mt-1 flex-1 text-sm text-muted">
            You already have the audio — a Teams recording, a voice memo,
            anything. Any length. I&apos;ll transcribe it, write nested-bullet
            notes, pull out the action items, and create the meeting for you.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept="audio/*,video/mp4,video/webm,.m4a,.mp3,.wav,.webm"
            className="hidden"
            onChange={(e) => {
              void handleFile(e.target.files?.[0] || null);
              e.target.value = "";
            }}
          />
          <Button className="mt-4" onClick={() => fileRef.current?.click()}>
            <FileAudio size={16} /> Choose a file
          </Button>
        </div>

        {/* Record — the meeting is happening now. */}
        <div className="flex flex-col rounded-xl border border-border bg-surface p-5 shadow-sm">
          <span className="mb-3 grid h-10 w-10 place-items-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
            <Mic size={20} />
          </span>
          <h2 className="font-semibold tracking-tight">Record it live</h2>
          <p className="mt-1 flex-1 text-sm text-muted">
            The meeting is starting now. Capture it as it happens — it stops
            itself when the meeting does, then asks whether to keep it.
          </p>

          <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-lg border border-border p-2.5 text-xs">
            <input
              type="checkbox"
              checked={includeMeetingAudio}
              onChange={(e) => setIncludeMeetingAudio(e.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 accent-[var(--accent)]"
            />
            <span>
              Capture the meeting&apos;s audio too, not just my microphone
              <span className="mt-0.5 block text-muted">
                Your browser asks what to share. Teams in a browser tab: pick
                that tab, tick &ldquo;Also share tab audio&rdquo;. Teams desktop
                app: pick <b>Entire Screen</b> and tick &ldquo;Also share system
                audio&rdquo; — a window share carries no sound.
              </span>
            </span>
          </label>

          <Button
            className="mt-4"
            variant="secondary"
            onClick={() => void start()}
            disabled={phase === "starting"}
          >
            <Mic size={16} />
            {phase === "starting" ? "Starting…" : "Start recording"}
          </Button>
        </div>
      </div>

      {/* Already have the text? Then there is no audio to capture, no upload,
          and nothing to transcribe — this joins the flow at the notes step.
          Deliberately outside the consent gate above, which is about
          recording. */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface p-4 text-sm shadow-sm">
        <ClipboardType size={16} className="shrink-0 text-[var(--accent)]" />
        <span className="flex-1">
          Already have a transcript?
          <span className="ml-1 text-muted">
            Teams, Zoom and Meet can export one — paste it and skip straight to
            the notes.
          </span>
        </span>
        <Button size="sm" variant="secondary" onClick={() => setPasteOpen(true)}>
          Paste a transcript
        </Button>
      </div>

      <p className="flex items-start gap-2 px-1 text-xs text-muted">
        <ShieldCheck size={14} className="mt-0.5 shrink-0 text-[var(--accent)]" />
        The audio is deleted as soon as it has been transcribed — it is never
        stored. You choose afterwards whether to keep even the transcript.
      </p>

      <Modal
        open={pasteOpen}
        onClose={() => setPasteOpen(false)}
        title="Paste a transcript"
        size="lg"
      >
        <div className="space-y-3">
          <p className="text-sm text-muted">
            Paste the text, or drop in a <code>.vtt</code>, <code>.srt</code> or{" "}
            <code>.txt</code> file — Teams, Zoom, Meet and Apple Voice Memos all
            export one. Timestamps and cue numbers are stripped automatically.
            Speaker names are kept, because they tell me who committed to what,
            and where a tool marks each new speaker with a line break that
            structure is preserved too.
          </p>
          <Textarea
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder={"00:00:04.120 --> 00:00:07.900\nDr. Chen: Let us start with the dosing data..."}
            className="min-h-64 font-mono text-xs"
            autoFocus
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-muted transition hover:text-ink">
              <FileAudio size={14} /> Load a transcript file
              <input
                type="file"
                accept=".vtt,.srt,.txt,.md,text/plain"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) setPasted(await f.text());
                }}
              />
            </label>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setPasteOpen(false)}>
                Cancel
              </Button>
              <Button disabled={!pasted.trim()} onClick={useTranscript}>
                Use this transcript
              </Button>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
