"use client";

import { useEffect, useRef } from "react";
import DOMPurify from "dompurify";
import { Bold, Italic, List, ListOrdered, IndentIncrease, IndentDecrease } from "lucide-react";

// Keep pasted content's structure (bold/italic/lists/links) but drop the
// colors/borders/fonts browsers carry over from Word, Docs, and web pages.
function cleanPaste(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ["b", "strong", "i", "em", "u", "ul", "ol", "li", "p", "br", "a", "h3", "h4"],
    ALLOWED_ATTR: ["href"],
  });
}

// Rich-text editor matching the session/KOL notes format: a compact toolbar
// (bold/italic · bullets/numbers · indent/outdent), keyboard shortcuts, and
// clean paste. Stores HTML; emits on input.
export function RichText({
  value,
  onChange,
  placeholder = "Start typing… (saves automatically)",
  minHeight = "min-h-28",
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const last = useRef(value);

  // Sync external value in without clobbering the caret while typing.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.innerHTML !== value && (el.innerHTML === "" || last.current !== value)) {
      el.innerHTML = value || "";
      last.current = value;
    }
  }, [value]);

  function emit() {
    const html = ref.current?.innerHTML || "";
    last.current = html;
    onChange(html);
  }

  function exec(command: string) {
    ref.current?.focus();
    document.execCommand(command, false);
    emit();
  }

  function onInput() {
    if (composing.current) return;
    emit();
  }

  function onPaste(e: React.ClipboardEvent) {
    const html = e.clipboardData.getData("text/html");
    const text = e.clipboardData.getData("text/plain");
    if (!html && !text) return;
    e.preventDefault();
    if (html) document.execCommand("insertHTML", false, cleanPaste(html));
    else document.execCommand("insertText", false, text);
    emit();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === "b") { e.preventDefault(); exec("bold"); }
    if ((e.metaKey || e.ctrlKey) && e.key === "i") { e.preventDefault(); exec("italic"); }
    if ((e.metaKey || e.ctrlKey) && e.key === "u") { e.preventDefault(); exec("underline"); }
    if (e.key === "Tab") { e.preventDefault(); exec(e.shiftKey ? "outdent" : "indent"); }
    // Enter: keep the browser default inside lists (new bullet), but insert
    // an explicit line break elsewhere — default block insertion is
    // unreliable in contenteditable across browsers and could swallow the
    // carriage return entirely.
    if (e.key === "Enter" && !e.shiftKey) {
      let node: Node | null = window.getSelection()?.anchorNode ?? null;
      let inList = false;
      while (node && node !== ref.current) {
        if (node.nodeName === "LI") { inList = true; break; }
        node = node.parentNode;
      }
      if (!inList) {
        e.preventDefault();
        const ok = document.execCommand("insertLineBreak");
        if (!ok) document.execCommand("insertHTML", false, "<br>");
        emit();
      }
    }
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border focus-within:border-[var(--accent)] focus-within:ring-2 focus-within:ring-[var(--accent)]/20">
      <div className="flex items-center gap-0.5 border-b border-border bg-canvas px-2 py-1.5">
        <Btn title="Bold (⌘B)" onClick={() => exec("bold")}><Bold size={14} /></Btn>
        <Btn title="Italic (⌘I)" onClick={() => exec("italic")}><Italic size={14} /></Btn>
        <span className="mx-1 h-4 w-px bg-border" />
        <Btn title="Bullet list" onClick={() => exec("insertUnorderedList")}><List size={14} /></Btn>
        <Btn title="Numbered list" onClick={() => exec("insertOrderedList")}><ListOrdered size={14} /></Btn>
        <span className="mx-1 h-4 w-px bg-border" />
        <Btn title="Indent (Tab)" onClick={() => exec("indent")}><IndentIncrease size={14} /></Btn>
        <Btn title="Outdent (⇧Tab)" onClick={() => exec("outdent")}><IndentDecrease size={14} /></Btn>
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onInput={onInput}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onCompositionStart={() => (composing.current = true)}
        onCompositionEnd={() => { composing.current = false; emit(); }}
        data-placeholder={placeholder}
        className={`omni-rt ${minHeight} px-3 py-2.5 text-sm leading-relaxed outline-none`}
        style={{ wordBreak: "break-word" }}
      />
    </div>
  );
}

function Btn({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => {
        e.preventDefault();
        onClick();
      }}
      className="grid h-7 w-7 place-items-center rounded text-muted transition hover:bg-surface hover:text-ink"
    >
      {children}
    </button>
  );
}

export function RichTextView({ html }: { html: string }) {
  if (!html?.trim()) return null;
  return (
    <div
      className="omni-rt-view text-sm leading-relaxed text-ink/90"
      dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }}
    />
  );
}

// Renders stored text that may be either rich HTML (new entries) or plain
// text with newlines (entries saved before the editors became rich text).
export function TextView({ value }: { value: string }) {
  if (!value?.trim()) return null;
  const isHtml = /<[a-z][^>]*>/i.test(value);
  if (isHtml) return <RichTextView html={value} />;
  return <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink/90">{value}</p>;
}
