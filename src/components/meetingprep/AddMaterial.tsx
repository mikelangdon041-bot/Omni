"use client";

// Add material: a file, a link, a photo of a printed agenda, or pasted text,
// always with the writer's reason for adding it. The reason is required
// because it is the instruction: the same PDF is an agenda to pull speakers
// from for one meeting and a paper to summarise for another.

import { useState } from "react";
import { FileText, Link2, Loader2, ClipboardPaste } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Working } from "@/components/ui/Progress";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Feedback";
import { cn } from "@/lib/ui";
import { MATERIAL_PURPOSES, type MaterialPurpose } from "@/lib/meetingprep/types";
import { addMaterial, type GetMeeting, type MaterialInput, type SaveMeeting } from "@/lib/meetingprep/material";

const HOW = [
  { key: "file", label: "File or photo", icon: FileText },
  { key: "url", label: "Link", icon: Link2 },
  { key: "paste", label: "Paste text", icon: ClipboardPaste },
] as const;
type How = (typeof HOW)[number]["key"];

export function AddMaterialModal({
  open,
  onClose,
  purpose: initialPurpose,
  getMeeting,
  save,
}: {
  open: boolean;
  onClose: () => void;
  /** Preselected when opened from somewhere that implies it ("Add a source"). */
  purpose?: MaterialPurpose;
  getMeeting: GetMeeting;
  save: SaveMeeting;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Add material">
      <Body key={String(open)} initialPurpose={initialPurpose} onClose={onClose} getMeeting={getMeeting} save={save} />
    </Modal>
  );
}

function Body({
  initialPurpose,
  onClose,
  getMeeting,
  save,
}: {
  initialPurpose?: MaterialPurpose;
  onClose: () => void;
  getMeeting: GetMeeting;
  save: SaveMeeting;
}) {
  const toast = useToast();
  const [how, setHow] = useState<How>("file");
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState<MaterialPurpose | null>(initialPurpose || null);
  const [note, setNote] = useState("");
  const [stage, setStage] = useState("");

  const p = MATERIAL_PURPOSES.find((x) => x.key === purpose);
  const hasContent = how === "file" ? Boolean(file) : how === "url" ? /^https?:\/\/\S+\.\S+/.test(url.trim()) : Boolean(text.trim());
  const missing = !hasContent
    ? how === "file"
      ? "Choose a file"
      : how === "url"
        ? "Paste a link"
        : "Paste the text"
    : !purpose
      ? "Pick what it is"
      : !note.trim()
        ? "Say what you want out of it"
        : "";

  async function submit() {
    if (missing || !purpose) return;
    const input: MaterialInput =
      how === "file" ? { kind: "file", file: file! } : how === "url" ? { kind: "url", url } : { kind: "paste", text, name };
    try {
      const msg = await addMaterial({ input, purpose, note, getMeeting, save, onStage: setStage });
      toast("success", msg);
      onClose();
    } catch (e) {
      toast("error", (e as Error).message);
      setStage("");
    }
  }

  if (stage)
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <Loader2 size={22} className="animate-spin text-[var(--accent)]" />
        <p className="text-sm font-medium">{stage}</p>
        {/* Measured: an agenda read in 13s; a long PDF or a photo can take longer. */}
        <Working active seconds={20} label="Reading it" className="w-full max-w-xs text-left" />
        <p className="max-w-xs text-xs text-muted">
          You can close this. It keeps going, and tells you when it&apos;s done.
        </p>
      </div>
    );

  return (
    <div className="space-y-5">
      <div>
        <p className="mb-2 text-sm font-medium">1. What are you adding?</p>
        <div className="mb-3 flex gap-1 rounded-lg bg-canvas p-1">
          {HOW.map((h) => (
            <button
              key={h.key}
              type="button"
              onClick={() => setHow(h.key)}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition",
                how === h.key ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink",
              )}
            >
              <h.icon size={13} /> {h.label}
            </button>
          ))}
        </div>
        {how === "file" && (
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted transition hover:border-[var(--accent)] hover:text-ink">
            <FileText size={16} className="shrink-0" />
            <span className="min-w-0 truncate">
              {file ? file.name : "PDF, Word, text, or a photo or screenshot (an agenda, a slide)"}
            </span>
            <input
              type="file"
              accept=".pdf,.doc,.docx,.txt,.md,text/plain,image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </label>
        )}
        {how === "url" && (
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://… the session page, an article, a report"
            autoFocus
          />
        )}
        {how === "paste" && (
          <div className="space-y-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="What to call it (optional)" />
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Paste the agenda, the email, the abstract…"
              className="min-h-32"
            />
          </div>
        )}
      </div>

      <div>
        <p className="mb-2 text-sm font-medium">2. What is it?</p>
        <div className="flex flex-wrap gap-1.5">
          {MATERIAL_PURPOSES.map((x) => (
            <button
              key={x.key}
              type="button"
              onClick={() => setPurpose(x.key)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition",
                purpose === x.key
                  ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                  : "border-border text-muted hover:text-ink",
              )}
            >
              {x.label}
            </button>
          ))}
        </div>
        {p && <p className="mt-1.5 text-xs text-muted">{p.does}</p>}
      </div>

      <div>
        <p className="mb-2 text-sm font-medium">3. Why are you adding it, and what do you want out of it?</p>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={p?.placeholder || "e.g. \"The other panelists are on page 2. I need to know who they are.\""}
        />
      </div>

      <div className="flex items-center justify-end gap-3">
        {missing && <p className="text-xs text-muted">{missing}</p>}
        <Button onClick={() => void submit()} disabled={Boolean(missing)}>
          Add it
        </Button>
      </div>
    </div>
  );
}
