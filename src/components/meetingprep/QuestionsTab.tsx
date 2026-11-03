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

import { Fragment, createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  CircleHelp,
  GripVertical,
  ListChecks,
  X,
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
  BookOpen,
  Archive,
  ListOrdered,
  CirclePause,
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpToLine,
  Ellipsis,
  SlidersHorizontal,
  Loader2,
  Scissors,
  Search,
} from "lucide-react";
import { AskMode } from "@/components/meetingprep/AskMode";
import { AskWho, ForChip, KeptFields, QuestionChoices, askList, choicesOf, panelNames, pickOption, sameOption, swapKept } from "@/components/meetingprep/QuestionChoices";
import { ReviewPanel } from "@/components/meetingprep/ReviewPanel";
import { useReview } from "@/lib/meetingprep/useReview";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { ProgressBar, useProgress, Working } from "@/components/ui/Progress";
import { useToast } from "@/components/ui/Feedback";
import { htmlToPlain } from "@/lib/writer/types";
import type { SaveState } from "@/lib/meetingprep/hooks";
import { matchSource, withReading } from "@/lib/meetingprep/reading";
import type { QuestionOption, ReadingSource } from "@/lib/meetingprep/types";

// The reading list, for the source line under a question to link into.
// Context rather than a prop: that line sits several components deep.
const ReadingSources = createContext<ReadingSource[]>([]);
import type { QuestionVariant, ReworkLength, ReworkPart } from "@/lib/meetingprep/questionsAi";
import {
  QUESTIONS_ENGINE,
  engineBehind,
  meetingTypeLabel,
  sameQuestion,
  setupFingerprint,
  stripAskedQuestion,
  type MpMeeting,
  type QuestionItem,
  type ReviewNote,
  type SourceDraft,
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
    documents: (m.documents || []).map((d) => ({
      name: d.name,
      note: d.note,
      text: d.text,
      purpose: d.purpose,
    })),
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
  // Writing one question with help. What they typed lives here so "Type one
  // of my own" can hand it across, and it survives closing the window.
  const [showHelp, setShowHelp] = useState(false);
  const [helpRough, setHelpRough] = useState("");
  const [helping, setHelping] = useState(false);
  // Rework for several at once, opened with the choices it was started with.
  const [manyOpen, setManyOpen] = useState(false);
  const [manyPreset, setManyPreset] = useState<ManyPreset>({ part: "auto", length: "same", instruction: "", n: 0 });
  const [resizing, setResizing] = useState(false);
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
  // Twenty questions and their checks: about a minute and a half.
  const pct = useProgress(busy, 90000);
  const [editingId, setEditingId] = useState<string | null>(null);
  // null until the writer opens or closes one; then exactly what they chose.
  // An empty set used to mean "untouched", so closing the last open group
  // opened the first one again and it could never be shut.
  const [openCats, setOpenCats] = useState<Set<string> | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  // Short rows (the question, who, how long) or every row open. Short is the
  // default: the list with every setup, probe and version showing was a wall
  // of text the writer could not plan from. Remembered per browser.
  // The tab only renders once the meeting has loaded in the browser, so
  // reading storage here does not differ from a server render.
  const [compact, setCompact] = useState(() => {
    try {
      return localStorage.getItem("mp:list-view") !== "full";
    } catch {
      return true;
    }
  });
  const setView = (short: boolean) => {
    setCompact(short);
    try {
      localStorage.setItem("mp:list-view", short ? "short" : "full");
    } catch {}
  };
  const [openRows, setOpenRows] = useState<Set<string>>(new Set());
  const toggleRow = (id: string) =>
    setOpenRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  // One panelist's share of the list, or the questions nobody has yet.
  const [whoFilter, setWhoFilter] = useState<string | null>(null);
  // Dragging near the edge scrolls, so a question can go from 22 to 1 in
  // one drag instead of a screenful at a time.
  const drag = useRef<{
    x: number;
    y: number;
    timer: number | null;
    scroller: HTMLElement | null;
    drop: number | null;
    stop: (() => void) | null;
  }>({ x: 0, y: 0, timer: null, scroller: null, drop: null, stop: null });
  // Where a dragged question would land: before the question at this place
  // on screen, or at the very end when it equals the number of rows.
  const [dropAt, setDropAt] = useState<number | null>(null);
  useEffect(() => {
    const d = drag.current;
    return () => d.stop?.();
  }, []);
  // The one question having its probe written, so that row can say so.
  const [fillingId, setFillingId] = useState<string | null>(null);
  // Writing every missing probe at once, and how many are home.
  const [fillingAll, setFillingAll] = useState(false);
  const [filledCount, setFilledCount] = useState(0);
  // The standing instructions, shut until asked for.
  const [showStanding, setShowStanding] = useState(false);
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
  const pickedRef = useRef(picked);
  useEffect(() => {
    pickedRef.current = picked;
  }, [picked]);
  const inFilter = (q: QuestionItem) =>
    !whoFilter
      ? true
      : whoFilter === "must"
        ? Boolean(q.mustAsk)
        : whoFilter === "reserve"
          ? Boolean(q.backup)
          : whoFilter === "none"
            ? !askList(q.askWho).length
            : askList(q.askWho).includes(whoFilter);

  // How long the list runs. Backups are left out of it on purpose: they are
  // the ones held back for if the room goes quiet, so counting them would
  // time a session where everything went wrong, which is not the number
  // anyone is standing there trying to work out.
  const pace = m.questions?.paceMin || (m.meeting_type === "panel" ? 2.5 : 3);
  // Moderating means asking one question and getting several answers, so the
  // cost of a question is the answers it draws, not one answer.
  const voices = m.questions?.voicesPerQ || (m.meeting_type === "panel" ? 2 : 1);

  // Questions that went in without a probe. In practice these are the ones
  // the writer typed: everything the model writes comes with one.
  const missingProbes = useMemo(() => live.filter((q) => !q.followUp).length, [live]);

  // Questions that have never been given a setup. "" means one was asked for
  // and the question was judged better bare, so it is not missing (and has
  // its own "Add a setup" for when the writer disagrees). Your list first,
  // since those are the ones being said; then the rest of the bank, so the
  // button does not just stop at the list and leave twenty questions bare.
  const setupTargets = useMemo(() => {
    const list = picked.filter((q) => q.setup === undefined);
    if (list.length) return { where: "your list" as const, qs: list.slice(0, 40) };
    const bank = live.filter((q) => !q.picked && q.setup === undefined);
    return { where: "the bank" as const, qs: bank.slice(0, 40) };
  }, [picked, live]);
  const [settingUpId, setSettingUpId] = useState<string | null>(null);
  // So Cancel can stop waiting for a setups request.
  const setupAbort = useRef<AbortController | null>(null);
  const [sharpening, setSharpening] = useState(false);
  const sharpenAbort = useRef<AbortController | null>(null);

  /**
   * Other ways to ask every question with a setup, offered under each: the
   * writer picks the kind they like for each setup, and nothing changes
   * until they do. Reads the meeting fresh before saving, so anything done
   * while it ran is kept.
   */
  const [versioningIds, setVersioningIds] = useState<string[]>([]);
  // Asked for one question's versions: they open there when they land.
  const [freshVersions, setFreshVersions] = useState<Set<string>>(new Set());
  async function sharpen(only?: QuestionItem[]) {
    if (blocked()) return;
    const targets = (only || live).filter((q) => !q.options?.length);
    if (!targets.length) return;
    const ids = targets.map((q) => q.id);
    if (!only) {
      sharpenAbort.current = new AbortController();
      setSharpening(true);
    }
    setVersioningIds((v) => [...v, ...ids]);
    try {
      const res = await fetch("/api/meeting/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          action: "options",
          meeting: payloadOf(m),
          items: targets.map((q) => ({ setup: stripAskedQuestion(q.setup, q.text), text: q.text })),
          standing: guidance,
        }),
        signal: only ? undefined : sharpenAbort.current?.signal,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not write the versions");
      const out: QuestionItem["options"][] = json.options || [];
      const byId = new Map(targets.map((q, i) => [q.id, out[i] || []]));
      const fresh = latest.current.questions?.items || [];
      save({
        questions: {
          ...latest.current.questions,
          items: fresh.map((x) => (byId.get(x.id)?.length ? { ...x, options: byId.get(x.id) } : x)),
        },
      });
      if (only) setFreshVersions((v) => new Set([...v, ...ids]));
      if (!only) toast("success", "Other ways to ask each one are under it. Pick the one you would say.");
    } catch (e) {
      if (!sharpenAbort.current?.signal.aborted) toast("error", (e as Error).message);
    } finally {
      if (!only) {
        sharpenAbort.current = null;
        setSharpening(false);
      }
      setVersioningIds((v) => v.filter((id) => !ids.includes(id)));
    }
  }
  const [settingUp, setSettingUp] = useState(false);

  /**
   * Questions in the bank that say their setup again ("Two thirds of you
   * can't measure MSL performance. So how...") after a setup that just gave
   * the room that figure. The repeat comes out, the rest keeps its words.
   * The bank only: what is in the list is the writer's, and that one gets the
   * shorter wording offered as a version instead.
   */
  const [tidying, setTidying] = useState(false);

  /**
   * Sorts every question by its subject. Each batch named its own groups,
   * so like questions were scattered across "Measuring it", "Measuring the
   * value" and "The hard ground". Group and rank change; nothing else does,
   * and Undo puts the old groups back.
   */
  const [regrouping, setRegrouping] = useState(false);
  const [undoGroups, setUndoGroups] = useState<{ id: string; category: string; rank: number }[] | null>(null);
  async function regroup() {
    if (blocked()) return;
    const targets = [...live].sort((a, b) => a.rank - b.rank);
    if (targets.length < 2) return;
    setRegrouping(true);
    try {
      const res = await fetch("/api/meeting/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          action: "regroup",
          meeting: payloadOf(m),
          items: targets.map((q) => ({ text: q.text, setup: stripAskedQuestion(q.setup, q.text) })),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not regroup them");
      const groups: { name: string; indices: number[] }[] = json.groups || [];
      const at = new Map<string, { category: string; rank: number }>();
      let rank = 1;
      for (const g of groups) for (const i of g.indices) if (targets[i]) at.set(targets[i].id, { category: g.name, rank: rank++ });
      if (!at.size) throw new Error("Could not regroup them");
      setUndoGroups(targets.map((q) => ({ id: q.id, category: q.category, rank: q.rank })));
      const fresh = latest.current.questions?.items || [];
      save({
        questions: {
          ...latest.current.questions,
          items: fresh.map((x) => (at.has(x.id) ? { ...x, ...at.get(x.id)! } : x)),
        },
      });
      setOpenCats(new Set(groups.map((g) => g.name)));
      toast("success", `Sorted into ${groups.length} groups by subject. Undo is at the top of the bank.`);
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setRegrouping(false);
    }
  }
  function undoRegroup() {
    if (!undoGroups) return;
    const was = new Map(undoGroups.map((u) => [u.id, u]));
    setItems(items.map((x) => (was.has(x.id) ? { ...x, category: was.get(x.id)!.category, rank: was.get(x.id)!.rank } : x)));
    setUndoGroups(null);
  }
  async function tidyRepeats() {
    if (blocked()) return;
    const targets = live.filter((q) => q.source !== "user" && stripAskedQuestion(q.setup, q.text));
    if (!targets.length) return;
    setTidying(true);
    try {
      const res = await fetch("/api/meeting/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ action: "trim", items: targets.map((q) => ({ setup: stripAskedQuestion(q.setup, q.text), text: q.text })) }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not check them");
      const texts: string[] = json.texts || [];
      const byId = new Map<string, string>(targets.map((q, i) => [q.id, texts[i] || ""] as [string, string]).filter(([, t]) => t));
      const fresh = latest.current.questions?.items || [];
      let bank = 0;
      let list = 0;
      save({
        questions: {
          ...latest.current.questions,
          items: fresh.map((x) => {
            const t = byId.get(x.id);
            if (!t) return x;
            if (!x.picked) {
              bank++;
              return { ...x, text: t, options: [{ kind: "Yours before", text: x.text, followUp: x.followUp }, ...(x.options || [])] };
            }
            list++;
            return { ...x, options: [{ kind: "Without the repeat", text: t, followUp: x.followUp, forWhom: x.forWhom }, ...(x.options || [])] };
          }),
        },
      });
      toast(
        "success",
        bank || list
          ? `${bank ? `Took the repeat out of ${bank} in the bank. ` : ""}${list ? `${list} in your list have a shorter version under "other ways".` : ""}`
          : "None of them repeat their setup.",
      );
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setTidying(false);
    }
  }


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

  // The meeting as it is now, for saves that land after a wait.
  const latest = useRef(m);
  useEffect(() => {
    latest.current = m;
  }, [m]);
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

  // Every question there is, for the search box: the list in its order, the
  // bank, and the drafts on the Reading tab nobody has dealt with yet.
  const searchPool = useMemo((): SearchHit[] => {
    const extra = (q: { followUp?: string; why?: string; category?: string; options?: { text: string }[] }) =>
      [q.followUp, q.why, q.category, ...(q.options || []).map((o) => o.text)].filter(Boolean).join(" ");
    return [
      ...picked.map((q, i) => ({ key: q.id, kind: "list" as const, where: `Your list, ${i + 1}`, text: q.text, setup: stripAskedQuestion(q.setup, q.text), extra: extra(q), q })),
      ...live
        .filter((q) => !q.picked)
        .map((q) => ({ key: q.id, kind: "bank" as const, where: `Bank: ${q.category}`, text: q.text, setup: stripAskedQuestion(q.setup, q.text), extra: extra(q), q })),
      ...(m.reading?.sources || []).flatMap((src) =>
        (src.questions || [])
          .filter((d) => !d.done)
          .map((d) => ({
            key: d.id,
            kind: "draft" as const,
            where: `Reading: ${src.title.length > 50 ? `${src.title.slice(0, 50)}…` : src.title}`,
            text: d.text,
            setup: stripAskedQuestion(d.setup, d.text),
            extra: extra(d),
            draft: { sourceId: src.id, d },
          })),
      ),
    ];
  }, [picked, live, m.reading]);

  /** Opens a question where it is and brings it into view. */
  function showQuestion(id: string) {
    const q = items.find((x) => x.id === id);
    if (!q) return;
    setWhoFilter(null);
    setOpenRows((v) => new Set([...v, id]));
    if (!q.picked) setOpenCats((prev) => new Set([...(prev ?? (categories[0] ? [categories[0][0]] : [])), q.category]));
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const el = document.querySelector(`[data-qrow="${id}"]`);
        el?.scrollIntoView({ block: "center", behavior: "smooth" });
        el?.classList.add("ring-2", "ring-[var(--accent)]");
        setTimeout(() => el?.classList.remove("ring-2", "ring-[var(--accent)]"), 1600);
      }),
    );
  }

  /** A draft from the Reading tab, straight into the list or the bank. */
  function addDraft(sourceId: string, d: SourceDraft, toList: boolean) {
    const fresh = latest.current;
    const all = fresh.questions?.items || [];
    const src = (fresh.reading?.sources || []).find((x) => x.id === sourceId);
    const markDone = (done: SourceDraft["done"]) => ({
      ...(fresh.reading || {}),
      sources: (fresh.reading?.sources || []).map((x) =>
        x.id === sourceId ? { ...x, questions: (x.questions || []).map((y) => (y.id === d.id ? { ...y, done } : y)) } : x,
      ),
    });
    const dup = sameQuestion(all, d.text);
    if (dup) {
      const order = all.filter((q) => q.picked).reduce((n, q) => Math.max(n, q.order + 1), 0);
      save({
        questions: { ...fresh.questions, items: all.map((q) => (q.id === dup.id && toList && !q.picked ? { ...q, picked: true, order } : q)) },
        reading: markDone(toList ? "list" : "bank"),
      });
      toast("info", dup.picked ? "That one is already in your list." : toList ? "It was in the bank, so it has moved to your list." : "That one is already in the bank.");
      return;
    }
    const item: QuestionItem = {
      id: newId(),
      setup: d.setup,
      text: d.text,
      why: d.why || "",
      followUp: d.followUp || "",
      forWhom: d.forWhom || "",
      category: d.category || "Questions",
      sourceNote: src ? `${[src.outlet, src.date].filter(Boolean).join(", ")}${src.outlet || src.date ? ": " : ""}${src.title}` : undefined,
      rank: all.reduce((n, q) => Math.max(n, q.rank), 0) + 1,
      picked: toList,
      backup: false,
      asked: false,
      order: toList ? all.filter((q) => q.picked).reduce((n, q) => Math.max(n, q.order + 1), 0) : 0,
      source: "ai",
      options: d.options,
      optionChosen: d.optionChosen,
      askWho: d.askWho,
    };
    save({ questions: { ...fresh.questions, items: [...all, item] }, reading: markDone(toList ? "list" : "bank") });
    toast("success", toList ? "Added to your list." : "Added to the bank.");
  }

  /** Before adding a question: is it here already? Handles it and says so. */
  /** A kept second question becomes a card of its own, straight after the first. */
  function splitOff(q: QuestionItem, o: QuestionOption) {
    if (alreadyHere(o.text)) return;
    setItems(
      items.flatMap((x) =>
        x.id !== q.id
          ? [x]
          : [
              { ...x, options: (x.options || []).filter((c) => !sameOption(c, o)) },
              {
                ...x,
                id: newId(),
                text: o.text,
                followUp: o.followUp || x.followUp,
                setup: o.setup || x.setup,
                forWhom: o.forWhom || x.forWhom,
                options: undefined,
                suggested: undefined,
                optionChosen: undefined,
                mustAsk: false,
                backup: false,
                asked: false,
                rank: 0,
                order: x.order + 0.5,
              },
            ],
      ),
    );
  }

  function alreadyHere(text: string): boolean {
    const dup = sameQuestion(items, text);
    if (!dup) return false;
    if (dup.picked) {
      toast("info", "That question is already in your list.");
    } else {
      pick(dup);
      toast("success", "That one was in the bank, so it has moved to your list.");
    }
    return true;
  }

  function pick(q: QuestionItem) {
    const maxOrder = picked.length ? Math.max(...picked.map((p) => p.order)) : -1;
    patch(q.id, { picked: true, order: maxOrder + 1 });
  }

  const panel = panelNames(m.attendees);
  const timing: Timing = {
    pace,
    reactions: m.questions?.reactions ?? 1,
    qaMin: m.questions?.qaMin ?? (m.meeting_type === "panel" ? 5 : 0),
    introMin: m.questions?.introMin ?? (m.meeting_type === "panel" ? 1 : 0),
  };
  const [ordering, setOrdering] = useState(false);
  // One AI job at a time. Two at once (ordering, then a read-through) queued
  // up behind each other with no sign of which had finished, so while one
  // runs every other is greyed out and the page says what is running.
  const runningLabel = busy
    ? busyLabel || "Writing questions"
    : ordering
      ? "Ordering your list"
      : sharpening
        ? "Writing other ways to ask each question"
        : settingUp || settingUpId
          ? "Writing setups"
          : tidying
            ? "Taking out repeats"
            : regrouping
              ? "Sorting the bank by subject"
              : review.reviewing
                ? "Checking it over"
                : fillingAll || fillingId
                  ? "Writing probes"
                  : versioningIds.length
                    ? "Writing other ways to ask it"
                    : helping
                      ? "Writing your question"
                      : resizing
                        ? "Reworking your questions"
                        : "";
  const working = Boolean(runningLabel);
  const blocked = () => {
    if (!working) return false;
    toast("info", `${runningLabel} first. Try again when it finishes.`);
    return true;
  };
  const [undoOrder, setUndoOrder] = useState<{ id: string; order: number; section?: string }[] | null>(null);

  /** The list in conversation order, in named stretches; the old order kept for Undo. */
  async function orderList() {
    if (blocked()) return;
    const list = picked;
    setOrdering(true);
    try {
      const res = await fetch("/api/meeting/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          action: "order",
          meeting: payloadOf(m),
          items: list.map((q) => ({ text: q.text, setup: q.setup, forWhom: q.forWhom, askWho: q.askWho, section: q.section })),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not order the list");
      const order: { index: number; section: string }[] = json.order || [];
      const at = new Map(order.map((o, k) => [list[o.index]?.id, { order: k, section: o.section }]));
      setUndoOrder(list.map((q) => ({ id: q.id, order: q.order, section: q.section })));
      const fresh = latest.current.questions?.items || [];
      save({
        questions: {
          ...latest.current.questions,
          items: fresh.map((x) => (at.has(x.id) ? { ...x, order: at.get(x.id)!.order, section: at.get(x.id)!.section || undefined } : x)),
        },
      });
      toast("success", "Ordered for the conversation. Drag anything to move it, or Undo.");
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setOrdering(false);
    }
  }
  function undoOrdering() {
    if (!undoOrder) return;
    const was = new Map(undoOrder.map((u) => [u.id, u]));
    setItems(items.map((x) => (was.has(x.id) ? { ...x, order: was.get(x.id)!.order, section: was.get(x.id)!.section } : x)));
    setUndoOrder(null);
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
  /**
   * The call itself, for one question. Returns what to merge into it, or
   * null when there was nothing worth adding. Throws so the caller can say
   * so — one on its own is a toast, one of twenty is a tally.
   */
  async function fetchProbe(q: QuestionItem): Promise<Partial<QuestionItem> | null> {
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
        research: withReading(researchStale ? "" : m.brief?.research?.notes || "", m),
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
    if (!followUp && !sourceNote) return null;
    return {
      ...(followUp ? { followUp } : {}),
      ...(sourceNote ? { sourceNote } : {}),
      // Into the gaps only. Whatever they filled in themselves stands.
      ...(why && !q.why ? { why } : {}),
      ...(forWhom && !q.forWhom ? { forWhom } : {}),
    };
  }

  async function fillOut(q: QuestionItem, base?: QuestionItem[]) {
    // Called on its own after a typed question goes in: skipped, not
    // queued, while something else runs.
    if (working) return;
    setFillingId(q.id);
    try {
      const p = await fetchProbe(q);
      if (!p) {
        toast("info", "Nothing worth adding to that one.");
        return;
      }
      setItems((base || items).map((x) => (x.id === q.id ? { ...x, ...p } : x)));
      toast(
        "success",
        p.sourceNote ? "Probe written, with a source from the research" : "Probe written",
      );
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setFillingId(null);
    }
  }

  /**
   * Doing what a read-through note says, to the questions it named.
   *
   * Only two things are ever done here, and both are reversible. "bin" sends
   * the duplicates to the bin, which is not deletion — the bin keeps them and
   * says so — and it only ever touches the ones the note listed, never the
   * one it said to keep. "rewrite" sends each named question back through the
   * single-question rewrite with the note's fix as the instruction, so it is
   * swapped in place and keeps its spot in the running order.
   *
   * Order advice gets no button at all. Rearranging someone's list out from
   * under them is worse than telling them where to drag it.
   */
  async function applyQuestionNote(n: ReviewNote) {
    const ids = (n.questionIds || []).filter((id) => live.some((q) => q.id === id));
    if (!ids.length) {
      toast("info", "Those questions are not in the list any more.");
      return;
    }
    // A probe note changes the probe and nothing else: sent through the
    // rewrite, it would have replaced a question they had finished.
    if (n.action === "probe" && n.probe) {
      setItems(items.map((q) => (ids.includes(q.id) ? { ...q, followUp: n.probe! } : q)));
      review.patchNote(n.id, { done: true });
      toast("success", "Probe changed");
      return;
    }
    if (n.action === "bin") {
      setItems(items.map((q) => (ids.includes(q.id) ? { ...q, deleted: true, picked: false } : q)));
      review.patchNote(n.id, { done: true });
      toast("success", `${ids.length} sent to the bin — open it to get one back`);
      return;
    }
    if (n.action === "rewrite") {
      review.patchNote(n.id, { done: true });
      // One at a time, because each is a replacement for a specific question
      // and `generate` slots it back into that question's own place.
      for (const id of ids) {
        await generate({
          onlyId: id,
          focus: n.fix,
          label: ids.length > 1 ? `Rewriting ${ids.length} questions` : "Rewriting that one",
        });
      }
    }
  }

  /**
   * Every question that went in without a probe, in one go.
   *
   * One at a time is fine for the question you just typed and tedious for the
   * six you typed last week. Each still gets its own call, because a probe is
   * only worth having if it is about that question, and one call asked for
   * six probes writes six versions of the same shrug.
   *
   * They run a few at a time rather than all at once: a bank can be twenty
   * deep, and twenty requests in the same breath is a thundering herd that
   * buys nothing. Results are collected and written ONCE at the end — writing
   * each as it lands would have every save racing the others off a stale list
   * and the last one home would win.
   */
  async function fillMissingProbes() {
    if (blocked()) return;
    const targets = live.filter((q) => !q.followUp);
    if (!targets.length) return;
    setFillingAll(true);
    setFilledCount(0);
    const got = new Map<string, Partial<QuestionItem>>();
    let failed = 0;
    const queue = [...targets];
    await Promise.all(
      Array.from({ length: Math.min(4, queue.length) }, async () => {
        for (let q = queue.shift(); q; q = queue.shift()) {
          try {
            const p = await fetchProbe(q);
            if (p) got.set(q.id, p);
          } catch {
            // One that would not come back should not take the other five
            // with it; it keeps its "Write the probe" line and can be asked
            // again on its own.
            failed++;
          }
          setFilledCount((c) => c + 1);
        }
      }),
    );
    if (got.size) setItems(items.map((x) => ({ ...x, ...(got.get(x.id) || {}) })));
    setFillingAll(false);
    const sourced = [...got.values()].filter((p) => p.sourceNote).length;
    toast(
      got.size ? "success" : "error",
      got.size
        ? `${got.size} probe${got.size === 1 ? "" : "s"} written${
            sourced ? `, ${sourced} with a source` : ""
          }${failed ? ` — ${failed} could not be written` : ""}`
        : "None of them could be written — try again.",
    );
  }

  /**
   * The background in front of questions already in the bank, in one call.
   * Only the setup changes: the call has no way to hand back a question.
   */
  async function addSetups(only?: QuestionItem) {
    if (blocked()) return;
    const targets = only ? [only] : setupTargets.qs;
    if (!targets.length) return;
    setupAbort.current = new AbortController();
    if (only) setSettingUpId(only.id);
    else setSettingUp(true);
    try {
      const res = await fetch("/api/meeting/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          action: "setups",
          meeting: payloadOf(m),
          kolId: m.kol_id || "",
          research: withReading(researchStale ? "" : m.brief?.research?.notes || "", m),
          questions: targets.map((q) => ({ text: q.text, category: q.category, why: q.why })),
          standing: guidance,
          // Asked for this one by name: it gets a setup even if it would
          // have been left bare.
          force: Boolean(only),
        }),
        signal: setupAbort.current.signal,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not write the background");
      const setups: string[] = Array.isArray(json.setups) ? json.setups : [];
      const byId = new Map(targets.map((q, i) => [q.id, String(setups[i] || "")]));
      setItems(items.map((x) => (byId.has(x.id) ? { ...x, setup: byId.get(x.id) } : x)));
      const n = [...byId.values()].filter(Boolean).length;
      toast(
        n || !only ? "success" : "error",
        only
          ? n
            ? "Setup written."
            : "Couldn't write one for that question. Try again."
          : n
            ? `Setups written for ${n} question${n === 1 ? "" : "s"}${
                n < targets.length
                  ? `. ${targets.length - n} work better as a plain question; use "Add a setup" on any you want one for anyway`
                  : ""
              }.`
            : "None of these needed a setup.",
      );
    } catch (e) {
      if (!setupAbort.current?.signal.aborted) toast("error", (e as Error).message);
    } finally {
      setupAbort.current = null;
      setSettingUp(false);
      setSettingUpId(null);
    }
  }

  /**
   * Move a picked question onto another's position. It joins the section of
   * the question it lands on, so a question moved to the top opens the panel
   * rather than sitting above the first heading with none of its own.
   */
  function reorder(id: string, toIndex: number, section?: string) {
    const list = [...picked];
    const from = list.findIndex((q) => q.id === id);
    if (from < 0) return;
    const clamped = Math.max(0, Math.min(list.length - 1, toIndex));
    if (clamped === from && section === undefined) return;
    const [moved] = list.splice(from, 1);
    list.splice(clamped, 0, moved);
    const landedOn = clamped < from ? list[clamped + 1] : list[clamped - 1];
    const nextSection =
      section !== undefined ? section : landedOn && list.some((q) => q.section) ? landedOn.section : moved.section;
    const orderById = new Map(list.map((q, i) => [q.id, i]));
    setItems(
      items.map((q) =>
        q.id === id
          ? { ...q, order: orderById.get(q.id)!, section: nextSection || undefined }
          : orderById.has(q.id)
            ? { ...q, order: orderById.get(q.id)! }
            : q,
      ),
    );
  }
  const reorderRef = useRef(reorder);
  useEffect(() => {
    reorderRef.current = reorder;
  });

  /** The move menu: to the top, one up or down, the bottom, a number, or a section. */
  function moveTo(id: string, where: MoveTarget) {
    const from = picked.findIndex((q) => q.id === id);
    if (from < 0) return;
    if (typeof where === "object") {
      const at = picked.map((q) => q.section).lastIndexOf(where.section);
      reorder(id, at < 0 ? 0 : at >= from ? at : at + 1, where.section);
    } else {
      // Top, bottom and the numbers mean of what is on screen, so "to the top"
      // with Must ask showing makes it the first must-ask.
      const shown = picked.filter(inFilter);
      const here = shown.findIndex((q) => q.id === id);
      const want = where === "top" ? 0 : where === "bottom" ? shown.length - 1 : where === "up" ? here - 1 : where === "down" ? here + 1 : where - 1;
      const target = shown[Math.max(0, Math.min(shown.length - 1, want))];
      if (target) reorder(id, picked.indexOf(target));
    }
    requestAnimationFrame(() =>
      document.querySelector(`[data-qrow="${id}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }),
    );
  }

  /**
   * The cards stay still during a drag: a line shows where it will land and
   * it moves once, on release. Moving the card under the pointer on every
   * step made it jump, and taking the element out of the page dropped the
   * browser's hold on the pointer, so the release never arrived and the card
   * stuck to the mouse. The window listens, so a release lands anywhere.
   */
  function startDrag(id: string, el: HTMLElement, x: number, y: number) {
    const d = drag.current;
    d.stop?.();
    setDragId(id);
    let p: HTMLElement | null = el.parentElement;
    while (p && !(/(auto|scroll)/.test(getComputedStyle(p).overflowY) && p.scrollHeight > p.clientHeight)) p = p.parentElement;
    d.scroller = p;
    d.x = x;
    d.y = y;
    d.drop = null;
    // The rows on screen, which a filter makes a part of the list. Only their
    // order changes: the questions the filter hides stay where they are.
    const ids = [...document.querySelectorAll<HTMLElement>("[data-listrow]")].map((r) => r.dataset.qrow || "");
    const from = ids.indexOf(id);
    const place = () => {
      const rows = [...document.querySelectorAll<HTMLElement>("[data-listrow]")];
      let at = rows.length;
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i].getBoundingClientRect();
        if (d.y < r.top + r.height / 2) {
          at = i;
          break;
        }
      }
      // Either side of itself is where it already is.
      const next = at === from || at === from + 1 ? null : at;
      if (next !== d.drop) {
        d.drop = next;
        setDropAt(next);
      }
    };
    const move = (e: PointerEvent) => {
      d.x = e.clientX;
      d.y = e.clientY;
      place();
    };
    const stop = (commit: boolean) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("keydown", key);
      if (d.timer) window.clearInterval(d.timer);
      d.timer = null;
      d.stop = null;
      document.body.classList.remove("select-none", "cursor-grabbing");
      const at = d.drop;
      d.drop = null;
      setDragId(null);
      setDropAt(null);
      if (commit && at !== null) {
        const list = pickedRef.current;
        // It joins the section of the question it lands above.
        const target = list.find((q) => q.id === (ids[at] ?? ids[ids.length - 1]));
        const slot = list.findIndex((q) => q === target) + (at < ids.length ? 0 : 1);
        const start = list.findIndex((q) => q.id === id);
        reorderRef.current(id, slot > start ? slot - 1 : slot, target?.section || "");
      }
    };
    const up = () => stop(true);
    const cancel = () => stop(false);
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") stop(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", key);
    d.stop = cancel;
    document.body.classList.add("select-none", "cursor-grabbing");
    d.timer = window.setInterval(() => {
      const box = d.scroller ? d.scroller.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
      const step = d.y < box.top + 70 ? -16 : d.y > box.bottom - 70 ? 16 : 0;
      if (!step) return;
      if (d.scroller) d.scroller.scrollBy(0, step);
      else window.scrollBy(0, step);
      place();
    }, 30);
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
    if (blocked()) return;
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
          research: withReading(research, m),
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
          setup: String(q.setup || ""),
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
      if (!opts.onlyId) {
        const seen: QuestionItem[] = [...kept];
        for (let k = fresh.length - 1; k >= 0; k--) {
          if (sameQuestion(seen, fresh[k].text) || fresh.findIndex((f) => sameQuestion([f], fresh[k].text)) !== k) fresh.splice(k, 1);
        }
      }
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
        setOpenCats((prev) => new Set([...(prev ?? []), opts.onlyCategory!]));
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
    <ReadingSources.Provider value={m.reading?.sources || []}>
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
            disabled={working}
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
        <Dropdown variant="primary" align="left" icon={<Sparkles size={14} />} text={busy ? "Working…" : "Add questions"} label="Add questions" width="w-56">
          {(close) => (
            <>
              <MenuItem
                icon={<Sparkles size={13} />}
                disabled={working}
                onClick={() => {
                  close();
                  setGuideScope("more");
                }}
              >
                Write me more
              </MenuItem>
              <MenuItem
                icon={<Wand2 size={13} />}
                onClick={() => {
                  close();
                  setShowHelp(true);
                }}
              >
                Help me write one
              </MenuItem>
              <MenuItem
                icon={<Pencil size={13} />}
                onClick={() => {
                  close();
                  setShowAdd(true);
                }}
              >
                Type one of my own
              </MenuItem>
            </>
          )}
        </Dropdown>
        {/* The jobs done once or twice per meeting, out of the way until
            wanted. Each says what it will touch. */}
        <Dropdown variant="secondary" align="left" icon={<Ellipsis size={14} />} text="More tools" label="More tools" width="w-80">
          {(close) => (
            <>
              <MenuItem
                icon={<Wand2 size={13} />}
                disabled={working || !live.some((q) => !q.options?.length)}
                onClick={() => {
                  close();
                  void sharpen();
                }}
              >
                Other ways to ask each question that has none
              </MenuItem>
              {setupTargets.qs.length > 0 && (
                <MenuItem
                  icon={<BookOpen size={13} />}
                  disabled={working}
                  onClick={() => {
                    close();
                    void addSetups();
                  }}
                >
                  {`Write setups for ${setupTargets.qs.length === 1 ? "1 question" : `${setupTargets.qs.length} questions`} in ${setupTargets.where}`}
                </MenuItem>
              )}
              {missingProbes > 0 && (
                <MenuItem
                  icon={<Sparkles size={13} />}
                  disabled={working}
                  onClick={() => {
                    close();
                    void fillMissingProbes();
                  }}
                >
                  {`Write the ${missingProbes} missing probe${missingProbes === 1 ? "" : "s"}`}
                </MenuItem>
              )}
              <MenuItem
                icon={<Wand2 size={13} />}
                onClick={() => {
                  close();
                  setManyOpen(true);
                }}
              >
                Rework several at once: shorter, longer, or as you say
              </MenuItem>
              <MenuItem
                icon={<ListOrdered size={13} />}
                disabled={working}
                onClick={() => {
                  close();
                  void regroup();
                }}
              >
                Regroup the bank by subject, like with like
              </MenuItem>
              <MenuItem
                icon={<Scissors size={13} />}
                disabled={working}
                onClick={() => {
                  close();
                  void tidyRepeats();
                }}
              >
                Take out questions repeating their setup (the bank)
              </MenuItem>
              <MenuItem
                icon={<Wand2 size={13} />}
                disabled={working}
                onClick={() => {
                  close();
                  setGuideScope("rewrite");
                }}
              >
                Fix how these are written
              </MenuItem>
              <MenuItem
                icon={<Stethoscope size={13} />}
                disabled={working}
                onClick={() => {
                  close();
                  if (!blocked()) void review.runReview();
                }}
              >
                {review.notes.length ? "Check it again" : "Check it over"}
              </MenuItem>
            </>
          )}
        </Dropdown>
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
      {/* Scoring runs eight at a time, then a quick rewrite for each that falls flat. */}
      <Working
        active={sharpening}
        seconds={25 + Math.ceil(live.filter((q) => q.setup).length / 6) * 4}
        label="Writing other ways to ask each question"
        className="px-0.5"
        onCancel={() => {
          sharpenAbort.current?.abort();
          toast("info", "Cancelled.");
        }}
      />
      <Working active={tidying} seconds={25} label="Looking for questions that repeat their setup" className="px-0.5" />
      <Working active={regrouping} seconds={40} label="Sorting the bank by subject" className="px-0.5" />
      {/* Measured: 14 setups in 18s. Longer lists take a little longer. */}
      <Working
        active={settingUp}
        seconds={10 + setupTargets.qs.length}
        label="Writing setups"
        onCancel={() => {
          setupAbort.current?.abort();
          toast("info", "Cancelled.");
        }}
        className="px-0.5"
      />
      {fillingAll && (
        <ProgressBar
          pct={Math.round((filledCount / Math.max(1, missingProbes)) * 100)}
          label={`Writing probes… ${filledCount} of ${missingProbes}`}
          className="px-0.5"
        />
      )}

      <ReviewPanel
        notes={review.notes}
        at={review.at}
        scope="questions"
        busy={working}
        onRerun={() => !blocked() && void review.runReview()}
        rerunning={review.reviewing}
        questionText={(id) => items.find((q) => q.id === id && !q.deleted)?.text}
        questionWhere={(id) => {
          const q = items.find((x) => x.id === id && !x.deleted);
          if (!q) return undefined;
          return q.picked ? `Your list, ${picked.findIndex((x) => x.id === id) + 1}` : `Bank: ${q.category}`;
        }}
        onShowQuestion={showQuestion}
        onFix={(n) => void applyQuestionNote(n)}
        onToggleDone={(n) => review.patchNote(n.id, { done: !n.done })}
        onDismiss={(n) => review.patchNote(n.id, { dismissed: true })}
        onClear={review.clear}
      />

      {/* Standing instructions, folded away. They are set once and then in
          force for good, so a banner quoting them back on every visit is a
          paragraph of the writer's own words between them and their list.
          One line says they are on; opening it is for when you want to
          change one. */}
      {(guidance || coverage) && !showStanding && (
        <button
          onClick={() => setShowStanding(true)}
          className="flex w-full items-center gap-1.5 rounded-lg px-1 py-0.5 text-left text-[11px] text-muted transition hover:text-ink"
        >
          <Wand2 size={12} className="shrink-0 text-[var(--accent)]" />
          <span className="min-w-0 flex-1 truncate">
            {[guidance && "how they're written", coverage && "what to cover"]
              .filter(Boolean)
              .join(" · ")}{" "}
            set
          </span>
          <span className="shrink-0 underline-offset-2 hover:underline">show</span>
        </button>
      )}
      {(guidance || coverage) && showStanding && (
        <div className="space-y-1.5 rounded-lg border border-border bg-canvas/50 px-3 py-2 text-xs text-muted">
          <button
            onClick={() => setShowStanding(false)}
            className="float-right shrink-0 underline-offset-2 hover:underline"
          >
            hide
          </button>
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

      {/* One box for every question: the list, the bank and the drafts on
          the Reading tab. Words match as you type; "Find by topic" finds the
          ones about it in other words. */}
      <SearchAll
        pool={searchPool}
        onGo={(h) => (h.kind === "draft" ? null : showQuestion(h.key))}
        onPick={(h) => {
          if (h.kind === "bank" && h.q) {
            pick(h.q);
            toast("success", "Added to your list.");
          } else if (h.kind === "draft" && h.draft) addDraft(h.draft.sourceId, h.draft.d, true);
        }}
        onBank={(h) => h.kind === "draft" && h.draft && addDraft(h.draft.sourceId, h.draft.d, false)}
      />

      {/* Your list — the questions you carry in, in your order. */}
      <section className="rounded-xl border border-[var(--accent)]/30 bg-surface">
        <div className="flex flex-wrap items-center gap-2 rounded-t-xl border-b border-[var(--accent)]/20 bg-gradient-to-r from-[var(--accent-soft)]/70 to-transparent px-4 py-3">
          <ListChecks size={16} className="shrink-0 text-[var(--accent)]" />
          <h3 className="text-sm font-semibold tracking-tight">Your list</h3>
          <span className="rounded-full bg-[var(--accent)] px-2 py-0.5 text-[11px] font-semibold tabular-nums text-[var(--accent-fg)]">
            {picked.length}
          </span>
          <span className="flex-1" />
          {picked.length > 0 && (
            // Short rows to plan from, or everything open to rehearse from.
            <span className="flex rounded-lg border border-border bg-surface p-0.5 text-xs font-medium">
              {([true, false] as const).map((short) => (
                <button
                  key={String(short)}
                  type="button"
                  onClick={() => setView(short)}
                  className={`rounded-md px-2 py-0.5 transition ${compact === short ? "bg-[var(--accent)] text-[var(--accent-fg)]" : "text-muted hover:text-ink"}`}
                >
                  {short ? "Questions only" : "Everything"}
                </button>
              ))}
            </span>
          )}
          {picked.length > 2 && (
            <span className="flex items-center gap-1">
              <Button
                size="sm"
                variant="secondary"
                disabled={working}
                onClick={() => void orderList()}
                title="Groups similar questions and puts them in the order the conversation should run"
              >
                <ListOrdered size={14} /> {ordering ? "Ordering…" : "Order for the conversation"}
              </Button>
              {undoOrder && (
                <Button size="sm" variant="ghost" onClick={undoOrdering}>
                  <Undo2 size={13} /> Undo
                </Button>
              )}
            </span>
          )}
          {!picked.length && <span className="hidden text-xs text-muted sm:block">Nothing picked yet</span>}
        </div>
        {picked.length > 0 && (
          <TimeBudget
            list={picked}
            panelSize={panel.length || voices}
            timing={timing}
            slot={m.duration_min}
            onTiming={(p) => save({ questions: { ...m.questions, ...p } })}
            onUseAsSlot={(mins) => save({ duration_min: mins })}
          />
        )}
        {picked.length > 0 && (
          // Each name shows only what is put to that person, so planning one
          // person's share of the conversation is one click.
          <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--accent)]/20 px-4 py-2 text-xs">
            <span className="mr-0.5 font-semibold text-muted">Show</span>
            {[
              { key: null as string | null, label: "All", n: picked.length, tip: "Every question in your list" },
              ...panel.map((n) => ({
                key: n as string | null,
                label: n,
                n: picked.filter((q) => askList(q.askWho).includes(n)).length,
                tip: `The questions you are putting to ${n}`,
              })),
              {
                key: "must" as string | null,
                label: "Must ask",
                n: picked.filter((q) => q.mustAsk).length,
                tip: "The questions you starred",
              },
              {
                key: "reserve" as string | null,
                label: "In reserve",
                n: picked.filter((q) => q.backup).length,
                tip: "The questions held back for if there's time",
              },
              {
                key: "none" as string | null,
                label: "Nobody yet",
                n: picked.filter((q) => !askList(q.askWho).length).length,
                tip: "Questions you have not put to anyone yet",
              },
            ].map((c) => (
              <button
                key={c.label}
                type="button"
                title={c.tip}
                onClick={() => setWhoFilter(c.key)}
                className={`rounded-full border px-2 py-0.5 font-medium transition ${
                  whoFilter === c.key
                    ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)]"
                    : "border-border bg-surface text-ink/80 hover:border-[var(--accent)]"
                }`}
              >
                {c.label} <span className="tabular-nums opacity-70">{c.n}</span>
              </button>
            ))}
            {whoFilter && picked.some(inFilter) && (
              <span className="w-full pt-0.5 text-muted">
                Numbered in the order you&apos;ll ask them. Drag to change it; the rest of your list stays where it is.
              </span>
            )}
          </div>
        )}
        <div className="p-3">
        {picked.length === 0 ? (
          <p className="px-1 py-2 text-sm text-muted">
            Press the + on any question below to put it here.
          </p>
        ) : (
          <ol className="space-y-1.5">
            {(() => {
              const sections = [...new Set(picked.map((q) => q.section).filter(Boolean))] as string[];
              const runTime = (sec: string) =>
                picked.filter((q) => q.section === sec && !q.backup).reduce((n, q) => n + minutesFor(q, panel.length, timing), 0);
              const shown = picked
                .map((q, i) => ({ q, i }))
                .filter(({ q }) => inFilter(q));
              if (!shown.length)
                return (
                  <li className="px-1 py-2 text-sm text-muted">
                    {whoFilter === "none"
                      ? "Every question is put to someone."
                      : whoFilter === "must"
                        ? "No must-asks yet. Star the ones you have to get to."
                        : whoFilter === "reserve"
                          ? "Nothing held in reserve."
                          : `Nothing is put to ${whoFilter} yet. Open a question and press their name.`}
                  </li>
                );
              return shown.map(({ q }, k) => {
                const heading = q.section && q.section !== shown[k - 1]?.q.section ? q.section : null;
                const open = !compact || openRows.has(q.id) || editingId === q.id || openNote === q.id;
                const asked = askList(q.askWho);
                const setupText = stripAskedQuestion(q.setup, q.text);
                const versions = choicesOf(q).filter((o) => !o.keep).length;
                return (
                  <Fragment key={q.id}>
                    {heading && (
                      <li className="flex items-baseline gap-2 px-1 pb-0.5 pt-4 first:pt-0">
                        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--accent)]">{heading}</span>
                        <span className="text-[11px] tabular-nums text-muted">~{fmtMin(runTime(heading))} min</span>
                      </li>
                    )}
                    <li
                      data-qrow={q.id}
                      data-listrow
                      className={`group/row rounded-xl border transition ${q.backup ? "bg-canvas/50" : "bg-surface"} ${
                        dropAt === k
                          ? "shadow-[0_-4px_0_0_var(--accent)]"
                          : dropAt === shown.length && k === shown.length - 1
                            ? "shadow-[0_4px_0_0_var(--accent)]"
                            : ""
                      } ${
                        dragId === q.id
                          ? "border-[var(--accent)] opacity-50"
                          : q.mustAsk
                            ? "border-amber-300"
                            : "border-border hover:border-[var(--accent)]/40"
                      }`}
                    >
                      <div className="flex items-start gap-1.5 p-2.5">
                        {/* Pointer events rather than HTML5 drag, so this works
                            with a finger; near the edge it scrolls. */}
                        <button
                          type="button"
                          aria-label="Drag to reorder"
                          title="Drag to reorder, or use the … menu to move it to the top"
                          onPointerDown={(e) => {
                            e.preventDefault();
                            startDrag(q.id, e.currentTarget, e.clientX, e.clientY);
                          }}
                          className="mt-0.5 shrink-0 cursor-grab touch-none rounded-md p-0.5 text-muted/60 transition hover:text-ink active:cursor-grabbing"
                        >
                          <GripVertical size={15} />
                        </button>
                        <span className="mt-px w-6 shrink-0 text-right text-sm font-semibold tabular-nums text-muted">{k + 1}</span>
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
                              {/* Said in this order: the setup, then the question. */}
                              {open && setupText && <p className="mb-1.5 text-sm leading-relaxed text-ink/65">{setupText}</p>}
                              <p
                                onClick={() => compact && toggleRow(q.id)}
                                title={compact ? (open ? "Fold it" : "Open it: setup, probe, who to ask, other ways") : undefined}
                                className={`text-[15px] font-medium leading-snug text-ink ${compact ? "cursor-pointer" : ""}`}
                              >
                                {q.text}
                              </p>
                              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                                {open ? (
                                  <AskWho
                                    forWhom={q.forWhom || ""}
                                    panel={panel}
                                    value={q.askWho}
                                    onChange={(who) => patch(q.id, { askWho: who || undefined })}
                                  />
                                ) : asked.length ? (
                                  asked.map((n) => (
                                    <span key={n} className="rounded bg-[var(--accent)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--accent-fg)]">
                                      {n}
                                    </span>
                                  ))
                                ) : (
                                  <ForChip who={q.forWhom || ""} />
                                )}
                                <span className="tabular-nums" title="Saying it, the first answer, and the others coming in on it">
                                  ~{fmtMin(minutesFor(q, panel.length, timing))} min
                                </span>
                                {q.mustAsk && (
                                  <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">Must ask</span>
                                )}
                                {q.backup && (
                                  <span className="rounded-full bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-800">In reserve</span>
                                )}
                                {!open && (q.options || []).some((o) => o.keep) && (
                                  <button
                                    type="button"
                                    onClick={() => toggleRow(q.id)}
                                    className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800 hover:bg-emerald-100"
                                    title="You kept a second way to ask it. Open the card to swap them."
                                  >
                                    + a second way kept
                                  </button>
                                )}
                                {versioningIds.includes(q.id) && (
                                  <span className="inline-flex items-center gap-1 rounded bg-[var(--accent-soft)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--accent)]">
                                    <Loader2 size={11} className="animate-spin" /> Writing other ways…
                                  </span>
                                )}
                                {!open && compact && (
                                  <button type="button" onClick={() => toggleRow(q.id)} className="inline-flex items-center gap-0.5 text-muted hover:text-ink">
                                    {/* Says what opening it shows. The versions stay behind
                                        their own button, so they are not promised here. */}
                                    {setupText ? "Show the setup" : "Show more"}
                                    {q.note ? " and your note" : ""}
                                    <ChevronDown size={12} />
                                  </button>
                                )}
                              </div>
                              {open && (
                                <>
                                  <ProbeLine
                                    q={q}
                                    busy={fillingId === q.id || (fillingAll && !q.followUp)}
                                    onFill={() => void fillOut(q)}
                                  />
                                  <QuestionChoices
                                    key={`${q.id}:${versions}`}
                                    x={q}
                                    fold
                                    startOpen={freshVersions.has(q.id)}
                                    busy={versioningIds.includes(q.id)}
                                    onPick={(p) => patch(q.id, p)}
                                    onWrite={() => void sharpen([q])}
                                    onSeparate={(o) => splitOff(q, o)}
                                  />
                                  {q.setup === "" && (
                                    <button
                                      type="button"
                                      disabled={working}
                                      onClick={() => void addSetups(q)}
                                      className="mt-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-[var(--accent)] transition hover:bg-[var(--accent-soft)] disabled:opacity-60"
                                    >
                                      <BookOpen size={12} className={settingUpId === q.id ? "animate-pulse" : ""} />
                                      {settingUpId === q.id ? "Writing the setup…" : "Add a setup"}
                                    </button>
                                  )}
                                  <NoteLine q={q} openNote={openNote} setOpenNote={setOpenNote} onPatch={(p) => patch(q.id, p)} />
                                </>
                              )}
                            </>
                          )}
                        </div>
                        {/* Two controls: the star, and one menu for everything
                            else. Six icons on every card was the clutter. */}
                        <div className="-mr-1 flex shrink-0 items-center gap-0.5 sm:mr-0">
                          {/* The star reads as "my favourite, make sure I get
                              to it", so that is what it means. */}
                          <IconBtn
                            label={q.mustAsk ? "No longer a must-ask" : "Must ask: make sure I get to this one"}
                            active={q.mustAsk}
                            onClick={() => patch(q.id, { mustAsk: !q.mustAsk, ...(q.mustAsk ? {} : { backup: false }) })}
                          >
                            <Star size={14} className={q.mustAsk ? "fill-amber-400 text-amber-500" : ""} />
                          </IconBtn>
                          {/* Reserve sits beside the star: the two are the
                              opposite ends of the same decision. */}
                          <IconBtn
                            label={q.backup ? "In reserve. Click to put it back in the running order" : "Hold in reserve: only if there's time"}
                            active={q.backup}
                            onClick={() => patch(q.id, { backup: !q.backup, ...(q.backup ? {} : { mustAsk: false }) })}
                          >
                            <CirclePause size={14} className={q.backup ? "text-sky-600" : ""} />
                          </IconBtn>
                          <Dropdown label="Move it, rework it, add a note…" icon={<Ellipsis size={15} />} width="w-64">
                            {(close) => (
                              <>
                                <MenuItem
                                  icon={<Wand2 size={13} />}
                                  disabled={working}
                                  onClick={() => {
                                    close();
                                    setReworkId(q.id);
                                  }}
                                >
                                  Rework it: other wording or setup
                                </MenuItem>
                                <MenuItem
                                  icon={<StickyNote size={13} />}
                                  onClick={() => {
                                    close();
                                    setOpenNote(q.id);
                                  }}
                                >
                                  {q.note ? "Edit your note" : "Add a note"}
                                </MenuItem>
                                <MenuItem
                                  icon={<Pencil size={13} />}
                                  onClick={() => {
                                    close();
                                    setEditingId(q.id);
                                  }}
                                >
                                  Edit the words
                                </MenuItem>
                                <MenuItem
                                  icon={<Archive size={13} />}
                                  onClick={() => {
                                    close();
                                    unpick(q);
                                    toast("info", "Moved to the bank.");
                                  }}
                                >
                                  Move to the bank
                                </MenuItem>
                                <div className="my-1 border-t border-border" />
                                <MoveItems
                                  index={k}
                                  count={shown.length}
                                  sections={sections}
                                  current={q.section}
                                  onMove={(to) => {
                                    close();
                                    moveTo(q.id, to);
                                  }}
                                />
                              </>
                            )}
                          </Dropdown>
                        </div>
                      </div>
                    </li>
                  </Fragment>
                );
              });
            })()}
          </ol>
        )}
        </div>
      </section>

      {undoGroups && (
        <div className="flex items-center gap-2 px-1 text-xs text-muted">
          <span>The bank is sorted by subject.</span>
          <button type="button" onClick={undoRegroup} className="inline-flex items-center gap-1 font-medium text-ink hover:underline">
            <Undo2 size={12} /> Put the old groups back
          </button>
        </div>
      )}
      {/* Suggestions, grouped. Collapsed by default past the first group so
          the page is skimmable rather than a wall of twenty questions. */}
      {categories.map(([cat, list, inList], catIndex) => {
        const open = openCats ? openCats.has(cat) : catIndex === 0;
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
                    const next = new Set(prev ?? [categories[0][0]]);
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
                disabled={working}
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
                  <li key={q.id} data-qrow={q.id} className="group/row flex items-start gap-3 rounded-lg p-3 transition">
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
                        compact && !openRows.has(q.id) ? (
                          <button type="button" onClick={() => toggleRow(q.id)} className="block w-full text-left" title="Open it: setup, probe, other ways">
                            <p className="text-sm text-ink">{q.text}</p>
                            <span className="mt-1 flex flex-wrap items-center gap-1.5 empty:hidden">
                              {q.forWhom && <ForChip who={q.forWhom} />}
                              {(q.options || []).some((o) => o.keep) && (
                                <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800">
                                  + a second way kept
                                </span>
                              )}
                            </span>
                          </button>
                        ) : (
                        <>
                          <SpokenQuestion
                        q={q}
                        busy={settingUpId === q.id}
                        onAddSetup={() => void addSetups(q)}
                        onPatch={(p) => patch(q.id, p)}
                        versioning={versioningIds.includes(q.id)}
                        onWriteVersions={() => void sharpen([q])}
                        startOpen={freshVersions.has(q.id)}
                        onToggle={compact ? () => toggleRow(q.id) : undefined}
                        onSeparate={(o) => splitOff(q, o)}
                      />
                          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                            <AskWho
                          forWhom={q.forWhom || ""}
                          panel={panel}
                          value={q.askWho}
                          onChange={(who, fw) => patch(q.id, { askWho: who || undefined, ...(fw !== undefined ? { forWhom: fw } : {}) })}
                        />
                            {q.why}
                          </p>
                          <ProbeLine
                            q={q}
                            busy={fillingId === q.id || (fillingAll && !q.followUp)}
                            onFill={() => void fillOut(q)}
                          />
                          <NoteLine q={q} openNote={openNote} setOpenNote={setOpenNote} onPatch={(p) => patch(q.id, p)} />
                        </>
                        )
                      )}
                    </div>
                    <div className="flex shrink-0 items-center">
                      <Dropdown label="Rework, lock, note, edit or bin it" icon={<Ellipsis size={15} />} width="w-64">
                        {(close) => (
                          <>
                            <MenuItem
                              icon={<Plus size={13} />}
                              onClick={() => {
                                close();
                                pick(q);
                              }}
                            >
                              Add to my list
                            </MenuItem>
                            <MenuItem
                              icon={<Wand2 size={13} />}
                              disabled={working}
                              onClick={() => {
                                close();
                                setReworkId(q.id);
                              }}
                            >
                              Rework it: other wording or setup
                            </MenuItem>
                            <MenuItem
                              icon={q.locked ? <Lock size={13} /> : <LockOpen size={13} />}
                              onClick={() => {
                                close();
                                patch(q.id, { locked: !q.locked });
                              }}
                            >
                              {q.locked ? "Unlock: rewrites may change it" : "Lock: keep it through rewrites"}
                            </MenuItem>
                            <MenuItem
                              icon={<StickyNote size={13} />}
                              onClick={() => {
                                close();
                                setOpenRows((v) => new Set([...v, q.id]));
                                setOpenNote(q.id);
                              }}
                            >
                              {q.note ? "Edit your note" : "Add a note"}
                            </MenuItem>
                            <MenuItem
                              icon={<Pencil size={13} />}
                              onClick={() => {
                                close();
                                setEditingId(q.id);
                              }}
                            >
                              Edit the words
                            </MenuItem>
                            <MenuItem
                              icon={<Trash2 size={13} />}
                              onClick={() => {
                                close();
                                patch(q.id, { deleted: true, picked: false });
                                toast("info", "Binned. It's in the bin at the foot of the page.");
                              }}
                            >
                              Bin it
                            </MenuItem>
                          </>
                        )}
                      </Dropdown>
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
          panel={panel}
          onToggleAsked={(q) => patch(q.id, { asked: !q.asked })}
          onResetTicks={() => setItems(items.map((q) => ({ ...q, asked: false })))}
          onUseKept={(q, o) => patch(q.id, swapKept(q, o))}
          minutesOf={(q) => minutesFor(q, panel.length, timing)}
          quickOf={(q) => quickFor(q, panel.length)}
          slotMin={m.duration_min || null}
          leadMin={timing.introMin * panel.length + 1}
          endMin={1 + timing.qaMin}
          clockKey={m.id}
        />
      )}

      <GuidanceModal
        key={`${guideScope}|${guidance}|${coverage}`}
        scope={guideScope}
        busy={working}
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
        onSplit={(setup, text) => reworkId && patch(reworkId, { setup, text })}
        onDismiss={(v) => {
          // Gone for good, unless they kept it: it was saved on the question.
          const q = live.find((x) => x.id === reworkId);
          if (q) patch(q.id, { options: (q.options || []).filter((o) => o.keep || !o.rework || !sameOption(o, v)) });
        }}
        standing={guidance}
        onClose={() => setReworkId(null)}
        onMany={(p) => {
          setReworkId(null);
          setManyPreset({ ...p, n: Date.now() });
          setManyOpen(true);
        }}
        onApply={(text, followUp, setup, forWho) => {
          const q = live.find((x) => x.id === reworkId);
          // Through the same swap as anywhere else, so the words it replaces
          // stay under the question instead of being gone.
          if (q) patch(q.id, pickOption(q, { kind: "Reworked", text, followUp, setup, forWhom: forWho || undefined }));
          setReworkId(null);
          toast("success", "Swapped in");
        }}
        onAdd={(text, followUp, setup, forWho) => {
          // Kept under this question, the same as "Keep both". It used to make
          // a new card at the end of the list, so nothing appeared here, and a
          // version with a new setup was turned away as a duplicate of itself.
          const id = reworkId;
          if (!id) return;
          const fresh = latest.current.questions?.items || [];
          save({
            questions: {
              ...latest.current.questions,
              items: fresh.map((x) => {
                if (x.id !== id) return x;
                const have = x.options || [];
                const it = { text, setup };
                return {
                  ...x,
                  options: have.some((o) => sameOption(o, it))
                    ? have.map((o) => (sameOption(o, it) ? { ...o, keep: true } : o))
                    : [...have, { kind: "Kept", text, followUp, setup: setup || undefined, forWhom: forWho, keep: true, rework: true }],
                };
              }),
            },
          });
          toast("success", "Kept under this question");
        }}
        onSave={(vs) => {
          // Kept on the question: closing the window used to lose them.
          const id = reworkId;
          if (!id) return;
          const fresh = latest.current.questions?.items || [];
          const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
          save({
            questions: {
              ...latest.current.questions,
              items: fresh.map((x) => {
                if (x.id !== id) return x;
                const have = x.options || [];
                const stamp = Date.now();
                const add = vs
                  .filter((v) => !have.some((o) => norm(o.text) === norm(v.text) && norm(o.setup || "") === norm(v.setup || "")))
                  .map((v) => ({
                    kind: v.angle,
                    text: v.text,
                    followUp: v.followUp,
                    setup: v.setup || undefined,
                    forWhom: v.forWhom,
                    rework: true,
                    changed: v.changed,
                    at: stamp,
                    ...(v.check ? { check: v.check } : {}),
                  }));
                return add.length ? { ...x, options: [...have, ...add] } : x;
              }),
            },
          });
        }}
        fetchVariants={async (q, instruction, extra) => {
          const res = await fetch("/api/meeting/ai", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify({
              action: "variants",
              meeting: payloadOf(m),
              kolId: m.kol_id || "",
              research: withReading(m.brief?.research?.notes || "", m),
              question: {
                text: q.text,
                setup: stripAskedQuestion(q.setup || "", q.text),
                why: q.why,
                followUp: q.followUp,
                category: q.category,
                // Who they are putting it to, so every version stays theirs.
                who: q.askWho || (q.forWhom && !/^everyone$/i.test(q.forWhom) ? q.forWhom : ""),
              },
              // Their list numbered as on screen, so "question four" means
              // their number 4, then the bank. Numbered from the bank, as it
              // was, "question four" pointed at some other question.
              others: [
                ...picked.map((x, i) => `${i + 1}. ${x.text}${x.id === q.id ? "  (THIS ONE)" : ""}`),
                ...live.filter((x) => !x.picked && x.id !== q.id).map((x) => `Bank: ${x.text}`),
              ],
              count: extra?.count || 3,
              avoid: extra?.avoid || [],
              part: extra?.part || "auto",
              length: extra?.length || "same",
              keep: extra?.keep || [],
              drop: extra?.drop || [],
              guidance: instruction,
              standing: guidance,
            }),
          });
          const json = await res.json();
          if (!res.ok) throw new Error(json.error || "Could not rework that one");
          return json.variants || [];
        }}
      />

      <ReworkManyModal
        key={manyPreset.n}
        preset={manyPreset}
        meetingId={m.id}
        open={manyOpen}
        onClose={() => setManyOpen(false)}
        list={picked}
        bank={live.filter((q) => !q.picked)}
        working={working}
        claim={() => {
          if (blocked()) return false;
          setResizing(true);
          return true;
        }}
        release={() => setResizing(false)}
        fetchMany={async (list, opts) => {
          const res = await fetch("/api/meeting/ai", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify({
              action: "rework_many",
              meeting: payloadOf(m),
              research: withReading(m.brief?.research?.notes || "", m),
              items: list.map((q) => ({ setup: stripAskedQuestion(q.setup || "", q.text), text: q.text })),
              ...opts,
              standing: guidance,
            }),
          });
          const json = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(json.error || "Could not rework them");
          return (json.results || []) as ({ setup: string; text: string } | { why: string })[];
        }}
        onApply={(done) => {
          // Through the same swap as picking a version, so what it replaces
          // stays under the question as another way to ask it.
          const byId = new Map(done.map((d) => [d.id, d]));
          const fresh = latest.current.questions?.items || [];
          save({
            questions: {
              ...latest.current.questions,
              items: fresh.map((x) => {
                const d = byId.get(x.id);
                return d ? { ...x, ...pickOption(x, { kind: "Reworked", text: d.text, followUp: x.followUp, setup: d.setup }) } : x;
              }),
            },
          });
          toast("success", done.length === 1 ? "Changed" : `${done.length} changed`);
        }}
      />

      <HelpWriteModal
        open={showHelp}
        onClose={() => setShowHelp(false)}
        rough={helpRough}
        onRough={setHelpRough}
        working={working}
        isHere={(text) => Boolean(sameQuestion(items, text))}
        fetchQuestions={async (rough, avoid) => {
          if (blocked()) return null;
          setHelping(true);
          try {
            const res = await fetch("/api/meeting/ai", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "same-origin",
              body: JSON.stringify({
                action: "variants",
                rough: true,
                meeting: payloadOf(m),
                kolId: m.kol_id || "",
                research: withReading(m.brief?.research?.notes || "", m),
                question: { text: rough },
                groups: allCategories,
                others: [
                  ...picked.map((x, i) => `${i + 1}. ${x.text}`),
                  ...live.filter((x) => !x.picked).map((x) => `Bank: ${x.text}`),
                ],
                count: 3,
                avoid,
                standing: guidance,
              }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || "Could not write that one");
            return (json.variants || []) as QuestionVariant[];
          } finally {
            setHelping(false);
          }
        }}
        onAdd={(v, toList) => {
          if (sameQuestion(items, v.text)) {
            if (toList) alreadyHere(v.text);
            else toast("info", "You already have that question.");
            return;
          }
          const fresh: QuestionItem = {
            id: newId(),
            text: v.text,
            category: allCategories.includes(v.group || "") ? v.group! : "Mine",
            why: "",
            followUp: v.followUp,
            setup: v.setup || "",
            forWhom: v.forWhom || "",
            rank: 0,
            picked: toList,
            backup: false,
            asked: false,
            order: toList ? (picked.length ? Math.max(...picked.map((p) => p.order)) : -1) + 1 : items.length,
            // Theirs: "Rewrite them" must not replace it.
            source: "user",
          };
          const next = [...items, fresh];
          setItems(next);
          toast("success", toList ? "Added to the end of your list" : "Added to the bank");
          if (!v.followUp) void fillOut(fresh, next);
        }}
      />

      <AddOwnModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        categories={allCategories}
        onHelp={(text) => {
          setHelpRough(text);
          setShowAdd(false);
          setShowHelp(true);
        }}
        onAdd={(text, category, followUp, forWhom, setup) => {
          if (alreadyHere(text)) {
            setShowAdd(false);
            return;
          }
          const maxOrder = picked.length ? Math.max(...picked.map((p) => p.order)) : -1;
          const fresh: QuestionItem = {
            id: newId(),
            text,
            category: category || "Mine",
            why: "",
            followUp,
            forWhom,
            ...(setup ? { setup } : {}),
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
    </ReadingSources.Provider>
  );
}

interface WrittenShape {
  id: string;
  setup?: string;
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
type Timing = { pace: number; reactions: number; qaMin: number; introMin: number };

const words = (t?: string) => (t || "").split(/\s+/).filter(Boolean).length;
const fmtMin = (n: number) => (Math.round(n * 2) / 2).toString();

/**
 * How long one question really takes on a panel: saying the setup and the
 * question (about 150 words a minute), the first answer, then the others
 * who come in on it at about a minute and a half each. Only a question put
 * to the whole panel (asked of all of them, or worded "to all in turn") is
 * everyone answering. "For Everyone" means any of them could take it, and
 * counting that as four answers put eight minutes on most of the list.
 */
/** Put to the whole panel, each of them answering in turn. */
function isToAll(q: QuestionItem, panelSize: number): boolean {
  const asked = askList(q.askWho).length;
  return (panelSize > 1 && asked >= panelSize) || (!asked && /\b(to all in turn|each of you|go down the line|all of you|everyone in turn)\b/i.test(q.text));
}

/**
 * A question to the whole panel asked for "a minute each": what it takes
 * then. Null for one that is not put to all of them.
 */
function quickFor(q: QuestionItem, panelSize: number): number | null {
  if (!isToAll(q, panelSize)) return null;
  return (words(q.setup) + words(q.text)) / 150 + panelSize;
}

function minutesFor(q: QuestionItem, panelSize: number, t: Timing): number {
  const say = (words(q.setup) + words(q.text)) / 150;
  const asked = askList(q.askWho).length;
  const toAll = isToAll(q, panelSize);
  // Put to several by name: each of them answers, then the usual others come in.
  const others = toAll ? Math.max(0, panelSize - 1) : asked > 1 ? asked - 1 + t.reactions : t.reactions;
  return say + t.pace + others * 1.5;
}

function TimeBudget({
  list,
  panelSize,
  timing,
  slot,
  onTiming,
  onUseAsSlot,
}: {
  list: QuestionItem[];
  panelSize: number;
  timing: Timing;
  slot?: number | null;
  onTiming: (p: Partial<Timing & { paceMin: number }>) => void;
  onUseAsSlot: (minutes: number) => void;
}) {
  const [settings, setSettings] = useState(false);
  const asking = list.filter((q) => !q.backup);
  const must = asking.filter((q) => q.mustAsk);
  const cost = (qs: QuestionItem[]) => qs.reduce((n, q) => n + minutesFor(q, panelSize, timing), 0);
  const intros = timing.introMin * panelSize;
  const openClose = slot ? 2 : 0;
  const budget = slot ? Math.max(0, slot - intros - openClose - timing.qaMin) : 0;
  // What fits: the must-asks first, then the rest in running order.
  // Must-asks count as fitting only while they do: 47 minutes of them used
  // to read "8 of 10 fit" against a 24 minute budget.
  let used = 0;
  let fit = 0;
  for (const q of [...must, ...asking.filter((x) => !x.mustAsk)]) {
    const c = minutesFor(q, panelSize, timing);
    if (used + c > budget) break;
    used += c;
    fit++;
  }
  const total = cost(asking);
  const mustCost = cost(must);
  const pct = (n: number) => (budget ? Math.min(100, (n / budget) * 100) : 0);
  // The two numbers the moderator asked for: one question to one person,
  // and one the whole panel answers.
  const toOne = 0.3 + timing.pace + timing.reactions * 1.5;
  const toAll = 0.3 + timing.pace + Math.max(0, panelSize - 1) * 1.5;
  const sel =
    "rounded-md border border-border bg-surface px-1.5 py-0.5 text-xs text-muted outline-none focus:border-[var(--accent)]";
  return (
    <div className="border-b border-[var(--accent)]/20 px-4 py-3 text-xs">
      {slot ? (
        <>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <span className="text-sm font-semibold text-ink">
              About {fit} of your {asking.length} questions fit
            </span>
            <span className="text-muted">
              {fmtMin(budget)} of your {slot} min are for questions
            </span>
            <button
              type="button"
              onClick={() => setSettings((v) => !v)}
              className="ml-auto inline-flex items-center gap-1 text-muted hover:text-ink"
            >
              <SlidersHorizontal size={12} /> {settings ? "Hide timing" : "Timing"}
            </button>
          </div>
          <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-canvas" title="Must-asks, then the rest of what fits">
            <div className="bg-amber-400" style={{ width: `${pct(mustCost)}%` }} />
            <div className="bg-[var(--accent)]" style={{ width: `${Math.max(0, pct(used) - pct(mustCost))}%` }} />
          </div>
          <p className="mt-1.5 text-muted">
            {must.length > 0 && (
              <span className={mustCost > budget ? "font-semibold text-amber-700" : "text-ink"}>
                {must.length} must-ask {must.length === 1 ? "takes" : "take"} about {fmtMin(mustCost)} min
                {mustCost > budget
                  ? `, ${fmtMin(mustCost - budget)} too long: only about ${fit} of them fit`
                  : `, leaving ${fmtMin(budget - mustCost)}`}
                .{" "}
              </span>
            )}
            One question to one person runs about {fmtMin(toOne)} min; one the whole panel answers, about {fmtMin(toAll)}.
          </p>
        </>
      ) : (
        <p className="text-ink">
          All {asking.length} take about {fmtMin(total)} min.{" "}
          <button type="button" onClick={() => onUseAsSlot(Math.round(total))} className="font-medium text-[var(--accent)] hover:underline">
            Use as the meeting length
          </button>
        </p>
      )}
      {/* The assumptions, in the open and adjustable, so the total can be
          checked against how this panel actually runs. */}
      {(settings || !slot) && (
        <div className="mt-2 space-y-1.5 rounded-lg bg-canvas px-3 py-2 text-muted">
          <div className="flex flex-wrap items-center gap-1.5">
            <span>First answer</span>
            <select value={timing.pace} onChange={(e) => onTiming({ paceMin: Number(e.target.value) })} className={sel}>
              {[1.5, 2, 2.5, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n} min
                </option>
              ))}
            </select>
            <span>then</span>
            <select value={timing.reactions} onChange={(e) => onTiming({ reactions: Number(e.target.value) })} className={sel}>
              {[0, 1, 2, 3].map((n) => (
                <option key={n} value={n}>
                  {n === 0 ? "nobody else" : `${n} more`}
                </option>
              ))}
            </select>
            <span>come in, about 1.5 min each.</span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span>Introductions</span>
            <select value={timing.introMin} onChange={(e) => onTiming({ introMin: Number(e.target.value) })} className={sel}>
              {[0, 0.5, 1, 2].map((n) => (
                <option key={n} value={n}>
                  {n} min each
                </option>
              ))}
            </select>
            <span>Audience questions</span>
            <select value={timing.qaMin} onChange={(e) => onTiming({ qaMin: Number(e.target.value) })} className={sel}>
              {[0, 5, 10, 15].map((n) => (
                <option key={n} value={n}>
                  {n === 0 ? "none" : `${n} min`}
                </option>
              ))}
            </select>
          </div>
          {slot ? (
            <p>
              Of your {slot} min: {fmtMin(intros)} for introductions, {openClose} to open and close
              {timing.qaMin ? `, ${timing.qaMin} for audience questions` : ""}. The whole list would take about {fmtMin(total)}.
            </p>
          ) : null}
        </div>
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
      {q.sourceNote && <SourceLine note={q.sourceNote} />}
    </>
  );
}

/**
 * A question as it is said: the setup, then the question. The question is
 * the darker line, because it is the part that must not be lost when reading
 * at speed; the setup is the run-up to it.
 */
function SpokenQuestion({
  q,
  busy = false,
  onAddSetup,
  onPatch,
  versioning = false,
  onWriteVersions,
  onSeparate,
  startOpen = false,
  onToggle,
}: {
  q: QuestionItem;
  startOpen?: boolean;
  /** Clicking the question closes it again. */
  onToggle?: () => void;
  busy?: boolean;
  onAddSetup?: () => void;
  /** For picking another way to ask it. */
  onPatch?: (p: Partial<QuestionItem>) => void;
  versioning?: boolean;
  onWriteVersions?: () => void;
  onSeparate?: (o: QuestionOption) => void;
}) {
  return (
    <>
      {stripAskedQuestion(q.setup, q.text) && (
        <p className="mb-1 text-sm leading-relaxed text-ink/70">{stripAskedQuestion(q.setup, q.text)}</p>
      )}
      <p
        onClick={onToggle}
        title={onToggle ? "Click to close" : undefined}
        className={`text-sm text-ink ${q.setup ? "font-medium" : ""} ${onToggle ? "cursor-pointer" : ""}`}
      >
        {q.text}
      </p>
      {/* Other ways to ask it under the same setup; picking one swaps it in. */}
      {onPatch && (
        <QuestionChoices
          key={`${q.id}:${choicesOf(q).length}`}
          x={q}
          fold
          startOpen={startOpen}
          busy={versioning}
          onPick={(p) => onPatch(p)}
          onWrite={onWriteVersions}
          onSeparate={onSeparate}
        />
      )}
      {/* Left bare on purpose ("") is a judgement, and the writer may not
          share it. One click overrules it. */}
      {q.setup === "" && onAddSetup && (
        <button
          type="button"
          disabled={busy}
          onClick={onAddSetup}
          className="mt-0.5 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-[var(--accent)] transition hover:bg-[var(--accent-soft)] disabled:opacity-60"
        >
          <BookOpen size={12} className={busy ? "animate-pulse" : ""} />
          {busy ? "Writing the setup…" : "Add a setup"}
        </button>
      )}
    </>
  );
}

/** "Source: ..." and, when it is on the reading list, the piece itself. */
function SourceLine({ note }: { note: string }) {
  const sources = useContext(ReadingSources);
  const hit = useMemo(() => matchSource(note, sources), [note, sources]);
  return (
    <p className="mt-1 text-xs text-muted">
      Source: {note}
      {hit?.url && (
        <>
          {" "}
          <a
            href={hit.url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-[var(--accent)] hover:underline"
            title={hit.title}
          >
            Read it
          </a>
        </>
      )}
    </p>
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
  onAdd,
  onSave,
  fetchVariants,
  onMany,
  onSplit,
  onDismiss,
}: {
  q: QuestionItem | null;
  /** Takes a version they do not want off the question. */
  onDismiss: (v: QuestionVariant) => void;
  /** Makes the lead-in typed into the question its setup. */
  onSplit: (setup: string, text: string) => void;
  /** Their standing instruction, shown so they know it is still on. */
  standing: string;
  onClose: () => void;
  onApply: (text: string, followUp: string, setup?: string, forWhom?: string) => void;
  /** Keep a version under the question as well as, rather than instead of, what is there. */
  onAdd: (text: string, followUp: string, setup?: string, forWhom?: string) => void;
  /** Keeps what came back on the question, so it is there next time. */
  onSave: (vs: QuestionVariant[]) => void;
  fetchVariants: (
    q: QuestionItem,
    instruction: string,
    extra?: { count?: number; avoid?: string[]; part?: ReworkPart; length?: ReworkLength; keep?: string[]; drop?: string[] },
  ) => Promise<QuestionVariant[]>;
  /** The same choices, for every question in the list. */
  onMany: (p: Omit<ManyPreset, "n">) => void;
}) {
  const [instruction, setInstruction] = useState("");
  // What came back last time, kept on the question, is here again.
  const saved = (q?.options || []).filter((o) => o.rework);
  // The last round, when it was written in the last little while: reopened
  // after a reload, it is still the one they were looking at.
  const lastAt = Math.max(0, ...saved.map((o) => o.at || 0));
  const [fresh, setFresh] = useState(() =>
    lastAt > Date.now() - 30 * 60 * 1000 ? saved.filter((o) => o.at === lastAt).length : 0,
  );
  const [options, setOptions] = useState<QuestionVariant[]>(() =>
    // Saved in the order written, so newest is last; shown newest first.
    saved
      .map((o, i) => ({ o, i }))
      // Newer rounds first; inside a round, the order it came in.
      .sort((a, b) => (b.o.at || 0) - (a.o.at || 0) || (a.o.at ? a.i - b.i : b.i - a.i))
      .map(({ o }) => o)
      .map((o) => ({
        angle: o.kind,
        text: o.text,
        followUp: o.followUp,
        setup: o.setup,
        // A new setup never changes who answers: older ones were labelled by guess.
        forWhom: o.changed === "setup" ? q?.forWhom : o.forWhom,
        changed: o.changed,
        check: o.check,
      })),
  );
  // Which part to change, and words marked to keep or lose. The writer liked
  // part of a question and had no way to say which part.
  const [part, setPart] = useState<ReworkPart>("auto");
  const [length, setLength] = useState<ReworkLength>("same");
  const [keepWords, setKeepWords] = useState<string[]>([]);
  const [dropWords, setDropWords] = useState<string[]>([]);
  const [sel, setSel] = useState("");
  // The version being edited in place, before using or keeping it.
  const [editIdx, setEditIdx] = useState<number | null>(null);
  // How many at the top came from the last press (declared above, with what
  // is saved), so the new ones can be told from the ones already seen.
  const editOption = (i: number, p: Partial<QuestionVariant>) =>
    setOptions((all) =>
      all.map((o, k) => {
        if (k !== i) return o;
        const n = { ...o, ...p };
        const setupNew = Boolean(n.setup && n.setup !== stripAskedQuestion(q?.setup || "", q?.text || ""));
        const textNew = n.text !== q?.text;
        return { ...n, changed: setupNew && textNew ? "both" : setupNew ? "setup" : "question" };
      }),
    );
  const grabSelection = () => {
    const t = (window.getSelection()?.toString() || "").replace(/\s+/g, " ").trim();
    setSel(t.length >= 2 ? t : "");
  };
  const keptHere = (v: QuestionVariant) => (q?.options || []).some((o) => o.keep && sameOption(o, v));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Shorter or longer is written, then checked against their setup: longer.
  const pct = useProgress(busy, length === "same" ? 20000 : 40000);

  /** "Give me five", "six more": the number they asked for, if any. */
  function askedCount(t: string): number | undefined {
    const w: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };
    const m = t.toLowerCase().match(/\b(\d+|two|three|four|five|six|seven|eight)\s+(?:more\s+)?(?:versions?|questions?|ways|options|more|of them)\b/);
    if (!m) return undefined;
    const n = Number(m[1]) || w[m[1]];
    return n ? Math.min(8, Math.max(1, n)) : undefined;
  }

  /** What is showing stays, with the new ones on top. */
  async function run() {
    if (!q) return;
    setBusy(true);
    setError("");
    try {
      const got = await fetchVariants(q, instruction.trim(), {
        count: askedCount(instruction) || 3,
        avoid: options.map((o) => `${o.setup ? `${o.setup} ` : ""}${o.text}`),
        part,
        length,
        keep: keepWords,
        drop: dropWords,
      });
      if (!got.length)
        throw new Error(
          length !== "same"
            ? `None came out ${length} than what you have. Try again, or say what to ${length === "shorter" ? "cut" : "add"}.`
            : "Nothing usable came back. Try saying it differently.",
        );
      onSave(got);
      // New ones on top; the earlier ones stay underneath rather than vanish.
      setOptions((o) => [...got, ...o]);
      setFresh(got.length);
      setEditIdx((k) => (k === null ? null : k + got.length));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const setupNow = q ? stripAskedQuestion(q.setup || "", q.text) : "";
  // Nothing to cut: asked for a shorter setup on a question with none, it
  // wrote new setups from nothing, and every one came back longer.
  const nothingToShorten = !setupNow && length === "shorter" && part === "setup";
  const sameWho = (w?: string) => !w || (w || "").toLowerCase() === (q?.forWhom || "").toLowerCase();

  return (
    <Modal open={Boolean(q)} onClose={onClose} title="Rework this question" movable resizable size="lg">
      {q && (
        <div className="space-y-4">
          {/* What is there now, each part labelled, so a missing setup reads as missing. */}
          <section
            className="rounded-xl border border-border bg-canvas/60 p-3"
            onMouseUp={grabSelection}
            onTouchEnd={grabSelection}
            onKeyUp={grabSelection}
          >
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <span className="text-xs font-semibold text-ink">What you have now</span>
              <span className="text-[11px] text-muted">about {secondsOf(`${setupNow} ${q.text}`)} sec to say</span>
            </div>
            <ReworkPartText label="Setup" count={setupNow ? words(setupNow) : undefined}>
              {setupNow || <span className="italic text-muted">No setup. The question is said on its own.</span>}
            </ReworkPartText>
            {!setupNow && splitLeadIn(q.text) && (
              // Typed in one box, the lead-in went in with the question and
              // Rework could not see a setup to work on.
              <div className="mt-1.5 rounded-md bg-[var(--accent-soft)] px-2.5 py-1.5 text-xs text-ink">
                The start of your question reads like a setup: &ldquo;{splitLeadIn(q.text)!.setup}&rdquo;{" "}
                <button
                  type="button"
                  onClick={() => {
                    const sp = splitLeadIn(q.text)!;
                    onSplit(sp.setup, sp.text);
                  }}
                  className="font-medium text-[var(--accent)] hover:underline"
                >
                  Make it the setup
                </button>
              </div>
            )}
            <ReworkPartText label="Question" count={words(q.text)} strong>
              {q.text}
            </ReworkPartText>
            {/* Select any words above to keep them or lose them. */}
            {sel ? (
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                <span className="max-w-full truncate text-muted">&ldquo;{sel.length > 70 ? `${sel.slice(0, 70)}…` : sel}&rdquo;</span>
                <button
                  type="button"
                  onClick={() => {
                    setKeepWords((k) => (k.includes(sel) ? k : [...k, sel]));
                    setDropWords((d) => d.filter((x) => x !== sel));
                    setSel("");
                  }}
                  className="rounded-md bg-emerald-100 px-2 py-0.5 font-medium text-emerald-800 hover:bg-emerald-200"
                >
                  Keep these words
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDropWords((d) => (d.includes(sel) ? d : [...d, sel]));
                    setKeepWords((k) => k.filter((x) => x !== sel));
                    setSel("");
                  }}
                  className="rounded-md bg-red-100 px-2 py-0.5 font-medium text-red-800 hover:bg-red-200"
                >
                  Lose these words
                </button>
              </div>
            ) : (
              <p className="mt-2 text-[11px] text-muted">Select any words to keep them or lose them.</p>
            )}
            {(keepWords.length > 0 || dropWords.length > 0) && (
              <div className="mt-1.5 flex flex-wrap gap-1.5 text-xs">
                {keepWords.map((k) => (
                  <span key={`k${k}`} className="inline-flex max-w-full items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-emerald-900">
                    <span className="truncate">Keep: {k}</span>
                    <button type="button" aria-label="Remove" onClick={() => setKeepWords((x) => x.filter((y) => y !== k))}>
                      ×
                    </button>
                  </span>
                ))}
                {dropWords.map((k) => (
                  <span key={`d${k}`} className="inline-flex max-w-full items-center gap-1 rounded-md bg-red-50 px-2 py-0.5 text-red-900">
                    <span className="truncate">Lose: {k}</span>
                    <button type="button" aria-label="Remove" onClick={() => setDropWords((x) => x.filter((y) => y !== k))}>
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </section>

          {/* What to do: which part, how long, anything else. */}
          <section className="space-y-2.5">
            <div className="grid grid-cols-[4.5rem_1fr] items-center gap-x-2 gap-y-2 text-xs">
              <span className="font-medium text-ink">Change</span>
              <Segmented
                value={part}
                onChange={setPart}
                options={[
                  ["setup", "Setup"],
                  ["question", "Question"],
                  ["both", "Both"],
                  ["auto", "As I say below"],
                ]}
              />
              <span className="font-medium text-ink">Length</span>
              <Segmented
                value={length}
                onChange={setLength}
                options={[
                  ["same", "Keep it"],
                  ["shorter", "Shorter"],
                  ["longer", "Longer"],
                ]}
              />
            </div>
            {nothingToShorten && (
              <p className="rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">
                This question has no setup, so there&apos;s nothing to make shorter. Pick Question to shorten the question, or Longer to write it a setup.
              </p>
            )}
            <Textarea
              label="Anything else? (optional)"
              autoFocus
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder={`e.g. "keep the number", "less formal", "make it work for Roman and Mark", "give me five"`}
              className="min-h-14"
            />
            {standing && <p className="text-[11px] text-muted">Your standing instruction still applies: {standing}</p>}
            <div className="flex flex-wrap items-center gap-2">
              <Button disabled={busy || nothingToShorten} onClick={() => void run()}>
                <Wand2 size={14} />
                {busy ? "Writing…" : options.length ? "Write more" : "Show me a few ways"}
              </Button>
              {options.length > 0 && !busy && <span className="text-[11px] text-muted">New ones appear just below.</span>}
            </div>
            {busy && (
              <ProgressBar
                pct={pct}
                label={length === "same" ? "Writing them" : "Writing them, then checking each still says what your setup says. About 40 seconds"}
              />
            )}
            {error && <p className="text-sm text-status-error">{error}</p>}
          </section>

          {options.length > 0 && (
            <ul className="space-y-2">
              {options.map((v, i) => {
                // How it compares with what is there now, part by part.
                const setupNew = v.setup || setupNow;
                const setupChanged = Boolean(v.setup) && v.setup !== setupNow;
                const textChanged = v.text !== q.text;
                const diff = secondsOf(`${setupNow} ${q.text}`) - secondsOf(`${setupNew} ${v.text}`);
                return (
                  <Fragment key={i}>
                    {i === 0 && fresh > 0 && (
                      <li className="pt-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--accent)]">Just written</li>
                    )}
                    {i === fresh && (
                      <li className={`text-[11px] font-semibold uppercase tracking-wide text-muted ${fresh ? "pt-3" : "pt-1"}`}>
                        {fresh ? "From before" : "Written before"}
                      </li>
                    )}
                    <li
                      className={`rounded-xl border bg-surface p-3 ${i < fresh ? "border-[var(--accent)]/50 shadow-sm" : "border-border"}`}
                    >
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-medium text-ink">{v.angle}</span>
                        <span className="ml-auto flex flex-wrap items-center gap-1.5">
                          {!sameWho(v.forWhom) && <ForChip who={v.forWhom || ""} />}
                          {(setupChanged || textChanged) && (
                            <span
                              className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                                diff > 0 ? "bg-emerald-50 text-emerald-800" : diff < 0 ? "bg-amber-50 text-amber-800" : "bg-canvas text-muted"
                              }`}
                            >
                              {diff ? `${Math.abs(diff)} sec ${diff > 0 ? "shorter" : "longer"}` : "Same length"}
                            </span>
                          )}
                          <button
                            type="button"
                            aria-label="Remove this version"
                            title="Remove this version"
                            onClick={() => {
                              onDismiss(v);
                              setOptions((all) => all.filter((_, k) => k !== i));
                              if (i < fresh) setFresh((f) => f - 1);
                              setEditIdx((k) => (k === null || k === i ? null : k > i ? k - 1 : k));
                            }}
                            className="rounded-md p-1 text-muted hover:bg-canvas hover:text-ink"
                          >
                            <X size={14} />
                          </button>
                        </span>
                      </div>
                      {editIdx === i ? (
                        <div className="space-y-1.5">
                          <Textarea
                            label="Setup"
                            value={v.setup ?? ""}
                            placeholder="No setup"
                            onChange={(e) => editOption(i, { setup: e.target.value })}
                            className="min-h-16"
                          />
                          <Textarea
                            label="Question"
                            value={v.text}
                            onChange={(e) => editOption(i, { text: e.target.value })}
                            className="min-h-12 font-medium"
                          />
                        </div>
                      ) : (
                        <>
                          <ReworkPartText
                            label="Setup"
                            count={setupNew ? words(setupNew) : undefined}
                            was={setupChanged ? words(setupNow) : undefined}
                            fresh={setupChanged}
                          >
                            {setupNew || <span className="italic text-muted">No setup</span>}
                          </ReworkPartText>
                          <ReworkPartText
                            label="Question"
                            count={words(v.text)}
                            was={textChanged ? words(q.text) : undefined}
                            fresh={textChanged}
                            strong
                          >
                            {v.text}
                          </ReworkPartText>
                        </>
                      )}
                      {v.check && <p className="mt-1.5 rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-900">{v.check}</p>}
                      {v.followUp && <p className="mt-1.5 text-xs italic text-muted">Probe: {v.followUp}</p>}
                      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-2.5">
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={!v.text.trim()}
                          onClick={() => onApply(v.text.trim(), v.followUp || q.followUp, v.setup?.trim() || undefined, v.forWhom)}
                        >
                          Use this one
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={keptHere(v) || !v.text.trim()}
                          onClick={() => onAdd(v.text.trim(), v.followUp || "", v.setup?.trim() || undefined, v.forWhom)}
                        >
                          {keptHere(v) ? (
                            <>
                              <Check size={13} /> Kept
                            </>
                          ) : (
                            <>
                              <Plus size={13} /> Keep as a backup
                            </>
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            // Starting from the setup there now, so it can be edited rather than retyped.
                            if (editIdx !== i && !v.setup && setupNow) editOption(i, { setup: setupNow });
                            setEditIdx(editIdx === i ? null : i);
                          }}
                        >
                          {editIdx === i ? (
                            <>
                              <Check size={13} /> Done editing
                            </>
                          ) : (
                            <>
                              <Pencil size={13} /> Edit
                            </>
                          )}
                        </Button>
                      </div>
                    </li>
                  </Fragment>
                );
              })}
            </ul>
          )}
          {options.some(keptHere) && (
            <p className="text-xs text-muted">Backups sit under your question, to ask if it falls flat. You can swap one in or edit it there.</p>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
            <button
              type="button"
              onClick={() => onMany({ part, length, instruction: instruction.trim() })}
              className="mr-auto text-xs font-medium text-[var(--accent)] hover:underline"
              title="The same choices for each question in your list, each one shown for you to approve"
            >
              Do this to every question in my list
            </button>
            <Button variant="ghost" onClick={onClose}>
              {options.length ? "Close" : "Keep it as it is"}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/**
 * A question typed with its lead-in, split into the two: the statements
 * before it, and the question itself. Null when there is no lead-in to speak of.
 */
function splitLeadIn(text: string): { setup: string; text: string } | null {
  const parts = text.trim().split(/(?<=[.!])\s+(?=[A-Z])/);
  if (parts.length < 2) return null;
  const last = parts[parts.length - 1];
  const lead = parts.slice(0, -1).join(" ");
  if (!/\?\s*$/.test(last) || /\?/.test(lead) || words(lead) < 6) return null;
  return { setup: lead, text: last };
}

/** One part of a question, labelled, with its length and what it was. */
function ReworkPartText({
  label,
  count,
  was,
  fresh,
  strong,
  children,
}: {
  label: string;
  count?: number;
  was?: number;
  /** This part is new in this version; the other is what is there now. */
  fresh?: boolean;
  strong?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-1.5 first:mt-0">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
        <span>{label}</span>
        {fresh && <span className="rounded bg-[var(--accent-soft)] px-1 text-[var(--accent)]">new</span>}
        {count !== undefined && (
          <span className="font-normal normal-case tracking-normal">
            {count} words{was !== undefined ? `, was ${was}` : ""}
          </span>
        )}
      </div>
      <p className={`mt-0.5 text-sm leading-relaxed ${strong ? "font-medium" : ""} ${fresh === false ? "text-ink/55" : "text-ink"}`}>{children}</p>
    </div>
  );
}

/** A row of choices where one is on. */
function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: [T, string][];
}) {
  return (
    <div className="inline-flex w-fit flex-wrap rounded-lg border border-border bg-canvas p-0.5">
      {options.map(([k, label]) => (
        <button
          key={k}
          type="button"
          aria-pressed={value === k}
          onClick={() => onChange(k)}
          className={`rounded-md px-2.5 py-1 transition ${
            value === k ? "bg-surface font-medium text-ink shadow-sm" : "text-muted hover:text-ink"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}


/**
 * A button that opens a short menu under it. Used for the card's one "…"
 * and the two menus on the toolbar, so nothing needs a row of icons.
 */
function Dropdown({
  label,
  icon,
  text,
  variant,
  align = "right",
  width = "w-60",
  children,
}: {
  label: string;
  icon: React.ReactNode;
  /** With text it is a button; without, an icon. */
  text?: string;
  variant?: "primary" | "secondary" | "ghost";
  align?: "left" | "right";
  width?: string;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <span ref={ref} className="relative inline-flex">
      {text ? (
        <Button size="sm" variant={variant || "secondary"} onClick={() => setOpen((v) => !v)} title={label}>
          {icon} {text} <ChevronDown size={13} className={`transition-transform ${open ? "rotate-180" : ""}`} />
        </Button>
      ) : (
        <IconBtn label={label} active={false} onClick={() => setOpen((v) => !v)}>
          {icon}
        </IconBtn>
      )}
      {open && (
        <div
          className={`absolute top-full z-30 mt-1 ${align === "left" ? "left-0" : "right-0"} ${width} max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-surface p-1 shadow-lg`}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </span>
  );
}

function MenuItem({
  icon,
  onClick,
  disabled,
  children,
}: {
  icon?: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-ink transition hover:bg-canvas disabled:pointer-events-none disabled:opacity-35"
    >
      {icon && <span className="shrink-0 text-muted">{icon}</span>}
      <span className="min-w-0 flex-1">{children}</span>
    </button>
  );
}

type SearchHit = {
  key: string;
  kind: "list" | "bank" | "draft";
  where: string;
  text: string;
  setup?: string;
  /** Probe, group, versions: searched, not shown. */
  extra: string;
  q?: QuestionItem;
  draft?: { sourceId: string; d: SourceDraft };
};

/**
 * Searching every question at once. Words match as you type, on the
 * question, its setup, probe, group and other ways to ask it. "Find by
 * topic" asks the model which ones are about it, for when the words differ.
 */
function SearchAll({
  pool,
  onGo,
  onPick,
  onBank,
}: {
  pool: SearchHit[];
  onGo: (h: SearchHit) => void;
  onPick: (h: SearchHit) => void;
  onBank: (h: SearchHit) => void;
}) {
  const [query, setQuery] = useState("");
  const [topic, setTopic] = useState<{ query: string; hits: { key: string; why: string }[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [where, setWhere] = useState<"all" | "list" | "bank" | "draft">("all");
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  const hay = (h: SearchHit) => `${h.text} ${h.setup || ""} ${h.extra}`.toLowerCase();
  const wordHits = words.length
    ? pool
        .filter((h) => words.every((w) => hay(h).includes(w)))
        .sort((a, b) => Number(words.every((w) => b.text.toLowerCase().includes(w))) - Number(words.every((w) => a.text.toLowerCase().includes(w))))
    : [];
  const topicHits =
    topic && topic.query === query.trim()
      ? topic.hits
          .map((t) => ({ h: pool.find((p) => p.key === t.key), why: t.why }))
          .filter((x): x is { h: SearchHit; why: string } => Boolean(x.h) && !wordHits.some((w) => w.key === x.h!.key))
      : [];
  const shown = (h: SearchHit) => where === "all" || h.kind === where;

  async function byTopic() {
    const q = query.trim();
    if (!q) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/meeting/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ action: "search", query: q, items: pool.map((h) => ({ text: h.text, setup: h.setup })) }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not search them");
      const matches: { index: number; why: string }[] = json.matches || [];
      setTopic({ query: q, hits: matches.filter((x) => pool[x.index]).map((x) => ({ key: pool[x.index].key, why: x.why })) });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const mark = (t: string) => {
    if (!words.length) return t;
    const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
    return t.split(re).map((part, i) =>
      i % 2 ? (
        <mark key={i} className="rounded bg-amber-200/70 px-0.5 text-ink">
          {part}
        </mark>
      ) : (
        part
      ),
    );
  };
  const counts = {
    list: pool.filter((h) => h.kind === "list").length,
    bank: pool.filter((h) => h.kind === "bank").length,
    draft: pool.filter((h) => h.kind === "draft").length,
  };

  const row = (h: SearchHit, why?: string) => (
    <li key={h.key} className="py-2">
      {h.setup && words.some((w) => (h.setup || "").toLowerCase().includes(w)) && (
        <p className="mb-0.5 line-clamp-2 text-xs leading-relaxed text-ink/60">{mark(h.setup)}</p>
      )}
      <p className="text-sm text-ink">{mark(h.text)}</p>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${h.kind === "list" ? "bg-[var(--accent)] text-[var(--accent-fg)]" : "bg-canvas text-muted"}`}>
          {h.where}
        </span>
        {why && <span className="text-muted">{why}</span>}
        {/* Matched somewhere not shown: say where, or it reads as a random hit. */}
        {!why && words.length > 0 && !words.every((w) => `${h.text} ${h.setup || ""}`.toLowerCase().includes(w)) && (
          <span className="text-muted">found in its probe or another way to ask it</span>
        )}
        {h.kind !== "draft" && (
          <button type="button" onClick={() => onGo(h)} className="font-medium text-[var(--accent)] hover:underline">
            Go to it
          </button>
        )}
        {h.kind !== "list" && (
          <button type="button" onClick={() => onPick(h)} className="font-medium text-[var(--accent)] hover:underline">
            Add to my list
          </button>
        )}
        {h.kind === "draft" && (
          <button type="button" onClick={() => onBank(h)} className="font-medium text-muted hover:text-ink hover:underline">
            Add to the bank
          </button>
        )}
      </div>
    </li>
  );

  const anyQuery = Boolean(query.trim());
  return (
    <div className="rounded-xl border border-border bg-surface px-3 py-2.5">
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void byTopic();
        }}
      >
        <Search size={15} className="shrink-0 text-muted" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search all ${pool.length} questions: your list, the bank and the reading`}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
        />
        {anyQuery && (
          <button type="button" onClick={() => setQuery("")} className="shrink-0 text-xs text-muted hover:text-ink">
            Clear
          </button>
        )}
        <Button size="sm" variant="secondary" type="submit" disabled={!anyQuery || busy} title="Finds the questions about this, even in other words">
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} {busy ? "Looking…" : "Find by topic"}
        </Button>
      </form>
      {anyQuery && (
        <div className="mt-2 border-t border-border pt-2">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {(
              [
                ["all", "Everywhere", pool.length],
                ["list", "Your list", counts.list],
                ["bank", "Bank", counts.bank],
                ["draft", "Reading", counts.draft],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setWhere(k)}
                className={`rounded-full border px-2 py-0.5 font-medium transition ${
                  where === k ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)]" : "border-border text-ink/80 hover:border-[var(--accent)]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
            {wordHits.filter(shown).length} with those words
          </p>
          {wordHits.filter(shown).length > 0 ? (
            <ul className="max-h-[50vh] divide-y divide-border overflow-y-auto">{wordHits.filter(shown).slice(0, 60).map((h) => row(h))}</ul>
          ) : (
            <p className="py-1 text-xs text-muted">None use those words. Try Find by topic for ones about it in other words.</p>
          )}
          {error && <p className="mt-1 text-xs text-status-error">{error}</p>}
          {topic && topic.query === query.trim() && (
            <>
              <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-muted">
                {topicHits.filter((x) => shown(x.h)).length} more about it, in other words
              </p>
              {topicHits.filter((x) => shown(x.h)).length > 0 ? (
                <ul className="max-h-[50vh] divide-y divide-border overflow-y-auto">{topicHits.filter((x) => shown(x.h)).map((x) => row(x.h, x.why))}</ul>
              ) : (
                <p className="py-1 text-xs text-muted">Nothing else is about that.</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

type MoveTarget = "top" | "up" | "down" | "bottom" | number | { section: string };

/**
 * Where a question can go in one click. Dragging moved it a card at a time,
 * which made taking the last question to the top a chore.
 */
function MoveItems({
  index,
  count,
  sections,
  current,
  onMove,
}: {
  index: number;
  count: number;
  sections: string[];
  current?: string;
  onMove: (to: MoveTarget) => void;
}) {
  const [num, setNum] = useState("");
  // Opening is offered even before there is one: it is where a question
  // moved to start the panel belongs.
  const all = sections.includes("Opening") ? sections : ["Opening", ...sections];
  return (
    <>
      <p className="px-2 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wide text-muted">Move it</p>
      <div className="grid grid-cols-2">
        <MenuItem icon={<ArrowUpToLine size={13} />} disabled={index === 0} onClick={() => onMove("top")}>
          To the top
        </MenuItem>
        <MenuItem icon={<ArrowDownToLine size={13} />} disabled={index === count - 1} onClick={() => onMove("bottom")}>
          To the bottom
        </MenuItem>
        <MenuItem icon={<ArrowUp size={13} />} disabled={index === 0} onClick={() => onMove("up")}>
          Up one
        </MenuItem>
        <MenuItem icon={<ArrowDown size={13} />} disabled={index === count - 1} onClick={() => onMove("down")}>
          Down one
        </MenuItem>
      </div>
      <form
        className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-muted"
        onSubmit={(e) => {
          e.preventDefault();
          const n = Number(num);
          if (n >= 1 && n <= count) onMove(n);
        }}
      >
        To number
        <input
          type="number"
          min={1}
          max={count}
          value={num}
          onChange={(e) => setNum(e.target.value)}
          placeholder={String(index + 1)}
          className="w-14 rounded border border-border bg-surface px-1.5 py-0.5 text-xs text-ink outline-none focus:border-[var(--accent)]"
        />
        <button type="submit" className="font-medium text-[var(--accent)] hover:underline">
          Move
        </button>
      </form>
      <p className="px-2 pb-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wide text-muted">Into a section</p>
      {all.map((sec) => (
        <MenuItem key={sec} disabled={sec === current} onClick={() => onMove({ section: sec })}>
          {sec}
          {!sections.includes(sec) && <span className="text-muted"> (new, at the top)</span>}
        </MenuItem>
      ))}
    </>
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

type ManyPreset = { part: ReworkPart; length: ReworkLength; instruction: string; n: number };

type ManyDraft = {
  /** What is proposed, editable before it is approved. */
  setup: string;
  text: string;
  /** What it would replace. */
  before: string;
  beforeText: string;
  status: "busy" | "ready" | "failed" | "approved";
  /** Why the last try was turned down, in plain words. */
  why?: string;
  /** Their suggestion for this one. */
  note: string;
  /** Tries they turned down, so Try again brings something new. */
  seen: string[];
};

const secondsOf = (t: string) => Math.round((words(t) / 150) * 60);

/**
 * Rework, for several questions at once: the same choices as for one (which
 * part, how long, what you want different), and nothing changes on a question
 * until it is approved. Each shows what is there now beside what is proposed,
 * and can be typed over, tried again with a suggestion, or left alone.
 */
function ReworkManyModal({
  preset,
  meetingId,
  open,
  onClose,
  list,
  bank,
  working,
  claim,
  release,
  fetchMany,
  onApply,
}: {
  preset: ManyPreset;
  meetingId: string;
  open: boolean;
  onClose: () => void;
  list: QuestionItem[];
  bank: QuestionItem[];
  working: boolean;
  /** False when another job is running: one at a time. */
  claim: () => boolean;
  release: () => void;
  fetchMany: (
    qs: QuestionItem[],
    opts: { part: ReworkPart; length: ReworkLength; instruction: string; avoid: string[] },
  ) => Promise<({ setup: string; text: string } | { why: string })[]>;
  onApply: (done: { id: string; setup: string; text: string }[]) => void;
}) {
  const storeKey = `mp:rework-many:${meetingId}`;
  // Kept through closing the window or the Outlook pane: they cost a wait.
  const [drafts, setDrafts] = useState<Record<string, ManyDraft>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storeKey) || "{}") as Record<string, ManyDraft>;
      return Object.fromEntries(Object.entries(saved).filter(([, d]) => d.status !== "busy" && typeof d.text === "string"));
    } catch {
      return {};
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(storeKey, JSON.stringify(drafts));
    } catch {}
  }, [drafts, storeKey]);
  const [part, setPart] = useState<ReworkPart>(preset.part);
  const [length, setLength] = useState<ReworkLength>(preset.length);
  const [instruction, setInstruction] = useState(preset.instruction);
  const [withBank, setWithBank] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  const scope = (withBank ? [...list, ...bank] : list).filter((q) => part !== "setup" || q.setup?.trim());
  const rows = scope.filter((q) => drafts[q.id]);
  const ready = rows.filter((q) => drafts[q.id].status === "ready");
  const busyCount = rows.filter((q) => drafts[q.id].status === "busy").length;
  const said = (setup: string, text: string) => secondsOf(`${setup} ${text}`);
  const saves = (qs: QuestionItem[]) =>
    qs.reduce((n, q) => n + said(drafts[q.id].before, drafts[q.id].beforeText) - said(drafts[q.id].setup, drafts[q.id].text), 0);
  const patchDraft = (id: string, p: Partial<ManyDraft>) => setDrafts((d) => (d[id] ? { ...d, [id]: { ...d[id], ...p } } : d));
  const canRun = length !== "same" || instruction.trim().length > 0;

  async function write(qs: QuestionItem[], note: string, avoid: string[]) {
    const got = await fetchMany(qs, { part, length, instruction: note, avoid });
    setDrafts((d) => {
      const next = { ...d };
      qs.forEach((q, i) => {
        const r = got[i];
        next[q.id] =
          r && "text" in r
            ? { ...next[q.id], setup: r.setup, text: r.text, status: "ready", why: undefined }
            : { ...next[q.id], status: "failed", why: (r && "why" in r && r.why) || "nothing came back for it" };
      });
      return next;
    });
  }

  async function runAll() {
    const todo = scope.filter((q) => drafts[q.id]?.status !== "approved");
    if (!todo.length || !claim()) return;
    setRunning(true);
    setError("");
    setDrafts((d) => {
      const next = { ...d };
      for (const q of todo)
        next[q.id] = { setup: q.setup || "", text: q.text, before: q.setup || "", beforeText: q.text, status: "busy", note: "", seen: [] };
      return next;
    });
    // Six to a call, three calls at a time, so they arrive as they are done.
    const chunks: QuestionItem[][] = [];
    for (let i = 0; i < todo.length; i += 6) chunks.push(todo.slice(i, i + 6));
    try {
      let at = 0;
      await Promise.all(
        [0, 1, 2].map(async () => {
          while (at < chunks.length) await write(chunks[at++], instruction.trim(), []);
        }),
      );
    } catch (e) {
      setError((e as Error).message);
      setDrafts((d) =>
        Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v.status === "busy" ? { ...v, status: "failed" as const, why: (e as Error).message } : v])),
      );
    } finally {
      setRunning(false);
      release();
    }
  }

  async function retry(q: QuestionItem) {
    const d = drafts[q.id];
    if (!claim()) return;
    const shown = `${d.setup} ${d.text}`.trim();
    const seen = d.status === "ready" && shown ? [...d.seen, shown] : d.seen;
    patchDraft(q.id, { status: "busy", seen });
    setError("");
    try {
      await write([q], [instruction.trim(), d.note.trim()].filter(Boolean).join(". "), seen);
    } catch (e) {
      setError((e as Error).message);
      patchDraft(q.id, { status: "failed" });
    } finally {
      release();
    }
  }

  function approve(qs: QuestionItem[]) {
    onApply(qs.map((q) => ({ id: q.id, setup: drafts[q.id].setup.trim(), text: drafts[q.id].text.trim() })));
    setDrafts((d) => {
      const next = { ...d };
      for (const q of qs) next[q.id] = { ...next[q.id], status: "approved" };
      return next;
    });
  }

  function undo(id: string) {
    const d = drafts[id];
    onApply([{ id, setup: d.before, text: d.beforeText }]);
    patchDraft(id, { status: "ready" });
  }

  const dropDraft = (id: string) =>
    setDrafts((d) => {
      const next = { ...d };
      delete next[id];
      return next;
    });

  const chip = (on: boolean) =>
    `rounded-full border px-2.5 py-0.5 transition ${
      on ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]" : "border-border text-muted hover:text-ink"
    }`;
  const approvedRows = Object.entries(drafts).filter(([id, d]) => d.status === "approved" && !scope.some((q) => q.id === id));

  return (
    <Modal open={open} onClose={onClose} title="Rework several at once" movable resizable size="lg">
      <div className="space-y-3">
        <p className="text-sm text-muted">The same choices as Rework, for each question. Nothing changes until you approve it.</p>
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="font-medium text-ink">Change</span>
          {(
            [
              ["auto", "Whatever I say below"],
              ["setup", "Just the setup"],
              ["question", "Just the question"],
              ["both", "Both"],
            ] as const
          ).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setPart(k)} className={chip(part === k)}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="font-medium text-ink">Length</span>
          {(
            [
              ["same", "As it is"],
              ["shorter", "Shorter"],
              ["longer", "Longer"],
            ] as const
          ).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setLength(k)} className={chip(length === k)}>
              {label}
            </button>
          ))}
          <label className="ml-auto inline-flex items-center gap-1.5 text-muted">
            <input type="checkbox" checked={withBank} onChange={(e) => setWithBank(e.target.checked)} />
            The bank too ({bank.filter((q) => part !== "setup" || q.setup?.trim()).length})
          </label>
        </div>
        <Textarea
          label="What's not right about them? (optional)"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder="One sentence each, keep the numbers, sound less formal"
          className="min-h-14"
        />
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="mr-auto text-xs text-muted">
            {running
              ? `${scope.filter((q) => drafts[q.id] && drafts[q.id].status !== "busy").length} of ${scope.length} ready. You can close this.`
              : !canRun
                ? "Pick shorter or longer, or say what you want."
                : ""}
          </span>
          {ready.length > 1 && (
            <Button variant="secondary" disabled={running} onClick={() => approve(ready)}>
              <Check size={14} /> Approve all {ready.length}
            </Button>
          )}
          <Button disabled={running || working || !scope.length || !canRun} onClick={() => void runAll()}>
            <Wand2 size={14} />
            {running ? "Writing…" : `Rework ${scope.length} ${scope.length === 1 ? "question" : "questions"}`}
          </Button>
        </div>
        {error && <p className="text-sm text-status-error">{error}</p>}
        {ready.length > 0 && !busyCount && saves(ready) !== 0 && (
          <p className="text-xs text-muted">
            {saves(ready) > 0
              ? `Approving these ${ready.length} takes about ${fmtMin(saves(ready) / 60)} min off.`
              : `Approving these ${ready.length} adds about ${fmtMin(-saves(ready) / 60)} min.`}
          </p>
        )}
        <ul className="space-y-2">
          {rows.map((q) => {
            const d = drafts[q.id];
            const diff = said(d.before, d.beforeText) - said(d.setup, d.text);
            const newSetup = d.setup !== d.before;
            const newText = d.text !== d.beforeText;
            return (
              <li
                key={q.id}
                data-rework={q.id}
                className={`rounded-xl border p-3 ${d.status === "approved" ? "border-emerald-300 bg-emerald-50/40" : "border-border bg-surface"}`}
              >
                <p className="text-[11px] font-semibold text-muted">
                  Now, {words(`${d.before} ${d.beforeText}`)} words, {said(d.before, d.beforeText)} sec
                </p>
                {d.before && <p className="text-sm leading-relaxed text-ink/60">{d.before}</p>}
                <p className="mt-0.5 text-sm font-medium text-ink/80">{d.beforeText}</p>
                {d.status === "busy" ? (
                  <p className="mt-2 inline-flex items-center gap-2 text-xs font-medium text-[var(--accent)]">
                    <Loader2 size={13} className="animate-spin" /> Writing it…
                  </p>
                ) : d.status === "failed" ? (
                  <p className="mt-2 text-sm text-status-error">
                    Couldn&apos;t write one that works: {d.why || "it didn't pass the checks"}. Try again, or say what you want in the box below.
                  </p>
                ) : d.status === "approved" ? (
                  <>
                    <p className="mt-2 text-[11px] font-semibold text-emerald-700">
                      Approved, {words(`${d.setup} ${d.text}`)} words, {said(d.setup, d.text)} sec
                    </p>
                    {d.setup && <p className="text-sm leading-relaxed text-ink">{d.setup}</p>}
                    <p className="mt-0.5 text-sm font-medium text-ink">{d.text}</p>
                  </>
                ) : (
                  <>
                    <p className="mt-2 text-[11px] font-semibold text-[var(--accent)]">
                      Proposed, {words(`${d.setup} ${d.text}`)} words, {said(d.setup, d.text)} sec
                      {diff ? `, ${Math.abs(diff)} sec ${diff > 0 ? "shorter" : "longer"}` : ""}
                    </p>
                    {(newSetup || part !== "question") && d.before && (
                      <Textarea aria-label="Proposed setup" value={d.setup} onChange={(e) => patchDraft(q.id, { setup: e.target.value })} className="min-h-14" />
                    )}
                    {(newText || part === "question" || part === "both") && (
                      <Textarea
                        aria-label="Proposed question"
                        value={d.text}
                        onChange={(e) => patchDraft(q.id, { text: e.target.value })}
                        className="mt-1.5 min-h-12 font-medium"
                      />
                    )}
                  </>
                )}
                {d.status === "approved" ? (
                  <button type="button" onClick={() => undo(q.id)} className="mt-1.5 text-xs font-medium text-muted hover:text-ink hover:underline">
                    Undo
                  </button>
                ) : (
                  d.status !== "busy" && (
                    <div className="mt-2 space-y-2">
                      <Input
                        aria-label="Your suggestion for this one"
                        value={d.note}
                        onChange={(e) => patchDraft(q.id, { note: e.target.value })}
                        placeholder="Your suggestion for this one (optional)"
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        {d.status === "ready" && (
                          <Button size="sm" variant="secondary" disabled={!d.text.trim()} onClick={() => approve([q])}>
                            <Check size={13} /> Approve
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" disabled={working} onClick={() => void retry(q)}>
                          <RefreshCw size={13} /> {d.note.trim() ? "Redo with my suggestion" : "Try again"}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => dropDraft(q.id)}>
                          Keep mine
                        </Button>
                      </div>
                    </div>
                  )
                )}
              </li>
            );
          })}
        </ul>
        {approvedRows.length > 0 && (
          <p className="text-xs text-muted">
            {approvedRows.length} approved earlier {approvedRows.length === 1 ? "is" : "are"} outside what is showing.
          </p>
        )}
      </div>
    </Modal>
  );
}

