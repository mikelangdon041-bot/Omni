"use client";

// Audio capture → transcript → nested summary for sessions and KOL meetings
// (spec §8.4, §6.3). Chunk-at-source: recording restarts every ~4 minutes so
// each segment is a standalone file Whisper can take directly — no ffmpeg
// needed for live recordings.
//
// Resilience:
//  * Every few seconds of live audio is persisted to IndexedDB as it's
//    captured; a crash/refresh mid-recording offers a one-tap recovery.
//  * Uploaded files go straight to Supabase storage via a signed URL (real
//    upload progress, no Vercel 4.5 MB body limit) and are transcribed
//    server-side with streamed x/y segment progress.
//  * Every busy phase has a Cancel button.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { useConfirm } from "@/components/ui/Feedback";
import { ProgressBar } from "@/components/conference/Bits";
import { cn } from "@/lib/ui";
import { useConferenceCtx } from "@/components/conference/ConferenceContext";
import { useRecordings, type ConfRecording } from "@/lib/conference/hooks";
import {
  clearSession,
  loadSession,
  saveChunk,
  type VaultSession,
} from "@/lib/conference/recordingVault";

const SEGMENT_MS = 4 * 60 * 1000; // restart the recorder every 4 minutes
const CHUNK_MS = 5000; // persist a chunk to IndexedDB every 5 seconds
// Vercel rejects request bodies over ~4.5 MB — anything bigger goes through
// storage instead of multipart.
const DIRECT_UPLOAD_LIMIT = 4 * 1024 * 1024;

