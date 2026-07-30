"use client";

// Ask-me-anything about the piece you're working on. Modelled on the dashboard's
// chat (turn list, example prompts, input pinned at the bottom) but with real
// conversation history, because "is that too blunt?" only makes sense as a
// follow-up to what was already said.
//
// It never edits on its own: answering a question changes nothing. But when an
// answer proposes a specific change, it comes with the same change written as an
// instruction, and one button hands that straight to the normal refine pass —
// so agreeing with a suggestion doesn't mean retyping it and hoping the
// paraphrase survives. The edit still goes through Refine, which snapshots the
// current version first, so nothing happens that can't be undone.

import { useEffect, useRef, useState } from "react";
import {
  Check,
  FileText,
  Image as ImageIcon,
  Loader2,
  MessageCircle,
  Paperclip,
  Send,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import { RichTextView } from "@/components/ui/RichText";

interface Turn {
  role: "user" | "assistant";
  /** What goes to the model — the question plus any attached text. */
  content: string;
  /** What's shown in the thread: the question on its own. */
  display?: string;
  /** Names of anything attached to this question, for the chips under it. */
  files?: { name: string; kind: "image" | "document" }[];
  /** The change this answer proposed, ready to hand straight to Refine. */
  instruction?: string;
  applied?: boolean;
}

interface Pending {
  id: string;
  name: string;
  kind: "image" | "document";
  text: string;
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
  onApply,
  applying,
}: {
  docType: string;
  /** Plain text of what's in the draft box. */
  draft: string;
  /** Plain text of the current version in the output pane. */
  output: string;
  notes: string;
  /** Apply a suggested change to the piece, via the normal refine pass. */
  onApply?: (instruction: string) => Promise<void> | void;
  applying?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draftQuestion, setDraftQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const [reading, setReading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Attach a screenshot or a document to the question. Same route the draft box
  // uses, so a picture of the thing you're asking about is read into text the
  // model can actually reason over.
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

  // Keep the newest answer in view as it arrives.
  useEffect(() => {
    if (turns.length) endRef.current?.scrollIntoView({ block: "nearest" });
  }, [turns]);

  async function ask(question: string) {
    const text = question.trim();
    // A question can be nothing but an attachment ("what do you make of this?"
    // is implied by handing over a screenshot).
    if ((!text && !pending.length) || busy) return;
    setDraftQuestion("");
    setError("");
    const attached = pending;
    setPending([]);
    // The model sees the question with the attached text spliced in; the thread
    // shows the question with chips, so a pasted PDF doesn't bury the chat.
    const content = attached.length
      ? `${text || "Have a look at this."}\n\n${attached
          .map((f) => `--- Attached: ${f.name} ---\n${f.text}`)
          .join("\n\n")}`
      : text;
    const next: Turn[] = [
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
          turns: next.map((t) => ({ role: t.role, content: t.content })),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not answer that");
      setTurns([
        ...next,
        {
          role: "assistant",
          content: String(json.reply || ""),
          instruction: String(json.instruction || ""),
        },
      ]);
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
              person getting it. Attach a screenshot or a file if it helps
              explain the question.
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
          ) : (
            <div key={i} className="flex gap-2">
              <Sparkles size={14} className="mt-1 shrink-0 text-[var(--accent)]" />
              <div className="min-w-0 flex-1">
                <RichTextView html={toHtml(turn.content)} />
                {/* When the answer proposed an actual change, it can be applied
                    from here. The instruction is the model's own wording of what
                    it just suggested, handed to the same refine pass the box
                    below uses — so nothing is retyped and nothing is lost in the
                    retyping. */}
                {turn.instruction && onApply && (
                  <div className="mt-1.5 flex items-center gap-2">
                    <button
                      type="button"
                      disabled={!!applying || turn.applied}
                      onClick={async () => {
                        setTurns((prev) =>
                          prev.map((t, n) => (n === i ? { ...t, applied: true } : t)),
                        );
                        await onApply(turn.instruction!);
                      }}
                      className="flex items-center gap-1 rounded-lg bg-[var(--accent)] px-2 py-1 text-[11px] font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
                    >
                      {turn.applied ? (
                        <>
                          <Check size={11} /> Applied
                        </>
                      ) : (
                        <>
                          <Wand2 size={11} /> Make this change
                        </>
                      )}
                    </button>
                    {!turn.applied && (
                      <span className="min-w-0 flex-1 truncate text-[10px] italic text-muted">
                        {turn.instruction}
                      </span>
                    )}
                  </div>
                )}
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

      <div
        className="border-t border-border px-3 py-2"
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
        {/* Anything queued for the next question. */}
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
                  onClick={() => setPending((prev) => prev.filter((p) => p.id !== f.id))}
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

        <div className="flex items-center gap-2">
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
          <input
            value={draftQuestion}
            onChange={(e) => setDraftQuestion(e.target.value)}
            onPaste={(e) => {
              // Paste a screenshot straight into the question.
              const images = Array.from(e.clipboardData.files || []).filter((f) =>
                f.type.startsWith("image/"),
              );
              if (images.length) {
                e.preventDefault();
                void attach(images);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void ask(draftQuestion);
              }
            }}
            placeholder={
              pending.length ? "Add a question, or just send it…" : "Ask about this piece…"
            }
            className="flex-1 rounded-lg border border-border bg-canvas px-2.5 py-1.5 text-sm outline-none transition focus:border-[var(--accent)]"
          />
          <button
            type="button"
            disabled={busy || reading || (!draftQuestion.trim() && !pending.length)}
            onClick={() => void ask(draftQuestion)}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gradient-to-r from-[var(--grad-from)] to-[var(--grad-to)] text-white transition disabled:opacity-40"
          >
            <Send size={14} />
          </button>
        </div>
      </div>
    </section>
  );
}
