"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { StatusChip } from "@/components/StatusChip";
import { SummaryTree } from "@/components/SummaryTree";
import type { SummaryNodeRow } from "@/lib/summaryTree";

export interface Recording {
  id: string;
  title: string;
  status: string;
  total_chunks: number;
  chunks_done: number;
  transcript: string;
  error: string | null;
}

export function RecordingView({
  initialRecording,
  initialNodes,
}: {
  initialRecording: Recording;
  initialNodes: SummaryNodeRow[];
}) {
  const [recording, setRecording] = useState(initialRecording);
  const [nodes, setNodes] = useState(initialNodes);
  const [liveProgress, setLiveProgress] = useState<number | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);

  const workerRef = useRef<Worker | null>(null);
  const startedRef = useRef(false);
  const id = initialRecording.id;

  const refetch = useCallback(async () => {
    const res = await fetch(`/api/recordings/${id}`, {
      credentials: "same-origin",
    });
    if (!res.ok) return null;
    const data = await res.json();
    setRecording(data.recording);
    setNodes(data.nodes || []);
    return data.recording as Recording;
  }, [id]);

  // Spawn the transcription worker (resumes from chunks_done).
  const startWorker = useCallback(
    (rec: Recording) => {
      if (workerRef.current) return;
      const worker = new Worker(
        new URL("../../../../workers/transcribe.worker.ts", import.meta.url),
      );
      workerRef.current = worker;
      worker.onmessage = (e: MessageEvent) => {
        const msg = e.data;
        if (msg.type === "progress") {
          setLiveProgress(msg.chunksDone);
          setRecording((r) => ({ ...r, chunks_done: msg.chunksDone }));
        } else if (msg.type === "status") {
          setRecording((r) => ({ ...r, status: msg.status }));
        } else if (msg.type === "complete") {
          refetch();
        } else if (msg.type === "error") {
          setRecording((r) => ({ ...r, status: "error", error: msg.message }));
        }
      };
      worker.postMessage({
        recordingId: rec.id,
        totalChunks: rec.total_chunks,
        startIndex: rec.chunks_done,
      });
    },
    [refetch],
  );

  // Finalize the upload (server-side chunking), then transcribe.
  const finalizeUpload = useCallback(async () => {
    const res = await fetch(`/api/recordings/${id}/uploaded`, {
      method: "POST",
      credentials: "same-origin",
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setRecording((r) => ({
        ...r,
        status: "error",
        error: data.error || "Could not prepare audio",
      }));
      return;
    }
    const rec = await refetch();
    if (rec && rec.status === "transcribing") startWorker(rec);
  }, [id, refetch, startWorker]);

  // Drive the pipeline forward based on current status, once on mount.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const s = recording.status;
    if (s === "uploading") {
      finalizeUpload();
    } else if (s === "transcribing") {
      startWorker(recording);
    } else if (s === "summarizing") {
      // Reloaded mid-summary with no live worker — re-trigger (idempotent).
      fetch(`/api/recordings/${id}/summarize`, {
        method: "POST",
        credentials: "same-origin",
      }).finally(refetch);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll as a backup until terminal state.
  useEffect(() => {
    if (recording.status === "complete" || recording.status === "error") return;
    const t = setInterval(refetch, 3500);
    return () => clearInterval(t);
  }, [recording.status, refetch]);

  // Clean up the worker on unmount.
  useEffect(() => () => workerRef.current?.terminate(), []);

  const inProgress =
    recording.status === "uploading" ||
    recording.status === "transcribing" ||
    recording.status === "summarizing";

  const chunksDone = liveProgress ?? recording.chunks_done;
  const pct =
    recording.total_chunks > 0
      ? Math.round((chunksDone / recording.total_chunks) * 100)
      : 0;
  const detail =
    recording.status === "transcribing" && recording.total_chunks
      ? `${pct}%`
      : undefined;

  return (
    <>
      <div className="mb-6">
        <Link
          href="/interview-prep"
          className="text-sm text-muted hover:text-ink"
        >
          ← Interview Prep
        </Link>
        <div className="mt-2 flex items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight">
            {recording.title}
          </h1>
          <StatusChip status={recording.status} detail={detail} />
        </div>
      </div>

      {inProgress && (
        <div className="mb-6 rounded-xl border border-border bg-surface p-5 shadow-sm">
          <p className="text-sm font-medium">
            {recording.status === "uploading" && "Preparing your audio…"}
            {recording.status === "transcribing" && "Transcribing your recording…"}
            {recording.status === "summarizing" &&
              "Organizing the transcript into a nested summary…"}
          </p>
          {recording.status === "transcribing" && recording.total_chunks > 0 && (
            <div className="mt-3">
              <div className="h-2 w-full overflow-hidden rounded-full bg-canvas">
                <div
                  className="h-full rounded-full bg-[var(--accent)] transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="mt-1.5 text-xs text-muted">{pct}% transcribed</p>
            </div>
          )}
          <p className="mt-3 text-xs text-muted">
            You can leave this page — progress is saved and resumes when you
            return.
          </p>
        </div>
      )}

      {recording.status === "error" && (
        <div className="mb-6 rounded-xl border border-status-error/30 bg-status-error/5 p-5">
          <p className="text-sm font-medium text-status-error">
            Something went wrong
          </p>
          <p className="mt-1 text-sm text-muted">{recording.error}</p>
        </div>
      )}

      {nodes.length > 0 && (
        <section className="rounded-xl border border-border bg-surface p-6 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted">
            Summary
          </h2>
          <SummaryTree nodes={nodes} />
        </section>
      )}

      {recording.transcript && (
        <section className="mt-6">
          <button
            onClick={() => setShowTranscript((v) => !v)}
            className="text-sm font-medium text-primary hover:underline"
          >
            {showTranscript ? "Hide" : "Show"} full transcript
          </button>
          {showTranscript && (
            <pre className="mt-3 whitespace-pre-wrap rounded-xl border border-border bg-surface p-5 text-sm leading-relaxed text-ink/90">
              {recording.transcript}
            </pre>
          )}
        </section>
      )}
    </>
  );
}
