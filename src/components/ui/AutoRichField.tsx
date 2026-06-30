"use client";

import { useEffect, useRef, useState } from "react";
import { RichText, RichTextView } from "./RichText";

// A labelled rich-text field that autosaves (debounced) and shows a status.
export function AutoRichField({
  label,
  initialHtml,
  canEdit,
  onSave,
  placeholder,
  minHeight,
}: {
  label: string;
  initialHtml: string;
  canEdit: boolean;
  onSave: (html: string) => Promise<void>;
  placeholder?: string;
  minHeight?: string;
}) {
  const [html, setHtml] = useState(initialHtml);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const saved = useRef(initialHtml);

  useEffect(() => {
    if (html === saved.current) return;
    setStatus("saving");
    const t = setTimeout(async () => {
      await onSave(html);
      saved.current = html;
      setStatus("saved");
    }, 900);
    return () => clearTimeout(t);
  }, [html, onSave]);

  if (!canEdit) {
    return initialHtml?.trim() ? (
      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
          {label}
        </p>
        <RichTextView html={initialHtml} />
      </div>
    ) : null;
  }

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">
          {label}
        </span>
        {status !== "idle" && (
          <span className="text-xs text-muted">
            {status === "saving" ? "Saving…" : "Saved"}
          </span>
        )}
      </div>
      <RichText
        value={html}
        onChange={setHtml}
        placeholder={placeholder}
        minHeight={minHeight}
      />
    </div>
  );
}
