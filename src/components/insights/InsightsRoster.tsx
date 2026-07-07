"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Plus,
  Search,
  Download,
  ChevronDown,
  ChevronRight,
  ArrowRight,
  ArrowUpDown,
  Trash2,
  CircleDot,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/Feedback";
import { Avatar } from "@/components/ui/Avatar";
import { EmptyState } from "@/components/ui/EmptyState";
import { EngagementRing } from "@/components/ui/EngagementRing";
import { useKOLs } from "@/lib/territory/hooks";
import { kolFullName, kolInitials } from "@/lib/territory/utils";
import {
  useOrgProfile,
  useResponses,
  useSurveyDefinition,
  type ResponseWithKol,
} from "@/lib/insights/hooks";
import {
  answersToMap,
  applicableQuestions,
  buildTree,
  completion,
  formatAnswer,
  splitByAnswered,
} from "@/lib/insights/survey";
import { cn } from "@/lib/ui";
import type { AnswerValue, QuestionNode, SurveyAnswer } from "@/lib/insights/types";
import { ImportKolsModal } from "./ImportKolsModal";
import { AddKolModal } from "./AddKolModal";

type SortKey =
  | "name"
  | "completion"
  | "priority"
  | "engagement"
  | "status"
  | "specialty";

const SORT_LABELS: Record<SortKey, string> = {
  name: "Name",
  completion: "Completion",
  priority: "Priority",
  engagement: "Engagement",
  status: "Status",
  specialty: "Specialty",
};

export function InsightsRoster({ userId }: { userId: string | null }) {
  const confirm = useConfirm();
  const { orgId } = useOrgProfile();
  const { template, questions, options, loading: defLoading } =
    useSurveyDefinition();
  const {
    responses,
    answers,
    loading,
    ensureResponse,
    removeResponse,
    refresh,
  } = useResponses(userId);
  const { kols, add: addKol } = useKOLs(userId);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "not_started" | "in_progress" | "complete">("all");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [showImport, setShowImport] = useState(false);
  const [showAdd, setShowAdd] = useState(false);

  const tree = useMemo(
    () => buildTree(questions, options),
    [questions, options],
  );

  // answers grouped by response id → question map
  const answersByResponse = useMemo(() => {
    const m = new Map<string, SurveyAnswer[]>();
    for (const a of answers) {
      const arr = m.get(a.response_id) || [];
      arr.push(a);
      m.set(a.response_id, arr);
    }
    return m;
  }, [answers]);

  // per-response completion (pct + counts)
  const compByResponse = useMemo(() => {
    const m = new Map<string, ReturnType<typeof completion>>();
    for (const r of responses) {
      const map = answersToMap(answersByResponse.get(r.id) || []);
      const applicable = applicableQuestions(tree, map);
      m.set(r.id, completion(applicable, map));
    }
    return m;
  }, [responses, answersByResponse, tree]);

  const kolIdsInRoster = useMemo(
    () => new Set(responses.map((r) => r.kol_id)),
    [responses],
  );
  const importCandidates = useMemo(
    () => kols.filter((k) => !kolIdsInRoster.has(k.id)),
    [kols, kolIdsInRoster],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const out = responses.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (!q) return true;
      const k = r.kol;
      return `${k?.first_name} ${k?.last_name} ${k?.specialty} ${k?.institution}`
        .toLowerCase()
        .includes(q);
    });

    const STATUS_RANK: Record<string, number> = {
      not_started: 0,
      in_progress: 1,
      complete: 2,
    };
    out.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "name") {
        cmp = `${a.kol?.last_name}${a.kol?.first_name}`.localeCompare(
          `${b.kol?.last_name}${b.kol?.first_name}`,
        );
      } else if (sortKey === "completion") {
        cmp =
          (compByResponse.get(a.id)?.pct ?? 0) -
          (compByResponse.get(b.id)?.pct ?? 0);
      } else if (sortKey === "priority") {
        cmp = (a.kol?.priority ?? 0) - (b.kol?.priority ?? 0);
      } else if (sortKey === "engagement") {
        cmp = (a.kol?.engagement_score ?? 0) - (b.kol?.engagement_score ?? 0);
      } else if (sortKey === "status") {
        cmp = (STATUS_RANK[a.status] ?? 0) - (STATUS_RANK[b.status] ?? 0);
      } else if (sortKey === "specialty") {
        cmp = (a.kol?.specialty ?? "").localeCompare(b.kol?.specialty ?? "");
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return out;
  }, [responses, search, statusFilter, sortKey, sortDir, compByResponse]);

  async function handleImport(kolIds: string[]) {
    if (!template) return;
    for (const id of kolIds) await ensureResponse(id, template.id, orgId);
    await refresh();
  }

  async function handleAdd(partial: Parameters<typeof addKol>[0]) {
    const kol = await addKol(partial);
    if (kol && template) {
      await ensureResponse(kol.id, template.id, orgId);
      await refresh();
    }
    return kol;
  }

  if (defLoading || loading) {
    return <p className="py-12 text-center text-sm text-muted">Loading…</p>;
  }

  if (!template) {
    return (
      <EmptyState
        title="No published survey yet"
        hint="An admin needs to build and publish the KOL survey before you can start collecting responses."
      />
    );
  }

  return (
    <>
      {/* Toolbar */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search KOLs…"
            className="w-full rounded-lg border border-border bg-surface py-2.5 pl-9 pr-3 text-sm outline-none focus:border-[var(--accent)]"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) =>
            setStatusFilter(e.target.value as typeof statusFilter)
          }
          className="rounded-lg border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)]"
        >
          <option value="all">All statuses</option>
          <option value="not_started">Not started</option>
          <option value="in_progress">In progress</option>
          <option value="complete">Complete</option>
        </select>
        <div className="flex items-center gap-1.5">
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="rounded-lg border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)]"
            title="Sort by"
          >
            {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
              <option key={k} value={k}>
                {SORT_LABELS[k]}
              </option>
            ))}
          </select>
          <button
            onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
            className="rounded-lg border border-border bg-surface p-2.5 text-muted transition hover:text-ink"
            title={sortDir === "asc" ? "Ascending — click to reverse" : "Descending — click to reverse"}
          >
            <ArrowUpDown size={16} />
          </button>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setShowImport(true)}>
            <Download size={16} /> Import KOLs
          </Button>
          <Button onClick={() => setShowAdd(true)}>
            <Plus size={16} /> Add KOL
          </Button>
        </div>
      </div>

      {/* Roster */}
      {filtered.length === 0 ? (
        <EmptyState
          title={
            responses.length === 0
              ? "No KOLs in your survey yet"
              : "No KOLs match these filters"
          }
          hint={
            responses.length === 0
              ? "Import KOLs from your territory or add a new one to start capturing insights."
              : undefined
          }
          action={
            responses.length === 0 ? (
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setShowImport(true)}>
                  <Download size={16} /> Import from Territory
                </Button>
                <Button onClick={() => setShowAdd(true)}>
                  <Plus size={16} /> Add KOL
                </Button>
              </div>
            ) : undefined
          }
        />
      ) : (
        <div className="flex flex-col gap-2.5">
          {filtered.map((r) => (
            <RosterRow
              key={r.id}
              response={r}
              tree={tree}
              answerMap={answersToMap(answersByResponse.get(r.id) || [])}
              comp={compByResponse.get(r.id) || { answered: 0, total: 0, pct: 0 }}
              onDelete={async () => {
                if (
                  await confirm({
                    title: `Remove ${kolFullName(r.kol)} from the survey?`,
                    message: "Their answers will be deleted.",
                    confirmLabel: "Remove",
                    danger: true,
                  })
                )
                  removeResponse(r.id);
              }}
            />
          ))}
        </div>
      )}

      <ImportKolsModal
        open={showImport}
        onClose={() => setShowImport(false)}
        candidates={importCandidates}
        onImport={handleImport}
      />
      <AddKolModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onCreate={handleAdd}
      />
    </>
  );
}

