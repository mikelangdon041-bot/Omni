"use client";

import { useRef, useState } from "react";
import { Upload, FileText } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Candidate } from "@/lib/interview/types";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";

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
  const [text, setText] = useState(candidate.resume_text || "");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [fileName, setFileName] = useState(
    candidate.resume_url ? candidate.resume_url.split("/").pop() || "" : "",
  );

  async function save() {
    setSaving(true);
    await updateCandidate({ resume_text: text });
    setSaving(false);
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !userId) return;
    setUploading(true);
    if (/\.(txt|md|csv)$/i.test(file.name) || file.type.startsWith("text/")) {
      const content = await file.text();
      setText(content);
      await updateCandidate({ resume_text: content });
    }
    const path = `${userId}/${candidate.id}/${Date.now()}-${file.name}`;
    const { error } = await supabase.storage
      .from("resumes")
      .upload(path, file, { upsert: true });
    if (!error) {
      setFileName(file.name);
      await updateCandidate({ resume_url: path });
    }
    setUploading(false);
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted">
          <FileText size={15} /> Resume
        </h3>
        <input
          ref={fileRef}
          type="file"
          accept=".txt,.md,.csv,.pdf,.doc,.docx"
          onChange={onFile}
          className="hidden"
        />
        <Button
          variant="secondary"
          size="sm"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
        >
          <Upload size={14} /> {uploading ? "Uploading…" : "Upload file"}
        </Button>
      </div>
      {fileName && <p className="mb-2 text-xs text-muted">Attached: {fileName}</p>}
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Paste the candidate's resume / background here. The AI uses this text to tailor questions. (PDFs are stored, but paste the text here for AI.)"
        className="min-h-32"
      />
      <div className="mt-2 flex justify-end">
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save resume"}
        </Button>
      </div>
    </div>
  );
}
