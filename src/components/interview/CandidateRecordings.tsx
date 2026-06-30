"use client";

import Link from "next/link";
import { useCandidateRecordings } from "@/lib/interview/hooks";
import { StatusChip } from "@/components/ui/StatusChip";
import { NewRecording } from "@/app/(app)/interview-prep/NewRecording";

export function CandidateRecordings({ candidateId }: { candidateId: string }) {
  const { recordings, loading } = useCandidateRecordings(candidateId);

  return (
    <div className="space-y-6">
      <NewRecording candidateId={candidateId} />

      <div>
        <h3 className="mb-3 text-sm font-semibold text-muted">Interviews</h3>
        {loading ? (
          <p className="py-8 text-center text-sm text-muted">Loading…</p>
        ) : recordings.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-surface px-6 py-10 text-center text-sm text-muted">
            No recordings yet. Upload an interview above to transcribe and summarize it.
          </div>
        ) : (
          <ul className="space-y-2">
            {recordings.map((r) => {
              const detail =
                r.status === "transcribing" && r.total_chunks
                  ? `${Math.round((r.chunks_done / r.total_chunks) * 100)}%`
                  : undefined;
              return (
                <li key={r.id}>
                  <Link
                    href={`/interview-prep/${r.id}`}
                    className="flex items-center justify-between gap-4 rounded-xl border border-border bg-surface px-4 py-3 shadow-sm transition hover:border-[var(--accent)]/40"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{r.title}</p>
                      <p className="text-xs text-muted">
                        {new Date(r.created_at).toLocaleString()}
                      </p>
                    </div>
                    <StatusChip status={r.status} detail={detail} />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
