"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, ShieldCheck } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";

type Phase = "idle" | "uploading" | "preparing" | "error";

export function NewRecording({ candidateId }: { candidateId?: string }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function handleUpload(file: File) {
    setError(null);
    const ext = file.name.split(".").pop()?.toLowerCase() || "bin";

    const signRes = await fetch("/api/recordings/sign-upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title || file.name, ext, candidateId }),
    });
    const signed = await signRes.json();
    if (!signRes.ok) throw new Error(signed.error || "Could not start upload");

    setPhase("uploading");
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", signed.signedUrl);
      xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable) {
          setProgress(Math.round((ev.loaded / ev.total) * 100));
        }
      };
      xhr.onload = () =>
        xhr.status >= 200 && xhr.status < 300
          ? resolve()
          : reject(new Error(`Upload failed (${xhr.status})`));
      xhr.onerror = () => reject(new Error("Upload failed"));
      xhr.send(file);
    });

    setPhase("preparing");
    const upRes = await fetch(`/api/recordings/${signed.recordingId}/uploaded`, {
      method: "POST",
    });
    const up = await upRes.json();
    if (!upRes.ok) throw new Error(up.error || "Could not prepare audio");

    router.push(`/interview-prep/${signed.recordingId}`);
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    handleUpload(file).catch((err) => {
      setPhase("error");
      setError(err instanceof Error ? err.message : "Something went wrong");
    });
  }

  function approveAndPick() {
    setConfirmOpen(false);
    fileRef.current?.click();
  }

  const busy = phase === "uploading" || phase === "preparing";

  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-sm">
      <h2 className="font-semibold">New interview recording</h2>
      <p className="mt-1 text-sm text-muted">
        Upload audio — we&apos;ll transcribe it and build a detailed nested summary.
      </p>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex-1">
          <span className="mb-1.5 block text-sm font-medium">Title (optional)</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Jane Smith — Senior MSL screen"
            disabled={busy}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20 disabled:opacity-60"
          />
        </label>

        <input
          ref={fileRef}
          type="file"
          accept="audio/*,video/mp4,.m4a,.mp3,.wav,.webm"
          onChange={onPick}
          disabled={busy}
          className="hidden"
        />
        <Button
          type="button"
          onClick={() => setConfirmOpen(true)}
          disabled={busy}
          className="shrink-0"
        >
          <Upload size={16} />
          {phase === "uploading"
            ? `Uploading… ${progress}%`
            : phase === "preparing"
              ? "Preparing audio…"
              : "Upload audio"}
        </Button>
      </div>

      {phase === "uploading" && (
        <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-canvas">
          <div
            className="h-full rounded-full bg-[var(--accent)] transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {error && (
        <p className="mt-3 rounded-lg bg-status-error/10 px-3 py-2 text-sm text-status-error">
          {error}
        </p>
      )}

      {/* Consent gate — shown only when the user initiates an upload. */}
      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Before you upload"
        size="sm"
      >
        <div className="space-y-4">
          <div className="flex gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]">
              <ShieldCheck size={18} />
            </span>
            <p className="text-sm text-muted">
              Only upload recordings you have permission to use. By continuing you
              confirm you have the necessary consent from all participants to
              record and process this conversation, per your organization&apos;s
              policies and applicable privacy laws.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button onClick={approveAndPick}>I have consent — choose file</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
