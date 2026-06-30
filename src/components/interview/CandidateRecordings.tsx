"use client";

import Link from "next/link";
import { useState } from "react";
import { PencilLine } from "lucide-react";
import {
  useCandidateRecordings,
  useInterviewNotes,
} from "@/lib/interview/hooks";
import type { InterviewNote } from "@/lib/interview/types";
import { StatusChip } from "@/components/ui/StatusChip";
import { Button } from "@/components/ui/Button";
import { NewRecording } from "@/app/(app)/interview-prep/NewRecording";
import { InterviewNotesEditor } from "@/components/interview/InterviewNotesEditor";

export function CandidateRecordings({
  candidateId,
  userId,
}: {
  candidateId: string;
  userId: string | null;
}) {
  const { recordings, loading } = useCandidateRecordings(candidateId);
  const written = useInterviewNotes(candidateId, userId);
  const [openNote, setOpenNote] = useState<InterviewNote | null>(null);

  async function writeNotes() {
    const n = await written.add();
    if (n) setOpenNote(n);
  }

  return (
    <div className="space-y-6">
      <NewRecording candidateId={candidateId} />

      <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">No recording?</p>
            <p className="text-sm text-muted">
              Write up the interview by hand — with your planned questions alongside.
            </p>
          </div>
          <Button variant="secondary" onClick={writeNotes}>
            <PencilLine size={15} /> Write interview notes
          </Button>
        </div>
      </div>

      {/* Recorded interviews */}
      <div>
        <h3 className="mb-3 text-sm font-semibold text-muted">Recorded</h3>
        {loading ? (
          <p className="py-6 text-center text-sm text-muted">Loading…</p>
        ) : recordings.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-surface px-6 py-8 text-center text-sm text-muted">
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

      {/* Written interviews */}
      {written.notes.length > 0 && (
        <div>
          <h3 className="mb-3 text-sm font-semibold text-muted">Written</h3>
          <ul className="space-y-2">
            {written.notes.map((n) => (
              <li key={n.id}>
                <button
                  onClick={() => setOpenNote(n)}
                  className="flex w-full items-center justify-between gap-4 rounded-xl border border-border bg-surface px-4 py-3 text-left shadow-sm transition hover:border-[var(--accent)]/40"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{n.title}</p>
                    <p className="text-xs text-muted">
                      {new Date(n.updated_at).toLocaleString()}
                    </p>
                  </div>
                  <PencilLine size={15} className="text-muted" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {openNote && (
        <InterviewNotesEditor
          open
          onClose={() => setOpenNote(null)}
          note={openNote}
          candidateId={candidateId}
          userId={userId}
          update={written.update}
          remove={written.remove}
        />
      )}
    </div>
  );
}
