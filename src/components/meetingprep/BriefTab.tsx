"use client";

// Meeting Prep — Brief: the generated brief, as one readable column.
//
// It used to be two magazine columns with a toolbar of seven buttons, an
// always-open "refine" box at the bottom and a bordered control strip under
// every single section. Read all at once that is a wall, and the thing you
// came for — the words you are going to say — competes with its own chrome
// for attention. So: one column at a readable measure, one row of controls,
// everything occasional behind a menu or a modal, and each box's own actions
// as quiet icons that only matter once you are looking at that box.
//
// Generation itself lives at the page level so it keeps running while you
// switch tabs.

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CalendarPlus,
  Check,
  CheckSquare,
  CloudUpload,
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  FileDown,
  FileText,
  HelpCircle,
  Lightbulb,
  ListOrdered,
  ListTodo,
  Globe,
  MessageSquare,
  MessagesSquare,
  Plus,
  RefreshCw,
  Send,
  ShieldAlert,
  Sparkles,
  Stethoscope,
  Target,
  Undo2,
  Users,
  Wand2,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { ProgressBar, useProgress } from "@/components/ui/Progress";
import { RichText } from "@/components/ui/RichText";
import { useToast } from "@/components/ui/Feedback";
import { htmlToPlain } from "@/lib/writer/types";
import type { SaveState } from "@/lib/meetingprep/hooks";
import type { GenerateOpts } from "@/lib/meetingprep/useBriefGenerator";
import {
  meetingContextText,
  meetingTypeLabel,
  orderSections,
  sectionTitle,
  type CustomSection,
  type IdeaSuggestion,
  type MpMeeting,
  type ReviewNote,
} from "@/lib/meetingprep/types";
import { exportBriefDocx, downloadMeetingInvite } from "@/lib/meetingprep/exports";

const supabase = createClient();

const IDEAS_SECTION_KEY = "ideas_angles";

const SECTION_ICONS: Record<string, React.ComponentType<{ size?: number | string; className?: string }>> = {
  objective: Target,
  attendees: Users,
  agenda: ListOrdered,
  landscape: Globe,
  talking_points: MessageSquare,
  questions_theyll_ask: HelpCircle,
  questions_to_ask: MessagesSquare,
  objections: ShieldAlert,
  checklist: CheckSquare,
  follow_up: Send,
  [IDEAS_SECTION_KEY]: Lightbulb,
};

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Percent loader for brief generation. A determinate ring rather than an
// endless spinner: the wait is long enough that "is this still going?" is a
// real question, and the number answers it.
function ProgressRing({ percent }: { percent: number }) {
  const p = Math.max(0, Math.min(100, percent));
  const r = 26;
  const circumference = 2 * Math.PI * r;
  return (
    <span className="relative grid h-16 w-16 place-items-center">
      <svg className="h-16 w-16 -rotate-90" viewBox="0 0 64 64" aria-hidden>
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          strokeWidth="5"
          className="stroke-[var(--accent-soft)]"
        />
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - p / 100)}
          className="stroke-[var(--accent)] transition-[stroke-dashoffset] duration-500 ease-out"
        />
      </svg>
      <span
        className="absolute text-sm font-semibold tabular-nums text-[var(--accent)]"
        role="progressbar"
        aria-valuenow={Math.round(p)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        {Math.round(p)}%
      </span>
    </span>
  );
}

