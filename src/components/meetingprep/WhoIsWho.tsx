"use client";

// Who's who: say who each "Speaker A" is and the notes are rewritten with it.
//
// Picked where the label is: every "Speaker A" in the notes is marked, and
// clicking one opens a small box beside it with a name, "Me" and pronouns.
// The box also shows what that speaker said or what the notes credit them
// with, because a recording saved without its transcript has nothing else to
// tell the voices apart, and a bare "Speaker C" can't be named from memory.
//
// Naming one speaker can wait for the others: "Name another first" holds it,
// and one rewrite applies them all. One rewrite, not three, because who one
// person is changes how sentences about the others read.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { Users, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { isComplete, type Pronouns, type SpeakerAssignment } from "@/lib/meetingprep/speakers";

const LABEL = /\bSpeaker [A-Z0-9]{1,2}\b/g;
const HIGHLIGHT = "omni-speaker";

export type SpeakerClues = { said: string[]; notes: string[] };

/**
 * What a speaker said (transcript lines that start with the label) and the
 * bullets and follow-ups that mention them. Bullets are their own text only,
 * not the bullets nested under them, so each clue is one point.
 */
export function speakerClues(
  label: string,
  { transcript, notesHtml, actions }: { transcript?: string; notesHtml?: string; actions?: string[] },
): SpeakerClues {
  const said = (transcript || "")
    .split("\n")
    .filter((l) => l.startsWith(`${label}:`))
    .map((l) => l.slice(label.length + 1).trim())
    .filter((l) => l.split(/\s+/).length >= 4)
    .slice(0, 3)
    .map((l) => (l.length > 160 ? `${l.slice(0, 160)}…` : l));

  const notes: string[] = [];
  if (notesHtml && typeof DOMParser !== "undefined") {
    const doc = new DOMParser().parseFromString(notesHtml, "text/html");
    for (const li of doc.querySelectorAll("li")) {
      const own = [...li.childNodes]
        .filter((n) => !(n instanceof Element && /^(UL|OL)$/.test(n.tagName)))
        .map((n) => n.textContent || "")
        .join("")
        .replace(/\s+/g, " ")
        .trim();
      if (own.includes(label)) notes.push(own);
    }
  }
  for (const a of actions || []) if (a.includes(label)) notes.push(a.trim());

  return { said, notes: notes.slice(0, 4) };
}

type Props = {
  labels: string[];
  /** The notes editor. Labels inside it are marked and clickable. */
  targetRef: RefObject<HTMLElement | null>;
  /** Re-mark when this changes: the notes HTML. */
  watch: string;
  clues: (label: string) => SpeakerClues;
  /** Names to offer: the meeting's attendees. */
  people: string[];
  busy?: boolean;
  onApply: (assignments: SpeakerAssignment[]) => void;
};

type Open = { label: string; x: number; y: number };

// Firefox has caretPositionFromPoint, Chromium and Safari caretRangeFromPoint.
function caretAt(x: number, y: number): { node: Node; offset: number } | null {
  const d = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  if (d.caretPositionFromPoint) {
    const p = d.caretPositionFromPoint(x, y);
    return p ? { node: p.offsetNode, offset: p.offset } : null;
  }
  const r = document.caretRangeFromPoint?.(x, y);
  return r ? { node: r.startContainer, offset: r.startOffset } : null;
}

function labelAt(x: number, y: number): string | null {
  const at = caretAt(x, y);
  if (!at || at.node.nodeType !== Node.TEXT_NODE) return null;
  const text = at.node.textContent || "";
  for (const m of text.matchAll(LABEL)) {
    const start = m.index ?? 0;
    if (at.offset >= start && at.offset <= start + m[0].length) return m[0];
  }
  return null;
}

