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
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Feedback";
import { startLiveCapture, type LiveCapture } from "@/lib/meetingprep/liveCapture";
import type { DebriefSection } from "@/lib/meetingprep/types";
import { transcribeUpload, type UploadProgress } from "@/lib/meetingprep/uploadCapture";

export interface CaptureResult {
  title: string;
  sections: DebriefSection[];
  actions: string[];
  transcript: string;
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

  async function discardEverything() {
    await captureRef.current?.discard();
    captureRef.current = null;
    setTranscript("");
    setResult(null);
    setProgress({ done: 0, total: 0 });
    setUpload(null);
    setFileName("");
    setElapsed(0);
    setPhase("idle");
  }

  async function summarize() {
    setPhase("summarizing");
    try {
      const res = await fetch("/api/meeting/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ action: "capture", transcript, hint }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not summarize the recording");
      setResult({
        title: json.title || hint.trim() || "Recorded meeting",
        sections: json.sections || [],
        actions: json.actions || [],
        transcript,
      });
      setKeepTranscript(true);
      setPhase("review");
    } catch (e) {
      setError((e as Error).message);
      setPhase("error");
    }
  }

  async function save() {
    if (!result) return;
    await onSave({
      ...result,
      transcript: keepTranscript ? result.transcript : "",
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
  if (phase === "uploading") {
    // One bar, one number, counting once from 0 to 100 across the whole job.
    const pct = upload?.percent ?? 0;
    return (
      <div className="rounded-xl border border-border bg-surface p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <p className="flex flex-1 items-center gap-2 text-sm font-medium">
            <Loader2 size={15} className="animate-spin text-[var(--accent)]" />
            {upload?.label || "Working"} {fileName && <span className="truncate text-muted">· {fileName}</span>}
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
          A full-length meeting can take a few minutes. Keep this tab open.
        </p>
      </div>
    );
  }

  // ------------------------------------------------------------------
  // Wrapping up / the "what do you want to do with this?" prompt
  // ------------------------------------------------------------------
  if (phase === "deciding" || phase === "summarizing") {
    const wrapping = phase === "deciding" && !transcript;
    return (
      <>
        <div className="rounded-xl border border-border bg-surface p-5 text-sm text-muted">
          <p className="flex items-center gap-2">
            <Loader2 size={15} className="animate-spin text-[var(--accent)]" />
            {phase === "summarizing"
              ? "Writing your notes and pulling out the follow-ups…"
              : progress.total > 0 && progress.done < progress.total
                ? `Finishing the transcript — ${progress.done}/${progress.total} segments.`
                : "Finishing the transcript…"}
          </p>
        </div>

        {/* The modal stays up while the notes are being written. Closing it
            first dropped the user onto a small card behind where the dialog
            had been, which read as nothing happening at all. */}
        <Modal
          open={phase === "summarizing"}
          onClose={() => {}}
          title="Writing your notes"
          size="sm"
        >
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <Loader2 size={28} className="animate-spin text-[var(--accent)]" />
            <p className="text-sm font-medium">
              Reading the transcript and pulling out the follow-ups…
            </p>
            <p className="text-xs text-muted">
              This takes about a minute for a full meeting.
            </p>
          </div>
        </Modal>

        <Modal
          open={!wrapping && phase === "deciding"}
          onClose={() => {}}
          title={autoEnded ? "That meeting just ended" : "Recording finished"}
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
    return (
      <div className="space-y-4">
        <section className="rounded-xl border border-border bg-surface p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--accent)]">
            Notes from your recording
          </p>
          <h2 className="mt-1 text-lg font-semibold tracking-tight">{result.title}</h2>
          <div className="mt-4 space-y-4">
            {result.sections.map((s) => (
              <div key={s.key}>
                <h3 className="text-sm font-semibold">{s.title}</h3>
                <div
                  className="mt-1 text-sm leading-relaxed [&_li]:ml-4 [&_li]:list-disc [&_ul]:mt-1"
                  dangerouslySetInnerHTML={{ __html: s.content }}
                />
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-muted">
            You can edit or delete any of this once it&apos;s saved.
          </p>
        </section>

        <section className="rounded-xl border border-border bg-surface p-5 shadow-sm">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted">
            <ListTodo size={15} /> Action items ({result.actions.length})
          </h3>
          {result.actions.length === 0 ? (
            <p className="text-sm text-muted">
              Nothing in the recording read as a commitment or a next step.
            </p>
          ) : (
            <>
              <ul className="space-y-1.5">
                {result.actions.map((a, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
                    {a}
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-muted">
                Once saved you can pick which of these go on your to-do list —
                nothing is added automatically.
              </p>
            </>
          )}
        </section>

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

      <p className="flex items-start gap-2 px-1 text-xs text-muted">
        <ShieldCheck size={14} className="mt-0.5 shrink-0 text-[var(--accent)]" />
        The audio is deleted as soon as it has been transcribed — it is never
        stored. You choose afterwards whether to keep even the transcript.
      </p>
    </div>
  );
}
