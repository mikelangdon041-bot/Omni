"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Plus, Search, Mic, BookMarked } from "lucide-react";
import { ModuleHero } from "@/components/ui/ModuleHero";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { StatusChip } from "@/components/ui/StatusChip";
import { CandidateCard } from "@/components/interview/CandidateCard";
import { AddCandidateModal } from "@/components/interview/AddCandidateModal";
import {
  useCandidates,
  useUnassignedRecordings,
  useUserId,
} from "@/lib/interview/hooks";
import {
  CANDIDATE_STATUSES,
  STATUS_LABELS,
  type Candidate,
  type CandidateStatus,
} from "@/lib/interview/types";

export default function InterviewPrepPage() {
  const { userId } = useUserId();
  const { candidates, loading, add } = useCandidates();
  const { recordings: unassigned } = useUnassignedRecordings();
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | CandidateStatus>("all");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return candidates.filter((c) => {
      if (statusFilter !== "all" && c.status !== statusFilter) return false;
      if (q) {
        const hay = `${c.first_name} ${c.last_name} ${c.role_title} ${c.location}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [candidates, search, statusFilter]);

  const activeCount = candidates.filter(
    (c) => !["hired", "rejected", "archived"].includes(c.status),
  ).length;
  const hiredCount = candidates.filter((c) => c.status === "hired").length;

  async function onCreate(partial: Partial<Candidate>) {
    if (!userId) return null;
    return add(partial, userId);
  }

  return (
    <>
      <ModuleHero
        eyebrow="Interview Prep"
        icon={Mic}
        title="Run great candidate interviews"
        subtitle="Track each candidate end-to-end — questions, recordings, summaries, and a shared history."
        stats={[
          { label: "Candidates", value: candidates.length },
          { label: "In process", value: activeCount },
          { label: "Hired", value: hiredCount },
        ]}
        action={
          <div className="flex flex-wrap gap-2">
            <Link href="/interview-prep/question-bank">
              <Button className="!bg-white/15 !text-white hover:!bg-white/25">
                <BookMarked size={16} /> Question bank
              </Button>
            </Link>
            <Button
              onClick={() => setShowAdd(true)}
              className="!bg-white !text-ink hover:!bg-white/90"
            >
              <Plus size={16} /> Add candidate
            </Button>
          </div>
        }
      />

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search candidates by name, role, location…"
            className="w-full rounded-lg border border-border bg-surface py-2.5 pl-9 pr-3 text-sm outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          className="rounded-lg border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)]"
        >
          <option value="all">All statuses</option>
          {CANDIDATE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <p className="py-12 text-center text-sm text-muted">Loading…</p>
      ) : filtered.length === 0 ? (
        <EmptyState
          title={
            candidates.length === 0 ? "No candidates yet" : "No candidates match"
          }
          hint={
            candidates.length === 0
              ? "Add your first candidate to start preparing interviews."
              : "Try a different search or status."
          }
          action={
            candidates.length === 0 ? (
              <Button onClick={() => setShowAdd(true)}>
                <Plus size={16} /> Add candidate
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((c) => (
            <CandidateCard
              key={c.id}
              candidate={c}
              shared={c.user_id !== userId}
            />
          ))}
        </div>
      )}

      {unassigned.length > 0 && (
        <div className="mt-10">
          <h2 className="mb-1 text-sm font-semibold text-muted">
            Unassigned recordings
          </h2>
          <p className="mb-3 text-xs text-muted">
            Recordings not yet linked to a candidate. Open one to view its
            transcript &amp; summary.
          </p>
          <ul className="space-y-2">
            {unassigned.map((r) => {
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
        </div>
      )}

      <AddCandidateModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onCreate={onCreate}
      />
    </>
  );
}
