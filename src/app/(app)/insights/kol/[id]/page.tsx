"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { EmptyState } from "@/components/ui/EmptyState";
import { SurveyRunner } from "@/components/insights/SurveyRunner";
import { useKOL, useUserId } from "@/lib/territory/hooks";
import { kolFullName, kolInitials } from "@/lib/territory/utils";
import {
  useOrgProfile,
  useResponses,
  useSurveyDefinition,
} from "@/lib/insights/hooks";
import { buildTree } from "@/lib/insights/survey";

export default function TakeSurveyPage() {
  const params = useParams<{ id: string }>();
  const kolId = params.id;

  const { userId } = useUserId();
  const { kol } = useKOL(kolId);
  const { orgId } = useOrgProfile();
  const { template, questions, options, loading: defLoading } =
    useSurveyDefinition();
  const { responses, loading: respLoading, ensureResponse } =
    useResponses(userId);

  const [responseId, setResponseId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const tree = useMemo(
    () => buildTree(questions, options),
    [questions, options],
  );

  // Find or create this KOL's response for the active template.
  useEffect(() => {
    if (!template || respLoading || creating || responseId) return;
    const found = responses.find(
      (r) => r.kol_id === kolId && r.template_id === template.id,
    );
    if (found) {
      setResponseId(found.id);
      return;
    }
    setCreating(true);
    ensureResponse(kolId, template.id, orgId).then((r) => {
      if (r) setResponseId(r.id);
      setCreating(false);
    });
  }, [
    template,
    responses,
    respLoading,
    creating,
    responseId,
    kolId,
    orgId,
    ensureResponse,
  ]);

  const status = useMemo(
    () => responses.find((r) => r.id === responseId)?.status ?? "not_started",
    [responses, responseId],
  );

  return (
    <>
      <Link
        href="/insights"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted transition hover:text-ink"
      >
        <ArrowLeft size={16} /> Back to Insights
      </Link>

      {/* KOL header */}
      <div className="mb-6 flex items-center gap-4 rounded-2xl border border-border bg-surface p-5 shadow-sm">
        <Avatar
          src={kol?.photo_url}
          initials={kol ? kolInitials(kol) : "?"}
          size={56}
        />
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight">
            {kol ? kolFullName(kol) : "Loading…"}
          </h1>
          <p className="truncate text-sm text-muted">
            {[kol?.specialty, kol?.institution].filter(Boolean).join(" · ") ||
              "KOL survey"}
          </p>
        </div>
      </div>

      {defLoading ? (
        <p className="py-12 text-center text-sm text-muted">Loading survey…</p>
      ) : !template ? (
        <EmptyState
          title="No published survey"
          hint="Ask an admin to publish the organization's KOL survey before collecting responses."
        />
      ) : tree.length === 0 ? (
        <EmptyState
          title="The survey has no questions yet"
          hint="An admin needs to add questions in the survey builder."
        />
      ) : !responseId ? (
        <p className="py-12 text-center text-sm text-muted">Preparing…</p>
      ) : (
        <SurveyRunner responseId={responseId} tree={tree} initialStatus={status} />
      )}
    </>
  );
}
