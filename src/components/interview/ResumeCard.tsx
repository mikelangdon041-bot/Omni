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
  const [fileName, setFileName] = useState(
    candidate.resume_url
      ? (candidate.resume_url.split("/").pop() || "").replace(/^\d+-/, "")
      : "",
  );
  const savedText = useRef(candidate.resume_text || "");

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

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !userId) return;
    setUploading(true);
    let extracted = "";
    if (/\.(txt|md|csv)$/i.test(file.name) || file.type.startsWith("text/")) {
      extracted = await file.text();
    }
    const path = `${userId}/${candidate.id}/${Date.now()}-${file.name}`;
    const { error } = await supabase.storage
      .from("resumes")
      .upload(path, file, { upsert: true });
    if (!error) {
      setFileName(file.name);
      const patch: Partial<Candidate> = { resume_url: path };
      if (extracted) {
        setText(extracted);
        savedText.current = extracted;
        patch.resume_text = extracted;
      }
      await updateCandidate(patch);
      setStatus("saved");
    }
    setUploading(false);
  }

  async function viewFile() {
    if (!candidate.resume_url) return;
    const { data } = await supabase.storage
      .from("resumes")
      .createSignedUrl(candidate.resume_url, 300);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
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
            <div className="flex items-center justify-between rounded-lg border border-border bg-canvas px-4 py-3">
              <span className="flex min-w-0 items-center gap-2 text-sm">
                <FileText size={15} className="shrink-0 text-[var(--accent)]" />
                <span className="truncate">{fileName || "Resume file"}</span>
              </span>
              <div className="flex items-center gap-3">
                <button
                  onClick={viewFile}
                  className="inline-flex items-center gap-1 text-xs font-medium text-[var(--accent)] hover:underline"
                >
                  <ExternalLink size={13} /> Preview
                </button>
                <button
                  onClick={() => fileRef.current?.click()}
                  className="text-xs font-medium text-muted hover:text-ink"
                >
                  Replace
                </button>
              </div>
            </div>
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
          {text && (
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">
                Extracted text (used for AI)
              </p>
              <p className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink/90">
                {text}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