const STATUS_META: Record<
  string,
  { label: string; className: string }
> = {
  not_started: { label: "Not started", className: "bg-slate-100 text-slate-600" },
  in_progress: { label: "In progress", className: "bg-amber-100 text-amber-700" },
  complete: { label: "Complete", className: "bg-emerald-100 text-emerald-700" },
};

function RosterRow({
  response,
  tree,
  answerMap,
  comp,
  onDelete,
}: {
  response: ResponseWithKol;
  tree: QuestionNode[];
  answerMap: Map<string, AnswerValue>;
  comp: { answered: number; total: number; pct: number };
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const k = response.kol;
  const meta = STATUS_META[response.status] || STATUS_META.not_started;

  const { missing, answered } = useMemo(() => {
    const applicable = applicableQuestions(tree, answerMap);
    return splitByAnswered(applicable, answerMap);
  }, [tree, answerMap]);

  return (
    <div className="rounded-xl border border-border bg-surface shadow-sm">
      <div className="flex items-center gap-3 p-3.5">
        <Avatar src={k?.photo_url} initials={k ? kolInitials(k) : "?"} size={44} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate font-medium text-ink">
              {k ? kolFullName(k) : "Unknown KOL"}
            </p>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[11px] font-medium",
                meta.className,
              )}
            >
              {meta.label}
            </span>
          </div>
          <p className="truncate text-xs text-muted">
            {[k?.specialty, k?.institution].filter(Boolean).join(" · ") || "—"}
          </p>
        </div>

        <EngagementRing score={comp.pct} size={44} />

        <div className="flex items-center gap-1">
          <Link
            href={`/insights/kol/${response.kol_id}`}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-[var(--accent-fg)] transition hover:bg-[var(--accent-hover)]"
          >
            {response.status === "not_started" ? "Start" : "Continue"}
            <ArrowRight size={15} />
          </Link>
          <button
            onClick={() => setOpen((v) => !v)}
            className="rounded-lg p-2 text-muted transition hover:bg-canvas hover:text-ink"
            aria-label="Show details"
            title="Show questions"
          >
            {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
          </button>
        </div>
      </div>

      {/* Collapsed by default — click the chevron to reveal missing/answered. */}
      {open && (
        <div className="grid grid-cols-1 gap-4 border-t border-border p-4 sm:grid-cols-2">
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-600">
              <CircleDot size={13} /> Missing ({missing.length})
            </p>
            {missing.length === 0 ? (
              <p className="text-xs text-muted">Nothing left — fully answered.</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {missing.map((q) => (
                  <li key={q.id} className="text-sm text-ink">
                    · {q.text}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-600">
              <CheckCircle2 size={13} /> Answered ({answered.length})
            </p>
            {answered.length === 0 ? (
              <p className="text-xs text-muted">No answers yet.</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {answered.map((q) => (
                  <li key={q.id} className="text-sm">
                    <span className="text-ink">{q.text}</span>{" "}
                    <span className="text-muted">
                      — {formatAnswer(q, answerMap.get(q.id))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="sm:col-span-2">
            <button
              onClick={onDelete}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-muted transition hover:text-status-error"
            >
              <Trash2 size={13} /> Remove from survey
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
