"use client";

// Insights hub (spec §9): day-grouped intelligence with smart day assignment
// (an insight tied to a scheduled item belongs to that item's date), filters,
// manual capture, AI daily rollups (excluding "Not relevant"), and the daily
// booth log.

import { useMemo, useState } from "react";
import { Loading, ProgressBar } from "@/components/conference/Bits";
import Link from "next/link";
import {
  ChevronDown,
  Download,
  Landmark,
  Mail,
  Mic2,
  NotebookPen,
  Plus,
  Sparkles,
  Store,
  Trash2,
} from "lucide-react";
import {
  exportInsightsDocx,
  exportInsightsPdf,
  exportInsightsXlsx,
} from "@/lib/conference/exports";
import { Button } from "@/components/ui/Button";
import { useConfirm, useToast } from "@/components/ui/Feedback";
import { Modal } from "@/components/ui/Modal";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { EmptyState } from "@/components/ui/EmptyState";
import { RichText, RichTextView } from "@/components/ui/RichText";
import { cn } from "@/lib/ui";
import { useConferenceCtx } from "@/components/conference/ConferenceContext";
import {
  uploadConferenceFile,
  useCategories,
  useDailyRow,
  useEvents,
  useInsights,
  usePosters,
} from "@/lib/conference/hooks";
import { usePersistedFilter } from "@/lib/conference/usePersistedFilter";
import { CategoryChip, GenerateInsightsModal } from "@/components/conference/InsightAI";
import { PriorityPill, PriorityEditorModal } from "@/components/conference/Priority";
import { EditQuestionsButton, QuestionsEditorModal } from "@/components/conference/Questions";
import {
  BUILTIN_BOOTH_KEYS,
  SOURCE_TYPES,
  boothQuestions,
  priorityRank,
  type BoothLog,
  type DailySummary,
  type Insight,
  type Priority,
  type QuestionDef,
} from "@/lib/conference/types";
import {
  dateKeyInTz,
  fmtDayKey,
  fmtDayKeyLong,
  legacyPlainToHtml,
  listDays,
  nestedHtmlToPlainText,
  normalizeFreeDate,
  stripHtml,
  todayKey,
} from "@/lib/conference/utils";

