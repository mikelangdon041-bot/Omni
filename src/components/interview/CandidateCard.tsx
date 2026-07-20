import Link from "next/link";
import { Mic, MessageCircleQuestion, FileText, Share2, MapPin } from "lucide-react";
import type { Candidate } from "@/lib/interview/types";
import {
  STATUS_COLORS,
  STATUS_LABELS,
  candidateInitials,
  candidateName,
} from "@/lib/interview/types";
import type { CandidateStat } from "@/lib/interview/hooks";
import { Badge } from "@/components/ui/Badge";
import { Avatar } from "@/components/ui/Avatar";

export function CandidateCard({
  candidate,
  shared,
  stat,
}: {
  candidate: Candidate;
  shared?: boolean;
  stat?: CandidateStat;
}) {
  const interviews = stat?.interviews ?? 0;
  const questions = stat?.questions ?? 0;
  const hasResume = !!(candidate.resume_text?.trim() || candidate.resume_url);

  return (
    <Link
      href={`/interview-prep/candidate/${candidate.id}`}
      className="flex flex-col rounded-xl border border-border bg-surface p-2.5 shadow-sm transition hover:border-[var(--accent)]/40 hover:shadow sm:p-4"
    >
      <div className="flex items-start gap-2 sm:gap-3">
        <Avatar initials={candidateInitials(candidate)} size={36} className="sm:hidden" />
        <Avatar initials={candidateInitials(candidate)} size={44} className="hidden sm:block" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold sm:text-base">{candidateName(candidate)}</p>
          {candidate.role_title && (
            <p className="truncate text-xs text-muted">{candidate.role_title}</p>
          )}
          {candidate.location && (
            <p className="mt-0.5 hidden items-center gap-1 truncate text-xs text-muted sm:flex">
              <MapPin size={11} className="shrink-0" />
              {candidate.location}
            </p>
          )}
        </div>
        {shared && (
          <span title="Shared with you" className="text-muted">
            <Share2 size={15} />
          </span>
        )}
      </div>

      {/* facts */}
      <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-xs text-muted sm:mt-3 sm:gap-x-3">
        <span
          className="flex items-center gap-1"
          title={`${interviews} interview${interviews === 1 ? "" : "s"}`}
        >
          <Mic size={13} /> {interviews}
        </span>
        <span
          className="flex items-center gap-1"
          title={`${questions} question${questions === 1 ? "" : "s"}`}
        >
          <MessageCircleQuestion size={13} /> {questions}
        </span>
        <span
          className={`hidden items-center gap-1 sm:flex ${hasResume ? "text-status-complete" : ""}`}
          title={hasResume ? "Resume added" : "No resume yet"}
        >
          <FileText size={13} /> {hasResume ? "Resume" : "No resume"}
        </span>
      </div>

      <div className="mt-2 sm:mt-3">
        <Badge className={STATUS_COLORS[candidate.status]}>
          {STATUS_LABELS[candidate.status]}
        </Badge>
      </div>
    </Link>
  );
}
