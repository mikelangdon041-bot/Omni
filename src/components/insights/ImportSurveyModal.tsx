"use client";

import { useRef, useState } from "react";
import {
  Upload,
  FileText,
  Loader2,
  Trash2,
  Plus,
  CornerDownRight,
  AlertTriangle,
  Check,
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/ui";
import type {
  ImportDraftQuestion,
  QuestionType,
} from "@/lib/insights/types";

type Editable = ImportDraftQuestion & { include: boolean };

const TYPE_LABELS: Record<QuestionType, string> = {
  single: "Single choice",
  multi: "Multiple choice",
  boolean: "Yes / No",
  scale: "Scale",
  number: "Number",
  text: "Free text",
};

export function ImportSurveyModal({
  open,
  onClose,
  onImport,
}: {
  open: boolean;
  onClose: () => void;
  onImport: (drafts: ImportDraftQuestion[]) => Promise<number>;
}) {
  const [step, setStep] = useState<"input" | "preview">("input");
  const [file, setFile] = useState<File | null>(null);
  const [pasted, setPasted] = useState("");
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Editable[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  function reset() {
    setStep("input");
    setFile(null);
    setPasted("");
    setDrafts([]);
    setError(null);
    setParsing(false);
    setImporting(false);
  }

  function close() {
    reset();
    onClose();
  }

  async function parse() {
    if (!file && !pasted.trim()) return;
    setParsing(true);
    setError(null);
    try {
      const res = await fetch("/api/insights/import-doc", {
        method: "POST",
        credentials: "same-origin",
        body: buildBody(file, pasted),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not read the document");
      const qs: ImportDraftQuestion[] = json.draft?.questions || [];
      setDrafts(qs.map((q) => ({ ...q, include: true })));
      setStep("preview");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the document");
    } finally {
      setParsing(false);
    }
  }

  function patch(tempId: string, p: Partial<Editable>) {
    setDrafts((prev) => prev.map((d) => (d.tempId === tempId ? { ...d, ...p } : d)));
  }

  function setAllChoice(type: "single" | "multi") {
    setDrafts((prev) =>
      prev.map((d) =>
        d.type === "single" || d.type === "multi" ? { ...d, type } : d,
      ),
    );
  }

  async function doImport() {
    const included = new Set(drafts.filter((d) => d.include).map((d) => d.tempId));
    const final: ImportDraftQuestion[] = drafts
      .filter((d) => d.include && d.text.trim())
      .map(({ include, ...d }) => {
        void include;
        // Drop a branch link whose parent wasn't imported.
        if (d.parentTempId && !included.has(d.parentTempId)) {
          return { ...d, parentTempId: null, parentOptionLabel: null };
        }
        return d;
      });
    if (final.length === 0) return;
    setImporting(true);
    setError(null);
    try {
      await onImport(final);
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
      setImporting(false);
    }
  }

  const includedCount = drafts.filter((d) => d.include).length;

  return (
    <Modal
      open={open}
      onClose={close}
      title={step === "input" ? "Import a survey" : "Review before importing"}
      size="lg"
    >
      {step === "input" ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">
            Upload a survey worksheet (.docx, .pdf, or .txt) or paste its text.
            We&apos;ll detect the questions, answer options, and follow-up
            branches — then you review and edit before anything is created.
          </p>

          <button
            onClick={() => fileRef.current?.click()}
            className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-border bg-canvas px-6 py-8 text-center transition hover:border-[var(--accent)]"
          >
            <Upload size={24} className="text-[var(--accent)]" />
            {file ? (
              <span className="flex items-center gap-1.5 text-sm font-medium text-ink">
                <FileText size={15} /> {file.name}
              </span>
            ) : (
              <>
                <span className="text-sm font-medium text-ink">
                  Click to choose a document
                </span>
                <span className="text-xs text-muted">.docx · .pdf · .txt</span>
              </>
            )}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".docx,.doc,.pdf,.txt,.md"
            className="hidden"
            onChange={(e) => {
              setFile(e.target.files?.[0] || null);
              setPasted("");
            }}
          />

          <div className="flex items-center gap-3 text-xs text-muted">
            <div className="h-px flex-1 bg-border" /> or paste text{" "}
            <div className="h-px flex-1 bg-border" />
          </div>

          <textarea
            value={pasted}
            onChange={(e) => {
              setPasted(e.target.value);
              if (e.target.value) setFile(null);
            }}
            placeholder="Paste the survey questions and answer options here…"
            className="min-h-28 w-full resize-y rounded-lg border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)]"
          />

          {error && <p className="text-sm text-status-error">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button onClick={parse} disabled={parsing || (!file && !pasted.trim())}>
              {parsing ? (
                <>
                  <Loader2 size={16} className="animate-spin" /> Reading…
                </>
              ) : (
                <>Detect questions</>
              )}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted">
              Found <span className="font-semibold text-ink">{drafts.length}</span>{" "}
              questions. Untick any you don&apos;t want, edit as needed, then import.
            </p>
            <button
              onClick={parse}
              className="text-xs font-medium text-[var(--accent)] hover:underline"
            >
              Re-detect
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-canvas px-3 py-2 text-xs">
            <span className="text-muted">Set all choice questions to:</span>
            <button
              onClick={() => setAllChoice("single")}
              className="rounded-md border border-border bg-surface px-2 py-1 font-medium hover:border-[var(--accent)] hover:text-[var(--accent)]"
            >
              Choose one
            </button>
            <button
              onClick={() => setAllChoice("multi")}
              className="rounded-md border border-border bg-surface px-2 py-1 font-medium hover:border-[var(--accent)] hover:text-[var(--accent)]"
            >
              Select all that apply
            </button>
          </div>

          <div className="max-h-[55vh] space-y-2.5 overflow-y-auto pr-1">
            {drafts.map((d, i) => (
              <DraftCard
                key={d.tempId}
                draft={d}
                index={i + 1}
                parentText={
                  d.parentTempId
                    ? drafts.find((p) => p.tempId === d.parentTempId)?.text
                    : undefined
                }
                onPatch={(p) => patch(d.tempId, p)}
              />
            ))}
          </div>

          {error && <p className="text-sm text-status-error">{error}</p>}

          <div className="flex items-center justify-between border-t border-border pt-3">
            <button
              onClick={() => setStep("input")}
              className="text-sm text-muted hover:text-ink"
            >
              ← Back
            </button>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={close}>
                Cancel
              </Button>
              <Button onClick={doImport} disabled={importing || includedCount === 0}>
                {importing ? (
                  <>
                    <Loader2 size={16} className="animate-spin" /> Importing…
                  </>
                ) : (
                  <>
                    <Check size={16} /> Import {includedCount} question
                    {includedCount === 1 ? "" : "s"}
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

function buildBody(file: File | null, pasted: string): FormData {
  const fd = new FormData();
  if (file) fd.append("file", file);
  if (pasted.trim()) fd.append("text", pasted.trim());
  return fd;
}

function DraftCard({
  draft,
  index,
  parentText,
  onPatch,
}: {
  draft: Editable;
  index: number;
  parentText?: string;
  onPatch: (p: Partial<Editable>) => void;
}) {
  const isChoice =
    draft.type === "single" || draft.type === "multi" || draft.type === "boolean";

  function setOption(i: number, label: string) {
    onPatch({
      options: draft.options.map((o, idx) => (idx === i ? { ...o, label } : o)),
    });
  }
  function addOption() {
    onPatch({ options: [...draft.options, { label: "" }] });
  }
  function removeOption(i: number) {
    onPatch({ options: draft.options.filter((_, idx) => idx !== i) });
  }

  return (
    <div
      className={cn(
        "rounded-xl border p-3 transition",
        draft.include
          ? "border-border bg-surface"
          : "border-dashed border-border bg-canvas opacity-60",
      )}
    >
      <div className="flex items-start gap-2.5">
        <input
          type="checkbox"
          checked={draft.include}
          onChange={(e) => onPatch({ include: e.target.checked })}
          className="mt-1 h-4 w-4 shrink-0 accent-[var(--accent)]"
        />
        <div className="min-w-0 flex-1">
          {draft.section && (
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
              {draft.section}
            </p>
          )}
          {draft.parentTempId && (
            <p className="mb-1 flex items-center gap-1 text-[11px] font-medium text-[var(--accent)]">
              <CornerDownRight size={12} />
              Follow-up: shows when “{parentText ? shorten(parentText) : "…"}” ={" "}
              “{draft.parentOptionLabel}”
              <button
                onClick={() =>
                  onPatch({ parentTempId: null, parentOptionLabel: null })
                }
                className="ml-1 text-muted underline hover:text-ink"
              >
                make top-level
              </button>
            </p>
          )}

          <div className="flex items-start gap-2">
            <span className="mt-2 text-xs font-semibold text-muted">{index}.</span>
            <textarea
              value={draft.text}
              onChange={(e) => onPatch({ text: e.target.value })}
              rows={1}
              className="min-h-9 w-full resize-y rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm font-medium outline-none focus:border-[var(--accent)]"
            />
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select
              value={draft.type}
              onChange={(e) =>
                onPatch({ type: e.target.value as QuestionType })
              }
              className="rounded-lg border border-border bg-surface px-2 py-1 text-xs outline-none focus:border-[var(--accent)]"
            >
              {(Object.keys(TYPE_LABELS) as QuestionType[]).map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABELS[t]}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1 text-xs text-muted">
              <input
                type="checkbox"
                checked={draft.required}
                onChange={(e) => onPatch({ required: e.target.checked })}
                className="h-3.5 w-3.5 accent-[var(--accent)]"
              />
              Required
            </label>
          </div>

          {isChoice && (
            <div className="mt-2 flex flex-col gap-1.5">
              {draft.options.map((o, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-muted" />
                  <input
                    value={o.label}
                    onChange={(e) => setOption(i, e.target.value)}
                    placeholder={`Option ${i + 1}`}
                    className="w-full rounded-md border border-border bg-surface px-2 py-1 text-xs outline-none focus:border-[var(--accent)]"
                  />
                  <button
                    onClick={() => removeOption(i)}
                    className="text-muted hover:text-status-error"
                    aria-label="Remove option"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
              <button
                onClick={addOption}
                className="flex items-center gap-1 self-start text-xs font-medium text-[var(--accent)] hover:underline"
              >
                <Plus size={12} /> Add option
              </button>
              {draft.options.length === 0 && (
                <p className="flex items-center gap-1 text-[11px] text-amber-600">
                  <AlertTriangle size={12} /> No options detected — add some or
                  switch to Free text.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function shorten(t: string, n = 32): string {
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}
