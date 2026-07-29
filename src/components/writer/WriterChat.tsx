"use client";

// Ask-me-anything about the piece you're working on. Modelled on the dashboard's
// chat (turn list, example prompts, input pinned at the bottom) but with real
// conversation history, because "is that too blunt?" only makes sense as a
// follow-up to what was already said.
//
// It is deliberately read-only: it will tell you what to change and what to type
// into the refine box, but Generate and Refine stay the only things that touch
// your draft. A chat that silently rewrites the text you are looking at is how
// you lose work you didn't know you had.

import { useEffect, useRef, useState } from "react";
import { Loader2, MessageCircle, Send, Sparkles, Trash2 } from "lucide-react";
import { RichTextView } from "@/components/ui/RichText";

interface Turn {
  role: "user" | "assistant";
  content: string;
}

const EXAMPLES = [
  "Is this too long?",
  "Does the ask land?",
  "How would you open it?",
  "What am I missing?",
];

/** Answer text → the same simple HTML the rest of the studio renders. */
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

export function WriterChat({
  docType,
  draft,
  output,
  notes,
}: {
  docType: string;
  /** Plain text of what's in the draft box. */
  draft: string;
  /** Plain text of the current version in the output pane. */
  output: string;
  notes: string;
}) {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draftQuestion, setDraftQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  // Keep the newest answer in view as it arrives.
  useEffect(() => {
    if (turns.length) endRef.current?.scrollIntoView({ block: "nearest" });
  }, [turns]);

  async function ask(question: string) {
    const text = question.trim();
    if (!text || busy) return;
    setDraftQuestion("");
    setError("");
    const next: Turn[] = [...turns, { role: "user", content: text }];
    setTurns(next);
    setBusy(true);
    try {
      const res = await fetch("/api/writer/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          action: "chat",
          docType,
          draft,
          output,
          notes,
          turns: next,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not answer that");
      setTurns([...next, { role: "assistant", content: String(json.reply || "") }]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 rounded-xl border border-border bg-surface px-3.5 py-2.5 text-left shadow-sm transition hover:border-[var(--accent)]/50"
      >
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-teal-100 text-teal-600">
          <MessageCircle size={15} />
        </span>
        <span className="flex-1 text-sm font-semibold">Ask about this piece</span>
        <span className="text-[11px] text-muted">
          {turns.length ? `${turns.length} messages` : "Questions, second opinions"}
        </span>
      </button>
    );

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
      <div className="flex items-center gap-2.5 border-b border-border px-3.5 py-2.5">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-teal-100 text-teal-600">
          <MessageCircle size={15} />
        </span>
        <span className="flex-1 text-sm font-semibold">Ask about this piece</span>
        {turns.length > 0 && (
          <button
            type="button"
            title="Clear the conversation"
            onClick={() => {
              setTurns([]);
              setError("");
            }}
            className="grid h-7 w-7 place-items-center rounded text-muted transition hover:bg-canvas hover:text-red-600"
          >
            <Trash2 size={13} />
          </button>
        )}
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded px-1.5 py-0.5 text-[11px] font-medium text-muted transition hover:text-ink"
        >
          Hide
        </button>
      </div>

      <div className="max-h-80 space-y-3 overflow-y-auto px-3.5 py-3">
        {turns.length === 0 && (
          <div className="space-y-2">
            <p className="text-[11px] leading-snug text-muted">
              I can see your draft and the current version. Ask me anything about
              them: what&apos;s weak, what&apos;s missing, how it reads to the
              person getting it.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLES.map((q) => (
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
            <div key={i} className="flex justify-end">
              <p className="max-w-[85%] rounded-2xl rounded-br-sm bg-[var(--accent-soft)] px-3 py-1.5 text-sm text-ink">
                {turn.content}
              </p>
            </div>
          ) : (
            <div key={i} className="flex gap-2">
              <Sparkles size={14} className="mt-1 shrink-0 text-[var(--accent)]" />
              <div className="min-w-0 flex-1">
                <RichTextView html={toHtml(turn.content)} />
              </div>
            </div>
          ),
        )}

        {busy && (
          <p className="flex items-center gap-2 text-xs text-muted">
            <Loader2 size={13} className="animate-spin" /> Thinking…
          </p>
        )}
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div ref={endRef} />
      </div>

      <div className="flex items-center gap-2 border-t border-border px-3 py-2">
        <input
          value={draftQuestion}
          onChange={(e) => setDraftQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void ask(draftQuestion);
            }
          }}
          placeholder="Ask about this piece…"
          className="flex-1 rounded-lg border border-border bg-canvas px-2.5 py-1.5 text-sm outline-none transition focus:border-[var(--accent)]"
        />
        <button
          type="button"
          disabled={busy || !draftQuestion.trim()}
          onClick={() => void ask(draftQuestion)}
          className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-r from-[var(--grad-from)] to-[var(--grad-to)] text-white transition disabled:opacity-40"
        >
          <Send size={14} />
        </button>
      </div>
    </section>
  );
}
