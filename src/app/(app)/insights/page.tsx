"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Sparkles, ClipboardList, TrendingUp, Users } from "lucide-react";
import { ModuleHero } from "@/components/ui/ModuleHero";
import { Tabs } from "@/components/ui/Tabs";
import { useUserId } from "@/lib/territory/hooks";
import {
  useOrgProfile,
  useResponses,
  useSurveyDefinition,
} from "@/lib/insights/hooks";
import {
  answersToMap,
  applicableQuestions,
  buildTree,
  completion,
} from "@/lib/insights/survey";
import { rosterStats } from "@/lib/insights/analytics";
import { InsightsRoster } from "@/components/insights/InsightsRoster";
import { AnalysisWorkbench } from "@/components/insights/AnalysisWorkbench";
import type { SurveyAnswer } from "@/lib/insights/types";

const TABS = ["KOLs", "Analyze"] as const;
type Tab = (typeof TABS)[number];

export default function InsightsPage() {
  const { userId } = useUserId();
  const { isAdmin } = useOrgProfile();
  const { questions, options } = useSurveyDefinition();
  const { responses, answers } = useResponses(userId);
  const [tab, setTab] = useState<Tab>("KOLs");

  const tree = useMemo(
    () => buildTree(questions, options),
    [questions, options],
  );

  const stats = useMemo(() => {
    const byResponse = new Map<string, SurveyAnswer[]>();
    for (const a of answers) {
      const arr = byResponse.get(a.response_id) || [];
      arr.push(a);
      byResponse.set(a.response_id, arr);
    }
    const completions = new Map<string, number>();
    for (const r of responses) {
      const map = answersToMap(byResponse.get(r.id) || []);
      completions.set(r.id, completion(applicableQuestions(tree, map), map).pct);
    }
    return rosterStats(responses, completions, answers, questions);
  }, [responses, answers, questions, tree]);

  return (
    <>
      <ModuleHero
        eyebrow="Insights"
        icon={Sparkles}
        title="Field insights"
        subtitle="Run the canonical KOL survey, track your coverage, and turn answers into comparable, chartable data."
        stats={[
          { label: "KOLs in survey", value: stats.totalKols },
          { label: "Started", value: stats.started },
          { label: "Complete", value: stats.complete },
          { label: "Avg complete", value: `${stats.avgCompletion}%` },
        ]}
        action={
          isAdmin ? (
            <Link
              href="/insights/survey"
              className="inline-flex items-center gap-1.5 rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-ink shadow-sm transition hover:bg-white/90"
            >
              <ClipboardList size={16} /> Edit survey
            </Link>
          ) : undefined
        }
      />

      {/* Fun stats strip */}
      {(stats.mostAnswered || stats.leastAnswered) && (
        <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {stats.mostAnswered && (
            <FunStat
              icon={TrendingUp}
              label="Most-answered question"
              value={stats.mostAnswered.question}
              hint={`${stats.mostAnswered.count} responses`}
            />
          )}
          {stats.leastAnswered && (
            <FunStat
              icon={Users}
              label="Least-answered question"
              value={stats.leastAnswered.question}
              hint={`${stats.leastAnswered.count} responses`}
            />
          )}
        </div>
      )}

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {tab === "KOLs" ? (
        <InsightsRoster userId={userId} />
      ) : (
        <AnalysisWorkbench />
      )}
    </>
  );
}

function FunStat({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof TrendingUp;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border bg-surface p-4 shadow-sm">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-[var(--accent)]">
        <Icon size={17} />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">
          {label}
        </p>
        <p className="truncate text-sm font-medium text-ink">{value}</p>
        <p className="text-xs text-muted">{hint}</p>
      </div>
    </div>
  );
}
