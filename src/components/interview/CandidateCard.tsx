import Link from "next/link";
import { Briefcase, Share2 } from "lucide-react";
import type { Candidate } from "@/lib/interview/types";
import {
  STATUS_COLORS,
  STATUS_LABELS,
  candidateInitials,
  candidateName,
} from "@/lib/interview/types";
import { Badge } from "@/components/ui/Badge";
import { Avatar } from "@/components/ui/Avatar";

export function CandidateCard({
  candidate,
  shared,
}: {
  candidate: Candidate;
  shared?: boolean;
}) {
  return (
    <Link
      href={`/interview-prep/candidate/${candidate.id}`}
      className="flex flex-col rounded-xl border border-border bg-surface p-4 shadow-sm transition hover:border-[var(--accent)]/40 hover:shadow"
    >
      <div className="flex items-start gap-3">
        <Avatar initials={candidateInitials(candidate)} size={44} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{candidateName(candidate)}</p>
          {candidate.role_title && (
            <p className="truncate text-xs text-muted">{candidate.role_title}</p>
          )}
        </div>
        {shared && (
          <span title="Shared with you" className="text-muted">
            <Share2 size={15} />
          </span>
        )}
      </div>

      {candidate.location && (
        <p className="mt-3 flex items-center gap-1.5 truncate text-xs text-muted">
          <Briefcase size={12} className="shrink-0" />
          <span className="truncate">{candidate.location}</span>
        </p>
      )}

      <div className="mt-3">
        <Badge className={STATUS_COLORS[candidate.status]}>
          {STATUS_LABELS[candidate.status]}
        </Badge>
      </div>
    </Link>
  );
}
