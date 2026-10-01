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
  RefreshCw,
  Sparkles,
  Star,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Feedback";
import { htmlToPlain } from "@/lib/writer/types";
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
}: {
  m: MpMeeting;
  save: (p: Partial<MpMeeting>) => void;
  flush: () => Promise<void>;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [showAsk, setShowAsk] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [openCats, setOpenCats] = useState<Set<string>>(new Set());
  const [dragId, setDragId] = useState<string | null>(null);

  const items: QuestionItem[] = useMemo(() => m.questions?.items || [], [m.questions]);
  const picked = useMemo(
    () => items.filter((q) => q.picked).sort((a, b) => a.order - b.order),
    [items],
  );
  const suggestions = useMemo(() => items.filter((q) => !q.picked), [items]);

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

  const setItems = (next: QuestionItem[]) =>
    save({ questions: { ...m.questions, items: next } });

  // The standing correction, if the writer has given one. It is kept on the
  // bank so it survives: telling the model once to stop opening every
  // question the same way should not wear off at the next batch.
  const guidance = m.questions?.guidance || "";

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
    opts: { focus?: string; guidance?: string; replace?: boolean } = {},
  ) {
    setBusy(true);
    try {
      await flush();
      const briefText = (m.brief?.sections || [])
        .map((s) => `${s.title}:\n${htmlToPlain(s.content)}`)
        .join("\n\n");
      // A rewrite starts from a blank sheet, so it must not be told to avoid
      // the questions it is replacing, nor to file into the categories that
      // the correction may well be about.
      const kept = opts.replace ? items.filter((q) => q.source === "user") : items;
      const nextGuidance = opts.guidance ?? guidance;
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
          categories: opts.replace ? [] : [...new Set(items.map((q) => q.category))],
          count: 20,
          focus: opts.focus || "",
          guidance: nextGuidance,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not write the questions");
      // Ranks are per batch, so a second batch's "1" would sort above the
      // first batch's best question inside the same category. Offsetting
      // keeps a merged category in a sensible order.
      const rankOffset = opts.replace
        ? 0
        : items.reduce((n, q) => Math.max(n, q.rank), 0);
      const fresh: QuestionItem[] = (json.questions || []).map(
        (q: Omit<WrittenShape, "id">, i: number) => ({
          id: newId(),
          text: String(q.text || ""),
          category: String(q.category || "Questions"),
          why: String(q.why || ""),
          followUp: String(q.followUp || ""),
          forWhom: String(q.forWhom || ""),
          rank: rankOffset + (Number(q.rank) || i + 1),
          picked: false,
          backup: false,
          asked: false,
          order: 0,
          source: "ai" as const,
        }),
      );
      if (!fresh.length) throw new Error("Nothing came back — try again.");
      save({
        questions: {
          ...m.questions,
          items: [...kept, ...fresh],
          guidance: nextGuidance,
          generatedAt: new Date().toISOString(),
          // Only a batch written against the whole setup can claim to be
          // current; topping up an old bank leaves the old ones in it.
          ...(opts.replace || !items.length
            ? { engine: QUESTIONS_ENGINE, sourceFingerprint: fingerprint }
            : {}),
        },
      });
      // A fresh batch is easiest to read with every group open.
      setOpenCats(new Set([...new Set(fresh.map((q) => q.category))]));
      toast(
        "success",
        opts.replace
          ? `Rewritten — ${fresh.length} new question${fresh.length === 1 ? "" : "s"}`
          : `${fresh.length} question${fresh.length === 1 ? "" : "s"} added`,
      );
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setBusy(false);
      setShowMore(false);
      setShowGuide(false);
    }
  }

  if (!items.length) {
    return (
      <div className="grid place-items-center rounded-xl border border-dashed border-border bg-surface px-6 py-16 text-center">
        {busy ? (
          <>
            <Sparkles size={22} className="mb-2 animate-pulse text-[var(--accent)]" />
            <p className="text-sm font-medium text-ink">Writing your questions…</p>
            <p className="mt-1 max-w-md text-sm text-muted">
              Twenty or so, grouped and ranked, built from your setup and
              whatever the brief turned up about the subject.
            </p>
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
              <Button onClick={() => void generate({ replace: true })}>
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
            onClick={() => void generate({ replace: true })}
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
        <Button size="sm" disabled={busy} onClick={() => setShowMore(true)}>
          <Sparkles size={14} /> {busy ? "Writing…" : "Write me 20 more"}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setShowAdd(true)}>
          <Pencil size={14} /> Type one of my own
        </Button>
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => setShowGuide(true)}>
          <Wand2 size={14} /> Change how they&apos;re written
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

      {guidance && (
        <p className="flex items-start gap-1.5 rounded-lg border border-border bg-canvas/50 px-3 py-2 text-xs text-muted">
          <Wand2 size={13} className="mt-0.5 shrink-0 text-[var(--accent)]" />
          <span className="min-w-0 flex-1">
            Every batch follows your instruction: <b className="font-medium text-ink">{guidance}</b>
          </span>
          <button
            className="shrink-0 underline-offset-2 hover:underline"
            onClick={() => save({ questions: { ...m.questions, guidance: "" } })}
          >
            clear
          </button>
        </p>
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
                    <Textarea
                      autoFocus
                      value={q.text}
                      onChange={(e) => patch(q.id, { text: e.target.value })}
                      onBlur={() => setEditingId(null)}
                      className="min-h-16"
                    />
                  ) : (
                    <p className={`text-sm ${q.backup ? "text-muted" : "text-ink"}`}>
                      {q.text}
                    </p>
                  )}
                  {q.forWhom && (
                    <p className="mt-0.5 text-xs text-muted">For: {q.forWhom}</p>
                  )}
                  {q.followUp && (
                    <p className="mt-1 text-xs italic text-muted">
                      Probe: {q.followUp}
                    </p>
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
                  <IconBtn label="Edit" onClick={() => setEditingId(q.id)}>
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
                      <p className="text-sm text-ink">{q.text}</p>
                      <p className="mt-0.5 text-xs text-muted">
                        {q.why}
                        {q.forWhom ? ` · For: ${q.forWhom}` : ""}
                      </p>
                      {q.followUp && (
                        <p className="mt-1 text-xs italic text-muted">Probe: {q.followUp}</p>
                      )}
                    </div>
                    <IconBtn
                      label="Delete this question"
                      onClick={() => setItems(items.filter((x) => x.id !== q.id))}
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

      <AskMode
        open={showAsk}
        onClose={() => setShowAsk(false)}
        topic={m.topic || ""}
        picked={picked}
        onToggleAsked={(q) => patch(q.id, { asked: !q.asked })}
        onResetTicks={() => setItems(items.map((q) => ({ ...q, asked: false })))}
      />

      <MoreModal
        open={showMore}
        busy={busy}
        onClose={() => setShowMore(false)}
        onGenerate={(focus) => void generate({ focus })}
      />

      <GuidanceModal
        open={showGuide}
        busy={busy}
        current={guidance}
        onClose={() => setShowGuide(false)}
        onApply={(g) => void generate({ guidance: g, replace: true })}
      />

      <AddOwnModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        categories={[...new Set(items.map((q) => q.category))]}
        onAdd={(text, category, followUp) => {
          const maxOrder = picked.length ? Math.max(...picked.map((p) => p.order)) : -1;
          setItems([
            ...items,
            {
              id: newId(),
              text,
              category: category || "Mine",
              why: "",
              followUp,
              forWhom: "",
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

// The in-the-room view: big type, your order, tick them off as you ask them.
// Backups sit at the end, out of the main flow, because that is what holding
// one in reserve means.
function AskMode({
  open,
  onClose,
  topic,
  picked,
  onToggleAsked,
  onResetTicks,
}: {
  open: boolean;
  onClose: () => void;
  /** The subject, on screen while you are standing in front of the room. */
  topic: string;
  picked: QuestionItem[];
  onToggleAsked: (q: QuestionItem) => void;
  onResetTicks: () => void;
}) {
  const main = picked.filter((q) => !q.backup);
  const backups = picked.filter((q) => q.backup);
  const done = picked.filter((q) => q.asked).length;

  const Row = ({ q, n }: { q: QuestionItem; n?: number }) => (
    <li>
      <button
        type="button"
        onClick={() => onToggleAsked(q)}
        className={`flex w-full items-start gap-3 rounded-xl border p-3 text-left transition ${
          q.asked ? "border-border bg-canvas/60 opacity-60" : "border-border bg-surface"
        }`}
      >
        <span
          className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md text-xs font-semibold ${
            q.asked
              ? "bg-emerald-100 text-emerald-700"
              : "bg-[var(--accent-soft)] text-[var(--accent)]"
          }`}
        >
          {q.asked ? <Check size={14} /> : (n ?? "★")}
        </span>
        <span className="min-w-0 flex-1">
          <span
            className={`block text-lg leading-snug ${q.asked ? "line-through" : "font-medium"}`}
          >
            {q.text}
          </span>
          {q.forWhom && (
            <span className="mt-0.5 block text-sm text-muted">For: {q.forWhom}</span>
          )}
          {q.followUp && (
            <span className="mt-1 block text-sm italic text-muted">Probe: {q.followUp}</span>
          )}
        </span>
      </button>
    </li>
  );

  return (
    <Modal open={open} onClose={onClose} title="Ask mode" size="lg">
      {topic && (
        <p className="mb-3 rounded-lg bg-[var(--accent-soft)]/50 px-3 py-2 text-sm font-medium">
          {topic}
        </p>
      )}
      <div className="mb-3 flex items-center gap-3">
        <p className="flex-1 text-sm text-muted">
          Tap a question to tick it off. {done} of {picked.length} asked.
        </p>
        {done > 0 && (
          <Button size="sm" variant="secondary" onClick={onResetTicks}>
            Reset ticks
          </Button>
        )}
      </div>
      <ul className="space-y-2">
        {main.map((q, i) => (
          <Row key={q.id} q={q} n={i + 1} />
        ))}
      </ul>
      {backups.length > 0 && (
        <>
          <p className="mb-2 mt-4 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
            <Star size={12} className="fill-current text-amber-500" /> In reserve
          </p>
          <ul className="space-y-2">
            {backups.map((q) => (
              <Row key={q.id} q={q} />
            ))}
          </ul>
        </>
      )}
    </Modal>
  );
}

function MoreModal({
  open,
  busy,
  onClose,
  onGenerate,
}: {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onGenerate: (focus: string) => void;
}) {
  const [focus, setFocus] = useState("");
  return (
    <Modal open={open} onClose={onClose} title="Write me 20 more">
      <p className="mb-3 text-sm text-muted">
        I&apos;ll write another twenty and add them to what you already have.
        None of them will repeat a question that is already in the list. Say
        what this batch should be about, or leave it blank for more of
        everything.
      </p>
      <Input
        value={focus}
        onChange={(e) => setFocus(e.target.value)}
        placeholder='e.g. "harder ones on budgets" or "questions for the quiet panelist"'
      />
      <div className="mt-3 flex justify-end">
        <Button
          disabled={busy}
          onClick={() => {
            onGenerate(focus.trim());
            setFocus("");
          }}
        >
          <Sparkles size={14} /> {busy ? "Writing…" : "Write them"}
        </Button>
      </div>
    </Modal>
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
  onAdd: (text: string, category: string, followUp: string) => void;
}) {
  const [text, setText] = useState("");
  const [category, setCategory] = useState("");
  const [followUp, setFollowUp] = useState("");
  return (
    <Modal open={open} onClose={onClose} title="Type one of my own">
      <div className="space-y-3">
        <Textarea
          label="The question, as you'd say it"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="min-h-20"
        />
        <Input
          label="Follow-up probe (optional)"
          value={followUp}
          onChange={(e) => setFollowUp(e.target.value)}
        />
        <Input
          label="Category (optional)"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          list="mp-question-categories"
          placeholder="Mine"
        />
        <datalist id="mp-question-categories">
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <div className="flex justify-end">
          <Button
            disabled={!text.trim()}
            onClick={() => {
              onAdd(text.trim(), category.trim(), followUp.trim());
              setText("");
              setCategory("");
              setFollowUp("");
            }}
          >
            <Plus size={14} /> Add to my list
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// "Don't open every question with a consultancy's name." The correction
// arrives after you have read the batch, not before, so it has to be able to
// land on questions that already exist — which means rewriting them, not
// adding twenty more in the same style.
function GuidanceModal({
  open,
  busy,
  current,
  onClose,
  onApply,
}: {
  open: boolean;
  busy: boolean;
  current: string;
  onClose: () => void;
  onApply: (guidance: string) => void;
}) {
  const [text, setText] = useState(current);
  return (
    <Modal open={open} onClose={onClose} title="Change how they're written">
      <p className="mb-3 text-sm text-muted">
        Tell me what&apos;s wrong with these questions and I&apos;ll write the
        whole set again to that instruction. It sticks: every batch after this
        one follows it too, until you clear it.
      </p>
      <Textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={`e.g. "Stop opening questions with 'McKinsey says'. Don't cite consultancies at all, ask the question directly." Or: "Shorter. Nothing over fifteen words."`}
        className="min-h-24"
      />
      <p className="mt-2 text-xs text-muted">
        Questions you typed yourself are kept exactly as they are. Everything I
        wrote is replaced, so anything you had picked goes back in the pool.
      </p>
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={busy || !text.trim()}
          onClick={() => onApply(text.trim())}
        >
          <RefreshCw size={14} className={busy ? "animate-spin" : ""} />
          {busy ? "Rewriting…" : "Rewrite them all"}
        </Button>
      </div>
    </Modal>
  );
}