export function WhoIsWho({ labels, targetRef, watch, clues, people, busy, onApply }: Props) {
  const [held, setHeld] = useState<Record<string, SpeakerAssignment>>({});
  const [open, setOpen] = useState<Open | null>(null);
  const [draft, setDraft] = useState<SpeakerAssignment>({ label: "", name: "", pronouns: "" });
  const boxRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const openFor = useCallback(
    (label: string, x: number, y: number) => {
      setDraft(held[label] || { label, name: "", pronouns: "" });
      setOpen({ label, x, y });
    },
    [held],
  );

  // Mark every label in the notes without touching the notes' HTML: the
  // editor owns that, and a wrapping <span> would be saved into the meeting.
  useEffect(() => {
    const el = targetRef.current;
    const reg = (globalThis as { CSS?: { highlights?: Map<string, unknown> } }).CSS?.highlights;
    const Ctor = (globalThis as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
    if (!el || !reg || !Ctor) return;
    const ranges: Range[] = [];
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      for (const m of (n.textContent || "").matchAll(LABEL)) {
        const r = document.createRange();
        r.setStart(n, m.index ?? 0);
        r.setEnd(n, (m.index ?? 0) + m[0].length);
        ranges.push(r);
      }
    }
    reg.set(HIGHLIGHT, new Ctor(...ranges));
    return () => {
      reg.delete(HIGHLIGHT);
    };
  }, [targetRef, watch, labels.length]);

  // A plain click on a label opens the box. A drag-select doesn't, so
  // selecting text to replace still works as before.
  useEffect(() => {
    const el = targetRef.current;
    if (!el || busy) return;
    const onClick = (e: MouseEvent) => {
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) return;
      const label = labelAt(e.clientX, e.clientY);
      if (label) openFor(label, e.clientX, e.clientY);
    };
    const onMove = (e: MouseEvent) => {
      el.style.cursor = labelAt(e.clientX, e.clientY) ? "pointer" : "";
    };
    el.addEventListener("click", onClick);
    el.addEventListener("mousemove", onMove);
    return () => {
      el.removeEventListener("click", onClick);
      el.removeEventListener("mousemove", onMove);
      el.style.cursor = "";
    };
  }, [targetRef, busy, openFor]);

  // Placed beside the click, kept on screen.
  useLayoutEffect(() => {
    if (!open || !boxRef.current) return setPos(null);
    const { offsetWidth: w, offsetHeight: h } = boxRef.current;
    const pad = 12;
    const left = Math.max(pad, Math.min(open.x - 24, window.innerWidth - w - pad));
    const below = open.y + 14;
    const top = below + h + pad > window.innerHeight ? Math.max(pad, open.y - h - 14) : below;
    setPos({ left, top });
    nameRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !boxRef.current?.contains(e.target as Node)) {
        setOpen(null);
      }
    };
    // The page scrolling moves the label out from under a fixed box; the
    // clue list scrolling inside it does not count.
    const onScroll = (e: Event) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(null);
    };
    const t = setTimeout(() => document.addEventListener("mousedown", close), 0);
    document.addEventListener("keydown", close);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  if (!labels.length) return null;

  const pending = Object.values(held).filter((a) => labels.includes(a.label) && isComplete(a));
  const others = labels.filter((l) => l !== open?.label && !held[l]);

  function hold() {
    setHeld((h) => {
      const next = { ...h, [draft.label]: draft };
      if (draft.me) for (const k of Object.keys(next)) if (k !== draft.label) next[k] = { ...next[k], me: false };
      return next;
    });
  }
  function apply(list: SpeakerAssignment[]) {
    setOpen(null);
    setHeld({});
    onApply(list.filter(isComplete));
  }
  function applyNow() {
    const rest = pending.filter((a) => a.label !== draft.label).map((a) => (draft.me ? { ...a, me: false } : a));
    apply([...rest, draft]);
  }

  const c = open ? clues(open.label) : null;

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-lg border border-border bg-canvas px-3 py-2 text-xs">
        <Users size={14} className="shrink-0 text-[var(--accent)]" />
        <span className="text-muted">Click a speaker in the notes to say who it is:</span>
        {labels.map((l) => {
          const h = held[l];
          return (
            <button
              key={l}
              type="button"
              disabled={busy}
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                openFor(l, r.left + 24, r.bottom);
              }}
              className="rounded-md border border-border bg-surface px-2 py-0.5 font-medium transition hover:border-[var(--accent)] disabled:opacity-60"
            >
              {l}
              {h && isComplete(h) && <span className="text-[var(--accent)]"> → {h.me ? "me" : h.name}</span>}
            </button>
          );
        })}
        {pending.length > 0 && (
          <Button size="sm" disabled={busy} onClick={() => apply(pending)} className="ml-auto">
            {busy ? "Rewriting…" : `Rewrite with ${pending.length === 1 ? "this name" : "these names"}`}
          </Button>
        )}
      </div>

      {open && (
        <div
          ref={boxRef}
          role="dialog"
          aria-label={`Who is ${open.label}?`}
          style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: 0 }}
          className="fixed z-50 w-80 max-w-[calc(100vw-24px)] rounded-lg border border-border bg-surface p-3 shadow-xl"
        >
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">Who is {open.label}?</p>
            <button type="button" onClick={() => setOpen(null)} className="text-muted hover:text-ink" aria-label="Close">
              <X size={14} />
            </button>
          </div>

          {c && (c.said.length > 0 || c.notes.length > 0) ? (
            <div className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-md bg-canvas p-2 text-[11px] leading-snug">
              {c.said.length > 0 && <p className="font-medium text-muted">They said</p>}
              {c.said.map((s, i) => (
                <p key={`s${i}`} className="italic">&ldquo;{s}&rdquo;</p>
              ))}
              {c.notes.length > 0 && <p className="pt-1 font-medium text-muted">In the notes</p>}
              {c.notes.map((s, i) => (
                <p key={`n${i}`}>• {s}</p>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-[11px] text-muted">Nothing else in this meeting mentions {open.label}.</p>
          )}

          <datalist id="omni-whoiswho">
            {people.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
          <div className="mt-3 flex items-center gap-2">
            <input
              ref={nameRef}
              value={draft.me ? "" : draft.name}
              disabled={draft.me}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value, me: false }))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && isComplete(draft)) applyNow();
              }}
              list="omni-whoiswho"
              placeholder={draft.me ? "You" : "Name"}
              className="min-w-0 flex-1 rounded-md border border-border bg-canvas px-2 py-1.5 text-sm outline-none transition focus:border-[var(--accent)] disabled:opacity-60"
            />
            <button
              type="button"
              onClick={() => setDraft((d) => ({ ...d, me: !d.me }))}
              className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition ${
                draft.me
                  ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                  : "border-border text-muted hover:text-ink"
              }`}
            >
              Me
            </button>
            {!draft.me && (
              <select
                value={draft.pronouns || ""}
                onChange={(e) => setDraft((d) => ({ ...d, pronouns: e.target.value as Pronouns }))}
                className="rounded-md border border-border bg-canvas px-1.5 py-1.5 text-xs"
                aria-label={`Pronouns for ${open.label}`}
              >
                <option value="">he/she?</option>
                <option value="he">he</option>
                <option value="she">she</option>
                <option value="they">they</option>
              </select>
            )}
          </div>
          {people.length > 0 && !draft.me && (
            <div className="mt-2 flex flex-wrap gap-1">
              {people.slice(0, 8).map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setDraft((d) => ({ ...d, name: n, me: false }))}
                  className={`rounded-full border px-2 py-0.5 text-[11px] transition ${
                    draft.name === n
                      ? "border-[var(--accent)] text-[var(--accent)]"
                      : "border-border text-muted hover:text-ink"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          )}

          <div className="mt-3 flex items-center justify-end gap-2">
            {others.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                disabled={!isComplete(draft)}
                onClick={() => {
                  hold();
                  setOpen(null);
                }}
              >
                Name another first
              </Button>
            )}
            <Button size="sm" disabled={busy || !isComplete(draft)} onClick={applyNow}>
              Rewrite notes
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
