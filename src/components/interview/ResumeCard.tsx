"use client";

import { useEffect, useRef, useState } from "react";
import { Upload, FileText, ExternalLink, Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Candidate } from "@/lib/interview/types";
import { cn } from "@/lib/ui";

const supabase = createClient();

export function ResumeCard({
  candidate,
  userId,
  updateCandidate,
}: {
  candidate: Candidate;
  userId: string | null;
  updateCandidate: (p: Partial<Candidate>) => Promise<void>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"paste" | "upload">(
    candidate.resume_url ? "upload" : "paste",
  );
  const [text, setText] = useState(candidate.resume_text || "");
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [uploading, setUploading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [fileName, setFileName] = useState(
    candidate.resume_url
      ? (candidate.resume_url.split("/").pop() || "").replace(/^\d+-/, "")
      : "",
  );
  const savedText = useRef(candidate.resume_text || "");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [extractError, setExtractError] = useState<string | null>(null);
  const autoTried = useRef<string | null>(null);

  // Sign the uploaded file for an inline preview.
  useEffect(() => {
    if (!candidate.resume_url) {
      setPreviewUrl(null);
      return;
    }
    let active = true;
    supabase.storage
      .from("resumes")
      .createSignedUrl(candidate.resume_url, 600)
      .then(({ data }) => {
        if (active) setPreviewUrl(data?.signedUrl || null);
      });
    return () => {
      active = false;
    };
  }, [candidate.resume_url]);

  const isPdf = /\.pdf$/i.test(candidate.resume_url || "");
  const isImage = /\.(png|jpe?g|gif|webp)$/i.test(candidate.resume_url || "");

  // Debounced autosave of the pasted resume text.
  useEffect(() => {
    if (text === savedText.current) return;
    setStatus("saving");
    const t = setTimeout(async () => {
      await updateCandidate({ resume_text: text });
      savedText.current = text;
      setStatus("saved");
    }, 800);
    return () => clearTimeout(t);
  }, [text, updateCandidate]);

  // Extract text from an uploaded file (PDF/DOCX) so AI features can read it.
  // Surfaces failures and populates resume_text so "Scan resume" enables.
  async function runExtract(path: string) {
    setExtracting(true);
    setExtractError(null);
    autoTried.current = path;
    try {
      const res = await fetch("/api/interview/parse-resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ candidateId: candidate.id, path }),
      });
      const data = await res.json();
      if (res.ok && data.text) {
        setText(data.text);
        savedText.current = data.text;
        // Push extracted text to the parent so AI features (scan) light up.
        await updateCandidate({ resume_text: data.text });
      } else if (res.ok) {
        setExtractError(
          "No text found in this file. If it's a scanned PDF or image, paste the text in the “Paste” tab so AI can use it.",
        );
      } else {
        setExtractError(data.error || "Could not read this file.");
      }
    } catch {
      setExtractError("Could not read this file. Try again, or paste the text manually.");
    }
    setExtracting(false);
  }

  // If a file is already attached but has no extracted text (e.g. an earlier
  // extraction failed), try once automatically so AI features work.
  useEffect(() => {
    const url = candidate.resume_url;
    if (!url) return;
    const isImg = /\.(png|jpe?g|gif|webp)$/i.test(url);
    if (isImg) return;
    if ((candidate.resume_text || "").trim()) return;
    if (autoTried.current === url || extracting) return;
    void runExtract(url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidate.resume_url, candidate.resume_text]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !userId) return;
    setUploading(true);
    setExtractError(null);
    let extracted = "";
    if (/\.(txt|md|csv)$/i.test(file.name) || file.type.startsWith("text/")) {
      extracted = await file.text();
    }
    const path = `${userId}/${candidate.id}/${Date.now()}-${file.name}`;
    const { error } = await supabase.storage
      .from("resumes")
      .upload(path, file, { upsert: true });
    if (error) {
      setExtractError("Upload failed. Check your connection and try again.");
      setUploading(false);
      return;
    }
    setFileName(file.name);
    const patch: Partial<Candidate> = { resume_url: path };
    if (extracted) {
      setText(extracted);
      savedText.current = extracted;
      patch.resume_text = extracted;
    }
    await updateCandidate(patch);
    setStatus("saved");
    setUploading(false);
    if (!extracted) await runExtract(path);
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted">
          <FileText size={15} /> Resume
        </h3>
        <div className="flex items-center gap-3">
          {status !== "idle" && (
            <span className="flex items-center gap-1 text-xs text-muted">
              {status === "saving" ? (
                "Saving…"
              ) : (
                <>
                  <Check size={12} className="text-status-complete" /> Saved
                </>
              )}
            </span>
          )}
          <div className="flex overflow-hidden rounded-lg border border-border text-xs">
            {(["paste", "upload"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={cn(
                  "px-2.5 py-1 font-medium capitalize transition",
                  mode === m
                    ? "bg-[var(--accent)] text-white"
                    : "bg-surface text-muted hover:text-ink",
                )}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      </div>

      {mode === "paste" ? (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste the candidate's resume / background. Saves automatically and powers AI question suggestions."
          className="min-h-40 w-full resize-y rounded-lg border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20"
        />
      ) : (
        <div className="space-y-3">
          <input
            ref={fileRef}
            type="file"
            accept=".txt,.md,.csv,.pdf,.doc,.docx"
            onChange={onFile}
            className="hidden"
          />
          {candidate.resume_url ? (
            <>
              <div className="flex items-center justify-between rounded-lg border border-border bg-canvas px-4 py-3">
                <span className="flex min-w-0 items-center gap-2 text-sm">
                  <FileText size={15} className="shrink-0 text-[var(--accent)]" />
                  <span className="truncate">{fileName || "Resume file"}</span>
                </span>
                <div className="flex items-center gap-3">
                  {previewUrl && (
                    <a
                      href={previewUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-medium text-[var(--accent)] hover:underline"
                    >
                      <ExternalLink size={13} /> Open
                    </a>
                  )}
                  <button
                    onClick={() => fileRef.current?.click()}
                    className="text-xs font-medium text-muted hover:text-ink"
                  >
                    Replace
                  </button>
                </div>
              </div>
              {previewUrl && isPdf && (
                <object
                  data={`${previewUrl}#view=FitH`}
                  type="application/pdf"
                  className="h-[34rem] w-full rounded-lg border border-border"
                >
                  {/* Fallback for browsers that won't render PDFs inline */}
                  <iframe
                    src={previewUrl}
                    title="Resume preview"
                    className="h-[34rem] w-full rounded-lg border border-border"
                  />
                  <p className="px-3 py-2 text-xs text-muted">
                    Can&apos;t show the PDF here —{" "}
                    <a href={previewUrl} target="_blank" rel="noreferrer" className="text-[var(--accent)] underline">
                      open it in a new tab
                    </a>
                    .
                  </p>
                </object>
              )}
              {previewUrl && isImage && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previewUrl}
                  alt="Resume preview"
                  className="max-h-[28rem] w-full rounded-lg border border-border object-contain"
                />
              )}
            </>
          ) : (
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="grid w-full place-items-center gap-1 rounded-lg border border-dashed border-border py-8 text-sm text-muted transition hover:border-[var(--accent)] hover:text-ink disabled:opacity-60"
            >
              <Upload size={20} />
              {uploading ? "Uploading…" : "Click to upload a resume file"}
              <span className="text-xs">PDF, DOCX, or TXT</span>
            </button>
          )}
          {extracting && (
            <p className="text-xs text-muted">Extracting text from your file…</p>
          )}
          {!extracting && extractError && candidate.resume_url && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-status-error/30 bg-status-error/5 px-3 py-2">
              <p className="text-xs text-status-error">{extractError}</p>
              <button
                onClick={() => candidate.resume_url && runExtract(candidate.resume_url)}
                className="shrink-0 rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-medium text-ink transition hover:border-[var(--accent)]"
              >
                Retry extraction
              </button>
            </div>
          )}
          {!extracting && text && (
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">
                {isPdf || isImage ? "Extracted text (used for AI)" : "Preview"}
              </p>
              <p
                className={`${isPdf || isImage ? "max-h-40" : "max-h-[28rem]"} overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink/90`}
              >
                {text}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