export default function InsightsPage() {
  const confirm = useConfirm();
  const toast = useToast();
  const { conference, attendees, me } = useConferenceCtx();
  const insightsApi = useInsights(conference.id);
  const { parents, childrenOf, loading, add, update, remove } = insightsApi;
  const { categories } = useCategories(conference.id);
  const { events } = useEvents(conference.id, me?.id);
  const { posters } = usePosters(conference.id);
  const tz = conference.timezone;
  const confYear = Number(conference.start_date.slice(0, 4)) || new Date().getFullYear();

  const [showAdd, setShowAdd] = useState(false);
  const [photoUrls, setPhotoUrls] = useState<string[] | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoPct, setPhotoPct] = useState(0);
  const [catFilter, setCatFilter] = usePersistedFilter<string[]>(conference.id, "insights_cat", []);
  const [personFilter, setPersonFilter] = usePersistedFilter(conference.id, "insights_person", "all");
  const [dayFilter, setDayFilter] = usePersistedFilter(conference.id, "insights_day", "all");
  const [view, setView] = usePersistedFilter<"list" | "booth">(conference.id, "insights_view", "list");
  const [collapsedDays, setCollapsedDays] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [priorityFor, setPriorityFor] = useState<Insight | null>(null);
  const [summaryDay, setSummaryDay] = useState<string | null>(null);

  // Smart day assignment (spec §9.6).
  const dayOf = useMemo(() => {
    const eventDay = new Map(events.map((e) => [e.id, dateKeyInTz(e.starts_at, tz)]));
    const posterDay = new Map(
      posters.map((p) => [p.id, normalizeFreeDate(p.date, confYear) || ""]),
    );
    return (i: Insight): string => {
      if (i.event_id && eventDay.get(i.event_id)) return eventDay.get(i.event_id)!;
      if (i.poster_id && posterDay.get(i.poster_id)) return posterDay.get(i.poster_id)!;
      if (i.insight_date) return i.insight_date;
      return dateKeyInTz(i.created_at, tz);
    };
  }, [events, posters, tz, confYear]);

  const userName = (userId: string | null) =>
    attendees.find((a) => a.user_id === userId)?.name || "";

  // Author display name: linked attendee first, else the imported name.
  const authorOf = (i: Insight) => userName(i.user_id) || i.created_by_name || "";

  const filtered = useMemo(() => {
    return parents.filter((i) => {
      if (personFilter !== "all") {
        if (personFilter.startsWith("name:")) {
          if ((i.created_by_name || "") !== personFilter.slice(5)) return false;
        } else if (i.user_id !== personFilter) return false;
      }
      if (dayFilter !== "all" && dayOf(i) !== dayFilter) return false;
      if (catFilter.length) {
        const all = [i, ...childrenOf(i.id)];
        const hit = all.some((x) => x.categories.some((c) => catFilter.includes(c)));
        if (!hit) return false;
      }
      return true;
    });
  }, [parents, personFilter, dayFilter, catFilter, dayOf, childrenOf]);

  const groups = useMemo(() => {
    const map = new Map<string, Insight[]>();
    for (const i of filtered) {
      const key = dayOf(i) || "No date";
      map.set(key, [...(map.get(key) || []), i]);
    }
    for (const list of map.values()) {
      list.sort(
        (a, b) =>
          priorityRank(a.suspected_priority, a.confirmed_priority) -
          priorityRank(b.suspected_priority, b.confirmed_priority),
      );
    }
    return [...map.entries()].sort(([a], [b]) => b.localeCompare(a));
  }, [filtered, dayOf]);

  const linkedUsers = useMemo(
    () => attendees.filter((a) => a.user_id && parents.some((p) => p.user_id === a.user_id)),
    [attendees, parents],
  );
  // Authors that exist only as imported names (no auth user here).
  const namedAuthors = useMemo(
    () =>
      [...new Set(parents.map((p) => (!p.user_id && p.created_by_name) || ""))]
        .filter(Boolean)
        .sort(),
    [parents],
  );
  const days = listDays(conference.start_date, conference.end_date);

  function sourceChip(i: Insight) {
    const [icon, label, color, soft] = i.event_id
      ? [<Mic2 key="i" size={11} />, "Session", "#0284c7", "#e0f2fe"]
      : i.contact_id
        ? [<Landmark key="i" size={11} />, "KOL", "#7c3aed", "#ede9fe"]
        : i.poster_id
          ? [<NotebookPen key="i" size={11} />, "Poster", "#d97706", "#fef3c7"]
          : [<Plus key="i" size={11} />, "Manual", "#6c6982", "#eeedf5"];
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
        style={{ background: soft as string, color: color as string }}
      >
        {icon}
        {label as string}
      </span>
    );
  }
  function sourceHref(i: Insight): string | null {
    const base = `/conference-planning/${conference.id}`;
    if (i.event_id) return `${base}/sessions/${i.event_id}`;
    if (i.contact_id) return `${base}/contacts/${i.contact_id}`;
    if (i.poster_id) return `${base}/posters/${i.poster_id}`;
    return null;
  }

  // Plain-text digest of the currently filtered insights (for email). Real
  // bullets (•/◦), not dashes, and non-breaking-space indentation — regular
  // spaces get collapsed by most mail clients, silently flattening structure.
  function digestText(): string {
    const NBSP = "  ";
    const dayCount = groups.length;
    const intro =
      dayFilter !== "all"
        ? `${fmtDayKeyLong(dayFilter)} of ${conference.name} — field insights below.`
        : `${conference.name} — field insights across ${dayCount} day${dayCount === 1 ? "" : "s"}.`;
    const lines: string[] = [intro, ""];
    for (const [day, list] of groups) {
      lines.push(day === "No date" ? "No date" : fmtDayKeyLong(day));
      lines.push("");
      for (const i of list) {
        lines.push(`• ${i.title}${i.source_type ? ` (${i.source_type})` : ""}`);
        if (i.notes) lines.push(`${NBSP}${nestedHtmlToPlainText(i.notes)}`);
        for (const c of childrenOf(i.id)) lines.push(`${NBSP}◦ ${c.title}`);
        lines.push("");
      }
    }
    return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  async function emailInsights() {
    const subject = `${conference.name} — field insights${
      dayFilter !== "all" ? `, ${fmtDayKeyLong(dayFilter)}` : ""
    }`;
    const body = digestText();
    if (!body) {
      toast("info", "No insights to send with these filters.");
      return;
    }
    // mailto URLs truncate long bodies — put the full digest on the clipboard
    // and open the email app with as much as fits.
    try {
      await navigator.clipboard.writeText(`${subject}\n\n${body}`);
      toast("success", "Full digest copied — paste it if the email is cut off.");
    } catch {
      // clipboard denied — the mailto still carries the truncated body
    }
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(
      body.slice(0, 1800),
    )}`;
  }

  return (
    <div>
      {/* Insights / Booth sub-tabs */}
      <div className="mb-4 flex gap-1 border-b border-border">
        <button
          onClick={() => setView("list")}
          className={cn(
            "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition",
            view === "list"
              ? "border-[var(--accent)] text-[var(--accent)]"
              : "border-transparent text-muted hover:text-ink",
          )}
        >
          Insights
        </button>
        <button
          onClick={() => setView("booth")}
          className={cn(
            "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition",
            view === "booth"
              ? "border-[var(--accent)] text-[var(--accent)]"
              : "border-transparent text-muted hover:text-ink",
          )}
        >
          <Store size={14} /> Booth
        </button>
      </div>

      {view === "booth" ? (
        <BoothTabView />
      ) : (
        <>
      {/* Filters */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select
          value={dayFilter}
          onChange={(e) => setDayFilter(e.target.value)}
          className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium outline-none focus:border-[var(--accent)]"
        >
          <option value="all">All days</option>
          {days.map((d) => (
            <option key={d} value={d}>
              {fmtDayKeyLong(d)}
            </option>
          ))}
        </select>
        <select
          value={personFilter}
          onChange={(e) => setPersonFilter(e.target.value)}
          className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium outline-none focus:border-[var(--accent)]"
        >
          <option value="all">Everyone</option>
          {linkedUsers.map((a) => (
            <option key={a.id} value={a.user_id!}>
              {a.name}
            </option>
          ))}
          {namedAuthors.map((n) => (
            <option key={`name:${n}`} value={`name:${n}`}>
              {n}
            </option>
          ))}
        </select>
        <div className="-mx-1 flex w-full flex-nowrap gap-1 overflow-x-auto px-1 pb-1 md:mx-0 md:w-auto md:flex-wrap md:overflow-visible md:px-0 md:pb-0">
          {categories.map((c) => (
            <button
              key={c.id}
              onClick={() =>
                setCatFilter((prev) =>
                  prev.includes(c.name)
                    ? prev.filter((x) => x !== c.name)
                    : [...prev, c.name],
                )
              }
              className={cn(
                "shrink-0 rounded-full border px-2 py-1 text-[10px] font-semibold transition",
                catFilter.includes(c.name)
                  ? "border-transparent text-white"
                  : "border-border bg-surface text-muted hover:text-ink",
              )}
              style={catFilter.includes(c.name) ? { background: c.color } : undefined}
            >
              {c.name}
            </button>
          ))}
        </div>
      </div>

      {/* Toolbar: utilities on the left (one consistent style), the primary
          action isolated on the right — these used to be five differently
          shaped buttons (a pill, a bare circle, another pill…) crammed
          together with no grouping. */}
      <div className="mb-4 flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <Link
            href={`/conference-planning/${conference.id}/recap`}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted transition hover:bg-canvas hover:text-ink"
            title="Everything captured, day by day, per rep"
          >
            <NotebookPen size={14} /> Team Recap
          </Link>
          <button
            onClick={emailInsights}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted transition hover:bg-canvas hover:text-ink"
            title="Email the filtered insights"
          >
            <Mail size={14} /> Send email
          </button>
          <div className="relative">
            <select
              value=""
              onChange={(e) => {
                const fmt = e.target.value;
                if (!fmt) return;
                const ctx = { dayOf, childrenOf, nameOf: userName };
                const name = `${conference.name} — insights${dayFilter !== "all" ? ` ${dayFilter}` : ""}`;
                if (fmt === "xlsx") exportInsightsXlsx(filtered, ctx, name);
                if (fmt === "docx") void exportInsightsDocx(filtered, ctx, name, name);
                if (fmt === "pdf") exportInsightsPdf(filtered, ctx, name, name);
              }}
              className="peer absolute inset-0 cursor-pointer opacity-0"
              title="Export the filtered insights"
            >
              <option value="">Export…</option>
              <option value="xlsx">Excel (.xlsx)</option>
              <option value="docx">Word (.docx)</option>
              <option value="pdf">PDF</option>
            </select>
            <span className="pointer-events-none inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted transition peer-hover:bg-canvas peer-hover:text-ink">
              <Download size={14} /> Export
            </span>
          </div>
          <label className="relative inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted transition hover:bg-canvas hover:text-ink">
            <Sparkles size={14} />
            {photoBusy ? "Uploading…" : "From photo"}
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={async (e) => {
                const files = Array.from(e.target.files || []);
                if (!files.length) return;
                setPhotoBusy(true);
                setPhotoPct(0);
                try {
                  const urls: string[] = [];
                  for (let i = 0; i < files.length; i++) {
                    const url = await uploadConferenceFile(conference.id, "insight-photos", files[i]);
                    if (url) urls.push(url);
                    setPhotoPct(((i + 1) / files.length) * 100);
                  }
                  if (urls.length) setPhotoUrls(urls);
                } catch (err) {
                  toast("error", (err as Error).message);
                } finally {
                  setPhotoBusy(false);
                }
              }}
            />
          </label>
        </div>
        <span className="flex-1" />
        <Button onClick={() => setShowAdd(true)}>
          <Plus size={16} /> Add insight
        </Button>
      </div>

      {photoBusy && (
        <ProgressBar percent={photoPct} label="Uploading photos…" className="mb-4" />
      )}

      {loading ? (
        <Loading />
      ) : groups.length === 0 ? (
        <EmptyState
          title={parents.length === 0 ? "No insights yet" : "No insights match these filters"}
          hint="Capture field intelligence manually here, or generate insights from session, poster, and contact notes."
          action={
            parents.length === 0 ? (
              <Button onClick={() => setShowAdd(true)}>
                <Plus size={16} /> Add insight
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-4">
          {groups.map(([day, list]) => {
            const closed = collapsedDays[day] ?? false;
            return (
              <section key={day} className="overflow-hidden rounded-xl border border-border bg-surface">
                <div className="flex items-center justify-between px-4 py-3">
                  <button
                    onClick={() =>
                      setCollapsedDays((prev) => ({ ...prev, [day]: !closed }))
                    }
                    className="flex items-center gap-2 text-sm font-semibold"
                  >
                    <ChevronDown
                      size={15}
                      className={cn("transition-transform", closed && "-rotate-90")}
                    />
                    {day === "No date" ? "No date" : fmtDayKeyLong(day)}
                    <span className="text-xs font-normal text-muted">({list.length})</span>
                  </button>
                  {day !== "No date" && (
                    <Button size="sm" variant="secondary" onClick={() => setSummaryDay(day)}>
                      <Sparkles size={13} /> Daily rollup
                    </Button>
                  )}
                </div>
                {!closed && (
                  <div className="space-y-2 border-t border-border p-3">
                    {list.map((i) => {
                      const children = childrenOf(i.id);
                      const isOpen = expanded[i.id] ?? false;
                      const href = sourceHref(i);
                      return (
                        <div
                          key={i.id}
                          className="rounded-lg border border-border bg-surface p-3"
                          style={{
                            borderLeft: `${
                              (i.confirmed_priority ?? i.suspected_priority) === "high" ? 5 : 3
                            }px solid ${
                              i.confirmed_priority === "high" || (!i.confirmed_priority && i.suspected_priority === "high")
                                ? "#dc2626"
                                : "transparent"
                            }`,
                          }}
                        >
                          <div className="flex items-start gap-2">
                            <button
                              onClick={() =>
                                setExpanded((prev) => ({ ...prev, [i.id]: !isOpen }))
                              }
                              className="min-w-0 flex-1 text-left"
                            >
                              <p className="text-sm font-medium">{i.title}</p>
                              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                                {sourceChip(i)}
                                <span>{i.source_type || "Unspecified source"}</span>
                                {authorOf(i) && <span>· {authorOf(i)}</span>}
                                {children.length > 0 && (
                                  <span>· {children.length} bullet{children.length === 1 ? "" : "s"}</span>
                                )}
                              </p>
                            </button>
                            <PriorityPill
                              suspected={i.suspected_priority}
                              confirmed={i.confirmed_priority}
                              onClick={() => setPriorityFor(i)}
                            />
                            <button
                              onClick={async () => {
                                if (
                                  await confirm({
                                    title: "Delete this insight?",
                                    confirmLabel: "Delete",
                                    danger: true,
                                  })
                                )
                                  await remove(i.id);
                              }}
                              className="rounded p-1 text-muted hover:text-red-600"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                          {isOpen && (
                            <div className="mt-2 space-y-2 border-t border-border pt-2">
                              {i.notes && <RichTextView html={i.notes} />}
                              {children.length > 0 && (
                                <ul className="list-disc space-y-0.5 pl-5 text-sm text-ink/85">
                                  {children.map((c) => (
                                    <li key={c.id}>{c.title}</li>
                                  ))}
                                </ul>
                              )}
                              <div className="flex flex-wrap items-center gap-1">
                                {[...new Set([i, ...children].flatMap((x) => x.categories))].map(
                                  (c) => (
                                    <CategoryChip key={c} name={c} categories={categories} />
                                  ),
                                )}
                                {href && (
                                  <Link
                                    href={href}
                                    className="ml-auto text-xs font-medium text-[var(--accent)] hover:underline"
                                  >
                                    Open source →
                                  </Link>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
        </>
      )}

      <AddInsightModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        categories={categories}
        defaultDay={todayKey(tz)}
        onAdd={add}
      />

      {photoUrls && (
        <GenerateInsightsModal
          open
          onClose={() => setPhotoUrls(null)}
          sourceText=""
          imageUrls={photoUrls}
          insightDate={todayKey(tz)}
          addWithChildren={insightsApi.addWithChildren}
        />
      )}

      {priorityFor && (
        <PriorityEditorModal
          open
          onClose={() => setPriorityFor(null)}
          suspected={priorityFor.suspected_priority}
          confirmed={priorityFor.confirmed_priority}
          canManage
          onChange={async (field, value) => {
            await update(priorityFor.id, { [field]: value });
            setPriorityFor((prev) => (prev ? { ...prev, [field]: value } : prev));
          }}
        />
      )}

      {summaryDay && (
        <DailyRollupModal
          key={summaryDay}
          day={summaryDay}
          onClose={() => setSummaryDay(null)}
          insights={parents.filter(
            (i) => dayOf(i) === summaryDay && i.confirmed_priority !== "not_relevant",
          )}
          childrenOf={childrenOf}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------

// Booth log, front and center (was previously only reachable by opening the
// Daily Rollup AI modal). Same organizer-configurable questions, same
// controlled BoothFields — just its own tab so it's a place to log booth
// activity as it happens, not a side effect of generating a summary.
function BoothTabView() {
  const { conference, canManage, updateConference } = useConferenceCtx();
  const tz = conference.timezone;
  const days = listDays(conference.start_date, conference.end_date);
  const today = todayKey(tz);
  const [day, setDay] = usePersistedFilter(conference.id, "booth_day", days.includes(today) ? today : days[0] || today);
  const boothRow = useDailyRow<BoothLog>("conf_booth_logs", conference.id, day);
  const [questionsOpen, setQuestionsOpen] = useState(false);
  const questions = boothQuestions(conference);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1.5 overflow-x-auto">
          {days.map((d) => (
            <button
              key={d}
              onClick={() => setDay(d)}
              className={cn(
                "shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-medium transition",
                day === d
                  ? "border-transparent bg-[var(--accent)] text-white"
                  : "border-border bg-surface text-muted hover:text-ink",
              )}
            >
              {fmtDayKey(d)}
            </button>
          ))}
        </div>
        <span className="flex-1" />
        {canManage && <EditQuestionsButton onClick={() => setQuestionsOpen(true)} />}
      </div>

      <div className="rounded-xl border border-border bg-surface p-5">
        <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted">
          <Store size={14} /> Booth log — {fmtDayKeyLong(day)}
        </h2>
        {boothRow.loaded ? (
          <BoothFields questions={questions} booth={boothRow.row} onSave={boothRow.upsert} />
        ) : (
          <p className="text-sm text-muted">Loading…</p>
        )}
      </div>

      <QuestionsEditorModal
        open={questionsOpen}
        onClose={() => setQuestionsOpen(false)}
        title="Booth log questions"
        questions={questions}
        onSave={(qs) =>
          updateConference({
            settings: { ...(conference.settings || {}), booth_questions: qs },
          })
        }
      />
    </div>
  );
}

// ------------------------------------------------------------------

function AddInsightModal({
  open,
  onClose,
  categories,
  defaultDay,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  categories: { id: string; name: string; color: string }[];
  defaultDay: string;
  onAdd: (partial: Partial<Insight>) => Promise<Insight | null>;
}) {
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [date, setDate] = useState(defaultDay);
  const [sourceType, setSourceType] = useState("");
  const [cats, setCats] = useState<string[]>([]);
  const [priority, setPriority] = useState<Priority | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!title.trim()) return;
    setSaving(true);
    await onAdd({
      title: title.trim(),
      notes,
      insight_date: date || null,
      source_type: sourceType,
      categories: cats,
      confirmed_priority: priority,
    });
    setSaving(false);
    setTitle("");
    setNotes("");
    setCats([]);
    setPriority(null);
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="Add insight" size="lg">
      <div className="space-y-4">
        <Input
          label="Insight *"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="One clear, complete sentence of field intelligence"
          autoFocus
        />
        <div>
          <p className="mb-1.5 text-sm font-medium">Supporting notes</p>
          <RichText value={notes} onChange={setNotes} placeholder="Specifics — numbers, names, context…" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <Select
            label="Source type"
            value={sourceType}
            onChange={(e) => setSourceType(e.target.value)}
          >
            <option value="">Choose…</option>
            {SOURCE_TYPES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <p className="mb-1.5 text-sm font-medium">Categories</p>
          <div className="flex flex-wrap gap-1.5">
            {categories.map((c) => (
              <button
                key={c.id}
                onClick={() =>
                  setCats((prev) =>
                    prev.includes(c.name)
                      ? prev.filter((x) => x !== c.name)
                      : [...prev, c.name],
                  )
                }
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs font-medium transition",
                  cats.includes(c.name)
                    ? "border-transparent text-white"
                    : "border-border bg-surface text-muted hover:text-ink",
                )}
                style={cats.includes(c.name) ? { background: c.color } : undefined}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || !title.trim()}>
            {saving ? "Saving…" : "Save insight"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// Daily AI rollup + booth log for one day.
function DailyRollupModal({
  day,
  onClose,
  insights,
  childrenOf,
}: {
  day: string;
  onClose: () => void;
  insights: Insight[];
  childrenOf: (parentId: string) => Insight[];
}) {
  const { conference, updateConference, canManage } = useConferenceCtx();
  const toast = useToast();
  const summaryRow = useDailyRow<DailySummary>("conf_daily_summaries", conference.id, day);
  const boothRow = useDailyRow<BoothLog>("conf_booth_logs", conference.id, day);
  const [guidance, setGuidance] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [questionsOpen, setQuestionsOpen] = useState(false);
  const questions = boothQuestions(conference);

  const sourceText = useMemo(() => {
    const parts = insights.map((i) => {
      const bullets = childrenOf(i.id).map((c) => `  - ${c.title}`).join("\n");
      const prio = i.confirmed_priority || i.suspected_priority;
      return `- [${prio ? prio.toUpperCase() : "unranked"}] (${i.source_type || "unknown source"}) ${i.title}${
        i.notes ? `\n  ${stripHtml(i.notes)}` : ""
      }${bullets ? `\n${bullets}` : ""}`;
    });
    const booth = boothRow.row;
    if (booth) {
      const answers = questions
        .map((q) => {
          const builtin = BUILTIN_BOOTH_KEYS.includes(q.key);
          const val = builtin
            ? (booth[q.key as "attendee_count" | "standout" | "patterns"] as string)
            : booth.custom_answers?.[q.key];
          return val ? `${q.label}: ${stripHtml(val)}` : "";
        })
        .filter(Boolean);
      if (answers.length) parts.push(`Booth log: ${answers.join(". ")}`);
    }
    return parts.join("\n\n");
  }, [insights, childrenOf, boothRow.row, questions]);

  async function generate() {
    setRunning(true);
    setError("");
    try {
      const res = await fetch("/api/conference/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          action: "daily_summary",
          text: sourceText,
          guidance,
          context: `${fmtDayKeyLong(day)} of ${conference.name}`,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "AI request failed");
      await summaryRow.upsert({ content: json.content, guidance });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Daily rollup — ${fmtDayKeyLong(day)}`} size="lg">
      <div className="space-y-5">
        <p className="text-sm text-muted">
          {insights.length} insight{insights.length === 1 ? "" : "s"} feed this
          summary (items confirmed “Not relevant” are excluded).
        </p>

        {/* Booth log — organizer-configurable questions (Edit questions).
            Gated on boothRow.loaded: mounting these before the async fetch
            resolves bakes in an empty defaultValue that never refreshes. */}
        <div className="space-y-2 rounded-lg bg-canvas p-3">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
              <Store size={13} /> Booth log for this day
            </p>
            {canManage && <EditQuestionsButton onClick={() => setQuestionsOpen(true)} />}
          </div>
          {boothRow.loaded ? (
            <BoothFields questions={questions} booth={boothRow.row} onSave={boothRow.upsert} />
          ) : (
            <p className="text-xs text-muted">Loading…</p>
          )}
        </div>

        <QuestionsEditorModal
          open={questionsOpen}
          onClose={() => setQuestionsOpen(false)}
          title="Booth log questions"
          questions={questions}
          onSave={(qs) =>
            updateConference({
              settings: { ...(conference.settings || {}), booth_questions: qs },
            })
          }
        />

        <Textarea
          label="Guidance (optional)"
          value={guidance}
          onChange={(e) => setGuidance(e.target.value)}
          placeholder='e.g. "Lead with competitive intel"'
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        {running && (
          <ProgressBar percent={null} label="AI is distilling the day into an executive summary…" />
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button onClick={generate} disabled={running || insights.length === 0}>
            <Sparkles size={15} />
            {running ? "Generating…" : summaryRow.row?.content ? "Regenerate" : "Generate summary"}
          </Button>
        </div>

        {summaryRow.row?.content && (
          <>
            <div className="max-h-72 overflow-y-auto rounded-lg border border-border bg-surface p-4">
              <RichTextView html={legacyPlainToHtml(summaryRow.row.content)} />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={async () => {
                  const subject = `${conference.name} — daily insights, ${fmtDayKeyLong(day)}`;
                  const plain = nestedHtmlToPlainText(legacyPlainToHtml(summaryRow.row!.content));
                  await navigator.clipboard.writeText(`${subject}\n\n${plain}`);
                  toast("success", "Digest copied — paste it into an email.");
                }}
              >
                Copy email digest
              </Button>
              <a
                href={`mailto:?subject=${encodeURIComponent(
                  `${conference.name} — daily insights, ${fmtDayKeyLong(day)}`,
                )}&body=${encodeURIComponent(
                  nestedHtmlToPlainText(legacyPlainToHtml(summaryRow.row.content)).slice(0, 1800),
                )}`}
                className="inline-flex items-center rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-ink transition hover:bg-canvas"
              >
                Open in email app
              </a>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

// Controlled (not defaultValue) booth-log fields — the previous version used
// defaultValue on an async-loaded row, so a save was invisible: the input
// rendered blank on every reopen even though the value was in the database.
function BoothFields({
  questions,
  booth,
  onSave,
}: {
  questions: QuestionDef[];
  booth: BoothLog | null;
  onSave: (partial: Record<string, unknown>) => Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {};
    for (const q of questions) {
      v[q.key] = BUILTIN_BOOTH_KEYS.includes(q.key)
        ? (booth?.[q.key as "attendee_count" | "standout" | "patterns"] as string) || ""
        : booth?.custom_answers?.[q.key] || "";
    }
    return v;
  });

  function save(key: string) {
    if (BUILTIN_BOOTH_KEYS.includes(key)) {
      onSave({ [key]: values[key] });
    } else {
      onSave({ custom_answers: { ...(booth?.custom_answers || {}), [key]: values[key] } });
    }
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {questions.slice(0, 2).map((q) => (
          <Input
            key={q.key}
            label={q.label}
            value={values[q.key] || ""}
            onChange={(e) => setValues((prev) => ({ ...prev, [q.key]: e.target.value }))}
            onBlur={() => save(q.key)}
          />
        ))}
      </div>
      {questions.slice(2).map((q) => (
        <Textarea
          key={q.key}
          label={q.label}
          value={values[q.key] || ""}
          onChange={(e) => setValues((prev) => ({ ...prev, [q.key]: e.target.value }))}
          onBlur={() => save(q.key)}
        />
      ))}
    </>
  );
}
