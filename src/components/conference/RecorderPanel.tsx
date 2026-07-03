"use client";

// Audio capture → transcript → nested summary for sessions and KOL meetings
// (spec §8.4, §6.3). Chunk-at-source: recording restarts every ~4 minutes so
// each segment is a standalone file Whisper can take directly — no ffmpeg, so
// it runs on serverless. Also accepts an uploaded audio file or a pasted
// transcript, and always shows a review/edit step before anything saves.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  FileAudio,
  Mic,
  Sparkles,
  Square,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { cn } from "@/lib/ui";
import { useConferenceCtx } from "@/components/conference/ConferenceContext";
import { useRecordings, type ConfRecording } from "@/lib/conference/hooks";

const SEGMENT_MS = 4 * 60 * 1000; // restart the recorder every 4 minutes

type Phase =
  | "idle"
  | "recording"
  | "transcribing"
  | "summarizing"
  | "review"
  | "error";

export function RecorderPanel({
  eventId,
  contactId,
  consentNotice,
  defaultTitle,
}: {
  eventId?: string;
  contactId?: string;
  consentNotice?: boolean;
  defaultTitle: string;
}) {
  const { conference, attendees } = useConferenceCtx();
  const { recordings, add, remove } = useRecordings(conference.id, {
    eventId,
    contactId,
  });

  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [segmentsDone, setSegmentsDone] = useState(0);
  const [segmentsTotal, setSegmentsTotal] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [summary, setSummary] = useState("");
  const [title, setTitle] = useState(defaultTitle);
  const [showPaste, setShowPaste] = useState(false);
  const [pasted, setPasted] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const mediaRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stoppingRef = useRef(false);
  const queueRef = useRef<Promise<string>>(Promise.resolve(""));
  const partsRef = useRef<string[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const segmentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => stopEverything();
  }, []);

  function stopEverything() {
    if (timerRef.current) clearInterval(timerRef.current);
    if (segmentTimerRef.current) clearTimeout(segmentTimerRef.current);
    try {
      mediaRef.current?.stop();
    } catch {
      // already stopped
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }

  function enqueueSegment(blob: Blob, index: number) {
    setSegmentsTotal((n) => Math.max(n, index + 1));
    queueRef.current = queueRef.current.then(async () => {
      const form = new FormData();
      form.append("audio", new File([blob], `segment-${index}.webm`, { type: blob.type }));
      const res = await fetch("/api/conference/transcribe", {
        method: "POST",
        credentials: "same-origin",
        body: form,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Transcription failed");
      partsRef.current[index] = json.text || "";
      setSegmentsDone((n) => n + 1);
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
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      if (chunks.length) enqueueSegment(new Blob(chunks, { type: mime }), index);
      if (!stoppingRef.current) startSegment(index + 1);
    };
    rec.start();
    mediaRef.current = rec;
    // Roll to a fresh standalone segment so every file has valid headers.
    segmentTimerRef.current = setTimeout(() => {
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
      setSegmentsDone(0);
      setSegmentsTotal(0);
      setElapsed(0);
      setPhase("recording");
      timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
      startSegment(0);
      if (navigator.vibrate) navigator.vibrate(30);
    } catch {
      setError("Microphone access was denied.");
      setPhase("error");
    }
  }

  async function stopRecording() {
    stoppingRef.current = true;
    if (timerRef.current) clearInterval(timerRef.current);
    if (segmentTimerRef.current) clearTimeout(segmentTimerRef.current);
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
      setTranscript(full);
      await summarize(full);
    } catch (e) {
      setError((e as Error).message);
      setPhase("error");
    }
  }

  async function uploadFile(file: File | null) {
    if (!file) return;
    setError("");
    setPhase("transcribing");
    setSegmentsDone(0);
    setSegmentsTotal(1);
    try {
      const form = new FormData();
      form.append("audio", file);
      const res = await fetch("/api/conference/transcribe", {
        method: "POST",
        credentials: "same-origin",
        body: form,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Transcription failed");
      setSegmentsDone(1);
      setTranscript(json.text || "");
      await summarize(json.text || "");
    } catch (e) {
      setError((e as Error).message);
      setPhase("error");
    }
  }

  async function usePastedTranscript() {
    if (!pasted.trim()) return;
    setTranscript(pasted.trim());
    setShowPaste(false);
    await summarize(pasted.trim());
  }

  async function summarize(text: string) {
    setPhase("summarizing");
    try {
      const res = await fetch("/api/conference/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ action: "meeting_summary", text }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Summarization failed");
      setSummary(json.content || "");
      setPhase("review");
    } catch (e) {
      setError((e as Error).message);
      setPhase("error");
    }
  }

  async function save() {
    await add({
      title: title.trim() || defaultTitle,
      status: "complete",
      transcript,
      summary,
    });
    setPhase("idle");
    setTranscript("");
    setSummary("");
    setPasted("");
    setTitle(defaultTitle);
  }

  const nameForUser = useMemo(
    () => (userId: string | null) =>
      attendees.find((a) => a.user_id === userId)?.name || "Teammate",
    [attendees],
  );

  const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;

  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
          Recordings ({recordings.length})
        </h2>
        {phase === "idle" && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={startRecording}>
              <Mic size={14} /> Record
            </Button>
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-muted transition hover:text-ink">
              <FileAudio size={14} /> Upload audio
              <input
                type="file"
                accept="audio/*,video/webm"
                className="hidden"
                onChange={(e) => uploadFile(e.target.files?.[0] || null)}
              />
            </label>
            <Button size="sm" variant="secondary" onClick={() => setShowPaste((v) => !v)}>
              Paste transcript
            </Button>
          </div>
        )}
      </div>

      {consentNotice && phase === "idle" && (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Record or upload only if all participants were informed and consented,
          per applicable privacy law and policy.
        </p>
      )}

      {showPaste && phase === "idle" && (
        <div className="mt-3 space-y-2">
          <Textarea
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder="Paste an existing transcript to skip recording…"
            className="min-h-28"
          />
          <div className="flex justify-end">
            <Button size="sm" onClick={usePastedTranscript} disabled={!pasted.trim()}>
              <Sparkles size={14} /> Summarize transcript
            </Button>
          </div>
        </div>
      )}

      {phase === "recording" && (
        <div className="mt-3 flex items-center gap-3 rounded-lg bg-red-50 px-4 py-3">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
          <span className="font-mono text-sm font-semibold text-red-700">{mmss}</span>
          <span className="text-xs text-red-600">
            Recording — segments transcribe as you go
            {segmentsDone > 0 && ` (${segmentsDone} done)`}
          </span>
          <span className="flex-1" />
          <Button size="sm" variant="danger" onClick={stopRecording}>
            <Square size={13} /> Stop
          </Button>
        </div>
      )}

      {(phase === "transcribing" || phase === "summarizing") && (
        <div className="mt-3 rounded-lg bg-canvas px-4 py-3 text-sm text-muted">
          {phase === "transcribing"
            ? `Transcribing… ${segmentsDone}/${Math.max(segmentsTotal, 1)} segments`
            : "Summarizing into nested bullets…"}
        </div>
      )}

      {phase === "error" && (
        <div className="mt-3 space-y-2 rounded-lg bg-red-50 px-4 py-3">
          <p className="text-sm text-red-700">{error}</p>
          <div className="flex gap-2">
            {transcript && (
              <Button size="sm" variant="secondary" onClick={() => summarize(transcript)}>
                Retry summary
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setPhase("idle")}>
              Dismiss
            </Button>
          </div>
        </div>
      )}

      {phase === "review" && (
        <div className="mt-3 space-y-3 rounded-lg border border-[var(--accent)]/40 bg-[var(--accent-soft)]/30 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">
            Review before saving — edit anything below
          </p>
          <Input label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <Textarea
            label="Summary (nested bullets)"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            className="min-h-36 font-mono !text-xs"
          />
          <Textarea
            label="Transcript"
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            className="min-h-28 !text-xs"
          />
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => summarize(transcript)}
            >
              <Sparkles size={13} /> Re-summarize
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPhase("idle")}>
              Discard
            </Button>
            <Button size="sm" onClick={save}>
              Save recording
            </Button>
          </div>
        </div>
      )}

      {/* Saved recordings */}
      {recordings.length > 0 && (
        <ul className="mt-4 space-y-2">
          {recordings.map((r) => (
            <li key={r.id} className="rounded-lg border border-border p-3">
              <div className="flex items-center gap-2">
                <button
                  onClick={() =>
                    setExpanded((prev) => ({ ...prev, [r.id]: !prev[r.id] }))
                  }
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <ChevronDown
                    size={14}
                    className={cn(
                      "shrink-0 text-muted transition-transform",
                      !expanded[r.id] && "-rotate-90",
                    )}
                  />
                  <span className="truncate text-sm font-medium">
                    {r.title || "Recording"}
                  </span>
                  <span className="shrink-0 text-xs text-muted">
                    {nameForUser(r.user_id)} ·{" "}
                    {new Date(r.created_at).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                </button>
                <button
                  onClick={async () => {
                    if (confirm("Delete this recording?")) await remove(r.id);
                  }}
                  className="rounded p-1 text-muted hover:text-red-600"
                >
                  <Trash2 size={13} />
                </button>
              </div>
              {expanded[r.id] && (
                <div className="mt-2 space-y-3 border-t border-border pt-2">
                  {r.summary && (
                    <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">
                      {r.summary}
                    </pre>
                  )}
                  {r.transcript && (
                    <details>
                      <summary className="cursor-pointer text-xs font-medium text-muted">
                        Full transcript
                      </summary>
                      <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-muted">
                        {r.transcript}
                      </p>
                    </details>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// Combined plain text of saved recordings, for AI insight extraction.
export function recordingsText(recordings: ConfRecording[]): string {
  return recordings
    .filter((r) => r.status === "complete")
    .map((r) => `Recording "${r.title}":\n${r.summary || r.transcript}`)
    .join("\n\n");
}
