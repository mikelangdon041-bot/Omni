"use client";

// "Questions from this": a few questions built on one source, with the setup
// that lays out what it found, each one offered to the bank or straight into
// the writer's list. Nothing lands anywhere until they say so.
//
// The drafts are kept on the source, so coming back to the Reading tab shows
// them as they were left rather than asking for a fresh batch. And each one
// is checked against the questions already in the bank when it is written:
// one that asks the same thing as a question they have says so, and they
// choose between the two rather than finding the pair later in their list.
//
// Every request back to the writer model says what the writer wants, because
// rewriting blind gives them another batch with the same problem and no way
// to name it: a new batch, more like one they liked, another version of one,
// or one fixed for what they did not like.

import { useRef, useState } from "react";
import {
  ArrowLeftRight,
  Check,
  Copy,
  MessageCircleQuestion,
  Pencil,
  Plus,
  RefreshCw,
  ThumbsDown,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { Working } from "@/components/ui/Progress";
import { useToast } from "@/components/ui/Feedback";
import { withReading } from "@/lib/meetingprep/reading";
import {
  meetingPayload,
  newId,
  type GetMeeting,
  type SaveMeeting,
} from "@/lib/meetingprep/material";
import {
  stripAskedQuestion,
  type MpMeeting,
  type QuestionItem,
  type ReadingSource,
  type SourceDraft,
} from "@/lib/meetingprep/types";

async function post<T>(body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch("/api/meeting/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(body),
    signal,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Something went wrong");
  return json as T;
}

const liveQuestions = (m: MpMeeting) =>
  (m.questions?.items || []).filter((q) => !q.deleted);

/**
 * The whole of the source, not the summary of it. Material the writer added
 * already has its text; a found source is opened at its link, every time
 * (a few seconds), rather than kept: sixty slides of text on every source
 * would ride along on every load of every meeting. "" when it cannot be
 * read, and the batch is written from the summary instead.
 */
async function fullTextOf(s: ReadingSource, m: MpMeeting, signal?: AbortSignal): Promise<string> {
  const docId = s.fullDocId || s.docId;
  if (docId) return (m.documents || []).find((d) => d.id === docId)?.text || "";
  if (!s.url) return "";
  try {
    const res = await fetch("/api/meeting/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ url: s.url }),
      signal,
    });
    const json = await res.json().catch(() => ({}));
    return res.ok ? String(json.text || "") : "";
  } catch {
    return "";
  }
}

/** For a fix or a version: the question only, the setup only, or both. */
type Part = "question" | "setup" | "both";
type PartChoice = Part | "auto";

const GOOD = /\b(?:great|good|fine|ok(?:ay)?|love|like|perfect|keep|works|happy with|is right|spot on)\b/i;
const BAD = /\b(?:bad|wrong|weak|vague|long|short|boring|generic|fake|filler|corporate|off|doesn'?t (?:fit|work|land)|don'?t like|isn'?t|not (?:good|right|great)|hate|change|fix|redo|rewrite)\b/i;

/**
 * Which part the writer means, from what they wrote, so they do not have to
 * say it twice: "setup is great but question isn't" is about the question.
 * Each part is judged on the clause that mentions it; when nothing says, the
 * question changes and the setup stays, the safer of the two to get wrong.
 */
export function inferPart(note: string): { part: Part; why: string } {
  const t = note.toLowerCase();
  if (/\b(?:both|start over|whole thing|all of it|everything)\b/.test(t)) return { part: "both", why: "you asked for all of it" };
  const clauses = t.split(/[.,;!?]|\bbut\b|\band\b|\bwhile\b|\bthough\b/);
  const about = (word: RegExp) => clauses.filter((c) => word.test(c));
  const setup = about(/\bsetups?\b|\bintro\b|\bpreamble\b|\blead-?in\b/);
  const question = about(/\bquestions?\b|\bask\b/);
  const setupGood = setup.some((c) => GOOD.test(c) && !BAD.test(c.replace(/isn'?t/, "")));
  const setupBad = setup.some((c) => BAD.test(c) && !GOOD.test(c));
  const questionBad = question.some((c) => BAD.test(c) || /isn'?t|not/.test(c));
  if (setupBad && !questionBad) return { part: "setup", why: "you said the setup is the problem" };
  if (setupBad && questionBad) return { part: "both", why: "you said both need work" };
  if (setupGood) return { part: "question", why: "you said the setup is fine" };
  return { part: "question", why: "the setup stays unless you say otherwise" };
}

/** What the writer asked for. "batch" is a whole new set; the rest are about one draft. */
type Ask =
  { kind: "batch" } | { kind: "more" | "version" | "fix"; draft: SourceDraft };

// Measured on the writer's panel: a batch with both checks ran about 45s.
const SECONDS = { batch: 45, more: 40, version: 35, fix: 35 } as const;

const PICKS = {
  batch: [
    "One question per main argument",
    "Questions that ask for a real example",
    "The hardest question this raises",
    "Questions that put panelists on opposite sides",
    "On the strongest figure in it",
  ],
  more: ["Same angle", "Harder", "For a specific panelist", "Shorter"],
  version: ["Blunter", "Shorter", "More personal", "Shorter setup"],
  fix: [
    "Too long",
    "Too vague",
    "Too leading",
    "Setup doesn't fit",
    "Already asked this",
  ],
};

const PROMPTS = {
  batch: "What should they be about? (optional)",
  more: "What do you like about it? (optional)",
  version: "What should change? (optional)",
  fix: "What's wrong with it?",
};

export function SourceQuestions({
  s,
  getMeeting,
  save,
}: {
  s: ReadingSource;
  getMeeting: GetMeeting;
  save: SaveMeeting;
}) {
  const toast = useToast();
  /** "batch" or the id of the draft being worked on. */
  const [busy, setBusy] = useState<string>("");
  // Requests made while one is running wait their turn rather than being
  // refused: the writer works down the list while the first one writes.
  const running = useRef(false);
  // The request in flight, so Cancel can stop waiting for it. The server
  // finishes what it started; the answer is simply not used.
  const abort = useRef<AbortController | null>(null);
  const call = <T,>(body: unknown) => post<T>(body, abort.current?.signal);
  const stopped = () => Boolean(abort.current?.signal.aborted);
  const queue = useRef<{ ask: Ask; note: string; part: Part }[]>([]);
  const [queued, setQueued] = useState<string[]>([]);
  // For a fix or a version: which part to change. A fix used to rewrite the
  // setup the writer had just said was great.
  const [part, setPart] = useState<PartChoice>("auto");
  const [open, setOpen] = useState(true);
  /** The feedback box that is open, if any. */
  const [asking, setAsking] = useState<Ask | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const drafts = s.questions || [];
  // Everything they have asked of this source: the saved list, and the
  // request carried on each batch of drafts (which predates the list).
  // Only requests for a whole batch: a note on one question ("question
  // sucks") read back as a suggestion for the next batch was the writer's own
  // complaint, shown to them as if it were an example.
  const batchAsks = new Set(
    drafts
      .map((d) => d.askedFor || "")
      .filter((a) => a && !/^(more like|another version of|a fix for|the full article)/.test(a)),
  );
  const pastAsks = [...new Set([...(s.asks || []).filter((a) => batchAsks.has(a)), ...batchAsks])].slice(0, 6);

  /** The drafts as they are now, read fresh: another save may have landed. */
  const current = () =>
    getMeeting()?.reading?.sources?.find((x) => x.id === s.id)?.questions ||
    drafts;

  function setDrafts(next: SourceDraft[], ask?: string) {
    const m = getMeeting();
    if (!m) return;
    const r = m.reading || {};
    save({
      reading: {
        ...r,
        sources: (r.sources || []).map((x) =>
          x.id === s.id
            ? {
                ...x,
                questions: next,
                // What they asked for, newest first, so the next request
                // box can show it back to them.
                ...(ask
                  ? {
                      asks: [
                        ask,
                        ...(x.asks || []).filter((a) => a !== ask),
                      ].slice(0, 8),
                    }
                  : {}),
              }
            : x,
        ),
      },
    });
  }

  function focusFor(
    ask: Ask,
    note: string,
    seen: SourceDraft[],
    full: boolean,
  ): { focus: string; count: number } {
    // With the whole document in hand, the questions already written show
    // which parts of it have been used. Told only "do not repeat these
    // questions", a second batch from a sixty-seven slide deck came back on
    // the same three points in new words.
    const deeper =
      full && seen.length
        ? ` The questions already written from it used some of its points. Go to the parts of the document they did not use: its other findings, figures, frameworks, examples, warnings and recommendations, and build on those.`
        : "";
    const base = `Every question here is built on the one source marked THE SOURCE THIS BATCH IS BUILT ON: what it found, what it argues, and what it leaves open. Each one gets a setup that lays out the relevant finding or argument from it in plain words, then asks what that means for the people answering. The people listening have not read it: never call it "the source", "the article", "the guidance", "the report" or "the authors", and never name its publisher; state what it found as a plain fact, or introduce it the way you would to a stranger ("a recent industry report argues").${deeper}`;
    const said = note
      ? `\nThe writer says, and this outranks everything above: ${note}`
      : "";
    const avoid = seen.length
      ? ` The writer has already seen these and wants different ones, so do not repeat them: ${seen.map((d) => d.text).join(" | ")}`
      : "";
    // A specific request is the brief, not a footnote to it. Asked for
    // "publications", the batch used to stay on whatever the source covered,
    // because "built on the one source" came first and won.
    if (ask.kind === "batch" && note)
      return {
        count: Math.min(
          10,
          Math.max(
            3,
            note
              .split(/;|\n|\bone (?:about|on)\b/i)
              .filter((x) => x.trim().length > 8).length,
          ),
        ),
        focus: `THE WRITER ASKED FOR THIS, and it decides what every question is about: ${note}
Write questions specifically on that, each with a setup. How many is set by the request: if it asks for one thing, two or three; if it lists several things ("one about X; one on Y"), exactly one question for each thing it lists, and nothing else; rank them 1, 2, 3 in the order the writer listed them, not by strength. Every item the writer listed gets its question; leaving one out is not doing what was asked. Where an item quotes or points at a passage of the source, build that question on that passage.${deeper} Draw on the source marked THE SOURCE THIS BATCH IS BUILT ON wherever it bears on the request; where it does not, use the rest of the reading list and what you know of the field, and keep the request. Never invent a figure: a number in a setup must come from the material given. Read the request the way someone working in this field means it, and never bend it to fit the source: if the source is about something else, the request still wins, and the source is only used where it genuinely bears. A question that is not about what the writer asked for is wrong however good it is.${avoid}`,
      };
    if (ask.kind === "batch")
      return {
        count: 4,
        focus: `${base} Three to five questions, no more; quality over count.${avoid}`,
      };
    const q = `${ask.draft.setup ? `Setup: ${ask.draft.setup}\n` : ""}Question: ${ask.draft.text}`;
    if (ask.kind === "more")
      return {
        // Five asked, three kept: a single source has only so many distinct
        // points, and the ones that repeat a draft already here are dropped.
        count: 5,
        focus: `${base} The writer liked this one and wants five more of the same kind: the same angle, register and kind of setup, each asking something genuinely different, never a rewording of it or of each other.\n${q}${said}`,
      };
    if (ask.kind === "version")
      return {
        count: 3,
        focus: `${base} Rewrite this ONE question exactly two ways. Same job in the conversation, same thing being asked, but far enough apart that choosing between them is a real choice. Return exactly two.\n${q}${said}`,
      };
    return {
      count: 3,
      focus: `${base} The writer did not like this question. Write three replacements. All three ask about the SAME thing the original asks about, the same subject and the same point; only how it is asked changes, fixed for what the writer says is wrong with it. A replacement about a different point is not a fix.\n${q}${said}`,
    };
  }

  /** Run it now, or after the one that is running. */
  function request(ask: Ask, note = "", which: Part = "both") {
    if (running.current) {
      queue.current.push({ ask, note, part: which });
      setQueued((q) => [...q, ask.kind === "batch" ? "batch" : ask.draft.id]);
      toast("info", "Queued. It starts when the current one finishes.");
      return;
    }
    void run(ask, note, which);
  }

  async function run(ask: Ask, note: string, which: Part) {
    running.current = true;
    abort.current = new AbortController();
    try {
      if ((ask.kind === "fix" || ask.kind === "version") && which !== "both")
        await rewritePart(ask, note, which);
      else await generate(ask, note);
    } finally {
      running.current = false;
      abort.current = null;
      const next = queue.current.shift();
      setQueued((q) => q.slice(1));
      if (next) void run(next.ask, next.note, next.part);
    }
  }

  function cancel() {
    abort.current?.abort();
    toast("info", "Cancelled.");
  }

  /** Take a queued request back off the queue before it starts. */
  function unqueue(id: string) {
    const at = queue.current.findIndex((x) => (x.ask.kind === "batch" ? "batch" : x.ask.draft.id) === id);
    if (at < 0) return;
    queue.current.splice(at, 1);
    setQueued((q) => {
      const i = q.indexOf(id);
      return i < 0 ? q : [...q.slice(0, i), ...q.slice(i + 1)];
    });
  }

  /**
   * Change one part of a draft and leave the other alone: a new question
   * under the same setup, or a new setup over the same question. Seconds,
   * not the best part of a minute, because it is one line on the quick model
   * rather than the whole question writer.
   */
  async function rewritePart(ask: Ask & { draft: SourceDraft }, note: string, which: "question" | "setup") {
    const m = getMeeting();
    if (!m) return;
    setBusy(ask.draft.id);
    try {
      const d = ask.draft;
      let got: SourceDraft[] = [];
      if (which === "question") {
        const json = await call<{ questions: { text: string; followUp: string }[] }>({
          action: "rewrite_question",
          meeting: meetingPayload(m),
          setup: d.setup,
          question: d.text,
          complaint: note,
          kind: ask.kind === "version" ? "version" : "fix",
          standing: m.questions?.guidance || "",
          count: 2,
        });
        got = (json.questions || []).map((q) => ({ ...d, id: newId("sd"), text: q.text, followUp: q.followUp, similarTo: undefined, done: undefined }));
      } else {
        const one = () =>
          call<{ setups: string[] }>({
            action: "setups",
            meeting: meetingPayload(m),
            kolId: m.kol_id || "",
            research: withReading("", m),
            questions: [{ text: d.text, category: d.category, why: d.why }],
            standing: `${m.questions?.guidance || ""}\nThe writer likes this question and wants ${ask.kind === "version" ? "a different setup for it" : "its setup fixed"}${note ? `: ${note}` : ""}.`.trim(),
            force: true,
          }).then((x) => String(x.setups?.[0] || ""));
        const setups = (await Promise.all([one(), one()])).filter((x, i, a) => x && a.indexOf(x) === i);
        got = setups.map((setup) => ({ ...d, id: newId("sd"), setup, similarTo: undefined, done: undefined }));
      }
      if (!got.length) throw new Error("Nothing usable came back. Try saying it differently.");
      const what = which === "question" ? "the question" : "the setup";
      for (const g of got) {
        g.isNew = true;
        g.askedFor = `${ask.kind === "version" ? "another version of" : "a fix for"} ${what} of: "${d.text.slice(0, 60)}${d.text.length > 60 ? "…" : ""}"${note ? `, ${note}` : ""}`;
      }
      // Older New tags stay: a writer working down ten new questions should
      // not lose the tag on nine because they asked for a version of one.
      const now = current();
      const at = now.findIndex((x) => x.id === d.id);
      const next = [...now];
      // A fix takes the place of what it fixes; versions go beside it.
      if (ask.kind === "fix") next.splice(at < 0 ? next.length : at, at < 0 ? 0 : 1, ...got);
      else next.splice(at < 0 ? next.length : at + 1, 0, ...got);
      if (stopped()) return;
      setDrafts(next);
    } catch (e) {
      if (!stopped()) toast("error", (e as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function generate(ask: Ask, note = "") {
    const m = getMeeting();
    if (!m) return;
    setBusy(ask.kind === "batch" ? "batch" : ask.draft.id);
    setOpen(true);
    try {
      const live = liveQuestions(m);
      const seen = current();
      const piece = [
        `${s.title}${s.outlet ? ` (${s.outlet}${s.date ? `, ${s.date}` : ""})` : ""}`,
        s.summary,
        ...s.findings.map((f) => `- ${f}`),
      ]
        .filter(Boolean)
        .join("\n");
      const sourceText = await fullTextOf(s, m, abort.current?.signal);
      if (!sourceText && s.url)
        toast(
          "info",
          "Couldn't open the document at that link, so these are written from its summary.",
        );
      const { focus, count } = focusFor(ask, note, seen, Boolean(sourceText));
      const json = await call<{ questions: Partial<SourceDraft>[] }>({
        action: "questions",
        meeting: meetingPayload(m),
        kolId: m.kol_id || "",
        research: withReading(
          sourceText
            ? `THE SOURCE THIS BATCH IS BUILT ON is ${s.title}${s.outlet ? ` (${s.outlet})` : ""}, given in full below.`
            : `THE SOURCE THIS BATCH IS BUILT ON:\n${piece}`,
          m,
        ),
        // The bank and every draft on this source, the one being worked from
        // included: without them "another version" handed the original back
        // word for word and "more like this" rewrote drafts already here.
        existing: [...live.map((q) => q.text), ...seen.map((d) => d.text)],
        categories: [...new Set(live.map((q) => q.category))],
        count,
        focus,
        guidance: m.questions?.guidance || "",
        sourceText,
      });
      // A request that lists six things is owed six questions. The cap used
      // to be three for any request, which cut the writer's list in half.
      const cap =
        ask.kind === "batch" ? (note ? 10 : 5) : ask.kind === "more" ? 3 : 2;
      let got: SourceDraft[] = (json.questions || []).map((q) => ({
        id: newId("sd"),
        setup: String(q.setup || ""),
        text: String(q.text || ""),
        why: String(q.why || ""),
        followUp: String(q.followUp || ""),
        forWhom: String(q.forWhom || ""),
        category: String(q.category || "Questions"),
      }));
      if (!got.length) throw new Error("Nothing came back. Try again.");

      // A fix that wandered onto a different point is not a fix. Keep the
      // replacements judged to ask what the original asked; if none are,
      // keep what came back rather than nothing.
      if (ask.kind === "fix" && got.length > 1) {
        try {
          const { matches } = await call<{ matches: number[] }>({
            action: "similar",
            drafts: got.map((d) => d.text),
            existing: [ask.draft.text],
          });
          const onPoint = got.filter((_, i) => matches?.[i] === 0);
          if (onPoint.length) got = onPoint;
        } catch {
          // Keep them all.
        }
      }

      // Two new drafts that ask the same thing as each other: keep the first.
      // Not for versions, which are meant to be the same question.
      if (got.length > 1 && (ask.kind === "batch" || ask.kind === "more")) {
        try {
          const { matches } = await call<{ matches: number[] }>({
            action: "similar",
            drafts: got.map((d) => d.text),
            existing: got.map((d) => d.text),
            within: true,
          });
          const dupes = new Set(
            (matches || [])
              .map((k, i) =>
                typeof k === "number" && k >= 0 && k < i ? i : -1,
              )
              .filter((i) => i > 0),
          );
          for (const i of [...dupes].sort((a, b) => b - a)) got.splice(i, 1);
        } catch {
          // Keep them all rather than lose the batch.
        }
      }

      // One that asks what a draft already on this source asks adds nothing.
      // Not for versions, which are meant to ask the same thing.
      const others = seen.map((d) => d.text);
      // A specific request is never thinned out for resembling a draft
      // already here: asked for questions on hard-to-reach KOLs, the writer
      // got nothing, because each new one looked like an older draft on KOL
      // selection and all of them were dropped. Without a request, repeats go,
      // but never all of them.
      if (got.length && others.length && ask.kind !== "version" && !(ask.kind === "batch" && note)) {
        try {
          const { matches } = await call<{ matches: number[] }>({
            action: "similar",
            drafts: got.map((d) => d.text),
            existing: others,
          });
          // A fix is checked against everything but the one it replaces.
          const fixing = ask.kind === "fix" ? ask.draft.text : "";
          const kept = got.filter((_, i) => {
            const k = matches?.[i];
            return !(typeof k === "number" && k >= 0 && others[k] !== fixing);
          });
          if (kept.length) got = kept;
        } catch {
          // Keep them rather than lose the batch.
        }
      }

      got = got.slice(0, cap);

      // Which question already in the bank each one repeats, so it can say so.
      if (live.length) {
        try {
          const { matches } = await call<{ matches: number[] }>({
            action: "similar",
            drafts: got.map((d) => d.text),
            existing: live.map((q) => q.text),
          });
          got.forEach((d, i) => {
            const k = matches?.[i];
            if (typeof k === "number" && k >= 0 && live[k])
              d.similarTo = live[k].id;
          });
        } catch {
          // Without the check the drafts are still worth having.
        }
      }

      // New ones are marked, with what they were asked for, and everything
      // older loses the mark: telling the new batch from the old one was a
      // matter of reading every question again.
      for (const d of got) {
        d.isNew = true;
        d.askedFor =
          ask.kind === "batch"
            ? note
            : `${ask.kind === "more" ? "more like" : ask.kind === "version" ? "another version of" : "a fix for"}: "${ask.draft.text.slice(0, 60)}${ask.draft.text.length > 60 ? "…" : ""}"${note ? `, ${note}` : ""}`;
      }
      const now = current();
      if (ask.kind === "batch") {
        // New ones first, where they will be seen; the ones already acted on
        // stay below them; the untouched ones are what this replaces.
        // Nothing is thrown away: asked for more, the writer used to lose
        // every question they had not acted on yet.
        if (stopped()) return;
        setDrafts([...got, ...now], note);
      } else {
        // Next to the one they came from. A fix takes its place.
        const at = now.findIndex((d) => d.id === ask.draft.id);
        const keep = ask.kind === "fix" ? 0 : 1;
        const next = [...now];
        next.splice(
          at < 0 ? next.length : at + (keep ? 1 : 0),
          at < 0 ? 0 : 1 - keep,
          ...got,
        );
        if (stopped()) return;
        setDrafts(next);
      }
    } catch (e) {
      if (!stopped()) toast("error", (e as Error).message);
    } finally {
      setBusy("");
    }
  }

  function toItem(
    d: SourceDraft,
    items: QuestionItem[],
    place?: QuestionItem,
  ): QuestionItem {
    return {
      id: newId("q"),
      setup: d.setup,
      text: d.text,
      why: d.why,
      followUp: d.followUp,
      forWhom: d.forWhom,
      category: place ? place.category : d.category,
      // Backed by the piece it came from, so the source line under it links
      // straight back here.
      sourceNote: `${[s.outlet, s.date].filter(Boolean).join(", ")}${s.outlet || s.date ? ": " : ""}${s.title}`,
      rank: place
        ? place.rank
        : items.reduce((n, q) => Math.max(n, q.rank), 0) + 1,
      picked: place ? place.picked : false,
      backup: place ? place.backup : false,
      asked: false,
      order: place ? place.order : 0,
      source: "ai",
    };
  }

  function patchDraft(id: string, p: Partial<SourceDraft>) {
    setDrafts(current().map((x) => (x.id === id ? { ...x, ...p } : x)));
  }

  /** A setup for a draft that has none, written in place. */
  async function addSetupTo(d: SourceDraft) {
    const m = getMeeting();
    if (!m) return;
    setBusy(d.id);
    abort.current = new AbortController();
    try {
      const out = await call<{ setups: string[] }>({
        action: "setups",
        meeting: meetingPayload(m),
        kolId: m.kol_id || "",
        research: withReading("", m),
        questions: [{ text: d.text, category: d.category, why: d.why }],
        standing: m.questions?.guidance || "",
        force: true,
      });
      const setup = String(out.setups?.[0] || "");
      if (stopped()) return;
      if (!setup) throw new Error("Couldn't write a setup for that one. Try again.");
      patchDraft(d.id, { setup });
    } catch (e) {
      if (!stopped()) toast("error", (e as Error).message);
    } finally {
      abort.current = null;
      setBusy("");
    }
  }

  function clearNew() {
    setDrafts(current().map((x) => (x.isNew ? { ...x, isNew: false } : x)));
  }

  function mark(id: string, done: SourceDraft["done"]) {
    setDrafts(
      current().map((x) => (x.id === id ? { ...x, done, isNew: false } : x)),
    );
  }

  function add(d: SourceDraft, where: "bank" | "list") {
    const m = getMeeting();
    if (!m) return;
    const items = m.questions?.items || [];
    const item = toItem(d, items);
    if (where === "list") {
      item.picked = true;
      item.order = items
        .filter((q) => q.picked)
        .reduce((n, q) => Math.max(n, q.order + 1), 0);
    }
    save({ questions: { ...(m.questions || {}), items: [...items, item] } });
    mark(d.id, where);
  }

  /** The new one takes the old one's place: its slot in the list, its order. */
  function replace(d: SourceDraft, old: QuestionItem) {
    const m = getMeeting();
    if (!m) return;
    const items = m.questions?.items || [];
    const item = toItem(d, items, old);
    // To the bank, not the bin. Swapping a question out of the list is a
    // choice about what to ask, not a verdict that the old one is rubbish,
    // and the bin put it out of sight.
    const next = items.flatMap((q) =>
      q.id === old.id ? [{ ...q, picked: false, backup: false }, item] : [q],
    );
    save({ questions: { ...(m.questions || {}), items: next } });
    mark(d.id, "replaced");
    toast(
      "success",
      old.picked
        ? "Swapped into your list. Yours moved to the bank."
        : "Added to the bank. Yours is still there too.",
    );
  }

  function openAsk(ask: Ask) {
    setAsking(ask);
    setNote("");
    setPart("auto");
  }

  // The feedback box for whichever request is open. A function that returns
  // markup, not a component: one declared in here would be a new component
  // every render, and the box would lose its caret on every keystroke.
  function askBox(ask: Ask) {
    const required = ask.kind === "fix";
    return (
      <form
        className="mt-2 space-y-2 rounded-md border border-border bg-surface p-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (required && !note.trim()) return;
          setAsking(null);
          // Runs on submit, not during render; the rule cannot see that
          // because the form is built by a helper called from render.
          // eslint-disable-next-line react-hooks/refs
          request(
            ask,
            note.trim(),
            ask.kind === "fix" || ask.kind === "version"
              ? part === "auto"
                ? inferPart(note).part
                : part
              : "both",
          );
        }}
      >
        {(ask.kind === "fix" || ask.kind === "version") && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-muted">Change:</span>
            {(
              [
                ["auto", "Let it decide"],
                ["question", "The question"],
                ["setup", "The setup"],
                ["both", "Both"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setPart(k)}
                className={`rounded-full border px-2.5 py-0.5 ${
                  part === k
                    ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                    : "border-border text-muted hover:text-ink"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        {(ask.kind === "fix" || ask.kind === "version") && part === "auto" && note.trim() && (
          <p className="text-[11px] text-muted">
            Will change{" "}
            {{ question: "the question", setup: "the setup", both: "both" }[inferPart(note).part]}:{" "}
            {inferPart(note).why}.
          </p>
        )}
        <p className="text-xs font-medium">{PROMPTS[ask.kind]}</p>
        {/* What they asked for before, to see and reuse. Rewriting without
            it meant typing the same correction again from memory. */}
        {ask.kind === "batch" && pastAsks.length > 0 && (
          <div className="text-xs">
            <p className="text-muted">Your earlier requests here:</p>
            <ul className="mt-0.5 space-y-0.5">
              {pastAsks.map((a) => (
                <li key={a}>
                  <button
                    type="button"
                    onClick={() => setNote(a)}
                    className="text-left text-ink/80 underline-offset-2 hover:underline"
                    title="Use this again"
                  >
                    &ldquo;{a}&rdquo;
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex flex-wrap gap-1.5">
          {PICKS[ask.kind].map((p) => (
            <button
              key={p}
              type="button"
              onClick={() =>
                setNote((f) => (f.includes(p) ? f : f ? `${f}; ${p}` : p))
              }
              className="rounded-full border border-border px-2.5 py-0.5 text-xs text-muted hover:text-ink"
            >
              {p}
            </button>
          ))}
        </div>
        <Input
          autoFocus
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={
            required
              ? "Say what you didn't like"
              : "Or say it in your own words"
          }
        />
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setAsking(null)}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            size="sm"
            disabled={required && !note.trim()}
          >
            {ask.kind === "batch"
              ? "Write questions"
              : ask.kind === "more"
                ? "Write more"
                : ask.kind === "version"
                  ? "Write 2 versions"
                  : "Fix it"}
          </Button>
        </div>
      </form>
    );
  }

  if (!drafts.length || !open)
    return (
      <div className="mt-2">
        {busy === "batch" ? (
          <Working
            active
            seconds={SECONDS.batch}
            label="Writing questions from this source"
            onCancel={cancel}
          />
        ) : asking?.kind === "batch" ? (
          askBox(asking)
        ) : (
          <button
            type="button"
            // The first batch asks what it should be about too. It used to
            // start writing on the click, so the one thing the writer wanted
            // from this source had nowhere to go.
            onClick={() =>
              drafts.length ? setOpen(true) : openAsk({ kind: "batch" })
            }
            className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs font-medium text-[var(--accent)] hover:bg-[var(--accent-soft)]"
          >
            <MessageCircleQuestion size={13} />
            {drafts.length
              ? `Questions from this (${drafts.length})`
              : "Questions from this"}
          </button>
        )}
      </div>
    );

  const m = getMeeting();
  const byId = new Map(m ? liveQuestions(m).map((q) => [q.id, q]) : []);
  const askingDraft = asking && asking.kind !== "batch" ? asking.draft.id : "";
  // To review, handled (added, kept, swapped in) and removed, kept apart so
  // the ones still waiting on a decision are the only ones in full view.
  const open_ = drafts.filter((d) => !d.done);
  const handled = drafts.filter((d) => d.done && d.done !== "removed");
  const removed = drafts.filter((d) => d.done === "removed");
  const anyNew = drafts.some((d) => d.isNew);
  // Groups by the batch request each was written for. A version, rewrite or
  // "more like this" carries a label built from the writer's complaint about
  // one question; shown as a heading it read their own "question sucks" back
  // to them, so it joins the group it sits in and wears a small chip instead.
  const derivedKind = (a: string) =>
    /^more like/.test(a) ? "More like this" : /^another version/.test(a) ? "Version" : /^a fix for/.test(a) ? "Rewrite" : "";
  const groups: { ask: string; items: SourceDraft[] }[] = [];
  let lastKey = "";
  for (const d of open_) {
    const a = d.askedFor || "";
    const key = derivedKind(a) || /^the full article/.test(a) ? lastKey : a;
    lastKey = key;
    const g = groups.find((x) => x.ask === key);
    if (g) g.items.push(d);
    else groups.push({ ask: key, items: [d] });
  }

  const row = (d: SourceDraft) => {
    const like = d.similarTo ? byId.get(d.similarTo) : undefined;
    const setup = stripAskedQuestion(d.setup, d.text);
    if (editing === d.id)
      return (
        <li key={d.id} className="rounded-lg border border-[var(--accent)]/40 bg-surface p-3">
          <EditDraft
            d={d}
            onSave={(p) => {
              patchDraft(d.id, p);
              setEditing(null);
            }}
            onCancel={() => setEditing(null)}
          />
        </li>
      );
    return (
      <li
        key={d.id}
        className={`rounded-lg border bg-surface p-3 ${d.isNew ? "border-amber-300" : "border-border"}`}
      >
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            {(d.isNew || derivedKind(d.askedFor || "")) && (
              <span className="mb-1 flex gap-1">
                {d.isNew && (
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">New</span>
                )}
                {derivedKind(d.askedFor || "") && (
                  <span className="rounded bg-canvas px-1.5 py-0.5 text-[10px] font-semibold text-muted">
                    {derivedKind(d.askedFor || "")}
                  </span>
                )}
              </span>
            )}
            <p className="text-[15px] font-medium leading-snug text-ink">{d.text}</p>
            {setup ? (
              <Setup text={setup} />
            ) : (
              <button
                type="button"
                onClick={() => void addSetupTo(d)}
                disabled={busy === d.id}
                className="mt-1 text-xs font-medium text-[var(--accent)] hover:underline disabled:opacity-60"
              >
                {busy === d.id ? "Writing a setup…" : "Add a setup"}
              </button>
            )}
          </div>
        </div>

        {/* A sharper question for this setup, offered, not applied. */}
        {d.suggested && (
          <div className="mt-2 rounded-md border border-[var(--accent)]/30 bg-[var(--accent-soft)]/30 px-2.5 py-2 text-xs">
            <p className="font-semibold text-[var(--accent)]">A sharper question for this setup</p>
            <p className="mt-0.5 text-sm text-ink">{d.suggested.text}</p>
            <p className="mt-0.5 text-muted">Why: {d.suggested.why}</p>
            <div className="mt-1.5 flex gap-1.5">
              <Button
                size="sm"
                onClick={() =>
                  patchDraft(d.id, {
                    text: d.suggested!.text,
                    followUp: d.suggested!.followUp || d.followUp,
                    suggested: undefined,
                  })
                }
              >
                Use it
              </Button>
              <Button size="sm" variant="ghost" onClick={() => patchDraft(d.id, { suggested: undefined })}>
                Keep mine
              </Button>
            </div>
          </div>
        )}

        {/* Asks what one of theirs already asks. */}
        {like && (
          <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">
            <span className="font-semibold">You have one like this{like.picked ? " in your list" : " in the bank"}: </span>
            {like.text}
          </div>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-1">
          {like ? (
            <>
              <Button size="sm" onClick={() => replace(d, like)}>
                <ArrowLeftRight size={12} /> Use instead of yours
              </Button>
              <Button size="sm" variant="secondary" onClick={() => add(d, "list")}>
                <Plus size={12} /> List too
              </Button>
              <Button size="sm" variant="secondary" onClick={() => add(d, "bank")}>
                Bank
              </Button>
              <Button size="sm" variant="ghost" onClick={() => mark(d.id, "kept")}>
                Keep mine
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" onClick={() => add(d, "list")}>
                <Plus size={12} /> Add to my list
              </Button>
              <Button size="sm" variant="secondary" onClick={() => add(d, "bank")}>
                Bank
              </Button>
            </>
          )}
          {queued.includes(d.id) && (
            <span className="inline-flex items-center gap-1 rounded bg-canvas px-1.5 py-0.5 text-[11px] font-medium text-muted">
              Queued
              <button type="button" onClick={() => unqueue(d.id)} className="hover:text-ink hover:underline">
                cancel
              </button>
            </span>
          )}
          <span className="ml-auto flex items-center">
            <IconAction label="Edit" onClick={() => setEditing(d.id)}>
              <Pencil size={13} />
            </IconAction>
            <IconAction label="More like this" onClick={() => openAsk({ kind: "more", draft: d })}>
              <Copy size={13} />
            </IconAction>
            <IconAction label="Another version" onClick={() => openAsk({ kind: "version", draft: d })}>
              <RefreshCw size={13} />
            </IconAction>
            <IconAction label="What's wrong?" onClick={() => openAsk({ kind: "fix", draft: d })}>
              <ThumbsDown size={13} />
            </IconAction>
            <IconAction label="Remove" onClick={() => mark(d.id, "removed")}>
              <X size={14} />
            </IconAction>
          </span>
        </div>
        {askingDraft === d.id && asking && askBox(asking)}
        {busy === d.id && (
          <Working active seconds={SECONDS.more} label="Writing from this question" onCancel={cancel} className="mt-2" />
        )}
      </li>
    );
  };

  return (
    <div className="mt-3 space-y-3 rounded-lg bg-canvas p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold">Questions from this</p>
        <span className="text-xs text-muted">
          {open_.length} to look at{handled.length ? ` · ${handled.length} done` : ""}
        </span>
        <span className="ml-auto flex items-center gap-1">
          {anyNew && (
            <Button size="sm" variant="ghost" onClick={clearNew}>
              Clear New tags
            </Button>
          )}
          <Button size="sm" variant="secondary" onClick={() => openAsk({ kind: "batch" })} disabled={busy === "batch"}>
            <Plus size={12} /> Write more
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Hide
          </Button>
        </span>
      </div>

      {asking?.kind === "batch" && askBox(asking)}
      {busy === "batch" && (
        <Working active seconds={SECONDS.batch} label="Writing questions from this source" onCancel={cancel} />
      )}

      {groups.map((g, gi) => (
        <details key={`${g.ask}-${gi}`} open className="group">
          <summary className="flex cursor-pointer list-none items-start gap-1.5 text-xs text-muted">
            <span className="mt-0.5 transition group-open:rotate-90">›</span>
            <span className="min-w-0 flex-1">
              {g.ask ? (
                <>
                  <span className="font-semibold">You asked for: </span>
                  <span className="text-ink/80">{g.ask.length > 140 ? `${g.ask.slice(0, 140)}…` : g.ask}</span>
                </>
              ) : (
                <span className="font-semibold">From the article</span>
              )}
              <span> ({g.items.length})</span>
            </span>
          </summary>
          <ul className="mt-2 space-y-2">{g.items.map(row)}</ul>
        </details>
      ))}

      {!open_.length && !busy && (
        <p className="text-xs text-muted">Nothing left to look at here. Write more, or open what you added below.</p>
      )}

      {handled.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted">Added or kept ({handled.length})</summary>
          <ul className="mt-1.5 space-y-1">
            {handled.map((d) => (
              <li key={d.id} className="flex items-start gap-2">
                <Check size={12} className="mt-0.5 shrink-0 text-emerald-600" />
                <span className="min-w-0 flex-1 text-ink/80">{d.text}</span>
                <span className="shrink-0 text-muted">
                  {d.done === "list"
                    ? "In your list"
                    : d.done === "bank"
                      ? "In the bank"
                      : d.done === "replaced"
                        ? "Used instead of yours"
                        : "Kept yours"}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {removed.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted">Removed ({removed.length})</summary>
          <ul className="mt-1.5 space-y-1">
            {removed.map((d) => (
              <li key={d.id} className="flex items-start gap-2">
                <span className="min-w-0 flex-1 text-muted line-through">{d.text}</span>
                <button
                  type="button"
                  onClick={() => patchDraft(d.id, { done: undefined })}
                  className="shrink-0 text-[var(--accent)] hover:underline"
                >
                  Bring back
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** An icon button with its name on hover and for screen readers. */
function IconAction({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="rounded p-1.5 text-muted transition hover:bg-canvas hover:text-ink"
    >
      {children}
    </button>
  );
}

/** The setup under its question: two lines, the rest a click away. */
function Setup({ text }: { text: string }) {
  const [full, setFull] = useState(false);
  const long = text.length > 180;
  return (
    <p className="mt-1 text-xs leading-relaxed text-muted">
      <span className="font-semibold text-ink/60">Setup: </span>
      {full || !long ? text : `${text.slice(0, 170).replace(/\s+\S*$/, "")}… `}
      {long && (
        <button type="button" onClick={() => setFull((v) => !v)} className="text-[var(--accent)] hover:underline">
          {full ? " less" : "more"}
        </button>
      )}
    </p>
  );
}

/** Change a draft by hand before it goes anywhere. */
function EditDraft({
  d,
  onSave,
  onCancel,
}: {
  d: SourceDraft;
  onSave: (p: Partial<SourceDraft>) => void;
  onCancel: () => void;
}) {
  const [setup, setSetup] = useState(d.setup || "");
  const [text, setText] = useState(d.text);
  const [followUp, setFollowUp] = useState(d.followUp || "");
  return (
    <div className="space-y-2">
      <Textarea label="Setup, said before the question" value={setup} onChange={(e) => setSetup(e.target.value)} className="min-h-20 text-sm" />
      <Textarea label="The question" value={text} onChange={(e) => setText(e.target.value)} className="min-h-14 text-sm" autoFocus />
      <Input label="Probe, if the answer is thin" value={followUp} onChange={(e) => setFollowUp(e.target.value)} />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={!text.trim()}
          onClick={() => onSave({ setup: setup.trim(), text: text.trim(), followUp: followUp.trim() })}
        >
          Save
        </Button>
      </div>
    </div>
  );
}
