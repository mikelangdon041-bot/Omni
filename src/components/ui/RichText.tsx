"use client";

import { useEffect, useRef } from "react";
import DOMPurify from "dompurify";
import { Bold, Italic, List, ListOrdered, IndentIncrease, IndentDecrease } from "lucide-react";

// Lightweight rich-text editor (bold/italic/bullets/numbering/indent) storing
// HTML. Uncontrolled body to keep the caret stable; emits HTML on input.
export function RichText({
  initialHtml,
  onChange,
  placeholder,
}: {
  initialHtml: string;
  onChange: (html: string) => void;
  placeholder?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.innerHTML = initialHtml || "";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function cmd(c: string) {
    document.execCommand(c, false);
    ref.current?.focus();
    onChange(ref.current?.innerHTML || "");
  }

  const Btn = ({ c, children }: { c: string; children: React.ReactNode }) => (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => cmd(c)}
      className="rounded p-1.5 text-muted transition hover:bg-canvas hover:text-ink"
    >
      {children}
    </button>
  );

  return (
    <div className="rounded-lg border border-border bg-surface focus-within:border-[var(--accent)] focus-within:ring-2 focus-within:ring-[var(--accent)]/20">
      <div className="flex gap-0.5 border-b border-border p-1">
        <Btn c="bold"><Bold size={15} /></Btn>
        <Btn c="italic"><Italic size={15} /></Btn>
        <Btn c="insertUnorderedList"><List size={15} /></Btn>
        <Btn c="insertOrderedList"><ListOrdered size={15} /></Btn>
        <Btn c="indent"><IndentIncrease size={15} /></Btn>
        <Btn c="outdent"><IndentDecrease size={15} /></Btn>
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onInput={() => onChange(ref.current?.innerHTML || "")}
        data-placeholder={placeholder}
        className="omni-rt min-h-24 px-3 py-2.5 text-sm leading-relaxed outline-none"
      />
    </div>
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
