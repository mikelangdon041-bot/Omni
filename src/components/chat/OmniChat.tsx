"use client";

// The bubble. One chat, every app.
//
// Grown out of Writing Studio's, which proved the shape: a floating widget
// rather than a panel in the page (in a column it competed with the real
// content and lost, ending up below the fold where nobody found it), real
// conversation history, and — the part that matters — never acting on its own.
// An answer changes nothing. When the answer offers to do something, it comes
// with a button, and the button runs the same code the person's own click would.

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  FileText,
  Image as ImageIcon,
  Loader2,
  MessageCircle,
  Paperclip,
  Search,
  History,
  Square,
  Send,
  Sparkles,
  Wand2,
  X,
} from "lucide-react";
import { RichTextView } from "@/components/ui/RichText";
import { useUserId } from "@/lib/writer/hooks";
import { runAction } from "@/lib/chat/run";
import type { ActionOutcome, ChatTurn, ProposedAction } from "@/lib/chat/types";
import { deleteChat, listChats, saveChat, type SavedChat } from "@/lib/chat/history";
import { useResolvedScope } from "./ChatScope";

interface Pending {
  id: string;
  name: string;
  kind: "image" | "document";
  text: string;
}

// Openers per app: the questions worth asking here, so the empty state teaches
// what this thing can do rather than asking to be talked to.
const EXAMPLES: Record<string, string[]> = {
  home: ["What's urgent this week?", "What have I been putting off?", "Add a to-do"],
  "territory-planning": [
    "Who haven't I touched this cycle?",
    "Log a meeting",
    "What do we know about…",
  ],
  "meeting-prep": [
    "What's the hardest question I'll get?",
    "What am I missing?",
    "Add an attendee",
  ],
  insights: ["What's surprising in this data?", "Which question is doing no work?"],
  "conference-planning": ["Who haven't we covered?", "Log a contact", "Capture an insight"],
  "writing-studio": ["Is this too long?", "Does the ask land?", "What am I missing?"],
  "slide-studio": ["Where does this drag?", "Cut it to 12 minutes"],
  "interview-prep": ["What's the gap in this resume?", "What should I ask?"],
  dashboard: ["Chart my KOLs by tier", "What should I be looking at?"],
};

