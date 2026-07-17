"use client";

// Compact record / upload / paste → transcript widget shared by Meeting Prep
// (prior meetings, grill-me answers, debriefs) and Slide Studio (practice).
// A slimmed-down cousin of the conference RecorderPanel: segments the live
// recording every ~4 minutes so each blob is a standalone file Whisper takes
// directly, transcribes segments as they finish, and hands the caller one
// combined transcript.

import { useEffect, useRef, useState } from "react";
import { FileAudio, Mic, Square } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";

const SEGMENT_MS = 4 * 60 * 1000;

type Phase = "idle" | "recording" | "transcribing" | "error";

export function TranscriptCapture({
  onTranscript,
  compact,
  allowPaste = true,
  recordLabel = "Record",
  onElapsed,
}: {
  onTranscript: (text: string, durationSec: number) => void | Promise<void>;
  compact?: boolean;
  allowPaste?: boolean;
  recordLabel?: string;
  /** Called every second while recording (drives external timers). */
  onElapsed?: (sec: number) => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [showPaste, setShowPaste] = useState(false);
  const [pasted, setPasted] = useState("");
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  const mediaRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stoppingRef = useRef(false);
  const queueRef = useRef<Promise<string>>(Promise.resolve(""));
  const partsRef = useRef<string[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const segTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const elapsedRef = useRef(0);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (segTimerRef.current) clearTimeout(segTimerRef.current);
      try {
        mediaRef.current?.stop();
      } catch {
        // already stopped
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function transcribeBlob(blob: Blob, index: number) {
    setProgress((p) => ({ ...p, total: Math.max(p.total, index + 1) }));
    queueRef.current = queueRef.current.then(async () => {
      const form = new FormData();
      form.append(
        "audio",
        new File([blob], `segment-${index}.webm`, { type: blob.type || "audio/webm" }),
      );
      const res = await fetch("/api/ai/transcribe", {
        method: "POST",
        credentials: "same-origin",
        body: form,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Transcription failed (${res.status})`);
      partsRef.current[index] = json.text || "";
      setProgress((p) => ({ ...p, done: p.done + 1 }));
      return json.text || "";
    });
  }

  function startSegment(index: number) {
    const stream = streamRef.current;
    if (!stream) return;
    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : "audio/webm";
    const rec = new MediaRecorder(stream, { mimeType: mime });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    rec.onstop = () => {
      if (chunks.length) void transcribeBlob(new Blob(chunks, { type: mime }), index);
      if (!stoppingRef.current) startSegment(index + 1);
    };
    rec.start(5000);
    mediaRef.current = rec;
    segTimerRef.current = setTimeout(() => {
      if (rec.state === "recording") rec.stop();
    }, SEGMENT_MS);
  }

  async function startRecording() {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      stoppingRef.current = false;
      partsRef.current = [];
      elapsedRef.current = 0;
      setProgress({ done: 0, total: 0 });
      setElapsed(0);
      setPhase("recording");
      timerRef.current = setInterval(() => {
        elapsedRef.current += 1;
        setElapsed(elapsedRef.current);
        onElapsed?.(elapsedRef.current);
      }, 1000);
      startSegment(0);
    } catch {
      setError("Microphone access was denied.");
      setPhase("error");
    }
  }

  async function stopRecording() {
    stoppingRef.current = true;
    if (timerRef.current) clearInterval(timerRef.current);
    if (segTimerRef.current) clearTimeout(segTimerRef.current);
    try {
      mediaRef.current?.stop();
    } catch {
      // ignore
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    setPhase("transcribing");
    try {
      await queueRef.current;
      const full = partsRef.current.filter(Boolean).join("\n\n");
      if (!full.trim()) throw new Error("No speech detected in the recording.");
      await onTranscript(full, elapsedRef.current);
      setPhase("idle");
    } catch (e) {
      setError((e as Error).message);
      setPhase("error");
    }
  }

  async function uploadFile(file: File | null) {
    if (!file) return;
    setError("");
    setPhase("transcribing");
    setProgress({ done: 0, total: 1 });
    try {
      const form = new FormData();
      form.append("audio", file);
      const res = await fetch("/api/ai/transcribe", {
        method: "POST",
        credentials: "same-origin",
        body: form,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Transcription failed (${res.status})`);
      if (!String(json.text || "").trim())
        throw new Error("No speech detected in that file.");
      await onTranscript(json.text, 0);
      setPhase("idle");
    } catch (e) {
      setError((e as Error).message);
      setPhase("error");
    }
  }

  const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;

  if (phase === "recording") {
    return (
      <div className="flex items-center gap-3 rounded-lg bg-red-50 px-4 py-3">
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
        <span className="font-mono text-sm font-semibold text-red-700">{mmss}</span>
        <span className="flex-1" />
        <Button size="sm" variant="danger" onClick={stopRecording}>
          <Square size={13} /> Stop
        </Button>
      </div>
    );
  }

  if (phase === "transcribing") {
    return (
      <div className="rounded-lg bg-canvas px-4 py-3 text-sm text-muted">
        Transcribing…
        {progress.total > 0 && ` ${progress.done}/${progress.total} segments`}
      </div>
    );
  }

  return (
    <div className={compact ? "" : "space-y-2"}>
      {phase === "error" && (
        <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={startRecording}>
          <Mic size={14} /> {recordLabel}
        </Button>
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-muted transition hover:text-ink">
          <FileAudio size={14} /> Upload audio
          <input
            type="file"
            accept="audio/*,video/webm,video/mp4"
            className="hidden"
            onChange={(e) => {
              void uploadFile(e.target.files?.[0] || null);
              e.target.value = "";
            }}
          />
        </label>
        {allowPaste && (
          <Button size="sm" variant="secondary" onClick={() => setShowPaste((v) => !v)}>
            Paste text
          </Button>
        )}
      </div>
      {showPaste && (
        <div className="mt-2 space-y-2">
          <Textarea
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder="Paste a transcript or notes…"
            className="min-h-24"
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              disabled={!pasted.trim()}
              onClick={async () => {
                await onTranscript(pasted.trim(), 0);
                setPasted("");
                setShowPaste(false);
              }}
            >
              Use text
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
