"use client";

import Link from "next/link";
import { useState } from "react";
import { Trash2, Pencil, Check } from "lucide-react";
import { useUnassignedRecordings } from "@/lib/interview/hooks";
import { StatusChip } from "@/components/ui/StatusChip";
import { candidateName, type Candidate } from "@/lib/interview/types";

export function UnassignedRecordings({ candidates }: { candidates: Candidate[] }) {
  const { recordings, rename, assign, remove } = useUnassignedRecordings();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");

  if (recordings.length === 0) return null;

  return (
    <div className="mt-10">
      <h2 className="mb-1 text-sm font-semibold text-muted">Unassigned recordings</h2>
      <p className="mb-3 text-xs text-muted">
        Recordings not yet linked to a candidate. Rename, move them onto a
        candidate, or delete.
      </p>
      <ul className="space-y-2">
        {recordings.map((r) => {
          const detail =
            r.status === "transcribing" && r.total_chunks
              ? `${Math.round((r.chunks_done / r.total_chunks) * 100)}%`
              : undefined;
          return (
            <li
              key={r.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 shadow-sm"
            >
              <div className="min-w-0 flex-1">
                {editingId === r.id ? (
                  <div className="flex items-center gap-2">
                    <input
                      autoFocus
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && title.trim()) {
                          rename(r.id, title.trim());
                          setEditingId(null);
                        }
                      }}
                      className="flex-1 rounded-md border border-border px-2 py-1 text-sm outline-none focus:border-[var(--accent)]"
                    />
                    <button
                      onClick={() => {
                        if (title.trim()) rename(r.id, title.trim());
                        setEditingId(null);
                      }}
                      className="text-status-complete"
                    >
                      <Check size={16} />
                    </button>
                  </div>
                ) : (
                  <>
                    <Link
                      href={`/interview-prep/${r.id}`}
                      className="block truncate font-medium hover:text-[var(--accent)]"
                    >
                      {r.title}
                    </Link>
                    <p className="text-xs text-muted">
                      {new Date(r.created_at).toLocaleString()}
                    </p>
                  </>
                )}
              </div>

              <StatusChip status={r.status} detail={detail} />

              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => {
                    setEditingId(r.id);
                    setTitle(r.title);
                  }}
                  title="Rename"
                  className="rounded-md p-1.5 text-muted transition hover:bg-canvas hover:text-ink"
                >
                  <Pencil size={15} />
                </button>
                <select
                  defaultValue=""
                  onChange={(e) => e.target.value && assign(r.id, e.target.value)}
                  title="Move to candidate"
                  className="rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-muted outline-none focus:border-[var(--accent)]"
                >
                  <option value="">Move to…</option>
                  {candidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {candidateName(c)}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => {
                    if (window.confirm("Delete this recording permanently?"))
                      remove(r.id);
                  }}
                  title="Delete"
                  className="rounded-md p-1.5 text-muted transition hover:bg-canvas hover:text-status-error"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
