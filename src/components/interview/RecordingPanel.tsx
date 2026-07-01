"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, Pencil, Trash2 } from "lucide-react";
import { StatusChip } from "@/components/StatusChip";
import { SummaryTree } from "@/components/SummaryTree";
import { RichText } from "@/components/ui/RichText";
import { parseOutline, type SummaryNodeRow } from "@/lib/summaryTree";
import { createClient } from "@/lib/supabase/client";

const supabase = createClient();

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
  notes?: string;
}

// Self-contained recording view: drives the transcribe→summarize pipeline and
// shows the summary/transcript inline. Used standalone (recording page) and
// embedded inside the interview workspace (embedded hides notes/back).
export function RecordingPanel({
  recordingId,
  initialRecording,
  initialNodes = [],
  embedded = false,
  onDeleted,
}: {
  recordingId: string;
  initialRecording?: Recording;
  initialNodes?: SummaryNodeRow[];
  embedded?: boolean;
  onDeleted?: () => void;
}) {
  const [recording, setRecording] = useState<Recording | null>(initialRecording ?? null);
  const [nodes, setNodes] = useState<SummaryNodeRow[]>(initialNodes);
  const [loading, setLoading] = useState(!initialRecording);
  const [liveProgress, setLiveProgress] = useState<number | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);
  const [editing, setEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(initialRecording?.title || "");
  const [summaryDraft, setSummaryDraft] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [notes, setNotes] = useState(initialRecording?.notes || "");
  const [notesStatus, setNotesStatus] = useState<"idle" | "saving" | "saved">("idle");
  const savedNotes = useRef(initialRecording?.notes || "");

  const workerRef = useRef<Worker | null>(null);
  const startedRef = useRef(false);
  const id = recordingId;

  const refetch = useCallback(async () => {
    const res = await fetch(`/api/recordings/${id}`, { credentials: "same-origin" });
    if (!res.ok) return null;
    const data = await res.json();
    setRecording(data.recording);
    setNodes(data.nodes || []);
    setLoading(false);
    return data.recording as Recording;
  }, [id]);

  // Fetch initial data if not provided (embedded usage).
  useEffect(() => {
    if (!initialRecording) void refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startWorker = useCallback(
    (rec: Recording) => {
      if (workerRef.current) return;
      const worker = new Worker(
        new URL("../../workers/transcribe.worker.ts", import.meta.url),
      );
      workerRef.current = worker;
      worker.onmessage = (e: MessageEvent) => {
        const msg = e.data;
        if (msg.type === "progress") {
          setLiveProgress(msg.chunksDone);
          setRecording((r) => (r ? { ...r, chunks_done: msg.chunksDone } : r));
        } else if (msg.type === "status") {
          setRecording((r) => (r ? { ...r, status: msg.status } : r));
        } else if (msg.type === "complete") {
          refetch();
        } else if (msg.type === "error") {
          setRecording((r) => (r ? { ...r, status: "error", error: msg.message } : r));
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

  const finalizeUpload = useCallback(async () => {
    const res = await fetch(`/api/recordings/${id}/uploaded`, {
      method: "POST",
      credentials: "same-origin",
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setRecording((r) => (r ? { ...r, status: "error", error: data.error || "Could not prepare audio" } : r));
      return;
    }
    const rec = await refetch();
    if (rec && rec.status === "transcribing") startWorker(rec);
  }, [id, refetch, startWorker]);

  // Drive the pipeline forward once we know the status.
  useEffect(() => {
    if (!recording || startedRef.current) return;
    startedRef.current = true;
    const s = recording.status;
    if (s === "uploading") finalizeUpload();
    else if (s === "transcribing") startWorker(recording);
    else if (s === "summarizing") {
      fetch(`/api/recordings/${id}/summarize`, { method: "POST", credentials: "same-origin" }).finally(refetch);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording?.status]);

  // Poll until terminal.
  useEffect(() => {
    if (!recording || recording.status === "complete" || recording.status === "error") return;
    const t = setInterval(refetch, 3500);
    return () => clearInterval(t);
  }, [recording, refetch]);

  useEffect(() => () => workerRef.current?.terminate(), []);

  // Notes autosave (standalone only).
  useEffect(() => {
    if (embedded || notes === savedNotes.current) return;
    setNotesStatus("saving");
    const t = setTimeout(async () => {
      await supabase.from("recordings").update({ notes }).eq("id", id);
      savedNotes.current = notes;
      setNotesStatus("saved");
    }, 800);
    return () => clearTimeout(t);
  }, [notes, embedded, id]);

  if (loading || !recording) {
    return (
      <div className="rounded-xl border border-border bg-surface p-5 text-sm text-muted shadow-sm">
        Loading recording…
      </div>
    );
  }

  const inProgress =
    recording.status === "uploading" ||
    recording.status === "transcribing" ||
    recording.status === "summarizing";
  const chunksDone = liveProgress ?? recording.chunks_done;
  const pct = recording.total_chunks > 0 ? Math.round((chunksDone / recording.total_chunks) * 100) : 0;
  const detail = recording.status === "transcribing" && recording.total_chunks ? `${pct}%` : undefined;
  const overallPct =
    recording.status === "summarizing"
      ? 95
      : recording.status === "transcribing"
        ? Math.min(92, 5 + Math.round((chunksDone / Math.max(1, recording.total_chunks)) * 85))
        : recording.status === "uploading"
          ? 3
          : 0;
  const canReanalyze = !inProgress && !!recording.transcript;
  const hasSummary = nodes.length > 0 || (recording.status === "complete" && !!recording.transcript);

  async function reanalyze() {
    setNodes([]);
    setRecording((r) => (r ? { ...r, status: "summarizing", error: null } : r));
    startedRef.current = false;
    await fetch(`/api/recordings/${id}/summarize`, { method: "POST", credentials: "same-origin" });
    refetch();
  }

  function openEdit() {
    setTitleDraft(recording!.title);
    setSummaryDraft(outlineFromNodes(nodes));
    setEditing(true);
  }

  // Save title AND summary together.
  async function saveEdit() {
    setSavingEdit(true);
    const t = titleDraft.trim() || "Untitled recording";
    await supabase.from("recordings").update({ title: t }).eq("id", id);
    const bullets = parseOutline(summaryDraft);
    const parentByDepth: string[] = [];
    const rows = bullets.map((b, i) => {
      const nodeId = crypto.randomUUID();
      const parentId = b.depth > 0 ? parentByDepth[b.depth - 1] || null : null;
      parentByDepth[b.depth] = nodeId;
      parentByDepth.length = b.depth + 1;
      return { id: nodeId, recording_id: id, parent_id: parentId, content: b.content, depth: b.depth, sort_order: i };
    });
    await supabase.from("summary_nodes").delete().eq("recording_id", id);
    if (rows.length) await supabase.from("summary_nodes").insert(rows);
    setRecording((r) => (r ? { ...r, title: t } : r));
    await refetch();
    setSavingEdit(false);
    setEditing(false);
  }

  async function del() {
    if (!confirm("Delete this recording?")) return;
    await supabase.from("recordings").delete().eq("id", id);
    onDeleted?.();
  }

  return (
    <div className={embedded ? "rounded-xl border border-border bg-surface p-5 shadow-sm" : ""}>
      {/* Header */}
      <div className="mb-3 flex items-center justify-between gap-3">
        {editing ? (
          <input
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            className="flex-1 rounded-lg border border-border bg-surface px-3 py-1.5 text-base font-semibold outline-none focus:border-[var(--accent)]"
          />
        ) : (
          <h3 className={embedded ? "flex-1 truncate text-base font-semibold" : "text-2xl font-semibold tracking-tight"}>
            {recording.title}
          </h3>
        )}
        <div className="flex shrink-0 items-center gap-2">
          {!editing && canReanalyze && (
            <button
              onClick={reanalyze}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-ink transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
              title="Regenerate the summary from the transcript"
            >
              <RefreshCw size={13} /> Re-analyze
            </button>
          )}
          {!editing && hasSummary && (
            <button
              onClick={openEdit}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-muted transition hover:text-[var(--accent)]"
              title="Edit title & summary"
            >
              <Pencil size={13} /> Edit
            </button>
          )}
          {editing && (
            <>
              <button onClick={() => setEditing(false)} className="text-xs font-medium text-muted hover:text-ink">
                Cancel
              </button>
              <button
                onClick={saveEdit}
                disabled={savingEdit}
                className="rounded-lg bg-[var(--accent)] px-2.5 py-1.5 text-xs font-medium text-white disabled:opacity-60"
              >
                {savingEdit ? "Saving…" : "Save"}
              </button>
            </>
          )}
          {!editing && <StatusChip status={recording.status} detail={detail} />}
          {embedded && !editing && (
            <button onClick={del} className="text-muted transition hover:text-status-error" title="Delete recording">
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>

      {inProgress && (
        <div className="mb-4">
          <p className="text-sm text-muted">Processing your interview…</p>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-canvas">
            <div className="h-full rounded-full bg-[var(--accent)] transition-all" style={{ width: `${overallPct}%` }} />
          </div>
          <p className="mt-1 text-xs text-muted">{overallPct}% · keep this page open until it finishes.</p>
        </div>
      )}

      {recording.status === "error" && (
        <div className="mb-4 rounded-lg border border-status-error/30 bg-status-error/5 p-3">
          <p className="text-sm font-medium text-status-error">Something went wrong</p>
          <p className="mt-1 text-sm text-muted">{recording.error}</p>
        </div>
      )}

      {editing ? (
        <>
          <textarea
            value={summaryDraft}
            onChange={(e) => setSummaryDraft(e.target.value)}
            placeholder="Summary — one bullet per line, start with “- ”, indent 2 spaces per level."
            className="min-h-64 w-full resize-y rounded-lg border border-border bg-surface p-4 font-mono text-sm outline-none focus:border-[var(--accent)]"
          />
          <p className="mt-2 text-xs text-muted">
            Editing the title (above) and the summary (here) together.
          </p>
        </>
      ) : (
        hasSummary && <SummaryTree nodes={nodes} />
      )}

      {!embedded && (
        <section className="mt-6 rounded-xl border border-border bg-surface p-6 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Notes</h2>
            {notesStatus !== "idle" && (
              <span className="text-xs text-muted">{notesStatus === "saving" ? "Saving…" : "Saved"}</span>
            )}
          </div>
          <RichText value={notes} onChange={setNotes} placeholder="Your notes on this interview…" minHeight="min-h-32" />
        </section>
      )}

      {recording.transcript && !editing && (
        <div className="mt-4">
          <button
            onClick={() => setShowTranscript((v) => !v)}
            className="text-sm font-medium text-[var(--accent)] hover:underline"
          >
            {showTranscript ? "Hide" : "Show"} full transcript
          </button>
          {showTranscript && (
            <pre className="mt-3 max-h-96 overflow-y-auto whitespace-pre-wrap rounded-xl border border-border bg-canvas p-4 text-sm leading-relaxed text-ink/90">
              {recording.transcript}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
