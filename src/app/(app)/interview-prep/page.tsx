import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { StatusChip } from "@/components/StatusChip";
import { NewRecording } from "./NewRecording";

export const dynamic = "force-dynamic";

export default async function InterviewPrepPage() {
  const supabase = await createClient();
  const { data: recordings } = await supabase
    .from("recordings")
    .select("id, title, status, total_chunks, chunks_done, created_at")
    .order("created_at", { ascending: false });

  return (
    <>
      <PageHeader
        title="Interview Prep"
        subtitle="Upload a recording, get a transcript and a nested summary."
      />

      <NewRecording />

      <div className="mt-8">
        <h2 className="mb-3 text-sm font-semibold text-muted">Your recordings</h2>
        {!recordings || recordings.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-surface px-6 py-12 text-center text-sm text-muted">
            No recordings yet. Upload your first one above.
          </div>
        ) : (
          <ul className="space-y-2">
            {recordings.map((r) => {
              const detail =
                r.status === "transcribing" && r.total_chunks
                  ? `${r.chunks_done}/${r.total_chunks}`
                  : undefined;
              return (
                <li key={r.id}>
                  <Link
                    href={`/interview-prep/${r.id}`}
                    className="flex items-center justify-between gap-4 rounded-xl border border-border bg-surface px-4 py-3 shadow-sm transition hover:border-primary/40"
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
    </>
  );
}
