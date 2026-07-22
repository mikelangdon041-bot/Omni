"use client";

// Shows the AI's proposed content (new/changed text highlighted against what
// was there before) and requires an explicit Apply — nothing an AI regenerate
// writes lands on real content until the user has seen it and agreed.

import { Modal } from "./Modal";
import { Button } from "./Button";
import { diffHighlightHtml } from "@/lib/writer/diff";
import { htmlToPlain } from "@/lib/writer/types";

export interface DiffChange {
  key: string;
  title: string;
  oldContent: string; // HTML, "" if this is new content
  newContent: string; // HTML
}

export function DiffPreviewModal({
  open,
  onClose,
  changes,
  onApply,
  applying,
  title = "Review before applying",
}: {
  open: boolean;
  onClose: () => void;
  changes: DiffChange[];
  onApply: () => void;
  applying?: boolean;
  title?: string;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title} size="lg">
      <p className="mb-3 text-sm text-muted">
        New or changed text is highlighted. Nothing is saved until you apply.
      </p>
      <div className="max-h-[60vh] space-y-3 overflow-y-auto">
        {changes.map((c) => {
          const html = diffHighlightHtml(htmlToPlain(c.oldContent), htmlToPlain(c.newContent));
          return (
            <div key={c.key} className="rounded-lg border border-border bg-canvas/40 p-3">
              <p className="mb-1.5 text-sm font-semibold">{c.title}</p>
              {html.trim() ? (
                <div
                  className="text-sm leading-relaxed [&_mark]:rounded [&_mark]:bg-[var(--accent-soft)] [&_mark]:px-0.5 [&_mark]:font-medium [&_mark]:text-[var(--accent)]"
                  dangerouslySetInnerHTML={{ __html: html }}
                />
              ) : (
                <p className="text-sm text-muted">(empty)</p>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Discard
        </Button>
        <Button disabled={applying} onClick={onApply}>
          {applying ? "Applying…" : "Apply"}
        </Button>
      </div>
    </Modal>
  );
}
