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
  Stethoscope,
  StickyNote,
  Trash2,
  Undo2,
  Wand2,
  X,
} from "lucide-react";
import { AskMode } from "@/components/meetingprep/AskMode";
import { ReviewPanel } from "@/components/meetingprep/ReviewPanel";
import { useReview } from "@/lib/meetingprep/useReview";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { ProgressBar, useProgress } from "@/components/ui/Progress";
import { useToast } from "@/components/ui/Feedback";
import { htmlToPlain } from "@/lib/writer/types";
import type { SaveState } from "@/lib/meetingprep/hooks";
import type { QuestionVariant } from "@/lib/meetingprep/questionsAi";
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
  // The question the writer wants said a different way.
  const [reworkId, setReworkId] = useState<string | null>(null);
  // Which question has its note open. One at a time, because the note is a
  // scratch line and not a second body of text.
  const [openNote, setOpenNote] = useState<string | null>(null);
  const pct = useProgress(busy, 45000);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [openCats, setOpenCats] = useState<Set<string>>(new Set());
  const [dragId, setDragId] = useState<string | null>(null);
  // The one question having its probe written, so that row can say so.
  const [fillingId, setFillingId] = useState<string | null>(null);
  // The read-through is one pass over the whole pack, run from any tab. This
  // one shows what it found about the questions, which is where the advice
  // about their order and their overlaps was always meant to be read.
  const review = useReview({ meeting: m, save });

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

  // How long the list runs. Backups are left out of it on purpose: they are
  // the ones held back for if the room goes quiet, so counting them would
  // time a session where everything went wrong, which is not the number
  // anyone is standing there trying to work out.
  const pace = m.questions?.paceMin || 3;
  const askingCount = useMemo(() => picked.filter((q) => !q.backup).length, [picked]);
  const backupCount = picked.length - askingCount;


  // Categories in the order the model's strongest question in each appears,
  // so the most useful group is the one at the top.
  //
  // Built from every live question, not just the unpicked ones. Grouping only
  // the suggestions meant a category vanished off the page the moment its
  // last question was picked or binned, which reads exactly like the app
  // having deleted the whole group — and the writer has no way to tell the
  // difference. A group now stays put and says where its questions went.
  const categories = useMemo(() => {
    const byCat = new Map<string, QuestionItem[]>();
    for (const q of [...live].sort((a, b) => a.rank - b.rank)) {
      const list = byCat.get(q.category) || [];
      list.push(q);
      byCat.set(q.category, list);
    }
    return [...byCat.entries()].map(
      ([cat, all]) =>
        [cat, all.filter((q) => !q.picked), all.filter((q) => q.picked)] as const,
    );
  }, [live]);

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

  // A question the writer typed, locked, or PUT IN THEIR LIST is theirs. A
  // rewrite never touches any of them. Picking a question is already the
  // writer saying they want it; making them also press a padlock to keep it
  // was asking them to say so twice.
  const isKept = (q: QuestionItem) =>
    q.source === "user" || Boolean(q.locked) || q.picked;
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
  // The research is the single biggest influence on what the questions are
  // about, and it was gathered once, for whatever the meeting was about
  // then. Change the subject and it is material about something else — which
  // is how a panel on value communication ended up with a group of questions
  // about AI. Anything that does not match the setup in front of us is not
  // used, and a fresh search runs instead.
  const researchStale =
    !m.brief?.research?.fingerprint || m.brief.research.fingerprint !== fingerprint;
  const briefStale = Boolean(
    m.brief?.sourceFingerprint && m.brief.sourceFingerprint !== fingerprint,
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

  /**
   * Finishes off a question the writer typed themselves.
   *
   * Theirs go into the bank bare — no probe, no reason, no sign that the
   * research already sitting on this meeting has anything to say about them —
   * so their own questions read as the thin ones in their own list. This adds
   * the probe and, where the notes genuinely carry one, the source behind it.
   * Their words are never touched: the route has no field to send a different
   * question back in.
   *
   * `base` is for the question that was added a moment ago, which the saved
   * list this render closed over does not have in it yet.
   */
  async function fillOut(q: QuestionItem, base?: QuestionItem[]) {
    setFillingId(q.id);
    try {
      const res = await fetch("/api/meeting/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          action: "probe",
          meeting: payloadOf(m),
          kolId: m.kol_id || "",
          // Notes about a subject this meeting is no longer on are not
          // backing for anything, so they are not offered as any.
          research: researchStale ? "" : m.brief?.research?.notes || "",
          question: { text: q.text, category: q.category },
          standing: guidance,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not write a probe for that one");
      const followUp = String(json.followUp || "").trim();
      const sourceNote = String(json.sourceNote || "").trim();
      const why = String(json.why || "").trim();
      const forWhom = String(json.forWhom || "").trim();
      if (!followUp && !sourceNote) {
        toast("info", "Nothing worth adding to that one.");
        return;
      }
      const p: Partial<QuestionItem> = {
        ...(followUp ? { followUp } : {}),
        ...(sourceNote ? { sourceNote } : {}),
        // Into the gaps only. Whatever they filled in themselves stands.
        ...(why && !q.why ? { why } : {}),
        ...(forWhom && !q.forWhom ? { forWhom } : {}),
      };
      setItems((base || items).map((x) => (x.id === q.id ? { ...x, ...p } : x)));
      toast(
        "success",
        sourceNote ? "Probe written, with a source from the research" : "Probe written",
      );
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setFillingId(null);
    }
  }

  /** Move a picked question onto another's position. */
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
      /** How many the writer asked for. A floor, not a quota. */
      count?: number;
      /** Top up one group only, and file everything new into it. */
      onlyCategory?: string;
      label?: string;
    } = {},
  ) {
    setBusy(true);
    setBusyLabel(opts.label || "Writing your questions");
    try {
      await flush();
      // A brief written about the old subject drags the questions back to it
      // just as hard as old research does.
      const briefText = briefStale
        ? ""
        : (m.brief?.sections || [])
            .map((s) => `${s.title}:\n${htmlToPlain(s.content)}`)
            .join("\n\n");

      let research = m.brief?.research?.notes || "";
      if (researchStale) {
        setBusyLabel("Reading up on the subject");
        try {
          const r = await fetch("/api/meeting/ai", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify({
              action: "research",
              meeting: payloadOf(m),
              kolId: m.kol_id || "",
            }),
          });
          const rj = await r.json();
          if (r.ok && String(rj.notes || "").trim()) {
            research = String(rj.notes).trim();
            // Kept, so the next batch and the next brief start from the same
            // material rather than searching again.
            save({
              brief: {
                ...m.brief,
                research: {
                  notes: research,
                  at: new Date().toISOString(),
                  fingerprint,
                },
              },
            });
          } else {
            // Better to write from the setup alone than from notes about a
            // subject this meeting is no longer about.
            research = "";
          }
        } catch {
          research = "";
        }
        setBusyLabel(opts.label || "Writing your questions");
      }
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
          research,
          briefText,
          existing: kept.map((q) => q.text),
          categories: opts.onlyCategory
            ? [opts.onlyCategory]
            : opts.replace
              ? []
              : [...new Set(live.map((q) => q.category))],
          count: opts.onlyId ? 1 : Math.max(1, Math.min(60, opts.count || 20)),
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
          category: target
            ? target.category
            : opts.onlyCategory || String(q.category || "Questions"),
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
      if (!opts.onlyId && !opts.onlyCategory)
        setOpenCats(new Set([...new Set(fresh.map((q) => q.category))]));
      if (opts.onlyCategory)
        setOpenCats((prev) => new Set([...prev, opts.onlyCategory!]));
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
    // The bottom padding is for the floating Ask button, which used to sit
    // on top of the bin and make it unclickable.
    <div className="space-y-4 pb-24">
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

      {/* One bar, in one place, rather than four buttons floating on the
          page. The things you do to the bank on the left, the thing you do
          in the room on the right. */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface p-2">
        <Button size="sm" disabled={busy} onClick={() => setGuideScope("more")}>
          <Sparkles size={14} /> {busy ? "Working…" : "Write me more"}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setShowAdd(true)}>
          <Pencil size={14} /> Type one of my own
        </Button>
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => setGuideScope("rewrite")}>
          <Wand2 size={14} /> Fix how these are written
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={review.reviewing || busy}
          onClick={() => void review.runReview()}
        >
          <Stethoscope size={14} />
          {review.reviewing
            ? "Reading it…"
            : review.notes.length
              ? "Check it again"
              : "Check it over"}
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
      {review.reviewing && (
        <ProgressBar pct={review.pct} label="Reading your whole pack back…" className="px-0.5" />
      )}

      {/* No "Do it for me" here yet, and that is on purpose. What the
          read-through finds about questions is mostly order and overlap —
          "start with the metrics one", "these two ask the same thing" — and
          neither can be applied without deciding which question loses. The
          advice being on the tab where you can act on it is the part that was
          missing; doing it for you is a separate problem. */}
      <ReviewPanel
        notes={review.notes}
        at={review.at}
        scope="questions"
        busy={busy}
        onToggleDone={(n) => review.patchNote(n.id, { done: !n.done })}
        onDismiss={(n) => review.patchNote(n.id, { dismissed: true })}
        onClear={review.clear}
      />

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
      <section className="overflow-hidden rounded-xl border border-[var(--accent)]/30 bg-surface">
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--accent)]/20 bg-gradient-to-r from-[var(--accent-soft)]/70 to-transparent px-4 py-3">
          <ListChecks size={16} className="shrink-0 text-[var(--accent)]" />
          <h3 className="text-sm font-semibold tracking-tight">Your list</h3>
          <span className="rounded-full bg-[var(--accent)] px-2 py-0.5 text-[11px] font-semibold tabular-nums text-[var(--accent-fg)]">
            {picked.length}
          </span>
          <span className="flex-1" />
          {picked.length ? (
            <RunTime
              asking={askingCount}
              backups={backupCount}
              pace={pace}
              slot={m.duration_min}
              onPace={(n) => save({ questions: { ...m.questions, paceMin: n } })}
              onUseAsSlot={(mins) => save({ duration_min: mins })}
            />
          ) : (
            <span className="hidden text-xs text-muted sm:block">Nothing picked yet</span>
          )}
        </div>
        <div className="p-3">
        {picked.length === 0 ? (
          <p className="px-1 py-2 text-sm text-muted">
            Press the + on any question below to put it here. Drag by the
            handle to reorder, and star the ones you&apos;re holding in
            reserve.
          </p>
        ) : (
          <ol className="space-y-2">
            {picked.map((q, i) => (
              <li
                key={q.id}
                data-qrow={q.id}
                onPointerMove={(e) => {
                  if (!dragId || dragId === q.id) return;
                  e.preventDefault();
                  reorder(dragId, i);
                }}
                className={`group/row flex items-start gap-2 rounded-xl border bg-surface p-2.5 transition ${
                  dragId === q.id
                    ? "border-[var(--accent)] opacity-60 shadow-sm"
                    : "border-border hover:border-[var(--accent)]/40"
                }`}
              >
                {/* Pointer events rather than HTML5 drag, so this works
                    with a finger. The up and down buttons are gone: two
                    controls for one job, and you can already drop a
                    question anywhere. */}
                <button
                  type="button"
                  aria-label="Drag to reorder"
                  title="Drag to reorder"
                  onPointerDown={(e) => {
                    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                    setDragId(q.id);
                  }}
                  onPointerUp={() => setDragId(null)}
                  onPointerCancel={() => setDragId(null)}
                  onPointerMove={(e) => {
                    if (dragId !== q.id) return;
                    // With the pointer captured, every move lands here, so
                    // the row under the finger has to be found by hand.
                    const el = document
                      .elementFromPoint(e.clientX, e.clientY)
                      ?.closest("[data-qrow]");
                    const overId = el?.getAttribute("data-qrow");
                    if (!overId || overId === q.id) return;
                    const to = picked.findIndex((p) => p.id === overId);
                    if (to >= 0) reorder(q.id, to);
                  }}
                  className="mt-0.5 shrink-0 cursor-grab touch-none rounded-md p-0.5 text-muted/60 transition hover:text-ink active:cursor-grabbing"
                >
                  <GripVertical size={15} />
                </button>
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
                      {/* Every question reads at the same weight. Backups
                          used to be greyed out, which made a held-back
                          question look like a rendering fault rather than a
                          choice — the chip below says it is a backup, and
                          that is the whole job. Nothing in this list is
                          less readable than anything else in it. */}
                      <p className="text-sm text-ink">{q.text}</p>
                      {/* Your list is one running order, not groups: the
                          order you ask them in is the whole point of it. But
                          which group a question came out of is worth knowing
                          at a glance, so it rides along as a tag. */}
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                        <span className="rounded-full bg-canvas px-1.5 py-0.5 text-[10px] font-medium">
                          {q.source === "user" ? "Yours" : q.category}
                        </span>
                        {/* Held back, and until this chip existed the only
                            sign of it was the greyed text above — which
                            reads as a glitch, not a state, when the star
                            that explains it only appears on hover. */}
                        {q.backup && (
                          <span className="rounded-full bg-canvas px-1.5 py-0.5 text-[10px] font-medium">
                            Backup
                          </span>
                        )}
                        {q.forWhom && <span>For: {q.forWhom}</span>}
                      </div>
                      <ProbeLine
                        q={q}
                        busy={fillingId === q.id}
                        onFill={() => void fillOut(q)}
                      />
                      <NoteLine q={q} openNote={openNote} setOpenNote={setOpenNote} onPatch={(p) => patch(q.id, p)} />
                    </>
                  )}
                </div>
                {/* Quiet until you are on the row. Six icons on every line
                    is what made this page look like a control panel. */}
                {/* Quiet, not hidden. These were invisible until you hovered,
                    which is how the writer came to ask for a feature that was
                    already here: three other ways to ask a question, behind
                    the wand. Mobile has always shown them, so the control
                    panel this was guarding against was only ever the desktop
                    one, and a soft grey keeps that at bay without hiding the
                    row's actions from the person looking for them. */}
                <div className="flex shrink-0 items-center gap-0.5 opacity-60 transition focus-within:opacity-100 group-hover/row:opacity-100 max-sm:opacity-100">
                  <IconBtn
                    label={q.backup ? "Not a backup" : "Hold as a backup"}
                    active={q.backup}
                    onClick={() => patch(q.id, { backup: !q.backup })}
                  >
                    <Star size={14} className={q.backup ? "fill-current" : ""} />
                  </IconBtn>
                  <IconBtn
                    label={q.note ? "Your note on this one" : "Add a note of your own"}
                    active={Boolean(q.note)}
                    onClick={() => setOpenNote(openNote === q.id ? null : q.id)}
                  >
                    <StickyNote size={13} />
                  </IconBtn>
                  <IconBtn
                    label="Not quite right? Give me a few other ways to ask it"
                    disabled={busy}
                    onClick={() => setReworkId(q.id)}
                  >
                    <Wand2 size={13} />
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
        </div>
      </section>

      {/* Suggestions, grouped. Collapsed by default past the first group so
          the page is skimmable rather than a wall of twenty questions. */}
      {categories.map(([cat, list, inList], catIndex) => {
        const open = openCats.has(cat) || (catIndex === 0 && openCats.size === 0);
        return (
          <section
            key={cat}
            className={`overflow-hidden rounded-xl border bg-surface transition ${
              open ? "border-[var(--accent)]/30" : "border-border"
            }`}
          >
            <div className="flex items-center gap-1 border-b border-border bg-canvas/60 pr-2">
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
                className="flex min-w-0 flex-1 items-center gap-2 px-4 py-3 text-left"
              >
                <ChevronDown
                  size={15}
                  className={`shrink-0 text-muted transition-transform ${open ? "" : "-rotate-90"}`}
                />
                <h3 className="min-w-0 truncate text-sm font-semibold tracking-tight">{cat}</h3>
                {list.length > 0 && (
                  <span className="shrink-0 rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[11px] font-semibold tabular-nums text-[var(--accent)]">
                    {list.length}
                  </span>
                )}
                <span className="shrink-0 text-xs text-muted">
                  {list.length ? "to look at" : "all in your list"}
                  {inList.length ? ` · ${inList.length} picked` : ""}
                </span>
              </button>
              {/* Top up one group rather than the whole bank. "More for the
                  closing" is a normal thing to want and there was no way to
                  ask for it. */}
              <IconBtn
                label={`Write me more for "${cat}"`}
                disabled={busy}
                onClick={() =>
                  void generate({
                    count: 5,
                    onlyCategory: cat,
                    focus: `Write more questions for the group called "${cat}" and nothing else. Every question goes in that group, does the job that group does in this conversation, and sits alongside the ones already in it without repeating them.`,
                    label: `Writing more for ${cat}`,
                  })
                }
              >
                <Plus size={15} />
              </IconBtn>
            </div>
            {open && (
              <ul className="divide-y divide-border">
                {!list.length && (
                  <li className="px-4 py-3 text-sm text-muted">
                    Every question in this group is in your list already.
                    {inList.length > 0 && " Nothing has been deleted."}
                  </li>
                )}
                {list.map((q) => (
                  <li key={q.id} className="group/row flex items-start gap-3 p-3">
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
                          <ProbeLine
                            q={q}
                            busy={fillingId === q.id}
                            onFill={() => void fillOut(q)}
                          />
                          <NoteLine q={q} openNote={openNote} setOpenNote={setOpenNote} onPatch={(p) => patch(q.id, p)} />
                        </>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5 opacity-60 transition focus-within:opacity-100 group-hover/row:opacity-100 max-sm:opacity-100">
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
                        label={q.note ? "Your note on this one" : "Add a note of your own"}
                        active={Boolean(q.note)}
                        onClick={() => setOpenNote(openNote === q.id ? null : q.id)}
                      >
                        <StickyNote size={13} />
                      </IconBtn>
                      <IconBtn
                        label="Not quite right? Give me a few other ways to ask it"
                        disabled={busy}
                        onClick={() => setReworkId(q.id)}
                      >
                        <Wand2 size={13} />
                      </IconBtn>
                      <IconBtn
                        label="Edit the question, the probe, who it's for, its group"
                        active={editingId === q.id}
                        onClick={() => setEditingId(editingId === q.id ? null : q.id)}
                      >
                        <Pencil size={13} />
                      </IconBtn>
                      <IconBtn
                        label="Bin this question (it goes to the bin at the foot of the page)"
                        onClick={() => {
                          patch(q.id, { deleted: true, picked: false });
                          toast("info", "Binned — it's in the bin at the foot of the page");
                        }}
                      >
                        <Trash2 size={13} />
                      </IconBtn>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}

      {binned.length > 0 && (
        <details className="rounded-xl border border-border bg-surface px-4 py-3">
          <summary className="flex cursor-pointer items-center gap-2 text-sm">
            <Trash2 size={14} className="text-muted" />
            <span className="font-medium text-ink">Bin</span>
            <span className="rounded-full bg-canvas px-2 py-0.5 text-[11px] font-semibold tabular-nums text-muted">
              {binned.length}
            </span>
            <span className="text-xs text-muted">nothing here is gone — open to get one back</span>
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
        onMore={(g, c, count) =>
          void generate({
            guidance: g,
            coverage: c,
            count,
            label: `Writing ${count} more question${count === 1 ? "" : "s"}`,
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

      <ReworkModal
        key={reworkId || "none"}
        q={live.find((x) => x.id === reworkId) || null}
        standing={guidance}
        onClose={() => setReworkId(null)}
        onApply={(text, followUp) => {
          if (reworkId) patch(reworkId, { text, followUp });
          setReworkId(null);
          toast("success", "Swapped in");
        }}
        fetchVariants={async (q, instruction) => {
          const res = await fetch("/api/meeting/ai", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify({
              action: "variants",
              meeting: payloadOf(m),
              kolId: m.kol_id || "",
              research: m.brief?.research?.notes || "",
              question: {
                text: q.text,
                why: q.why,
                followUp: q.followUp,
                category: q.category,
              },
              guidance: instruction,
              standing: guidance,
            }),
          });
          const json = await res.json();
          if (!res.ok) throw new Error(json.error || "Could not rework that one");
          return json.variants || [];
        }}
      />

      <AddOwnModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        categories={allCategories}
        onAdd={(text, category, followUp, forWhom) => {
          const maxOrder = picked.length ? Math.max(...picked.map((p) => p.order)) : -1;
          const fresh: QuestionItem = {
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
          };
          const next = [...items, fresh];
          setItems(next);
          setShowAdd(false);
          // No probe typed in means they do not have one, not that they want
          // none — the box says so. Writing it here saves them adding the
          // question and then asking for the same thing a second time.
          if (!followUp) void fillOut(fresh, next);
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

/**
 * How long the list will take to get through.
 *
 * The question a moderator is actually standing there trying to answer is not
 * "are these good questions" — they can see that — but "do these fit". Fourteen
 * questions is a count. Forty two minutes against a forty five minute slot is
 * a decision, and it is the one thing the page could not tell them.
 *
 * The pace is on screen and theirs to change rather than a constant buried in
 * the code. There is no right answer to how long an answer runs: a panel of
 * four and a one to one are different meetings, and a number nobody can see
 * is a number nobody can disagree with.
 */
function RunTime({
  asking,
  backups,
  pace,
  slot,
  onPace,
  onUseAsSlot,
}: {
  asking: number;
  backups: number;
  pace: number;
  /** The session length off Setup, when the writer has given one. */
  slot?: number | null;
  onPace: (minutes: number) => void;
  onUseAsSlot: (minutes: number) => void;
}) {
  const total = asking * pace;
  const over = Boolean(slot && total > slot);
  return (
    <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1 text-xs">
      <span className={over ? "font-semibold text-amber-700" : "font-medium text-ink"}>
        about {total} min{slot ? ` of your ${slot}` : ""}
        {over ? ` — ${total - slot!} over` : ""}
      </span>
      {backups > 0 && (
        <span className="text-muted" title="Backups are not in the total">
          +{backups * pace} held back
        </span>
      )}
      <select
        value={pace}
        onChange={(e) => onPace(Number(e.target.value))}
        title="How long you expect an answer to run"
        className="rounded-md border border-border bg-surface px-1.5 py-0.5 text-xs text-muted outline-none focus:border-[var(--accent)]"
      >
        {[1, 2, 3, 4, 5].map((n) => (
          <option key={n} value={n}>
            {n} min an answer
          </option>
        ))}
      </select>
      {/* Nothing to measure against until the slot length is known, and this
          is the moment they know it. */}
      {!slot && total > 0 && (
        <button
          type="button"
          onClick={() => onUseAsSlot(total)}
          className="rounded-md px-1.5 py-0.5 font-medium text-[var(--accent)] transition hover:bg-[var(--accent-soft)]"
        >
          Use as the meeting length
        </button>
      )}
    </div>
  );
}

/**
 * The probe under a question, and the way to get one where there is none.
 *
 * Every question the model writes comes with a probe; the ones the writer
 * types do not, which left their own questions the thin ones in their own
 * list. The offer empties itself — once there is a probe, this is just the
 * probe — so it can sit in the row rather than in the hover rail. That is
 * deliberate: an affordance you cannot see until you hover is how the greyed
 * backup rows in this same list went unexplained.
 *
 * The source line underneath is read, never said. It is backing the writer
 * can choose to cite, not a name to open a question with, which is the thing
 * they have twice asked not to be handed.
 */
function ProbeLine({
  q,
  busy,
  onFill,
}: {
  q: QuestionItem;
  busy: boolean;
  onFill: () => void;
}) {
  return (
    <>
      {q.followUp ? (
        <p className="mt-1 text-xs italic text-muted">Probe: {q.followUp}</p>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={onFill}
          className="mt-1 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-[var(--accent)] transition hover:bg-[var(--accent-soft)] disabled:opacity-60"
        >
          <Sparkles size={12} className={busy ? "animate-pulse" : ""} />
          {busy ? "Writing the probe…" : "Write the probe"}
        </button>
      )}
      {q.sourceNote && <p className="mt-1 text-xs text-muted">Source: {q.sourceNote}</p>}
    </>
  );
}

/**
 * The writer's own note under a question, which is not there until they want
 * one.
 *
 * Asked for without more buttons and without another large box sitting open
 * on every row: with no note there is a small line of text that only shows
 * when you are on the question, and with a note there is the note.
 */
function NoteLine({
  q,
  openNote,
  setOpenNote,
  onPatch,
}: {
  q: QuestionItem;
  openNote: string | null;
  setOpenNote: (id: string | null) => void;
  onPatch: (p: Partial<QuestionItem>) => void;
}) {
  const open = openNote === q.id;
  const setOpen = (v: boolean) => setOpenNote(v ? q.id : null);

  // Nothing at all when there is no note and nobody has asked for one. The
  // trigger lives in the row's hover rail instead: an empty placeholder line
  // under all twenty two questions is exactly the clutter this was meant to
  // avoid.
  if (!open && !q.note) return null;

  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1.5 flex w-full items-start gap-1.5 rounded-md bg-amber-50 px-2 py-1 text-left text-xs text-amber-900 transition hover:bg-amber-100"
      >
        <StickyNote size={12} className="mt-0.5 shrink-0 text-amber-500" />
        <span className="min-w-0 flex-1 whitespace-pre-wrap">{q.note}</span>
      </button>
    );

  return (
    <div className="mt-1.5 rounded-md border border-amber-200 bg-amber-50/60 p-1.5">
      <textarea
        autoFocus
        value={q.note || ""}
        onChange={(e) => onPatch({ note: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder="Only you see this. Saves as you type."
        className="min-h-12 w-full resize-y rounded border border-amber-200 bg-surface px-2 py-1 text-xs outline-none focus:border-amber-400"
      />
      <div className="mt-1 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded bg-amber-500 px-2 py-0.5 text-[11px] font-medium text-white transition hover:bg-amber-600"
        >
          Done
        </button>
        {q.note && (
          <button
            type="button"
            onClick={() => {
              onPatch({ note: "" });
              setOpen(false);
            }}
            className="text-[11px] text-muted underline-offset-2 hover:underline"
          >
            Remove the note
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * "This one is good but not quite right."
 *
 * The app could rewrite a question, which threw away what was good about it,
 * or hand over a blank box. Neither helps when you like the question and not
 * the wording. This gives three versions of the same question, far enough
 * apart to be a real choice, and lets the writer ask again with a different
 * instruction if none of them land.
 */
function ReworkModal({
  q,
  standing,
  onClose,
  onApply,
  fetchVariants,
}: {
  q: QuestionItem | null;
  /** Their standing instruction, shown so they know it is still on. */
  standing: string;
  onClose: () => void;
  onApply: (text: string, followUp: string) => void;
  fetchVariants: (q: QuestionItem, instruction: string) => Promise<QuestionVariant[]>;
}) {
  const [instruction, setInstruction] = useState("");
  const [options, setOptions] = useState<QuestionVariant[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pct = useProgress(busy, 20000);

  async function run() {
    if (!q) return;
    setBusy(true);
    setError("");
    try {
      const got = await fetchVariants(q, instruction.trim());
      if (!got.length) throw new Error("Nothing usable came back — try saying it differently.");
      setOptions(got);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={Boolean(q)} onClose={onClose} title="Say this one another way" movable>
      {q && (
        <>
          <p className="rounded-lg border border-border bg-canvas/60 px-3 py-2 text-sm text-ink">
            {q.text}
          </p>

          <div className="mt-3">
            <Textarea
              label="What's not right about it? (optional)"
              autoFocus
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder={`e.g. "too long to say out loud" or "make it land harder" or "ask it without the jargon"`}
              className="min-h-16"
            />
            {standing && (
              <p className="mt-1 text-[11px] text-muted">
                Your standing instruction still applies: {standing}
              </p>
            )}
          </div>

          {busy && <ProgressBar pct={pct} label="Finding other ways to ask it…" className="mt-3" />}
          {error && <p className="mt-2 text-sm text-status-error">{error}</p>}

          {options.length > 0 && !busy && (
            <ul className="mt-4 space-y-2">
              {options.map((v, i) => (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => onApply(v.text, v.followUp || q.followUp)}
                    className="w-full rounded-xl border border-border bg-surface p-3 text-left transition hover:border-[var(--accent)] hover:bg-[var(--accent-soft)]/20"
                  >
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--accent)]">
                      {v.angle}
                    </span>
                    <span className="mt-1 block text-sm font-medium text-ink">{v.text}</span>
                    {v.followUp && (
                      <span className="mt-1 block text-xs italic text-muted">
                        Probe: {v.followUp}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4 flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Keep it as it is
            </Button>
            <Button disabled={busy} onClick={() => void run()}>
              <Wand2 size={14} />
              {busy
                ? "Thinking…"
                : options.length
                  ? "Try again with that"
                  : "Show me a few ways"}
            </Button>
          </div>
          {options.length > 0 && (
            <p className="mt-2 text-right text-[11px] text-muted">
              Click one to swap it in. Nothing changes until you do.
            </p>
          )}
        </>
      )}
    </Modal>
  );
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
          placeholder="Leave it blank and I'll write one, with a source if the research has one"
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
        label="The source behind it, for you to read, not to say"
        value={q.sourceNote || ""}
        onChange={(e) => onPatch({ sourceNote: e.target.value })}
        placeholder="Nothing in the research backed this one up"
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
  onMore: (guidance: string, coverage: string, count: number) => void;
  onRewrite: (guidance: string, coverage: string) => void;
}) {
  const [style, setStyle] = useState(guidance);
  const [cover, setCover] = useState(coverage);
  const [scope, setScope] = useState<GuideScope>(openOn || "more");
  // A floor the writer sets, not a number the app picked. Twenty was
  // hardcoded and nobody had asked for twenty.
  const [howMany, setHowMany] = useState(20);

  const dirty = style.trim() !== guidance || cover.trim() !== coverage;
  const atRisk = total - keptCount;

  const CHOICES: { k: GuideScope; title: string; blurb: string }[] = [
    {
      k: "more",
      title: "Write me more, following this",
      blurb:
        "Nothing you have is touched or deleted. The new ones go underneath, and none of them repeats a question already in the list.",
    },
    {
      k: "rewrite",
      title: "Rewrite the ones I have",
      blurb:
        `${atRisk} question${atRisk === 1 ? "" : "s"} I wrote get replaced.` +
        (keptCount > 0
          ? ` ${keptCount} stay: everything in your list, everything you typed, and anything you've locked.`
          : " Put the ones you want to keep in your list first, or lock them with the padlock."),
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
            Say &ldquo;include questions about X&rdquo; here. Not a quota: I
            write the best bank on your subject first, then read it back and
            only top up what you asked for if it isn&apos;t already properly
            covered. Writing this never deletes anything on its own — what
            happens to the questions you already have is the choice below.
          </p>
        </div>
      </div>

      <fieldset className="mt-4">
        <legend className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
          And what should I do now?
        </legend>
        {scope !== "future" && (
          <label className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-canvas/50 px-2.5 py-2 text-sm">
            <span className="text-ink">Write me at least</span>
            <input
              type="number"
              min={1}
              max={60}
              value={howMany}
              onChange={(e) => setHowMany(Math.max(1, Math.min(60, Number(e.target.value) || 1)))}
              className="w-16 rounded-md border border-border bg-surface px-2 py-1 text-sm outline-none focus:border-[var(--accent)]"
            />
            <span className="text-ink">questions</span>
            <span className="w-full text-[11px] text-muted">
              A floor, not a quota. It writes more than this when the subject
              carries them, and never pads to reach it.
            </span>
          </label>
        )}
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
              onMore(g, c, howMany);
            } else {
              onRewrite(g, c);
            }
          }}
        >
          {/* The label is the whole answer to "will this delete what I
              have?", so it says the number either way. */}
          {scope === "future" ? (
            <>
              <Wand2 size={14} /> Remember it, change nothing
            </>
          ) : scope === "more" ? (
            <>
              <Sparkles size={14} className={busy ? "animate-pulse" : ""} />
              {busy
                ? "Writing…"
                : `Write ${howMany} more, keep all ${total}`}
            </>
          ) : (
            <>
              <RefreshCw size={14} className={busy ? "animate-spin" : ""} />
              {busy ? "Rewriting…" : `Replace ${atRisk} of ${total}`}
            </>
          )}
        </Button>
      </div>
    </Modal>
  );
}
