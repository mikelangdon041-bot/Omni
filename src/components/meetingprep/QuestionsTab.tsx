"use client";

// Meeting Prep — Questions: the bank of questions to ask, and the short list
// the writer actually carries in.
//
// Two halves, because they are two different jobs. Suggestions are a long
// ranked list grouped by category, collapsible, that you skim once while
// preparing. Your list is the handful you chose, in the order you will ask
// them, which is what "Ask mode" puts on the screen during the meeting.
//
// The model owns text/category/why/followUp/rank; the writer owns picked,
// backup, asked and order — so generating more questions only ever appends,
// and never disturbs a list someone has arranged.

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  CircleHelp,
  GripVertical,
  ListChecks,
  Pencil,
  Play,
  Plus,
  CloudUpload,
  Lock,
  LockOpen,
  RefreshCw,
  Sparkles,
  Star,
  Trash2,
  Undo2,
  Wand2,
  X,
} from "lucide-react";
import { AskMode } from "@/components/meetingprep/AskMode";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { ProgressBar, useProgress } from "@/components/ui/Progress";
import { useToast } from "@/components/ui/Feedback";
import { htmlToPlain } from "@/lib/writer/types";
import type { SaveState } from "@/lib/meetingprep/hooks";
import {
  QUESTIONS_ENGINE,
  engineBehind,
  meetingTypeLabel,
  setupFingerprint,
  type MpMeeting,
  type QuestionItem,
} from "@/lib/meetingprep/types";

const newId = () => `q${Date.now()}${Math.random().toString(36).slice(2, 6)}`;

/** The meeting as the AI route wants it. */
function payloadOf(m: MpMeeting) {
  return {
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
    priorTranscript: m.prior_transcript,
    documents: (m.documents || []).map((d) => ({ name: d.name, note: d.note, text: d.text })),
  };
}