export function BriefTab({
  m,
  save,
  saveState = "idle",
  userId,
  busy,
  briefStale,
  briefOutdated = false,
  generateDirect,
  generateWithPreview,
  goSetup,
  customSections,
  saveCustomSections,
  progress = 0,
  stage = "",
  sectionOrder,
}: {
  m: MpMeeting;
  save: (p: Partial<MpMeeting>) => void;
  /** So each box can say, where you are editing it, that it has saved. */
  saveState?: SaveState;
  userId: string | null;
  busy: string | null;
  briefStale: boolean;
  /** Written by an older version of the writing engine. */
  briefOutdated?: boolean;
  /** 0–100 while the whole brief is being built. */
  progress?: number;
  /** What that generation is doing right now. */
  stage?: string;
  /** The user's arrangement of the brief's boxes, from Brief settings. */
  sectionOrder?: string[];
  /** Only for the very first generation — applies straight away. */
  generateDirect: (opts?: GenerateOpts) => Promise<void>;
  /** Everything else — shows a preview the user must apply. */
  generateWithPreview: (opts?: GenerateOpts) => Promise<void>;
  goSetup: () => void;
  customSections: CustomSection[];
  saveCustomSections: (s: CustomSection[]) => void;
}) {
  const toast = useToast();
  const [showAdd, setShowAdd] = useState(false);
  const [showIdeas, setShowIdeas] = useState(false);
  const [showRefine, setShowRefine] = useState(false);
  const [pushedTasks, setPushedTasks] = useState(false);
  // One box being rewritten is its own, much shorter wait than the whole
  // brief, and it gets its own bar rather than a dimmed panel and a guess.
  const sectionPct = useProgress(Boolean(busy) && busy !== "all", 40000);
  const [reviewing, setReviewing] = useState(false);
  const reviewPct = useProgress(reviewing, 40000);

  // Stored order vs. displayed order. Edits and appends work on the stored
  // array so nothing is silently rewritten; only what's rendered follows the
  // arrangement the user chose in Brief settings.
  const storedSections = m.brief?.sections || [];
  const sections = orderSections(storedSections, sectionOrder);
  const hasBrief = sections.length > 0;
  const collapsedKeys = new Set(m.brief?.collapsed || []);

  function setCollapsed(keys: Set<string>) {
    save({ brief: { ...m.brief, collapsed: Array.from(keys) } });
  }
  function toggleCollapsed(key: string) {
    const next = new Set(collapsedKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setCollapsed(next);
  }

  async function pushChecklist() {
    if (!userId) return;
    const checklist = sections.find((s) => s.key === "checklist");
    if (!checklist) return;
    const items = htmlToPlain(checklist.content)
      .split("\n")
      .map((l) => l.replace(/^[•\-\d.\s]+/, "").trim())
      .filter((l) => l.length > 2);
    if (!items.length) {
      toast("info", "No checklist items found.");
      return;
    }
    for (const title of items) {
      await supabase.from("tasks").insert({
        user_id: userId,
        title,
        app: "meeting-prep",
        link: `/meeting-prep/${m.id}`,
        entity_label: m.title || "Meeting",
        due_date: m.date,
      });
    }
    setPushedTasks(true);
    toast("success", `${items.length} item${items.length === 1 ? "" : "s"} added to your to-do list`);
  }

  const review = m.brief?.review;
  const notes = (review?.notes || []).filter((n) => !n.dismissed);
  const openNotes = notes.filter((n) => !n.done);

  const setNotes = (next: ReviewNote[]) =>
    save({ brief: { ...m.brief, review: { ...review, notes: next } } });

  const patchNote = (id: string, p: Partial<ReviewNote>) =>
    setNotes((review?.notes || []).map((n) => (n.id === id ? { ...n, ...p } : n)));

  /** Read the whole pack back and say what's wrong with it. */
  async function runReview() {
    setReviewing(true);
    try {
      const briefText = sections
        .map((s) => `[${s.key}] ${sectionTitle(s.key, s.title)}:\n${htmlToPlain(s.content)}`)
        .join("\n\n");
      const questionsText = (m.questions?.items || [])
        .filter((q) => !q.deleted)
        .map((q) => `(${q.category}) ${q.text}`)
        .join("\n");
      const res = await fetch("/api/meeting/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          action: "review",
          meeting: {
            title: m.title,
            topic: m.topic,
            meetingType: meetingTypeLabel(m.meeting_type),
            date: m.date,
            durationMin: m.duration_min,
            format: m.format,
            location: m.location,
            attendees: m.attendees,
            explain: m.explain,
            objectives: m.objectives,
            background: m.background,
            concerns: m.concerns,
          },
          kolId: m.kol_id || "",
          briefText,
          questionsText,
          sectionKeys: sections.map((s) => s.key),
          research: m.brief?.research?.notes || "",
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not review it");
      const fresh: ReviewNote[] = (json.notes || []).map(
        (n: Omit<ReviewNote, "id" | "done" | "dismissed">, i: number) => ({
          ...n,
          id: `r${Date.now()}_${i}`,
          done: false,
          dismissed: false,
        }),
      );
      if (!fresh.length) {
        toast("success", "Read it through, nothing worth changing.");
      } else {
        toast("success", `${fresh.length} thing${fresh.length === 1 ? "" : "s"} worth a look`);
      }
      // A fresh read-through replaces the last one: advice about a brief
      // that has since been rewritten is worse than no advice.
      save({
        brief: { ...m.brief, review: { notes: fresh, at: new Date().toISOString() } },
      });
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setReviewing(false);
    }
  }

  // Only boxes the model added on its own can be dropped from here — the
  // blueprint ones come back on the next update anyway, and saved custom
  // sections are managed in Brief settings.
  const removeSection = (key: string) =>
    save({
      brief: { ...m.brief, sections: storedSections.filter((s) => s.key !== key) },
    });

  const setSection = (key: string, content: string) =>
    save({
      brief: {
        ...m.brief,
        sections: storedSections.map((s) => (s.key === key ? { ...s, content } : s)),
      },
    });

  // Append a brainstormed idea into the "Extra ideas" section (creating the
  // section on first use).
  function addIdeaToBrief(idea: IdeaSuggestion) {
    const html = `<p><b>${esc(idea.title)}.</b> ${esc(idea.detail)}</p>`;
    const existing = storedSections.find((s) => s.key === IDEAS_SECTION_KEY);
    const nextSections = existing
      ? storedSections.map((s) =>
          s.key === IDEAS_SECTION_KEY ? { ...s, content: s.content + html } : s,
        )
      : [
          ...storedSections,
          { key: IDEAS_SECTION_KEY, title: "Extra ideas", content: html },
        ];
    save({
      brief: { ...m.brief, sections: nextSections },
      ideas: (m.ideas || []).map((i) => (i.id === idea.id ? { ...i, added: true } : i)),
    });
    toast("success", `Added "${idea.title}" to the brief`);
  }

  // Empty / generating state.
  if (!hasBrief) {
    return (
      <div className="mx-auto grid max-w-3xl place-items-center rounded-xl border border-dashed border-border bg-surface px-6 py-16 text-center">
        {busy === "all" ? (
          <>
            <ProgressRing percent={progress} />
            <p className="mt-3 text-sm font-medium text-ink">
              {stage || "Building your brief…"}
            </p>
            <p className="mt-1 max-w-md text-sm text-muted">
              I&apos;m reading what you wrote, filling in the details on Setup,
              searching for what&apos;s happening in this space right now, then
              writing the brief from all of it. It takes
              a minute or two — feel free to look around, I&apos;ll keep
              working in the background.
            </p>
          </>
        ) : (
          <>
            <Sparkles size={22} className="mb-2 text-[var(--accent)]" />
            <p className="text-sm font-medium text-ink">No brief yet</p>
            <p className="mt-1 max-w-md text-sm text-muted">
              Fill in the Setup tab (the more you give me, the sharper the
              brief), then generate — from here or straight from Setup.
            </p>
            <div className="mt-4 flex gap-2">
              <Button variant="secondary" onClick={goSetup}>
                Back to Setup
              </Button>
              <Button onClick={() => void generateDirect()}>
                <Sparkles size={16} /> Generate the brief
              </Button>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {/* One banner, two reasons. The setup moving on is the writer's doing;
          the engine moving on is ours, and until this existed there was no
          way for the app to admit the second one had happened. */}
      {(briefStale || briefOutdated) && (
        <div className="flex flex-col gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 sm:flex-row sm:items-center">
          <p className="flex flex-1 items-start gap-2 text-sm text-amber-900">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" />
            {briefStale
              ? "Your setup changed since this brief was written."
              : "This brief was written before the latest improvements to how briefs are written."}
          </p>
          <Button
            size="sm"
            className="shrink-0 !bg-amber-600 hover:!bg-amber-700"
            disabled={!!busy}
            onClick={() => void generateWithPreview()}
          >
            <RefreshCw size={14} className={busy === "all" ? "animate-spin" : ""} />
            {busy === "all" ? `Rewriting… ${progress}%` : "Rewrite it"}
          </Button>
        </div>
      )}

      {busy === "all" && (
        <ProgressBar pct={progress} label={`${stage || "Working"}…`} className="px-0.5" />
      )}
      {reviewing && (
        <ProgressBar pct={reviewPct} label="Reading your whole pack back…" className="px-0.5" />
      )}

      <ReviewPanel
        notes={notes}
        at={review?.at}
        busy={!!busy}
        onFix={(n) => {
          patchNote(n.id, { done: true });
          const key = n.target.startsWith("section:") ? n.target.slice(8) : "";
          void (key
            ? generateWithPreview({ onlyKey: key, guidance: n.fix })
            : generateWithPreview({ refine: true, guidance: n.fix }));
        }}
        onFixAll={() => {
          const fixable = openNotes.filter((n) => n.target !== "questions" && n.target !== "setup");
          if (!fixable.length) return;
          setNotes(
            (review?.notes || []).map((n) =>
              fixable.some((f) => f.id === n.id) ? { ...n, done: true } : n,
            ),
          );
          void generateWithPreview({
            refine: true,
            guidance: fixable.map((n, i) => `${i + 1}. ${n.fix}`).join("\n"),
          });
        }}
        onToggleDone={(n) => patchNote(n.id, { done: !n.done })}
        onDismiss={(n) => patchNote(n.id, { dismissed: true })}
        onClear={() => save({ brief: { ...m.brief, review: undefined } })}
      />

      {/* One row. Everything occasional lives behind the menu or a modal. */}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={reviewing || !!busy} onClick={() => void runReview()}>
          <Stethoscope size={14} />
          {reviewing ? "Reading it…" : notes.length ? "Check it again" : "Check it over"}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setShowRefine(true)}>
          <Wand2 size={14} /> Change the whole brief
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setShowAdd(true)}>
          <Plus size={14} /> Add a section
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setShowIdeas(true)}>
          <Lightbulb size={14} /> Ideas
        </Button>
        {collapsedKeys.size > 0 ? (
          <Button size="sm" variant="ghost" onClick={() => setCollapsed(new Set())}>
            <ChevronsUpDown size={14} /> Expand all
          </Button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setCollapsed(new Set(sections.map((s) => s.key)))}
          >
            <ChevronsDownUp size={14} /> Collapse all
          </Button>
        )}
        <span className="flex-1" />
        <ExportMenu
          onWord={() => void exportBriefDocx(m)}
          onInvite={m.date ? () => downloadMeetingInvite(m) : undefined}
          onChecklist={pushedTasks ? undefined : pushChecklist}
          checklistDone={pushedTasks}
        />
      </div>

      {/* The brief itself. One column at a readable measure — this is a
          document you read top to bottom, not a dashboard. */}
      <div className="space-y-3">
        {sections.map((s) => {
          const Icon = SECTION_ICONS[s.key] || (s.origin === "ai" ? Sparkles : FileText);
          const sectionBusy = busy === s.key;
          const isCollapsed = collapsedKeys.has(s.key);
          const isDirty = s.generatedContent !== undefined && s.content !== s.generatedContent;
          return (
            <section key={s.key} className="rounded-xl border border-border bg-surface">
              <div className="flex items-center gap-1 border-b border-border px-1 py-1">
                <button
                  type="button"
                  onClick={() => toggleCollapsed(s.key)}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-3 py-1.5 text-left transition hover:bg-canvas/60"
                >
                  <ChevronDown
                    size={15}
                    className={`shrink-0 text-muted transition-transform ${isCollapsed ? "-rotate-90" : ""}`}
                  />
                  <Icon size={15} className="shrink-0 text-[var(--accent)]" />
                  <h3 className="min-w-0 truncate text-sm font-semibold">
                    {sectionTitle(s.key, s.title)}
                  </h3>
                  {s.origin === "ai" && (
                    <span
                      title={s.prompt || "Added because this meeting needed it"}
                      className="shrink-0 rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[10px] font-medium text-[var(--accent)]"
                    >
                      Added for this meeting
                    </span>
                  )}
                </button>
                {!isCollapsed && (
                  <SectionActions
                    busy={sectionBusy}
                    canRedoPlain={isDirty || briefStale || briefOutdated}
                    onAddMore={() =>
                      void generateWithPreview({ onlyKey: s.key, extend: true })
                    }
                    onRedo={() => void generateWithPreview({ onlyKey: s.key })}
                    onChange={(g) => void generateWithPreview({ onlyKey: s.key, guidance: g })}
                    onRemove={
                      s.origin === "ai"
                        ? () => {
                            removeSection(s.key);
                            toast("info", `Removed "${s.title}"`);
                          }
                        : undefined
                    }
                  />
                )}
              </div>
              {!isCollapsed && (
                <div className="px-3 py-2">
                  {sectionBusy && (
                    <ProgressBar
                      pct={sectionPct}
                      label="Rewriting this box…"
                      className="mb-2"
                    />
                  )}
                  <div className={sectionBusy ? "opacity-50" : ""}>
                    <RichText
                      value={s.content}
                      onChange={(html) => setSection(s.key, html)}
                      minHeight="min-h-16"
                    />
                  </div>
                  {/* There is no save button and people look for one. Say so
                      in the box they are typing in, not only in the page
                      header where it is easy to miss. */}
                  <p className="mt-1 flex items-center justify-end gap-1 text-[11px] text-muted">
                    {saveState === "pending" || saveState === "saving" ? (
                      <>
                        <CloudUpload size={11} className="animate-pulse" /> Saving your edit…
                      </>
                    ) : (
                      <>
                        <Check size={11} className="text-emerald-600" /> Type straight in, it saves
                        itself
                      </>
                    )}
                  </p>
                </div>
              )}
            </section>
          );
        })}
      </div>

      {/* What the search turned up. The brief is built from this, so it is
          worth being able to see it: it shows the sourcing behind a claim,
          and it is the thing to read when a section looks thin. */}
      {(m.brief?.research?.notes || "").trim() && (
        <details className="rounded-xl border border-border bg-surface p-3">
          <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
            <Globe size={15} className="text-[var(--accent)]" />
            What I looked up
            <span className="font-normal text-muted">
              {m.brief?.research?.at
                ? `— searched ${new Date(m.brief.research.at).toLocaleDateString()}`
                : ""}
            </span>
          </summary>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-muted">
            {m.brief?.research?.notes}
          </p>
        </details>
      )}

      <RefineModal
        open={showRefine}
        busy={busy === "all"}
        onClose={() => setShowRefine(false)}
        onRefine={async (g) => {
          setShowRefine(false);
          await generateWithPreview({ refine: true, guidance: g });
        }}
      />

      {/* Creative brainstorm — suggestions you can add one by one. */}
      <IdeasModal
        open={showIdeas}
        onClose={() => setShowIdeas(false)}
        m={m}
        save={save}
        onAddToBrief={addIdeaToBrief}
      />

      <AddSectionModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onAdd={(title, prompt, permanent) => {
          const key = `custom_${Date.now()}`;
          if (permanent) saveCustomSections([...customSections, { key, title, prompt }]);
          setShowAdd(false);
          void generateWithPreview({ extra: { key, title, prompt } });
        }}
      />
    </div>
  );
}

// What the read-through found, and the three things you can do with each
// note: have it done for you, do it yourself and cross it off, or decide it
// is wrong and bin it.
//
// It gets quieter as it empties. Open notes are a panel; once everything is
// crossed off it collapses to a single line, because advice you have already
// acted on should not keep taking up the top of the page.
function ReviewPanel({
  notes,
  at,
  busy,
  onFix,
  onFixAll,
  onToggleDone,
  onDismiss,
  onClear,
}: {
  notes: ReviewNote[];
  at?: string;
  busy: boolean;
  onFix: (n: ReviewNote) => void;
  onFixAll: () => void;
  onToggleDone: (n: ReviewNote) => void;
  onDismiss: (n: ReviewNote) => void;
  onClear: () => void;
}) {
  const [showDone, setShowDone] = useState(false);
  if (!notes.length) return null;

  const open = notes.filter((n) => !n.done);
  const done = notes.filter((n) => n.done);
  const fixable = open.filter((n) => n.target !== "questions" && n.target !== "setup");

  // Everything dealt with: one line, not a panel.
  if (!open.length)
    return (
      <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-sm text-emerald-900">
        <CheckSquare size={15} className="shrink-0" />
        <span className="min-w-0 flex-1">
          All {done.length} thing{done.length === 1 ? "" : "s"} from the read-through dealt with.
        </span>
        <button
          className="shrink-0 text-xs underline-offset-2 hover:underline"
          onClick={() => setShowDone((v) => !v)}
        >
          {showDone ? "hide" : "see them"}
        </button>
        <button className="shrink-0 text-xs underline-offset-2 hover:underline" onClick={onClear}>
          clear
        </button>
        {showDone && (
          <ul className="basis-full space-y-1 pt-2 text-xs text-emerald-900/70">
            {done.map((n) => (
              <li key={n.id} className="line-through">
                {n.title}
              </li>
            ))}
          </ul>
        )}
      </div>
    );

  return (
    <section className="rounded-xl border border-[var(--accent)]/30 bg-[var(--accent-soft)]/25">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--accent)]/20 px-3 py-2">
        <Stethoscope size={15} className="shrink-0 text-[var(--accent)]" />
        <h3 className="text-sm font-semibold">
          {open.length} thing{open.length === 1 ? "" : "s"} worth changing
        </h3>
        {at && (
          <span className="text-xs text-muted">
            read through {new Date(at).toLocaleDateString()}
          </span>
        )}
        <span className="flex-1" />
        {fixable.length > 1 && (
          <Button size="sm" disabled={busy} onClick={onFixAll}>
            <Wand2 size={13} /> Fix all {fixable.length} for me
          </Button>
        )}
        <button
          className="rounded p-1 text-muted hover:text-ink"
          title="Clear the read-through"
          aria-label="Clear the read-through"
          onClick={onClear}
        >
          <X size={14} />
        </button>
      </div>
      <ul className="divide-y divide-[var(--accent)]/15">
        {open.map((n) => (
          <li key={n.id} className="flex items-start gap-2.5 p-3">
            <span
              title={`${n.severity} priority`}
              className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                n.severity === "high"
                  ? "bg-red-500"
                  : n.severity === "medium"
                    ? "bg-amber-500"
                    : "bg-slate-300"
              }`}
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{n.title}</p>
              {n.detail && <p className="mt-0.5 text-sm text-muted">{n.detail}</p>}
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                  {n.targetLabel}
                </span>
                {n.target !== "questions" && n.target !== "setup" && (
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => onFix(n)}>
                    <Wand2 size={12} /> Do it for me
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => onToggleDone(n)}>
                  <CheckSquare size={12} /> I&apos;ve done it
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onDismiss(n)}>
                  Not needed
                </Button>
              </div>
            </div>
          </li>
        ))}
      </ul>
      {done.length > 0 && (
        <div className="border-t border-[var(--accent)]/20 px-3 py-2">
          <button
            className="text-xs text-muted underline-offset-2 hover:underline"
            onClick={() => setShowDone((v) => !v)}
          >
            {done.length} already dealt with {showDone ? "(hide)" : "(show)"}
          </button>
          {showDone && (
            <ul className="mt-1.5 space-y-1">
              {done.map((n) => (
                <li key={n.id} className="flex items-center gap-2 text-xs text-muted">
                  <span className="min-w-0 flex-1 truncate line-through">{n.title}</span>
                  <button
                    className="shrink-0 rounded p-0.5 hover:text-ink"
                    title="Put it back on the list"
                    aria-label="Put it back on the list"
                    onClick={() => onToggleDone(n)}
                  >
                    <Undo2 size={12} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

// Per-section actions. Quiet icons rather than the bordered strip that used
// to sit under every box — the actions matter once you are reading that one
// box, and the brief is easier to read when they are not shouting from ten
// places at once.
//
// "Add more" is the one that was missing: a redo replaces what is there, and
// most of the time what you want is the same box with more in it.
function SectionActions({
  busy,
  canRedoPlain,
  onAddMore,
  onRedo,
  onChange,
  onRemove,
}: {
  busy: boolean;
  /** Only offer a no-guidance redo when there's a reason for one. */
  canRedoPlain: boolean;
  onAddMore: () => void;
  onRedo: () => void;
  onChange: (guidance: string) => void;
  onRemove?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [guidance, setGuidance] = useState("");

  return (
    <>
      <div className="flex shrink-0 items-center gap-0.5 pr-1">
        <SmallBtn label="Write more in this box" disabled={busy} onClick={onAddMore}>
          <Plus size={14} />
        </SmallBtn>
        {canRedoPlain && (
          <SmallBtn label="Redo this box" disabled={busy} onClick={onRedo}>
            <RefreshCw size={13} className={busy ? "animate-spin" : ""} />
          </SmallBtn>
        )}
        <SmallBtn label="Tell me what to change" disabled={busy} onClick={() => setOpen(true)}>
          <Wand2 size={13} />
        </SmallBtn>
        {onRemove && (
          <SmallBtn label="Remove this box" onClick={onRemove}>
            <X size={14} />
          </SmallBtn>
        )}
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="What should be different?" size="sm">
        <Textarea
          autoFocus
          value={guidance}
          onChange={(e) => setGuidance(e.target.value)}
          placeholder="e.g. &quot;shorter, and cut the part about pricing&quot;"
          className="min-h-20"
        />
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={busy || !guidance.trim()}
            onClick={() => {
              onChange(guidance.trim());
              setGuidance("");
              setOpen(false);
            }}
          >
            <RefreshCw size={14} /> Rewrite this box
          </Button>
        </div>
      </Modal>
    </>
  );
}

function SmallBtn({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="grid h-7 w-7 place-items-center rounded-md text-muted transition hover:bg-canvas hover:text-ink disabled:opacity-30"
    >
      {children}
    </button>
  );
}

// Word / invite / to-dos. Three things you do once, at the end — they do not
// deserve three permanent buttons next to the ones you use while writing.
function ExportMenu({
  onWord,
  onInvite,
  onChecklist,
  checklistDone,
}: {
  onWord: () => void;
  onInvite?: () => void;
  onChecklist?: () => void;
  checklistDone: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const run = (fn?: () => void) => () => {
    fn?.();
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <Button size="sm" variant="secondary" onClick={() => setOpen((v) => !v)}>
        <FileDown size={14} /> Export
        <ChevronDown size={13} className={open ? "rotate-180 transition" : "transition"} />
      </Button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-60 overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-lg">
          <MenuItem icon={FileDown} label="Download as Word" onClick={run(onWord)} />
          <MenuItem
            icon={CalendarPlus}
            label="Outlook invite"
            hint={onInvite ? undefined : "needs a date"}
            onClick={onInvite && run(onInvite)}
          />
          <MenuItem
            icon={ListTodo}
            label={checklistDone ? "Checklist added" : "Checklist to my to-dos"}
            onClick={onChecklist && run(onChecklist)}
          />
        </div>
      )}
    </div>
  );
}

function MenuItem({
  icon: Icon,
  label,
  hint,
  onClick,
}: {
  icon: React.ComponentType<{ size?: number | string; className?: string }>;
  label: string;
  hint?: string;
  /** Absent = the action isn't available yet, and says why in `hint`. */
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={!onClick}
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition hover:bg-canvas disabled:opacity-45 disabled:hover:bg-transparent"
    >
      <Icon size={14} className="shrink-0 text-[var(--accent)]" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint && <span className="shrink-0 text-[11px] text-muted">{hint}</span>}
    </button>
  );
}

function RefineModal({
  open,
  busy,
  onClose,
  onRefine,
}: {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onRefine: (guidance: string) => void;
}) {
  const [guidance, setGuidance] = useState("");
  return (
    <Modal open={open} onClose={onClose} title="Change the whole brief">
      <p className="mb-3 text-sm text-muted">
        Tell me what&apos;s wrong with it, or what changed, and I&apos;ll rework
        every box around that. You see the changes before they land.
      </p>
      <Textarea
        autoFocus
        value={guidance}
        onChange={(e) => setGuidance(e.target.value)}
        placeholder='e.g. "They just published a negative trial — factor that in" or "make the agenda 20 minutes, not 45"'
        className="min-h-24"
      />
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={busy || !guidance.trim()}
          onClick={() => {
            onRefine(guidance.trim());
            setGuidance("");
          }}
        >
          <Sparkles size={14} /> {busy ? "Reworking…" : "Rework the brief"}
        </Button>
      </div>
    </Modal>
  );
}

// Brainstorm: the AI suggests what else to bring up / showcase — the things
// sharp people in the same seat would do. Each suggestion can be added to the
// brief individually. Suggestions persist on the meeting.
function IdeasModal({
  open,
  onClose,
  m,
  save,
  onAddToBrief,
}: {
  open: boolean;
  onClose: () => void;
  m: MpMeeting;
  save: (p: Partial<MpMeeting>) => void;
  onAddToBrief: (idea: IdeaSuggestion) => void;
}) {
  const toast = useToast();
  const [focus, setFocus] = useState("");
  const [busy, setBusy] = useState(false);

  const ideas = m.ideas || [];

  async function brainstorm() {
    setBusy(true);
    try {
      const briefText = (m.brief?.sections || [])
        .map((s) => `${s.title}:\n${htmlToPlain(s.content)}`)
        .join("\n\n")
        .slice(0, 12000);
      const res = await fetch("/api/meeting/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          action: "ideas",
          context: `${meetingContextText(m)}${briefText ? `\n\nThe current brief:\n${briefText}` : ""}`,
          focus,
          count: 8,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Brainstorm failed");
      const fresh: IdeaSuggestion[] = (json.ideas || [])
        .filter((i: { title?: string }) => (i.title || "").trim())
        .map((i: { title: string; detail: string }, n: number) => ({
          id: `i${Date.now()}_${n}`,
          title: i.title,
          detail: i.detail,
          added: false,
        }));
      save({ ideas: fresh });
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="What else could you bring up?" size="lg">
      <p className="mb-3 text-sm text-muted">
        I&apos;ll suggest what else you could raise or showcase — the things
        the sharpest people walking into this kind of meeting would prepare.
        Add the ones you like straight into the brief.
      </p>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <Input
          value={focus}
          onChange={(e) => setFocus(e.target.value)}
          placeholder={`Optional focus — e.g. "KPIs and new things we're doing to showcase my team"`}
          className="flex-1"
        />
        <Button disabled={busy} onClick={() => void brainstorm()} className="shrink-0">
          <Lightbulb size={15} />
          {busy ? "Thinking…" : ideas.length ? "Think again" : "Give me ideas"}
        </Button>
      </div>

      {busy && ideas.length === 0 && (
        <p className="py-8 text-center text-sm text-muted">
          Coming up with ideas tailored to this meeting…
        </p>
      )}

      {ideas.length > 0 && (
        <ul className="space-y-2">
          {ideas.map((idea) => (
            <li
              key={idea.id}
              className={`flex items-start gap-3 rounded-lg border p-3 transition ${
                idea.added
                  ? "border-emerald-200 bg-emerald-50/60"
                  : "border-border bg-surface"
              }`}
            >
              <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]">
                <Lightbulb size={14} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{idea.title}</p>
                <p className="mt-0.5 text-sm text-muted">{idea.detail}</p>
              </div>
              <Button
                size="sm"
                variant={idea.added ? "ghost" : "secondary"}
                disabled={idea.added}
                className="shrink-0"
                onClick={() => onAddToBrief(idea)}
              >
                {idea.added ? "In the brief" : <><Plus size={13} /> Add</>}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

function AddSectionModal({
  open,
  onClose,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (title: string, prompt: string, permanent: boolean) => void;
}) {
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [permanent, setPermanent] = useState(false);

  return (
    <Modal open={open} onClose={onClose} title="Add a section">
      <div className="space-y-3">
        <Input
          label="Section title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder='e.g. "Recent publications to mention"'
        />
        <Textarea
          label="What should it contain?"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Tell the AI what to write here…"
          className="min-h-20"
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={permanent}
            onChange={(e) => setPermanent(e.target.checked)}
            className="h-4 w-4 accent-[var(--accent)]"
          />
          Keep this section in every future brief
        </label>
        <div className="flex justify-end">
          <Button
            disabled={!title.trim() || !prompt.trim()}
            onClick={() => {
              onAdd(title.trim(), prompt.trim(), permanent);
              setTitle("");
              setPrompt("");
              setPermanent(false);
            }}
          >
            <Plus size={14} /> Add & write it
          </Button>
        </div>
      </div>
    </Modal>
  );
}
