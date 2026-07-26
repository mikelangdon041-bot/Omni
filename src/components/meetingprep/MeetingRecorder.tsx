"use client";

// "Record this meeting" — the one-tap capture flow.
//
// Arm → record (mic, plus the meeting's own audio if the user shares it) →
// the recording ends (they stop it, or the share ends because the meeting
// window closed) → we ask what to do with it:
//
//   Discard   — audio and transcript are dropped, nothing is ever saved.
//   Make notes — nested bullet summary + extracted action items.
//
// Audio is never persisted server-side at all: segments go to Whisper and
// are discarded, and the local crash vault is wiped the moment recording
// stops. The transcript is the only intermediate artifact, and step 3 lets
// the user delete that too once the notes are in hand.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
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
import { OutlineBullets } from "@/components/ui/OutlineBullets";
import { useToast } from "@/components/ui/Feedback";
import { startLiveCapture, type LiveCapture } from "@/lib/meetingprep/liveCapture";

export interface CaptureResult {
  title: string;
  summary: string;
  actions: string[];
  transcript: string;
}

type Phase =
  | "idle"
  | "starting"
  | "recording"
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

  const captureRef = useRef<LiveCapture | null>(null);
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

  async function discardEverything() {
    await captureRef.current?.discard();
    captureRef.current = null;
    setTranscript("");
    setResult(null);
    setProgress({ done: 0, total: 0 });
    setElapsed(0);
    setPhase("idle");
    toast("success", "Recording discarded — nothing was saved.");
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
        summary: json.summary || "",
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

        <Modal
          open={!wrapping && phase === "deciding"}
          onClose={() => {}}
          title={autoEnded ? "That meeting just ended" : "Recording finished"}
          size="sm"
        >
          <div className="space-y-4">
            <p className="text-sm text-muted">
              {mmss(elapsed)} captured. Want me to turn it into notes with
              follow-up actions?
            </p>
            <div className="flex items-start gap-2 rounded-lg bg-canvas px-3 py-2 text-xs text-muted">
              <ShieldCheck size={14} className="mt-0.5 shrink-0 text-[var(--accent)]" />
              <span>
                The audio is already gone either way — it was never stored.
                Discarding drops the transcript with it.
              </span>
            </div>
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
          <div className="mt-4">
            <OutlineBullets text={result.summary} />
          </div>
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
                You&apos;ll be able to push these to your to-do list on the next
                screen — nothing is added automatically.
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
                Untick and only these notes are saved — the transcript is
                discarded with the audio.
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
  // Idle / error — the arm screen
  // ------------------------------------------------------------------
  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-sm">
      {phase === "error" && (
        <p className="mb-4 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}

      <h2 className="font-semibold tracking-tight">Record this meeting</h2>
      <p className="mt-1 text-sm text-muted">
        Start it before you join. When the meeting ends I&apos;ll ask whether to
        turn it into notes — nested bullets plus every follow-up action — or
        throw it away.
      </p>

      <label className="mt-4 flex cursor-pointer items-start gap-2.5 rounded-lg border border-border p-3 text-sm">
        <input
          type="checkbox"
          checked={includeMeetingAudio}
          onChange={(e) => setIncludeMeetingAudio(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
        />
        <span>
          Include the meeting&apos;s audio, not just my microphone
          <span className="mt-0.5 block text-xs text-muted">
            Your browser will ask what to share. For Teams in a browser tab,
            pick that tab and tick &ldquo;Also share tab audio&rdquo;. For the
            Teams desktop app, pick <b>Entire Screen</b> and tick &ldquo;Also
            share system audio&rdquo; — window shares carry no sound.
          </span>
        </span>
      </label>

      <label className="mt-3 flex cursor-pointer items-start gap-2.5 rounded-lg bg-canvas p-3 text-sm">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
        />
        <span className="text-muted">
          Everyone in this meeting has agreed to be recorded, and recording it
          is allowed under my organization&apos;s policy and applicable law.
        </span>
      </label>

      <div className="mt-4 flex justify-end">
        <Button
          onClick={() => void start()}
          disabled={!consent || phase === "starting"}
        >
          <Mic size={16} />
          {phase === "starting" ? "Starting…" : "Start recording"}
        </Button>
      </div>
    </div>
  );
}