export function QuestionsTab({
  m,
  save,
  flush,
  saveState = "idle",
}: {
  m: MpMeeting;
  save: (p: Partial<MpMeeting>) => void;
  flush: () => Promise<void>;
  /** So an edited question can say it has saved, where you edited it. */
  saveState?: SaveState;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [showAsk, setShowAsk] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  // One dialog, not two. "Write me 20 more" and "Guide the questions" were
  // separate boxes that each took an instruction and did different things
  // with it, and there was no way at all to say "write me new ones about X"
  // — the standing instruction could only rewrite or wait. Now it is one
  // dialog, and what to do with the questions you already have is a choice
  // inside it. `guideScope` is which choice it opens on.
  const [guideScope, setGuideScope] = useState<GuideScope | null>(null);
  // What the loader should say it is doing. The work is one AI call that
  // reports nothing, but "Rewriting all 30 questions" and "Rewriting that one"
  // are very different waits and the bar should admit which one you're in.
  const [busyLabel, setBusyLabel] = useState("");
  const [rewritingId, setRewritingId] = useState<string | null>(null);
  const pct = useProgress(busy, 45000);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [openCats, setOpenCats] = useState<Set<string>>(new Set());
  const [dragId, setDragId] = useState<string | null>(null);

  // `items` is everything ever written for this meeting, including what has
  // been binned. `live` is what any list should show. Deleting puts a
  // question in the bin rather than dropping it from the array, because the
  // question you bin while skimming is the one you want back twenty minutes
  // later.
  const items: QuestionItem[] = useMemo(() => m.questions?.items || [], [m.questions]);
  const live = useMemo(() => items.filter((q) => !q.deleted), [items]);
  const binned = useMemo(() => items.filter((q) => q.deleted), [items]);
  const picked = useMemo(
    () => live.filter((q) => q.picked).sort((a, b) => a.order - b.order),
    [live],
  );
  const suggestions = useMemo(() => live.filter((q) => !q.picked), [live]);

  // Categories in the order the model's strongest question in each appears,
  // so the most useful group is the one at the top.
  const categories = useMemo(() => {
    const byCat = new Map<string, QuestionItem[]>();
    for (const q of [...suggestions].sort((a, b) => a.rank - b.rank)) {
      const list = byCat.get(q.category) || [];
      list.push(q);
      byCat.set(q.category, list);
    }
    return [...byCat.entries()];
  }, [suggestions]);

  // Every group name in play, picked ones included, for the editors. Shown
  // as real chips rather than hung off a one-line box in a browser dropdown,
  // which cut the longer names in half.
  const allCategories = useMemo(
    () => [...new Set(live.map((q) => q.category))].filter(Boolean),
    [live],
  );

  const setItems = (next: QuestionItem[]) =>
    save({ questions: { ...m.questions, items: next } });

  // The standing correction, if the writer has given one. It is kept on the
  // bank so it survives: telling the model once to stop opening every
  // question the same way should not wear off at the next batch.
  const guidance = m.questions?.guidance || "";
  // Two different kinds of instruction, checked two different ways: guidance
  // is a rule every question has to pass, coverage is a floor the bank as a
  // whole has to clear. Keeping them apart is what stops "include something
  // on AI" being read as "make it all about AI".
  const coverage = m.questions?.coverage || "";

  // A question the writer typed, or one they locked, is theirs. A rewrite
  // never touches either — that is the difference between "these are wrong"
  // and "all of these are wrong".
  const isKept = (q: QuestionItem) => q.source === "user" || Boolean(q.locked);
  const keptCount = live.filter(isKept).length;

  // Behind for one of two reasons: the setup moved (most often the topic,
  // which is the whole point of the bank) or the question writer itself got
  // better since these were written.
  const fingerprint = setupFingerprint(m);
  const questionsStale = Boolean(
    items.length && m.questions?.sourceFingerprint && m.questions.sourceFingerprint !== fingerprint,
  );
  const questionsOutdated = Boolean(
    items.length && engineBehind(m.questions?.engine, QUESTIONS_ENGINE),
  );

  const patch = (id: string, p: Partial<QuestionItem>) =>
    setItems(items.map((q) => (q.id === id ? { ...q, ...p } : q)));

  function pick(q: QuestionItem) {
    const maxOrder = picked.length ? Math.max(...picked.map((p) => p.order)) : -1;
    patch(q.id, { picked: true, order: maxOrder + 1 });
  }

  function unpick(q: QuestionItem) {
    patch(q.id, { picked: false, backup: false, asked: false });
  }

  /** Move a picked question by one place, or onto another's position. */
  function reorder(id: string, toIndex: number) {
    const list = [...picked];
    const from = list.findIndex((q) => q.id === id);
    if (from < 0) return;
    const clamped = Math.max(0, Math.min(list.length - 1, toIndex));
    const [moved] = list.splice(from, 1);
    list.splice(clamped, 0, moved);
    const orderById = new Map(list.map((q, i) => [q.id, i]));
    setItems(
      items.map((q) => (orderById.has(q.id) ? { ...q, order: orderById.get(q.id)! } : q)),
    );
  }

  /**
   * Writes a batch of questions.
   *
   * `replace` is the "I told you what was wrong with these, do them again"
   * path: every AI-written question goes and a fresh set takes its place,
   * written to the new instruction. Questions the writer typed themselves are
   * never touched by it — those are theirs.
   */
  async function generate(
    opts: {
      focus?: string;
      guidance?: string;
      coverage?: string;
      /** Replace everything the model wrote (keeping locked + user ones). */
      replace?: boolean;
      /** Replace exactly this question, leaving the rest of the bank alone. */
      onlyId?: string;
      label?: string;
    } = {},
  ) {
    setBusy(true);
    setBusyLabel(opts.label || "Writing your questions");
    if (opts.onlyId) setRewritingId(opts.onlyId);
    try {
      await flush();
      const briefText = (m.brief?.sections || [])
        .map((s) => `${s.title}:\n${htmlToPlain(s.content)}`)
        .join("\n\n");
      // A rewrite starts from a blank sheet, so it must not be told to avoid
      // the questions it is replacing, nor to file into the categories that
      // the correction may well be about.
      // Three scopes, one code path. Topping up keeps everything; a rewrite
      // keeps what the writer owns; a single-question rewrite keeps all but
      // the one being replaced.
      // Binned questions are kept in the array but must never come back as
      // "already in the bank", or the model will dodge every subject the
      // writer binned a question about.
      const kept = opts.onlyId
        ? live.filter((q) => q.id !== opts.onlyId)
        : opts.replace
          ? live.filter(isKept)
          : live;
      const target = opts.onlyId ? items.find((q) => q.id === opts.onlyId) : undefined;
      const nextGuidance = opts.guidance ?? guidance;
      const nextCoverage = opts.coverage ?? coverage;
      const res = await fetch("/api/meeting/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          action: "questions",
          meeting: payloadOf(m),
          kolId: m.kol_id || "",
          // The brief's research is reused rather than searched again: it is
          // the same subject and it was gathered for this meeting.
          research: m.brief?.research?.notes || "",
          briefText,
          existing: kept.map((q) => q.text),
          categories: opts.replace ? [] : [...new Set(live.map((q) => q.category))],
          count: opts.onlyId ? 1 : 20,
          focus: target
            ? `Replace one question that was not working. It was filed under "${target.category}" and read: ${target.text}. Write one question that does the same job in the conversation, better. ${opts.focus || ""}`.trim()
            : opts.focus || "",
          guidance: nextGuidance,
          coverage: nextCoverage,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not write the questions");
      // Ranks are per batch, so a second batch's "1" would sort above the
      // first batch's best question inside the same category. Offsetting
      // keeps a merged category in a sensible order.
      const rankOffset =
        opts.replace || opts.onlyId
          ? 0
          : live.reduce((n, q) => Math.max(n, q.rank), 0);
      const fresh: QuestionItem[] = (json.questions || []).map(
        (q: Omit<WrittenShape, "id">, i: number) => ({
          id: newId(),
          text: String(q.text || ""),
          why: String(q.why || ""),
          followUp: String(q.followUp || ""),
          forWhom: String(q.forWhom || ""),
          rank: target ? target.rank : rankOffset + (Number(q.rank) || i + 1),
          // A replacement takes over the old question's place: its category,
          // whether it was in your list, and where in that list it sat.
          category: target ? target.category : String(q.category || "Questions"),
          picked: target ? target.picked : false,
          backup: target ? target.backup : false,
          asked: false,
          order: target ? target.order : 0,
          source: "ai" as const,
        }),
      );
      if (!fresh.length) throw new Error("Nothing came back — try again.");
      save({
        questions: {
          ...m.questions,
          // A single-question rewrite slots back in where the old one was,
          // so the list does not reshuffle under the writer.
          items: opts.onlyId
            ? items.map((q) => (q.id === opts.onlyId ? fresh[0] : q))
            : [...kept, ...binned, ...fresh],
          guidance: nextGuidance,
          coverage: nextCoverage,
          generatedAt: new Date().toISOString(),
          // Only a batch written against the whole setup can claim to be
          // current; topping up an old bank, or swapping one question, leaves
          // the old ones in it.
          ...(opts.replace || !live.length
            ? { engine: QUESTIONS_ENGINE, sourceFingerprint: fingerprint }
            : {}),
        },
      });
      // A fresh batch is easiest to read with every group open. A single
      // swap should not rearrange what you had open.
      if (!opts.onlyId) setOpenCats(new Set([...new Set(fresh.map((q) => q.category))]));
      toast(
        "success",
        opts.onlyId
          ? "Rewritten"
          : opts.replace
            ? `Rewritten — ${fresh.length} new question${fresh.length === 1 ? "" : "s"}${
                keptCount ? `, ${keptCount} of yours kept` : ""
              }`
            : `${fresh.length} question${fresh.length === 1 ? "" : "s"} added`,
      );
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setBusy(false);
      setBusyLabel("");
      setRewritingId(null);
      setGuideScope(null);
    }
  }

  if (!live.length && !binned.length) {
    return (
      <div className="grid place-items-center rounded-xl border border-dashed border-border bg-surface px-6 py-16 text-center">
        {busy ? (
          <>
            <Sparkles size={22} className="mb-2 animate-pulse text-[var(--accent)]" />
            <p className="text-sm font-medium text-ink">{busyLabel || "Writing your questions"}…</p>
            <p className="mt-1 max-w-md text-sm text-muted">
              Twenty or so, grouped and ranked, built from your setup and
              whatever the brief turned up about the subject.
            </p>
            <ProgressBar pct={pct} className="mt-4 w-full max-w-sm" />
          </>
        ) : (
          <>
            <CircleHelp size={22} className="mb-2 text-[var(--accent)]" />
            <p className="text-sm font-medium text-ink">No questions yet</p>
            <p className="mt-1 max-w-md text-sm text-muted">
              I&apos;ll write a long list, grouped by theme and ranked, each
              with a follow-up probe. Pick the ones you want, drag them into
              the order you&apos;ll ask them, and open Ask mode during the
              meeting.
            </p>
            <div className="mt-4">
              <Button
                onClick={() => void generate({ replace: true, label: "Writing your questions" })}
              >
                <Sparkles size={16} /> Write my questions
              </Button>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Behind, and the only two reasons it can be. Worth a banner rather
          than a quiet button: a bank written about the wrong subject looks
          exactly as confident as one written about the right subject. */}
      {(questionsStale || questionsOutdated) && (
        <div className="flex flex-col gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 sm:flex-row sm:items-center">
          <p className="flex flex-1 items-start gap-2 text-sm text-amber-900">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" />
            {questionsStale
              ? "Your setup changed since these questions were written — the topic they were built around may not be the one you're on now."
              : "These were written before the latest improvements to how questions are written."}
          </p>
          <Button
            size="sm"
            className="shrink-0 !bg-amber-600 hover:!bg-amber-700"
            disabled={busy}
            onClick={() =>
              void generate({ replace: true, label: "Rewriting your questions" })
            }
          >
            <RefreshCw size={14} className={busy ? "animate-spin" : ""} />
            {busy ? "Rewriting…" : "Rewrite them"}
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {/* Three buttons that used to read as two. "More questions" and "Add
            your own" sat side by side looking like the same thing done twice;
            one asks the model for twenty more, the other is you typing one. */}
        <Button size="sm" disabled={busy} onClick={() => setGuideScope("more")}>
          <Sparkles size={14} /> {busy ? "Working…" : "Write me 20 more"}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setShowAdd(true)}>
          <Pencil size={14} /> Type one of my own
        </Button>
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => setGuideScope("rewrite")}>
          <Wand2 size={14} /> Fix how these are written
        </Button>
        <span className="flex-1" />
        <Button
          size="sm"
          variant={picked.length ? "primary" : "secondary"}
          disabled={!picked.length}
          title={picked.length ? "Open the big view for during the meeting" : "Pick some questions first"}
          onClick={() => setShowAsk(true)}
        >
          <Play size={14} /> Ask mode
        </Button>
      </div>

      {busy && <ProgressBar pct={pct} label={`${busyLabel}…`} className="px-0.5" />}

      {(guidance || coverage) && (
        <div className="space-y-1.5 rounded-lg border border-border bg-canvas/50 px-3 py-2 text-xs text-muted">
          {guidance && (
            <p className="flex items-start gap-1.5">
              <Wand2 size={13} className="mt-0.5 shrink-0 text-[var(--accent)]" />
              <span className="min-w-0 flex-1">
                How they&apos;re written:{" "}
                <b className="font-medium text-ink">{guidance}</b>
              </span>
              <button
                className="shrink-0 underline-offset-2 hover:underline"
                onClick={() => save({ questions: { ...m.questions, guidance: "" } })}
              >
                clear
              </button>
            </p>
          )}
          {coverage && (
            <p className="flex items-start gap-1.5">
              <ListChecks size={13} className="mt-0.5 shrink-0 text-[var(--accent)]" />
              <span className="min-w-0 flex-1">
                Make sure to cover: <b className="font-medium text-ink">{coverage}</b>
              </span>
              <button
                className="shrink-0 underline-offset-2 hover:underline"
                onClick={() => save({ questions: { ...m.questions, coverage: "" } })}
              >
                clear
              </button>
            </p>
          )}
        </div>
      )}

      {/* Your list — the questions you carry in, in your order. */}
      <section className="rounded-xl border border-[var(--accent)]/30 bg-[var(--accent-soft)]/20 p-3">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <ListChecks size={15} className="text-[var(--accent)]" />
          Your list
          <span className="font-normal text-muted">
            {picked.length ? `${picked.length} picked` : "nothing picked yet"}
          </span>
        </h3>
        {picked.length === 0 ? (
          <p className="px-1 pb-1 text-sm text-muted">
            Click the + on any question below to put it here. Drag to reorder,
            star the ones you&apos;re holding in reserve.
          </p>
        ) : (
          <ol className="space-y-2">
            {picked.map((q, i) => (
              <li
                key={q.id}
                draggable
                onDragStart={() => setDragId(q.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragId && dragId !== q.id) reorder(dragId, i);
                  setDragId(null);
                }}
                className={`flex items-start gap-2 rounded-lg border border-border bg-surface p-2.5 ${
                  dragId === q.id ? "opacity-50" : ""
                }`}
              >
                <GripVertical
                  size={15}
                  className="mt-0.5 shrink-0 cursor-grab text-muted"
                  aria-hidden
                />
                <span className="mt-0.5 w-5 shrink-0 text-right text-xs font-semibold tabular-nums text-muted">
                  {i + 1}.
                </span>
                <div className="min-w-0 flex-1">
                  {editingId === q.id ? (
                    <QuestionEditor
                      q={q}
                      categories={allCategories}
                      saveState={saveState}
                      onPatch={(p) => patch(q.id, p)}
                      onDone={() => setEditingId(null)}
                    />
                  ) : (
                    <>
                      <p className={`text-sm ${q.backup ? "text-muted" : "text-ink"}`}>
                        {q.text}
                      </p>
                      {/* Your list is one running order, not groups: the
                          order you ask them in is the whole point of it. But
                          which group a question came out of is worth knowing
                          at a glance, so it rides along as a tag. */}
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                        <span className="rounded-full bg-canvas px-1.5 py-0.5 text-[10px] font-medium">
                          {q.source === "user" ? "Yours" : q.category}
                        </span>
                        {q.forWhom && <span>For: {q.forWhom}</span>}
                      </div>
                      {q.followUp && (
                        <p className="mt-1 text-xs italic text-muted">
                          Probe: {q.followUp}
                        </p>
                      )}
                    </>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <IconBtn label="Move up" onClick={() => reorder(q.id, i - 1)} disabled={i === 0}>
                    <ArrowUp size={14} />
                  </IconBtn>
                  <IconBtn
                    label="Move down"
                    onClick={() => reorder(q.id, i + 1)}
                    disabled={i === picked.length - 1}
                  >
                    <ArrowDown size={14} />
                  </IconBtn>
                  <IconBtn
                    label={q.backup ? "Not a backup" : "Hold as a backup"}
                    active={q.backup}
                    onClick={() => patch(q.id, { backup: !q.backup })}
                  >
                    <Star size={14} className={q.backup ? "fill-current" : ""} />
                  </IconBtn>
                  <IconBtn
                    label={
                      q.locked
                        ? "Unlock — rewrites may change this one"
                        : "Lock — keep this one through every rewrite"
                    }
                    active={q.locked}
                    onClick={() => patch(q.id, { locked: !q.locked })}
                  >
                    {q.locked ? <Lock size={13} /> : <LockOpen size={13} />}
                  </IconBtn>
                  <IconBtn
                    label="Rewrite just this question"
                    disabled={busy}
                    onClick={() =>
                      void generate({ onlyId: q.id, label: "Rewriting that question" })
                    }
                  >
                    <RefreshCw size={13} className={rewritingId === q.id ? "animate-spin" : ""} />
                  </IconBtn>
                  <IconBtn
                    label="Edit the question, the probe, who it's for, its group"
                    active={editingId === q.id}
                    onClick={() => setEditingId(editingId === q.id ? null : q.id)}
                  >
                    <Pencil size={13} />
                  </IconBtn>
                  <IconBtn label="Take out of my list" onClick={() => unpick(q)}>
                    <X size={14} />
                  </IconBtn>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* Suggestions, grouped. Collapsed by default past the first group so
          the page is skimmable rather than a wall of twenty questions. */}
      {categories.map(([cat, list], catIndex) => {
        const open = openCats.has(cat) || (catIndex === 0 && openCats.size === 0);
        return (
          <section key={cat} className="rounded-xl border border-border bg-surface">
            <button
              type="button"
              onClick={() =>
                setOpenCats((prev) => {
                  const next = new Set(prev.size ? prev : [categories[0][0]]);
                  if (next.has(cat)) next.delete(cat);
                  else next.add(cat);
                  return next;
                })
              }
              className="flex w-full items-center justify-between gap-2 rounded-t-xl border-b border-border bg-canvas/50 px-4 py-2.5 text-left"
            >
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <CircleHelp size={15} className="text-[var(--accent)]" />
                {cat}
                <span className="font-normal text-muted">{list.length}</span>
              </h3>
              <ChevronDown
                size={16}
                className={`shrink-0 text-muted transition-transform ${open ? "" : "-rotate-90"}`}
              />
            </button>
            {open && (
              <ul className="divide-y divide-border">
                {list.map((q) => (
                  <li key={q.id} className="flex items-start gap-3 p-3">
                    <button
                      type="button"
                      aria-label="Add to my list"
                      title="Add to my list"
                      onClick={() => pick(q)}
                      className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)] transition hover:brightness-95"
                    >
                      <Plus size={15} />
                    </button>
                    <div className="min-w-0 flex-1">
                      {editingId === q.id ? (
                        <QuestionEditor
                          q={q}
                          categories={allCategories}
                          saveState={saveState}
                          onPatch={(p) => patch(q.id, p)}
                          onDone={() => setEditingId(null)}
                        />
                      ) : (
                        <>
                          <p className="text-sm text-ink">{q.text}</p>
                          <p className="mt-0.5 text-xs text-muted">
                            {q.why}
                            {q.forWhom ? ` · For: ${q.forWhom}` : ""}
                          </p>
                          {q.followUp && (
                            <p className="mt-1 text-xs italic text-muted">Probe: {q.followUp}</p>
                          )}
                        </>
                      )}
                    </div>
                    <IconBtn
                      label={
                        q.locked
                          ? "Unlock — rewrites may change this one"
                          : "Lock — keep this one through every rewrite"
                      }
                      active={q.locked}
                      onClick={() => patch(q.id, { locked: !q.locked })}
                    >
                      {q.locked ? <Lock size={13} /> : <LockOpen size={13} />}
                    </IconBtn>
                    <IconBtn
                      label="Rewrite just this question"
                      disabled={busy}
                      onClick={() =>
                        void generate({ onlyId: q.id, label: "Rewriting that question" })
                      }
                    >
                      <RefreshCw
                        size={13}
                        className={rewritingId === q.id ? "animate-spin" : ""}
                      />
                    </IconBtn>
                    <IconBtn
                      label="Edit the question, the probe, who it's for, its group"
                      active={editingId === q.id}
                      onClick={() => setEditingId(editingId === q.id ? null : q.id)}
                    >
                      <Pencil size={13} />
                    </IconBtn>
                    <IconBtn
                      label="Bin this question (you can get it back)"
                      onClick={() => patch(q.id, { deleted: true, picked: false })}
                    >
                      <Trash2 size={13} />
                    </IconBtn>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}

      {binned.length > 0 && (
        <details className="rounded-xl border border-border bg-surface px-3 py-2">
          <summary className="cursor-pointer text-sm text-muted">
            Binned ({binned.length}) — get one back
          </summary>
          <ul className="mt-2 space-y-1.5">
            {binned.map((q) => (
              <li key={q.id} className="flex items-start gap-2 text-sm">
                <span className="min-w-0 flex-1 text-muted">{q.text}</span>
                <IconBtn label="Put it back" onClick={() => patch(q.id, { deleted: false })}>
                  <Undo2 size={13} />
                </IconBtn>
                <IconBtn
                  label="Delete for good"
                  onClick={() => setItems(items.filter((x) => x.id !== q.id))}
                >
                  <Trash2 size={13} />
                </IconBtn>
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* Mounted only while it is open, so it opens on the first question
          every time rather than wherever you left off last meeting. */}
      {showAsk && (
        <AskMode
          onClose={() => setShowAsk(false)}
          topic={m.topic || ""}
          title={m.title}
          picked={picked}
          onToggleAsked={(q) => patch(q.id, { asked: !q.asked })}
          onResetTicks={() => setItems(items.map((q) => ({ ...q, asked: false })))}
        />
      )}

      <GuidanceModal
        key={`${guideScope}|${guidance}|${coverage}`}
        scope={guideScope}
        busy={busy}
        guidance={guidance}
        coverage={coverage}
        keptCount={keptCount}
        total={live.length}
        onClose={() => setGuideScope(null)}
        onSaveOnly={(g, c) =>
          save({ questions: { ...m.questions, guidance: g, coverage: c } })
        }
        onMore={(g, c) =>
          void generate({
            guidance: g,
            coverage: c,
            label: "Writing 20 more questions",
          })
        }
        onRewrite={(g, c) =>
          void generate({
            guidance: g,
            coverage: c,
            replace: true,
            label: "Rewriting your questions",
          })
        }
      />

      <AddOwnModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        categories={allCategories}
        onAdd={(text, category, followUp, forWhom) => {
          const maxOrder = picked.length ? Math.max(...picked.map((p) => p.order)) : -1;
          setItems([
            ...items,
            {
              id: newId(),
              text,
              category: category || "Mine",
              why: "",
              followUp,
              forWhom,
              rank: 0,
              picked: true,
              backup: false,
              asked: false,
              order: maxOrder + 1,
              source: "user",
            },
          ]);
          setShowAdd(false);
        }}
      />
    </div>
  );
}

interface WrittenShape {
  id: string;
  text: string;
  category: string;
  why: string;
  followUp: string;
  forWhom: string;
  rank: number;
}

function IconBtn({
  label,
  onClick,
  children,
  disabled,
  active,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`grid h-7 w-7 place-items-center rounded-md transition disabled:opacity-30 ${
        active ? "text-amber-500" : "text-muted hover:bg-canvas hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function AddOwnModal({
  open,
  onClose,
  categories,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  categories: string[];
  onAdd: (text: string, category: string, followUp: string, forWhom: string) => void;
}) {
  const [text, setText] = useState("");
  const [category, setCategory] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [forWhom, setForWhom] = useState("");
  return (
    <Modal open={open} onClose={onClose} title="Type one of my own" movable>
      <div className="space-y-3">
        <Textarea
          label="The question, as you'd say it"
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="min-h-20"
        />
        <Input
          label="Probe, for when the answer is thin (optional)"
          value={followUp}
          onChange={(e) => setFollowUp(e.target.value)}
          placeholder="What you ask next if they give you nothing"
        />
        <Input
          label="Who to put it to (optional)"
          value={forWhom}
          onChange={(e) => setForWhom(e.target.value)}
          placeholder="Everyone"
        />
        <CategoryPicker
          label="Which group it goes in"
          value={category}
          options={categories}
          onChange={setCategory}
          placeholder="Mine"
        />
        <div className="flex justify-end">
          <Button
            disabled={!text.trim()}
            onClick={() => {
              onAdd(text.trim(), category.trim(), followUp.trim(), forWhom.trim());
              setText("");
              setCategory("");
              setFollowUp("");
              setForWhom("");
            }}
          >
            <Plus size={14} /> Add to my list
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Picking the group a question belongs to.
 *
 * This was a one-line text box with a browser dropdown hanging off it, and
 * the dropdown cut the longer names off halfway: you could pick "How it works
 * in prac..." without ever seeing which group you had chosen. The names are
 * short enough to just show, all of them, wrapped, with the current one lit
 * up. The box underneath is still there for a group that does not exist yet.
 */
function CategoryPicker({
  label,
  value,
  options,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-ink">{label}</span>
      {options.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {options.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onChange(value === c ? "" : c)}
              className={`rounded-full border px-2.5 py-1 text-xs transition ${
                value === c
                  ? "border-[var(--accent)] bg-[var(--accent-soft)] font-medium text-[var(--accent)]"
                  : "border-border text-muted hover:bg-canvas hover:text-ink"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      )}
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={options.length ? "Or type a new group" : placeholder || "A group name"}
      />
    </div>
  );
}

/**
 * Editing a question — all of it.
 *
 * Only the text was editable, which meant a probe that was wrong, or a
 * question filed under the wrong group, or one aimed at the wrong person,
 * could only be fixed by binning it and typing a new one. There is nothing in
 * a question now that you cannot change by hand.
 */
function QuestionEditor({
  q,
  categories,
  saveState,
  onPatch,
  onDone,
}: {
  q: QuestionItem;
  categories: string[];
  saveState: SaveState;
  onPatch: (p: Partial<QuestionItem>) => void;
  onDone: () => void;
}) {
  return (
    <div className="space-y-2.5 rounded-lg border border-[var(--accent)]/40 bg-canvas/50 p-2.5">
      <Textarea
        label="The question"
        autoFocus
        value={q.text}
        onChange={(e) => onPatch({ text: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === "Escape") onDone();
        }}
        className="min-h-16"
      />
      <Input
        label="Probe, for when the answer is thin"
        value={q.followUp}
        onChange={(e) => onPatch({ followUp: e.target.value })}
        placeholder="What you ask next if they give you nothing"
      />
      <Input
        label="Who to put it to"
        value={q.forWhom}
        onChange={(e) => onPatch({ forWhom: e.target.value })}
        placeholder="Everyone"
      />
      <Input
        label="Your note on why it's here"
        value={q.why}
        onChange={(e) => onPatch({ why: e.target.value })}
        placeholder="Only you see this"
      />
      <CategoryPicker
        label="Which group it's in"
        value={q.category}
        options={categories}
        onChange={(c) => onPatch({ category: c })}
      />
      {/* There was no way to tell an edit had finished, and nothing to
          press. Blur alone is not an answer: you cannot see a blur. */}
      <div className="flex items-center gap-2 pt-0.5">
        <Button size="sm" onClick={onDone}>
          <Check size={13} /> Done
        </Button>
        <span className="flex items-center gap-1 text-[11px] text-muted">
          {saveState === "pending" || saveState === "saving" ? (
            <>
              <CloudUpload size={11} className="animate-pulse" /> Saving…
            </>
          ) : (
            <>
              <Check size={11} className="text-emerald-600" /> Saved as you type
            </>
          )}
        </span>
      </div>
    </div>
  );
}

export type GuideScope = "more" | "rewrite" | "future";

// Two instructions, because they are checked differently: how the questions
// are written is a rule every single one has to pass, what they cover is a
// floor the bank as a whole has to clear. Saying "include some on AI" in the
// same box as "keep them casual" is how you end up with a bank entirely about
// AI.
//
// And then one choice about what to do right now. This used to be two
// dialogs: one that took an instruction and wrote twenty more without
// remembering it, and one that remembered an instruction but could only
// rewrite what was already there. Which left the obvious thing — "write me
// new questions, about this" — impossible in either.
function GuidanceModal({
  scope: openOn,
  busy,
  guidance,
  coverage,
  keptCount,
  total,
  onClose,
  onSaveOnly,
  onMore,
  onRewrite,
}: {
  /** Which choice it opens on, or null when the dialog is shut. */
  scope: GuideScope | null;
  busy: boolean;
  guidance: string;
  coverage: string;
  /** Questions a rewrite will not touch: yours, plus anything locked. */
  keptCount: number;
  total: number;
  onClose: () => void;
  onSaveOnly: (guidance: string, coverage: string) => void;
  onMore: (guidance: string, coverage: string) => void;
  onRewrite: (guidance: string, coverage: string) => void;
}) {
  const [style, setStyle] = useState(guidance);
  const [cover, setCover] = useState(coverage);
  const [scope, setScope] = useState<GuideScope>(openOn || "more");

  const dirty = style.trim() !== guidance || cover.trim() !== coverage;
  const atRisk = total - keptCount;

  const CHOICES: { k: GuideScope; title: string; blurb: string }[] = [
    {
      k: "more",
      title: "Write me 20 more, following this",
      blurb:
        "Everything you have stays exactly as it is. Twenty new ones go underneath, none of them repeating a question already in the list.",
    },
    {
      k: "rewrite",
      title: "Rewrite the ones I have",
      blurb:
        `${atRisk} question${atRisk === 1 ? "" : "s"} I wrote get replaced.` +
        (keptCount > 0
          ? ` ${keptCount} stay: the ones you typed, and the ones you've locked.`
          : " Lock any you want to keep first, with the padlock on the question."),
    },
    {
      k: "future",
      title: "Nothing now, just remember it",
      blurb:
        "Nothing changes today. The next batch, and every one after it, follows the instruction.",
    },
  ];

  return (
    <Modal open={openOn !== null} onClose={onClose} title="Guide the questions" movable>
      <p className="mb-3 text-sm text-muted">
        Both boxes stick. Every batch from now on follows them, until you
        change or clear them.
      </p>
      <div className="space-y-3">
        <div>
          <Textarea
            label="How they should be written"
            autoFocus
            value={style}
            onChange={(e) => setStyle(e.target.value)}
            placeholder={`e.g. "Stop saying X person says blah blah. It sounds corporate and boring, I want it more casual."`}
            className="min-h-20"
          />
          <p className="mt-1 text-[11px] text-muted">
            A rule every question has to pass. I check each one against it
            before handing them over, and anything that still breaks it does
            not reach you.
          </p>
        </div>
        <div>
          <Textarea
            label="What they should cover"
            value={cover}
            onChange={(e) => setCover(e.target.value)}
            placeholder={`e.g. "Include some on AI, and on how anyone actually measures this."`}
            className="min-h-20"
          />
          <p className="mt-1 text-[11px] text-muted">
            Not a quota. I write the best bank on your subject first, then read
            it back and only top up what you asked for if it isn&apos;t already
            properly covered. The rest of the subject keeps its room.
          </p>
        </div>
      </div>

      <fieldset className="mt-4">
        <legend className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
          And what should I do now?
        </legend>
        <div className="space-y-2">
          {CHOICES.map((c) => (
            <label
              key={c.k}
              className="flex cursor-pointer items-start gap-2 rounded-lg border border-border p-2.5 text-sm has-[:checked]:border-[var(--accent)] has-[:checked]:bg-[var(--accent-soft)]/30"
            >
              <input
                type="radio"
                checked={scope === c.k}
                onChange={() => setScope(c.k)}
                className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
              />
              <span className="min-w-0 flex-1">
                {c.title}
                <span className="mt-0.5 block text-xs text-muted">{c.blurb}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={
            busy ||
            (scope === "future" && !dirty) ||
            (scope !== "more" && !style.trim() && !cover.trim())
          }
          onClick={() => {
            const g = style.trim();
            const c = cover.trim();
            if (scope === "future") {
              onSaveOnly(g, c);
              onClose();
            } else if (scope === "more") {
              onMore(g, c);
            } else {
              onRewrite(g, c);
            }
          }}
        >
          {scope === "future" ? (
            <>
              <Wand2 size={14} /> Remember it
            </>
          ) : scope === "more" ? (
            <>
              <Sparkles size={14} className={busy ? "animate-pulse" : ""} />
              {busy ? "Writing…" : "Write them"}
            </>
          ) : (
            <>
              <RefreshCw size={14} className={busy ? "animate-spin" : ""} />
              {busy ? "Rewriting…" : "Rewrite them"}
            </>
          )}
        </Button>
      </div>
    </Modal>
  );
}