/** Answer text → the simple HTML the rest of Omni renders. */
function toHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((block) => {
      const lines = block.split("\n");
      const bulleted = lines.every((l) => /^\s*[-•*]\s+/.test(l));
      if (bulleted && lines.length > 1)
        return `<ul>${lines
          .map((l) => `<li>${escapeHtml(l.replace(/^\s*[-•*]\s+/, ""))}</li>`)
          .join("")}</ul>`;
      return `<p>${lines.map(escapeHtml).join("<br>")}</p>`;
    })
    .join("");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function OmniChat() {
  const scope = useResolvedScope();
  const { userId } = useUserId();
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  // The request in flight, so the writer can call it off. Without this the
  // only way out of an answer you have changed your mind about was to close
  // the chat, which throws the whole conversation away with it.
  const inFlight = useRef<AbortController | null>(null);
  // Only the thinking is stoppable; an action mid-write is not.
  const [canStop, setCanStop] = useState(false);
  // Keeping a conversation. `asking` is the question on the way out, `fromId`
  // is the saved thread this one was reopened from — saving again updates it
  // rather than leaving three copies of a conversation that grew twice.
  const [asking, setAsking] = useState(false);
  const [fromId, setFromId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<SavedChat[] | null>(null);
  const [working, setWorking] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const [reading, setReading] = useState(false);
  // Where the bubble sits, as an offset from its corner. It is fixed to the
  // bottom right of every page in the app, which means on any page with
  // something in that corner — the question bin, a table's last row — it sits
  // on top of it and that thing cannot be clicked. Rather than move it and
  // break a different page, it can be dragged, and it remembers where it was
  // put. Per browser, which is right for a preference about one screen.
  //
  // The position is written straight to the element rather than held in
  // state: nothing else renders from it, and a transform that only exists on
  // the client would not match what the server sent.
  const boxRef = useRef<HTMLElement | null>(null);
  const nudge = useRef({ x: 0, y: 0 });
  const drag = useRef<{ mx: number; my: number; x: number; y: number; moved: boolean } | null>(
    null,
  );

  const place = () => {
    if (boxRef.current)
      boxRef.current.style.transform = `translate(${nudge.current.x}px, ${nudge.current.y}px)`;
  };

  useEffect(() => {
    try {
      const raw = localStorage.getItem("omni:chat:nudge");
      const v = raw ? JSON.parse(raw) : null;
      if (typeof v?.x === "number" && typeof v?.y === "number") nudge.current = v;
    } catch {
      // A blocked or empty store just means it opens in its corner.
    }
    place();
    // Re-applied when it opens or closes, because that swaps the element.
  }, [open]);

  function onBubbleDown(e: React.PointerEvent) {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = {
      mx: e.clientX,
      my: e.clientY,
      x: nudge.current.x,
      y: nudge.current.y,
      moved: false,
    };
  }

  function onBubbleMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.mx;
    const dy = e.clientY - d.my;
    // A few pixels of travel is a click with a shaky hand, not a drag.
    if (!d.moved && Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
    d.moved = true;
    // Keep it on the screen whatever happens.
    nudge.current = {
      x: Math.max(-(window.innerWidth - 120), Math.min(20, d.x + dx)),
      y: Math.max(-(window.innerHeight - 90), Math.min(20, d.y + dy)),
    };
    place();
  }

  function onBubbleUp() {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.moved) {
      try {
        localStorage.setItem("omni:chat:nudge", JSON.stringify(nudge.current));
      } catch {
        // Not worth failing a drag over.
      }
    } else {
      setOpen(true);
    }
  }
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // The conversation is about the thing on screen, so moving to another thing
  // starts a new one rather than answering about the last one.
  const anchor = `${scope.app}:${scope.subject?.id || ""}`;
  const lastAnchor = useRef(anchor);
  useEffect(() => {
    if (lastAnchor.current !== anchor) {
      lastAnchor.current = anchor;
      setTurns([]);
      setError("");
    }
  }, [anchor]);

  useEffect(() => {
    if (turns.length) endRef.current?.scrollIntoView({ block: "nearest" });
  }, [turns, working]);

  // The box grows with what is in it, up to a point. On one line, a question
  // long enough to be worth asking scrolled its own beginning out of sight
  // while it was being typed, so there was no way to reread it before sending.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [draft, open, pending.length]);

  // Escape puts it away, like every other overlay here.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const examples = useMemo(() => EXAMPLES[scope.app] || EXAMPLES.home, [scope.app]);

  /** Out of the way, conversation intact — the badge on the bubble says so. */
  function minimize() {
    setOpen(false);
  }

  /** Done with it: put it away and throw the conversation out. */
  function close() {
    setOpen(false);
    setTurns([]);
    setPending([]);
    setDraft("");
    setError("");
    setAsking(false);
    setFromId(null);
    setShowHistory(false);
  }

  /** Where this conversation belongs: the app, and what it was about. */
  const chatKey = {
    app: scope.app,
    subjectKind: scope.subject?.kind || "",
    subjectId: scope.subject?.id || "",
  };

  // Walking to a different meeting unties this conversation from the thread
  // it was reopened from. Without this, saving here would quietly overwrite
  // the kept chat belonging to the record they just left.
  //
  // Adjusted during render rather than in an effect: this is state that has
  // to be right for the paint that follows the move, and an effect would let
  // one render go out still holding the old thread's id.
  const keyId = `${chatKey.app}|${chatKey.subjectKind}|${chatKey.subjectId}`;
  const [lastKey, setLastKey] = useState(keyId);
  if (lastKey !== keyId) {
    setLastKey(keyId);
    setFromId(null);
    setHistory(null);
    setShowHistory(false);
  }

  /** Keep it, then go. */
  async function keepAndClose() {
    if (!userId) return close();
    setSaving(true);
    try {
      await saveChat(userId, chatKey, turns, fromId || undefined);
      close();
    } catch (e) {
      // Not saved means not closed. Closing anyway would throw away the thing
      // they just asked to keep, which is the one outcome worse than the
      // error itself.
      setError((e as Error).message);
      setAsking(false);
    } finally {
      setSaving(false);
    }
  }

  async function openHistory() {
    setShowHistory(true);
    if (!userId) return;
    try {
      setHistory(await listChats(userId, chatKey));
    } catch (e) {
      setError((e as Error).message);
      setHistory([]);
    }
  }

  /** Put a kept conversation back on screen, to carry on or to read. */
  function reopen(c: SavedChat) {
    setTurns(c.turns);
    setFromId(c.id);
    setShowHistory(false);
    setError("");
  }

  // Attach a screenshot or a document to the question. Same extractor the
  // writer's draft box uses, so a picture of the thing you're asking about is
  // read into text the model can actually reason over.
  async function attach(files: File[]) {
    if (!files.length) return;
    setReading(true);
    setError("");
    try {
      for (const file of files) {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/writer/ingest", {
          method: "POST",
          credentials: "same-origin",
          body: form,
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Could not read that file");
        const isImage = (file.type || "").startsWith("image/");
        setPending((prev) => [
          ...prev,
          {
            id: `p_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            name: file.name || (isImage ? "Screenshot" : "Attachment"),
            kind: isImage ? "image" : "document",
            text: String(json.html || "")
              .replace(/<br\s*\/?>/gi, "\n")
              .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
              .replace(/<[^>]+>/g, "")
              .replace(/&amp;/g, "&")
              .replace(/&#39;|&apos;/g, "'")
              .replace(/&quot;/g, '"')
              .replace(/\n{3,}/g, "\n\n")
              .trim(),
          },
        ]);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setReading(false);
    }
  }

  async function ask(question: string) {
    const text = question.trim();
    if ((!text && !pending.length) || busy) return;
    setDraft("");
    setError("");
    const attached = pending;
    setPending([]);
    const content = attached.length
      ? `${text || "Have a look at this."}\n\n${attached
          .map((f) => `--- Attached: ${f.name} ---\n${f.text}`)
          .join("\n\n")}`
      : text;
    const next: ChatTurn[] = [
      ...turns,
      {
        role: "user",
        content,
        display: text || "Have a look at this.",
        files: attached.map((f) => ({ name: f.name, kind: f.kind })),
      },
    ];
    setTurns(next);
    setBusy(true);
    const ctrl = new AbortController();
    inFlight.current = ctrl;
    setCanStop(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        signal: ctrl.signal,
        body: JSON.stringify({
          action: "ask",
          app: scope.app,
          context: scope.context,
          subject: scope.subject,
          canEdit: !!scope.onEdit,
          editLabel: scope.editLabel,
          // Events are this side's own notes about what happened; the model
          // sees them as assistant turns so it knows the thing exists now.
          turns: next
            .filter((t) => t.role !== "event" || t.content)
            .map((t) => ({
              role: t.role === "user" ? "user" : "assistant",
              content: t.content,
            })),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not answer that");
      const lookups: { query: string }[] = Array.isArray(json.lookups) ? json.lookups : [];
      setTurns([
        // A look-up is invisible work, and invisible work that takes four
        // seconds reads as a hang. Say what was checked.
        ...(lookups.length
          ? [
              ...next,
              {
                role: "event" as const,
                content: "",
                display: `Checked your other apps for ${lookups
                  .map((l) => `"${l.query}"`)
                  .join(", ")}`,
              },
            ]
          : next),
        {
          role: "assistant",
          content: String(json.reply || ""),
          actions: (Array.isArray(json.actions) ? json.actions : []) as ProposedAction[],
          done: {},
        },
      ]);
    } catch (e) {
      // Stopping it yourself is not an error, and saying so in red makes it
      // look like something went wrong.
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      setCanStop(false);
      inFlight.current = null;
      setBusy(false);
    }
  }

  /**
   * Call off the answer it is writing.
   *
   * Only ever the thinking. Running an action is a write — to a task list, a
   * meeting, a note — and stopping one halfway through leaves the writer
   * guessing which half landed. Those are short anyway; it is the long think
   * you change your mind during.
   */
  function stop() {
    inFlight.current?.abort();
    inFlight.current = null;
    setCanStop(false);
    setBusy(false);
    setWorking("");
  }

  async function run(turnIndex: number, actionIndex: number) {
    const action = turns[turnIndex]?.actions?.[actionIndex];
    if (!action || !userId || busy) return;
    setBusy(true);
    setError("");
    setTurns((prev) =>
      prev.map((t, i) => (i === turnIndex ? { ...t, running: actionIndex } : t)),
    );
    try {
      const outcome: ActionOutcome = await runAction(action, {
        userId,
        scope,
        note: setWorking,
      });
      // The action wrote to the table. If the page behind this panel is
      // holding that record in state, it has just gone stale — the change is
      // invisible, and its next autosave of the same column would put the old
      // copy back. Tell it to read itself again.
      try {
        await scope.reload?.();
      } catch {
        // A refresh that fails is a stale screen, not a lost write. The
        // action already succeeded and saying otherwise would be wrong.
      }
      setTurns((prev) => [
        ...prev.map((t, i) =>
          i === turnIndex
            ? { ...t, running: undefined, done: { ...(t.done || {}), [actionIndex]: outcome } }
            : t,
        ),
        // Told to the model as well as to the person: a follow-up like "add her
        // to my to-do list too" needs to know what just happened.
        {
          role: "event" as const,
          content: `[done] ${outcome.message}${outcome.detail ? ` (${outcome.detail})` : ""}`,
          display: outcome.message,
        },
      ]);
    } catch (e) {
      setError((e as Error).message);
      setTurns((prev) =>
        prev.map((t, i) => (i === turnIndex ? { ...t, running: undefined } : t)),
      );
    } finally {
      setWorking("");
      setBusy(false);
    }
  }

  if (!open)
    return (
      <button
        type="button"
        onPointerDown={onBubbleDown}
        onPointerMove={onBubbleMove}
        onPointerUp={onBubbleUp}
        onPointerCancel={() => (drag.current = null)}
        ref={(el) => {
          boxRef.current = el;
          place();
        }}
        title="Ask about this. Drag it if it's in your way."
        className="fixed bottom-5 right-5 z-40 flex touch-none items-center gap-2 rounded-full bg-gradient-to-r from-[var(--grad-from)] to-[var(--grad-to)] py-3 pl-4 pr-5 text-white shadow-lg transition hover:opacity-90 hover:shadow-xl active:cursor-grabbing"
      >
        <MessageCircle size={18} />
        <span className="text-sm font-semibold">Ask</span>
        {turns.some((t) => t.role === "assistant") && (
          <span className="grid h-5 min-w-5 place-items-center rounded-full bg-white/25 px-1 text-[10px] font-bold tabular-nums">
            {turns.filter((t) => t.role === "assistant").length}
          </span>
        )}
      </button>
    );

  return (
    <section
      ref={(el) => {
        boxRef.current = el;
        place();
      }}
      className="fixed bottom-5 right-5 z-40 flex max-h-[min(70vh,620px)] w-[min(24rem,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
    >
      <div className="flex items-center gap-2.5 border-b border-border bg-canvas/60 px-3.5 py-2.5">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]">
          <MessageCircle size={15} />
        </span>
        {/* The whole title bar is the minimize target — the two icons are for
            people who go looking for a control, and this is for everyone who
            just wants the thing out of the way. */}
        <button
          type="button"
          title="Minimize"
          onClick={minimize}
          className="min-w-0 flex-1 cursor-pointer text-left"
        >
          <span className="block truncate text-sm font-semibold">
            {scope.subject ? `Ask about ${scope.subject.label}` : "Ask"}
          </span>
        </button>
        <button
          type="button"
          title="Minimize — keeps this conversation"
          aria-label="Minimize"
          onClick={minimize}
          className="grid h-8 w-8 place-items-center rounded-lg text-muted transition hover:bg-surface hover:text-ink"
        >
          <ChevronDown size={17} />
        </button>
        <button
          type="button"
          title="Chats you've kept about this"
          aria-label="Chats you've kept"
          onClick={() => (showHistory ? setShowHistory(false) : void openHistory())}
          className="grid h-8 w-8 place-items-center rounded-lg text-muted transition hover:bg-surface hover:text-ink"
        >
          <History size={16} />
        </button>
        <button
          type="button"
          title={turns.length ? "Close this conversation" : "Close"}
          aria-label="Close"
          // Closing with something in it asks whether to keep it, rather than
          // binning it on the way out. Saving is a decision, never automatic.
          onClick={() => (turns.length ? setAsking(true) : close())}
          className="grid h-8 w-8 place-items-center rounded-lg text-muted transition hover:bg-surface hover:text-red-600"
        >
          <X size={17} />
        </button>
      </div>

      {/* On the way out: keep it, or don't. The X used to decide for them. */}
      {asking && (
        <div className="border-b border-border bg-canvas px-3.5 py-2.5">
          <p className="text-xs font-medium text-ink">Keep this chat?</p>
          <p className="mt-0.5 text-[11px] leading-snug text-muted">
            Yours only — it stays with {scope.subject?.label || "this app"} and nobody
            you share that with can see it.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => void keepAndClose()}
              className="rounded-md bg-[var(--accent)] px-2.5 py-1 text-xs font-semibold text-white transition disabled:opacity-50"
            >
              {saving ? "Keeping…" : "Keep it"}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={close}
              className="rounded-md px-2 py-1 text-xs font-medium text-muted transition hover:text-red-600"
            >
              Discard
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => setAsking(false)}
              className="rounded-md px-2 py-1 text-xs font-medium text-muted transition hover:text-ink"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {showHistory && (
        <div className="max-h-64 overflow-y-auto border-b border-border bg-canvas px-3.5 py-2.5">
          <p className="text-xs font-medium text-ink">
            Kept about {scope.subject?.label || "this app"}
          </p>
          {history === null ? (
            <p className="mt-1.5 text-[11px] text-muted">Looking…</p>
          ) : history.length === 0 ? (
            <p className="mt-1.5 text-[11px] leading-snug text-muted">
              Nothing kept yet. When you close a chat it asks whether to keep it.
            </p>
          ) : (
            <ul className="mt-1.5 space-y-1">
              {history.map((c) => (
                <li key={c.id} className="group/c flex items-start gap-1.5">
                  <button
                    type="button"
                    onClick={() => reopen(c)}
                    className="min-w-0 flex-1 rounded-md px-1.5 py-1 text-left transition hover:bg-surface"
                  >
                    <span className="block truncate text-[11px] font-medium text-ink">
                      {c.title}
                    </span>
                    <span className="block text-[10px] text-muted">
                      {new Date(c.updatedAt).toLocaleDateString()} ·{" "}
                      {c.turns.filter((t) => t.role === "user").length} asked
                    </span>
                  </button>
                  <button
                    type="button"
                    title="Delete this chat"
                    aria-label="Delete this chat"
                    onClick={async () => {
                      try {
                        await deleteChat(c.id);
                        setHistory((h) => (h || []).filter((x) => x.id !== c.id));
                        if (fromId === c.id) setFromId(null);
                      } catch (e) {
                        setError((e as Error).message);
                      }
                    }}
                    className="mt-1 shrink-0 rounded p-0.5 text-muted opacity-0 transition hover:text-red-600 group-hover/c:opacity-100 max-sm:opacity-100"
                  >
                    <X size={12} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex-1 space-y-3 overflow-y-auto px-3.5 py-3">
        {turns.length === 0 && (
          <div className="space-y-2">
            <p className="text-[11px] leading-snug text-muted">
              I can see this page. Ask, or say what you want done — nothing
              happens until you press the button.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {examples.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => void ask(q)}
                  className="rounded-full border border-border px-2.5 py-1 text-[11px] font-medium text-muted transition hover:border-[var(--accent)]/50 hover:text-ink"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((turn, i) =>
          turn.role === "user" ? (
            <div key={i} className="flex flex-col items-end gap-1">
              <p className="max-w-[85%] rounded-2xl rounded-br-sm bg-[var(--accent-soft)] px-3 py-1.5 text-sm text-ink">
                {turn.display ?? turn.content}
              </p>
              {turn.files?.length ? (
                <div className="flex flex-wrap justify-end gap-1">
                  {turn.files.map((f, n) => (
                    <span
                      key={n}
                      className="flex items-center gap-1 rounded-full bg-canvas px-2 py-0.5 text-[10px] font-medium text-muted"
                    >
                      {f.kind === "image" ? <ImageIcon size={10} /> : <FileText size={10} />}
                      <span className="max-w-32 truncate">{f.name}</span>
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          ) : turn.role === "event" ? (
            <p className="flex items-center gap-1.5 text-[11px] italic text-muted">
              {turn.content.startsWith("[done]") ? (
                <Check size={11} className="shrink-0 text-emerald-600" />
              ) : (
                <Search size={11} className="shrink-0" />
              )}
              {turn.display}
            </p>
          ) : (
            <div key={i} className="flex gap-2">
              <Sparkles size={14} className="mt-1 shrink-0 text-[var(--accent)]" />
              <div className="min-w-0 flex-1">
                <RichTextView html={toHtml(turn.content)} />
                {(turn.actions || []).map((action, n) => {
                  const outcome = turn.done?.[n];
                  return (
                    <div key={n} className="mt-1.5">
                      <button
                        type="button"
                        disabled={busy || !!outcome}
                        onClick={() => void run(i, n)}
                        className="flex items-center gap-1 rounded-lg bg-[var(--accent)] px-2 py-1 text-[11px] font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
                      >
                        {outcome ? (
                          <>
                            <Check size={11} /> Done
                          </>
                        ) : turn.running === n ? (
                          <>
                            <Loader2 size={11} className="animate-spin" /> Working…
                          </>
                        ) : (
                          <>
                            <Wand2 size={11} /> {action.label || "Do it"}
                          </>
                        )}
                      </button>
                      {outcome?.href && (
                        <Link
                          href={outcome.href}
                          className="ml-2 inline-flex items-center gap-0.5 text-[11px] font-semibold text-[var(--accent)] hover:underline"
                        >
                          Open <ArrowUpRight size={11} />
                        </Link>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ),
        )}

        {busy && (
          <p className="flex items-center gap-2 text-xs text-muted">
            <Loader2 size={13} className="animate-spin" /> {working || "Thinking…"}
          </p>
        )}
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div ref={endRef} />
      </div>

      <div
        className="shrink-0 border-t border-border bg-canvas/40 px-3 py-2"
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) e.preventDefault();
        }}
        onDrop={(e) => {
          const files = Array.from(e.dataTransfer.files || []).filter((f) => f.size > 0);
          if (!files.length) return;
          e.preventDefault();
          void attach(files);
        }}
      >
        {(pending.length > 0 || reading) && (
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            {pending.map((f) => (
              <span
                key={f.id}
                className="flex items-center gap-1 rounded-lg border border-border bg-canvas py-0.5 pl-1.5 pr-0.5 text-[11px]"
              >
                {f.kind === "image" ? <ImageIcon size={11} /> : <FileText size={11} />}
                <span className="max-w-32 truncate font-medium">{f.name}</span>
                <button
                  type="button"
                  onClick={() => setPending((prev) => prev.filter((x) => x.id !== f.id))}
                  className="rounded p-0.5 text-muted transition hover:text-red-600"
                >
                  <X size={10} />
                </button>
              </span>
            ))}
            {reading && (
              <span className="flex items-center gap-1 text-[11px] text-muted">
                <Loader2 size={11} className="animate-spin" /> Reading…
              </span>
            )}
          </div>
        )}

        <div className="flex items-end gap-2">
          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            accept=".pdf,.docx,.doc,.txt,.md,.csv,.png,.jpg,.jpeg,.gif,.webp"
            onChange={(e) => {
              const files = Array.from(e.target.files || []);
              e.target.value = "";
              if (files.length) void attach(files);
            }}
          />
          <button
            type="button"
            title="Attach a screenshot or a file"
            disabled={reading}
            onClick={() => fileRef.current?.click()}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-border text-muted transition hover:border-[var(--accent)]/50 hover:text-ink disabled:opacity-50"
          >
            <Paperclip size={14} />
          </button>
          <textarea
            ref={inputRef}
            rows={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onPaste={(e) => {
              const images = Array.from(e.clipboardData.files || []).filter((f) =>
                f.type.startsWith("image/"),
              );
              if (images.length) {
                e.preventDefault();
                void attach(images);
              }
            }}
            onKeyDown={(e) => {
              // Enter sends; Shift+Enter is how you get a second line, and the
              // box grows to show it.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void ask(draft);
              }
            }}
            placeholder={pending.length ? "Add a question, or just send it…" : "Ask, or say what you want done…"}
            className="max-h-42 min-h-8 flex-1 resize-none overflow-y-auto rounded-lg border border-border bg-canvas px-2.5 py-1.5 text-sm leading-relaxed outline-none transition focus:border-[var(--accent)]"
          />
          {/* While it is thinking, the same button stops it. An answer you
              have already decided against is a wait with nothing at the end
              of it, and there was no way out of it but to close the chat. */}
          {busy && canStop ? (
            <button
              type="button"
              title="Stop"
              aria-label="Stop"
              onClick={stop}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-border bg-surface text-muted transition hover:border-red-300 hover:text-red-600"
            >
              <Square size={12} className="fill-current" />
            </button>
          ) : (
            <button
              type="button"
              disabled={busy || reading || (!draft.trim() && !pending.length)}
              onClick={() => void ask(draft)}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gradient-to-r from-[var(--grad-from)] to-[var(--grad-to)] text-white transition disabled:opacity-40"
            >
              <Send size={14} />
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
