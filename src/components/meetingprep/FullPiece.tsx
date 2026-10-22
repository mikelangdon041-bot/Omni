"use client";

// "Add the full piece": for a reading-list source the app could not open (a
// paywall, a login), the writer hands over the article itself, as a PDF or
// pasted text. It is read in full, the card's summary and findings are
// rewritten from it, and it is kept as a document so questions from this
// source are written from it as well.

import { useState } from "react";
import { FileUp } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";
import { Working } from "@/components/ui/Progress";
import { useToast } from "@/components/ui/Feedback";
import { meetingPayload, newId, type GetMeeting, type SaveMeeting } from "@/lib/meetingprep/material";
import type { MpDocument, ReadingSource } from "@/lib/meetingprep/types";

export function FullPiece({
  s,
  getMeeting,
  save,
}: {
  s: ReadingSource;
  getMeeting: GetMeeting;
  save: SaveMeeting;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    const m = getMeeting();
    if (!m || (!file && !text.trim())) return;
    setBusy(true);
    try {
      let full = text.trim();
      if (file) {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/meeting/extract", { method: "POST", credentials: "same-origin", body: form });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || "Could not read that file");
        full = String(json.text || "");
      }
      const res = await fetch("/api/meeting/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ action: "readsource", meeting: meetingPayload(m), source: s, text: full }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Could not read it");

      const now = getMeeting() || m;
      const doc: MpDocument = {
        id: newId("d"),
        name: s.title,
        note: `The full text of "${s.title}" from the reading list`,
        text: full,
        purpose: "background",
        ...(s.url ? { url: s.url } : {}),
      };
      const r = now.reading || {};
      save({
        documents: [...(now.documents || []), doc],
        reading: {
          ...r,
          sources: (r.sources || []).map((x) =>
            x.id === s.id
              ? {
                  ...x,
                  summary: String(json.summary || x.summary),
                  findings: Array.isArray(json.findings) ? json.findings.map(String) : x.findings,
                  why: String(json.why || x.why),
                  date: x.date || String(json.date || ""),
                  read: "full" as const,
                  fullDocId: doc.id,
                }
              : x,
          ),
        },
      });
      toast("success", "Read it in full. The summary and findings now come from the whole article.");
      setOpen(false);
      setFile(null);
      setText("");
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!open)
    return (
      <Button size="sm" variant="secondary" className="mt-1.5" onClick={() => setOpen(true)}>
        <FileUp size={13} /> Add the full piece
      </Button>
    );

  return (
    <div className="mt-2 space-y-2 rounded-md border border-border bg-surface p-2.5">
      <p className="text-xs font-medium">
        Behind a paywall or a login? Save the article as a PDF and add it here, or paste its text.
      </p>
      <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-border px-2.5 py-2 text-xs text-muted hover:text-ink">
        <FileUp size={14} className="shrink-0" />
        <span className="min-w-0 truncate">{file ? file.name : "Choose a PDF, Word or text file"}</span>
        <input
          type="file"
          accept=".pdf,.doc,.docx,.txt,.md,text/plain"
          className="hidden"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
        />
      </label>
      {!file && (
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Or paste the article's text"
          className="min-h-24 text-xs"
        />
      )}
      {busy ? (
        <Working active seconds={30} label="Reading the whole article" />
      ) : (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => void submit()} disabled={!file && !text.trim()}>
            Read it
          </Button>
        </div>
      )}
    </div>
  );
}
