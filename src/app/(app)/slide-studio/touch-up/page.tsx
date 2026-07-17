"use client";

// Touch-up mode: change the words in an existing .pptx with ZERO design
// loss. We edit the text inside the original file and hand it back —
// layouts, SmartArt, animations, everything else stays byte-identical.

import { useMemo, useState } from "react";
import { Download, FileUp, Pencil, Undo2 } from "lucide-react";
import { BackButton } from "@/components/BackButton";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Feedback";
import {
  exportTouchup,
  loadTouchup,
  type TouchupDoc,
} from "@/lib/slides/touchup";

export default function TouchupPage() {
  const toast = useToast();
  const [doc, setDoc] = useState<TouchupDoc | null>(null);
  const [busy, setBusy] = useState(false);
  // Bump to re-render after in-place edits to doc.runs.
  const [, setTick] = useState(0);

  const bySlide = useMemo(() => {
    const map = new Map<number, TouchupDoc["runs"]>();
    for (const r of doc?.runs || []) {
      map.set(r.slideIndex, [...(map.get(r.slideIndex) || []), r]);
    }
    return [...map.entries()].sort(([a], [b]) => a - b);
  }, [doc]);

  const editedCount = (doc?.runs || []).filter((r) => r.edited !== r.original).length;

  async function upload(file: File | null) {
    if (!file) return;
    setBusy(true);
    try {
      const loaded = await loadTouchup(file);
      if (!loaded.runs.length) throw new Error("No editable text found in that file.");
      setDoc(loaded);
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function download() {
    if (!doc) return;
    setBusy(true);
    try {
      const blob = await exportTouchup(doc);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = doc.fileName.replace(/\.pptx?$/i, "") + " (edited).pptx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast("success", "Edited file downloaded — design untouched.");
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <BackButton label="Slide Studio" />
      <PageHeader
        title="Touch-up a presentation"
        subtitle="Edit the words in an existing .pptx — the design, layouts, SmartArt, and animations stay exactly as they are."
        action={
          doc ? (
            <Button disabled={busy || editedCount === 0} onClick={download}>
              <Download size={16} /> Download {editedCount ? `(${editedCount} edit${editedCount === 1 ? "" : "s"})` : ""}
            </Button>
          ) : undefined
        }
      />

      {!doc ? (
        <label className="grid cursor-pointer place-items-center rounded-xl border border-dashed border-border bg-surface px-6 py-20 text-center transition hover:border-[var(--accent)]/50">
          <FileUp size={24} className="mb-2 text-muted" />
          <span className="text-sm font-medium">
            {busy ? "Reading file…" : "Upload a .pptx to touch up"}
          </span>
          <span className="mt-1 max-w-md text-xs text-muted">
            Perfect for polished decks you don&apos;t want reflowed: fix typos,
            update numbers, reword anything. Text only — to move or add
            elements, use Remix import instead.
          </span>
          <input
            type="file"
            accept=".pptx"
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              void upload(e.target.files?.[0] || null);
              e.target.value = "";
            }}
          />
        </label>
      ) : (
        <div className="space-y-5">
          <p className="text-sm text-muted">
            <Pencil size={13} className="mr-1 inline" />
            <b className="text-ink">{doc.fileName}</b> — edit any text below;
            unchanged lines are left untouched in the file.
          </p>
          {bySlide.map(([slideIndex, runs]) => (
            <section
              key={slideIndex}
              className="rounded-xl border border-border bg-surface p-4 shadow-sm"
            >
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                Slide {slideIndex}
              </h2>
              <div className="space-y-1.5">
                {runs.map((r) => {
                  const changed = r.edited !== r.original;
                  return (
                    <div key={`${r.slideIndex}-${r.runIndex}`} className="flex items-center gap-1.5">
                      <input
                        value={r.edited}
                        onChange={(e) => {
                          r.edited = e.target.value;
                          setTick((t) => t + 1);
                        }}
                        className={`w-full rounded-lg border px-3 py-1.5 text-sm outline-none transition focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20 ${
                          changed
                            ? "border-[var(--accent)] bg-[var(--accent-soft)]/40"
                            : "border-border bg-surface"
                        }`}
                      />
                      {changed && (
                        <button
                          title="Revert"
                          className="rounded p-1 text-muted hover:text-ink"
                          onClick={() => {
                            r.edited = r.original;
                            setTick((t) => t + 1);
                          }}
                        >
                          <Undo2 size={14} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
