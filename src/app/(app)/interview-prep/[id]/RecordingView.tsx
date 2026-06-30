"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { RefreshCw, Pencil } from "lucide-react";
import { StatusChip } from "@/components/StatusChip";
import { SummaryTree } from "@/components/SummaryTree";
import { parseOutline, type SummaryNodeRow } from "@/lib/summaryTree";
import { createClient } from "@/lib/supabase/client";

const supabase = createClient();

// Reconstruct an indented outline (for editing) from stored summary nodes.
function outlineFromNodes(nodes: SummaryNodeRow[]): string {
  return [...nodes]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((n) => `${"  ".repeat(n.depth)}- ${n.content}`)
    .join("\n");
}

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
  const [editTranscript, setEditTranscript] = useState(false);
  const [transcriptDraft, setTranscriptDraft] = useState("");
  const [editSummary, setEditSummary] = useState(false);
  const [summaryDraft, setSummaryDraft] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

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

  // One seamless 0–100% across the whole pipeline (no backend stages exposed).
  const overallPct =
    recording.status === "summarizing"
      ? 95
      : recording.status === "transcribing"
        ? Math.min(
            92,
            5 + Math.round((chunksDone / Math.max(1, recording.total_chunks)) * 85),
          )
        : recording.status === "uploading"
          ? 3
          : 0;

  // Regenerate the summary from the stored transcript — no re-upload needed.
  async function reanalyze() {
    setNodes([]);
    setRecording((r) => ({ ...r, status: "summarizing", error: null }));
    await fetch(`/api/recordings/${id}/summarize`, {
      method: "POST",
      credentials: "same-origin",
    });
    refetch();
  }

  const canReanalyze = !inProgress && !!recording.transcript;

  async function saveTranscript() {
    setSavingEdit(true);
    await supabase
      .from("recordings")
      .update({ transcript: transcriptDraft })
      .eq("id", id);
    setRecording((r) => ({ ...r, transcript: transcriptDraft }));
    setSavingEdit(false);
    setEditTranscript(false);
  }

  async function saveSummary() {
    setSavingEdit(true);
    const bullets = parseOutline(summaryDraft);
    const parentByDepth: string[] = [];
    const rows = bullets.map((b, i) => {
      const nodeId = crypto.randomUUID();
      const parentId = b.depth > 0 ? parentByDepth[b.depth - 1] || null : null;
      parentByDepth[b.depth] = nodeId;
      parentByDepth.length = b.depth + 1;
      return {
        id: nodeId,
        recording_id: id,
        parent_id: parentId,
        content: b.content,
        depth: b.depth,
        sort_order: i,
      };
    });
    await supabase.from("summary_nodes").delete().eq("recording_id", id);
    if (rows.length) await supabase.from("summary_nodes").insert(rows);
    await refetch();
    setSavingEdit(false);
    setEditSummary(false);
  }

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
          <div className="flex items-center gap-2">
            {canReanalyze && (
              <button
                onClick={reanalyze}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-ink transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
                title="Regenerate the summary from the transcript"
              >
                <RefreshCw size={14} /> Re-analyze
              </button>
            )}
            <StatusChip status={recording.status} detail={detail} />
          </div>
        </div>
      </div>

      {inProgress && (
        <div className="mb-6 rounded-xl border border-border bg-surface p-5 shadow-sm">
          <p className="text-sm font-medium">Processing your interview…</p>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-canvas">
            <div
              className="h-full rounded-full bg-[var(--accent)] transition-all"
              style={{ width: `${overallPct}%` }}
            />
          </div>
          <p className="mt-1.5 text-xs text-muted">{overallPct}%</p>
          <p className="mt-3 text-xs text-muted">
            This can take a few minutes for long recordings. Please keep this page
            open until it&apos;s finished.
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

      {(nodes.length > 0 || (recording.status === "complete" && recording.transcript)) && (
        <section className="rounded-xl border border-border bg-surface p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
              Summary
            </h2>
            {!editSummary ? (
              <button
                onClick={() => {
                  setSummaryDraft(outlineFromNodes(nodes));
                  setEditSummary(true);
                }}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-muted transition hover:text-[var(--accent)]"
              >
                <Pencil size={13} /> Edit
              </button>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={() => setEditSummary(false)}
                  className="text-xs font-medium text-muted hover:text-ink"
                >
                  Cancel
                </button>
                <button
                  onClick={saveSummary}
                  disabled={savingEdit}
                  className="text-xs font-medium text-[var(--accent)] hover:underline disabled:opacity-60"
                >
                  {savingEdit ? "Saving…" : "Save"}
                </button>
              </div>
            )}
          </div>
          {editSummary ? (
            <>
              <textarea
                value={summaryDraft}
                onChange={(e) => setSummaryDraft(e.target.value)}
                className="min-h-80 w-full resize-y rounded-lg border border-border bg-surface p-4 font-mono text-sm outline-none focus:border-[var(--accent)]"
              />
              <p className="mt-2 text-xs text-muted">
                One bullet per line, start with &quot;- &quot;. Indent sub-points
                with 2 spaces per level.
              </p>
            </>
          ) : (
            <SummaryTree nodes={nodes} />
          )}
        </section>
      )}

      {recording.transcript && (
        <section className="mt-6">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setShowTranscript((v) => !v)}
              className="text-sm font-medium text-[var(--accent)] hover:underline"
            >
              {showTranscript ? "Hide" : "Show"} full transcript
            </button>
            {showTranscript && !editTranscript && (
              <button
                onClick={() => {
                  setTranscriptDraft(recording.transcript);
                  setEditTranscript(true);
                }}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-muted transition hover:text-[var(--accent)]"
              >
                <Pencil size={13} /> Edit
              </button>
            )}
          </div>
          {showTranscript &&
            (editTranscript ? (
              <div className="mt-3">
                <textarea
                  value={transcriptDraft}
                  onChange={(e) => setTranscriptDraft(e.target.value)}
                  className="min-h-80 w-full resize-y rounded-xl border border-border bg-surface p-5 text-sm leading-relaxed outline-none focus:border-[var(--accent)]"
                />
                <div className="mt-2 flex justify-end gap-2">
                  <button
                    onClick={() => setEditTranscript(false)}
                    className="text-sm font-medium text-muted hover:text-ink"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={saveTranscript}
                    disabled={savingEdit}
                    className="text-sm font-medium text-[var(--accent)] hover:underline disabled:opacity-60"
                  >
                    {savingEdit ? "Saving…" : "Save transcript"}
                  </button>
                </div>
              </div>
            ) : (
              <pre className="mt-3 whitespace-pre-wrap rounded-xl border border-border bg-surface p-5 text-sm leading-relaxed text-ink/90">
                {recording.transcript}
              </pre>
            ))}
        </section>
      )}
    </>
  );
}