type Phase =
  | "idle"
  | "recording"
  | "uploading"
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
  const confirm = useConfirm();
  const { conference, attendees } = useConferenceCtx();
  const { recordings, add, remove } = useRecordings(conference.id, {
    eventId,
    contactId,
  });
  const vaultKey = `conf-${conference.id}-${eventId || contactId || "general"}`;

  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [segmentsDone, setSegmentsDone] = useState(0);
  const [segmentsTotal, setSegmentsTotal] = useState(0);
  const [uploadPct, setUploadPct] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [summary, setSummary] = useState("");
  const [title, setTitle] = useState(defaultTitle);
  const [showPaste, setShowPaste] = useState(false);
  const [pasted, setPasted] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [recovery, setRecovery] = useState<VaultSession | null>(null);

  const mediaRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stoppingRef = useRef(false);
  const queueRef = useRef<Promise<string>>(Promise.resolve(""));
  const partsRef = useRef<string[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const segmentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    return () => {
      stopEverything();
      abortRef.current?.abort();
      xhrRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Unfinished audio from a crashed/closed session? Offer recovery.
  useEffect(() => {
    let active = true;
    void loadSession(vaultKey).then((s) => {
      if (active && s) setRecovery(s);
    });
    return () => {
      active = false;
    };
  }, [vaultKey]);

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

  function cancelBusy() {
    cancelledRef.current = true;
    abortRef.current?.abort();
    xhrRef.current?.abort();
    queueRef.current = Promise.resolve("");
    setPhase("idle");
    setError("");
    // Re-check the vault: a cancelled live-recording transcription still has
    // its audio persisted, so the recovery banner reappears.
    void loadSession(vaultKey).then((s) => setRecovery(s));
  }

  function enqueueSegment(blob: Blob, index: number) {
    setSegmentsTotal((n) => Math.max(n, index + 1));
    queueRef.current = queueRef.current.then(async () => {
      if (cancelledRef.current) return "";
      const form = new FormData();
      form.append("audio", new File([blob], `segment-${index}.webm`, { type: blob.type }));
      const res = await fetch("/api/conference/transcribe", {
        method: "POST",
        credentials: "same-origin",
        body: form,
        signal: abortRef.current?.signal,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `Transcription failed (${res.status})`);
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
    let chunkIndex = 0;
    rec.ondataavailable = (e) => {
      if (!e.data.size) return;
      chunks.push(e.data);
      // Crash safety: persist as we go — losing power now costs ≤5 seconds.
      void saveChunk(vaultKey, index, chunkIndex++, e.data, mime);
    };
    rec.onstop = () => {
      if (chunks.length) enqueueSegment(new Blob(chunks, { type: mime }), index);
      if (!stoppingRef.current) startSegment(index + 1);
    };
    rec.start(CHUNK_MS);
    mediaRef.current = rec;
    // Roll to a fresh standalone segment so every file has valid headers.
    segmentTimerRef.current = setTimeout(() => {
      if (rec.state === "recording") rec.stop();
    }, SEGMENT_MS);
  }

  async function startRecording() {
    setError("");
    try {
      // A stale vault session would interleave with the new one — clear it.
      if (recovery) {
        const keep = await confirm({
          title: "Discard the unsaved recording?",
          message:
            "There's unsaved audio recovered from an earlier session. Starting a new recording deletes it.",
          confirmLabel: "Delete and record",
          danger: true,
        });
        if (!keep) return;
        await clearSession(vaultKey);
        setRecovery(null);
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      stoppingRef.current = false;
      cancelledRef.current = false;
      abortRef.current = new AbortController();
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
      if (cancelledRef.current) return;
      const full = partsRef.current.filter(Boolean).join("\n\n");
      if (!full.trim()) throw new Error("No speech detected in the recording.");
      setTranscript(full);
      await summarize(full);
    } catch (e) {
      if (cancelledRef.current) return;
      setError((e as Error).message);
      setPhase("error");
    }
  }

  // Recovered audio → same pipeline as a live stop: one multipart request
  // per stored segment.
  async function transcribeRecovery() {
    if (!recovery) return;
    setError("");
    cancelledRef.current = false;
    abortRef.current = new AbortController();
    partsRef.current = [];
    setSegmentsDone(0);
    setSegmentsTotal(recovery.segments.length);
    setPhase("transcribing");
    try {
      recovery.segments.forEach((blob, i) => enqueueSegment(blob, i));
      await queueRef.current;
      if (cancelledRef.current) return;
      const full = partsRef.current.filter(Boolean).join("\n\n");
      if (!full.trim()) throw new Error("No speech detected in the recovered audio.");
      setRecovery(null);
      setTranscript(full);
      await summarize(full);
    } catch (e) {
      if (cancelledRef.current) return;
      setError((e as Error).message);
      setPhase("error");
    }
  }

  async function discardRecovery() {
    if (
      await confirm({
        title: "Discard the recovered audio?",
        message: "The unsaved recording from the earlier session is deleted.",
        confirmLabel: "Discard",
        danger: true,
      })
    ) {
      await clearSession(vaultKey);
      setRecovery(null);
    }
  }

  async function uploadFile(file: File | null) {
    if (!file) return;
    setError("");
    cancelledRef.current = false;
    abortRef.current = new AbortController();
    try {
      if (file.size <= DIRECT_UPLOAD_LIMIT) {
        // Small enough for one multipart request.
        setPhase("transcribing");
        setSegmentsDone(0);
        setSegmentsTotal(1);
        const form = new FormData();
        form.append("audio", file);
        const res = await fetch("/api/conference/transcribe", {
          method: "POST",
          credentials: "same-origin",
          body: form,
          signal: abortRef.current.signal,
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || `Transcription failed (${res.status})`);
        setSegmentsDone(1);
        setTranscript(json.text || "");
        await summarize(json.text || "");
        return;
      }

      // Big file: storage upload (signed URL, real progress) + server-side
      // chunked transcription with streamed progress.
      setPhase("uploading");
      setUploadPct(0);
      const ext = (file.name.split(".").pop() || "webm").toLowerCase();
      const signRes = await fetch("/api/conference/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ action: "sign", conferenceId: conference.id, ext }),
        signal: abortRef.current.signal,
      });
      const signed = await signRes.json().catch(() => ({}));
      if (!signRes.ok) throw new Error(signed.error || "Could not start the upload.");

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhrRef.current = xhr;
        xhr.open("PUT", signed.signedUrl);
        xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setUploadPct((e.loaded / e.total) * 100);
        };
        xhr.onload = () =>
          xhr.status >= 200 && xhr.status < 300
            ? resolve()
            : reject(new Error(`Upload failed (${xhr.status})`));
        xhr.onerror = () => reject(new Error("Upload failed — check your connection."));
        xhr.onabort = () => reject(new Error("Upload cancelled."));
        xhr.send(file);
      });
      xhrRef.current = null;
      if (cancelledRef.current) return;

      setPhase("transcribing");
      setSegmentsDone(0);
      setSegmentsTotal(0);
      const res = await fetch("/api/conference/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          action: "from-storage",
          conferenceId: conference.id,
          path: signed.path,
        }),
        signal: abortRef.current.signal,
      });
      if (!res.ok || !res.body) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || `Transcription failed (${res.status})`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let text = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let msg: { type?: string; done?: number; total?: number; text?: string; error?: string };
          try {
            msg = JSON.parse(line);
          } catch {
            continue;
          }
          if (msg.type === "progress" && typeof msg.total === "number") {
            setSegmentsTotal(msg.total);
            setSegmentsDone(msg.done || 0);
          }
          if (msg.type === "error") throw new Error(msg.error || "Transcription failed");
          if (msg.type === "done") text = msg.text || "";
        }
      }
      if (cancelledRef.current) return;
      if (!text.trim()) throw new Error("No speech detected in that file.");
      setTranscript(text);
      await summarize(text);
    } catch (e) {
      if (cancelledRef.current) return;
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
    cancelledRef.current = false;
    abortRef.current = new AbortController();
    try {
      const res = await fetch("/api/conference/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ action: "meeting_summary", text }),
        signal: abortRef.current.signal,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Summarization failed");
      setSummary(json.content || "");
      setPhase("review");
    } catch (e) {
      if (cancelledRef.current) {
        // Keep the transcript — offer review without a summary.
        setSummary("");
        setPhase(text.trim() ? "review" : "idle");
        return;
      }
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
    await clearSession(vaultKey);
    setRecovery(null);
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

  const discard = useCallback(async () => {
    if (
      await confirm({
        title: "Discard this recording?",
        message: "The transcript and summary are thrown away.",
        confirmLabel: "Discard",
        danger: true,
      })
    ) {
      await clearSession(vaultKey);
      setRecovery(null);
      setPhase("idle");
      setTranscript("");
      setSummary("");
    }
  }, [confirm, vaultKey]);

  const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;
  const recoveryMins = recovery ? Math.max(1, Math.round(recovery.approxSeconds / 60)) : 0;

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
                accept="audio/*,video/webm,video/mp4"
                className="hidden"
                onChange={(e) => {
                  uploadFile(e.target.files?.[0] || null);
                  e.target.value = "";
                }}
              />
            </label>
            <Button size="sm" variant="secondary" onClick={() => setShowPaste((v) => !v)}>
              Paste transcript
            </Button>
          </div>
        )}
      </div>

      {/* Crash recovery — audio persisted during a previous session. */}
      {recovery && phase === "idle" && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
          <p className="min-w-0 flex-1 text-sm text-amber-800">
            Found ~{recoveryMins} min of unsaved audio from an interrupted
            recording ({new Date(recovery.savedAt).toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}). Nothing was lost.
          </p>
          <div className="flex gap-2">
            <Button size="sm" onClick={transcribeRecovery}>
              <Sparkles size={13} /> Transcribe it
            </Button>
            <Button size="sm" variant="ghost" onClick={discardRecovery}>
              Discard
            </Button>
          </div>
        </div>
      )}

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
            Recording — saved locally as you go
            {segmentsDone > 0 && ` (${segmentsDone} segment${segmentsDone === 1 ? "" : "s"} transcribed)`}
          </span>
          <span className="flex-1" />
          <Button size="sm" variant="danger" onClick={stopRecording}>
            <Square size={13} /> Stop
          </Button>
        </div>
      )}

      {(phase === "uploading" || phase === "transcribing" || phase === "summarizing") && (
        <div className="mt-3 flex items-center gap-3 rounded-lg bg-canvas px-4 py-3">
          <div className="min-w-0 flex-1">
            {phase === "uploading" ? (
              <ProgressBar percent={uploadPct} label={`Uploading… ${Math.round(uploadPct)}%`} />
            ) : phase === "transcribing" ? (
              <ProgressBar
                percent={segmentsTotal > 0 ? (segmentsDone / segmentsTotal) * 100 : null}
                label={
                  segmentsTotal > 0
                    ? `Transcribing… ${segmentsDone}/${segmentsTotal} segment${segmentsTotal === 1 ? "" : "s"}`
                    : "Preparing transcription…"
                }
              />
            ) : (
              <ProgressBar percent={null} label="Summarizing into nested bullets…" />
            )}
          </div>
          <Button size="sm" variant="ghost" onClick={cancelBusy}>
            Cancel
          </Button>
        </div>
      )}

      {phase === "error" && (
        <div className="mt-3 space-y-2 rounded-lg bg-red-50 px-4 py-3">
          <p className="text-sm text-red-700">{error}</p>
          <div className="flex flex-wrap gap-2">
            {transcript && (
              <>
                <Button size="sm" variant="secondary" onClick={() => summarize(transcript)}>
                  Retry summary
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setPhase("review")}>
                  Keep transcript without summary
                </Button>
              </>
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
            <Button size="sm" variant="ghost" onClick={discard}>
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
                    if (
                      await confirm({
                        title: "Delete this recording?",
                        message: "The transcript and summary are removed too.",
                        confirmLabel: "Delete",
                        danger: true,
                      })
                    )
                      await remove(r.id);
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