/**
 * One question, written together. "Write me more" writes a batch of its own
 * choosing and "Type one of my own" takes the words as they are, so a question
 * you could only half say had nowhere to go. A topic or a rough attempt goes
 * in, finished questions come out, and the same box steers the next try.
 */
function HelpWriteModal({
  open,
  onClose,
  rough,
  onRough,
  working,
  isHere,
  fetchQuestions,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  rough: string;
  onRough: (t: string) => void;
  /** Any AI job on the page: only one runs at a time. */
  working: boolean;
  isHere: (text: string) => boolean;
  /** Null when another job is running. */
  fetchQuestions: (rough: string, avoid: string[]) => Promise<QuestionVariant[] | null>;
  onAdd: (v: QuestionVariant, toList: boolean) => void;
}) {
  const [options, setOptions] = useState<QuestionVariant[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pct = useProgress(busy, 30000);

  async function run() {
    setBusy(true);
    setError("");
    try {
      const got = await fetchQuestions(rough.trim(), options.map((o) => o.text));
      if (got && !got.length) throw new Error("Nothing usable came back. Try saying it differently.");
      // New ones on top; the earlier ones stay underneath rather than vanish.
      if (got) setOptions((o) => [...got.filter((v) => !o.some((x) => x.text === v.text)), ...o]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Help me write a question" movable resizable size="lg">
      <div className="space-y-3">
        <Textarea
          label="What do you want to ask about?"
          autoFocus
          value={rough}
          onChange={(e) => onRough(e.target.value)}
          placeholder="A topic, half a thought or a rough question, and who it's for if you know. For example: whether MSLs should be paid on outcomes, maybe for Ajay"
          className="min-h-20"
        />
        <div className="flex items-center justify-end gap-2">
          {options.length > 0 && (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setOptions([]);
                onRough("");
                setError("");
              }}
            >
              Start over
            </Button>
          )}
          <Button disabled={!rough.trim() || busy || working} onClick={() => void run()}>
            <Wand2 size={14} />
            {busy ? "Writing…" : options.length ? "Write more from that" : "Write it with me"}
          </Button>
        </div>
        {busy && <ProgressBar pct={pct} label="Writing them. You can close this; they'll be here." />}
        {error && <p className="text-sm text-status-error">{error}</p>}
        {options.length > 0 && (
          <ul className="space-y-2">
            {options.map((v) => {
              const here = isHere(v.text);
              return (
                <li key={v.text} className="rounded-xl border border-border bg-surface p-3">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--accent)]">{v.angle}</span>
                    {v.forWhom && <ForChip who={v.forWhom} />}
                  </span>
                  {v.setup && <p className="mt-1 text-sm leading-relaxed text-ink/70">{v.setup}</p>}
                  <p className="mt-1 text-sm font-medium text-ink">{v.text}</p>
                  {v.followUp && <p className="mt-1 text-xs italic text-muted">Probe: {v.followUp}</p>}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {here ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                        <Check size={13} /> Added
                      </span>
                    ) : (
                      <>
                        <Button size="sm" variant="secondary" onClick={() => onAdd(v, true)}>
                          <Plus size={13} /> Add to my list
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => onAdd(v, false)}>
                          Add to the bank
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Modal>
  );
}

function AddOwnModal({
  open,
  onClose,
  categories,
  onAdd,
  onHelp,
}: {
  open: boolean;
  onClose: () => void;
  categories: string[];
  onAdd: (text: string, category: string, followUp: string, forWhom: string, setup: string) => void;
  /** Carries what they have typed across to writing it with help. */
  onHelp: (text: string) => void;
}) {
  const [text, setText] = useState("");
  const [setup, setSetup] = useState("");
  const [category, setCategory] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [forWhom, setForWhom] = useState("");
  return (
    <Modal open={open} onClose={onClose} title="Type one of my own" movable>
      <div className="space-y-3">
        <Textarea
          label="Setup, said before the question (optional)"
          autoFocus
          value={setup}
          onChange={(e) => setSetup(e.target.value)}
          placeholder="The point or finding the question stands on"
          className="min-h-16"
        />
        <Textarea
          label="The question, as you'd say it"
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
        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            onClick={() => {
              onHelp(text);
              setText("");
            }}
          >
            <Wand2 size={14} /> Help me write it
          </Button>
          <Button
            disabled={!text.trim()}
            onClick={() => {
              onAdd(text.trim(), category.trim(), followUp.trim(), forWhom.trim(), setup.trim());
              setText("");
              setSetup("");
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
        label="Setup, said before the question (optional)"
        value={q.setup || ""}
        onChange={(e) => onPatch({ setup: e.target.value })}
        placeholder="The argument or finding the question stands on, in two to four sentences"
        className="min-h-16"
      />
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
      {/* Edit the words reaches every word on the card, the kept question too. */}
      {(q.options || []).map((o, i) =>
        o.keep ? (
          <KeptFields
            key={i}
            option={o}
            onChange={(p) => onPatch({ options: (q.options || []).map((c, k) => (k === i ? { ...c, ...p } : c)) })}
          />
        ) : null,
      )}
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
