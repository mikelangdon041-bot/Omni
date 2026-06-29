"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Phase = "idle" | "uploading" | "preparing" | "error";

export function NewRecording() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  async function handleUpload(file: File) {
    setError(null);
    const ext = file.name.split(".").pop()?.toLowerCase() || "bin";

    // 1) Ask the server to create the record + sign a direct-to-storage URL.
    const signRes = await fetch("/api/recordings/sign-upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title || file.name, ext }),
    });
    const signed = await signRes.json();
    if (!signRes.ok) throw new Error(signed.error || "Could not start upload");

    // 2) PUT the bytes straight to storage via XHR (real progress events).
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

    // 3) Tell the server it's there → server chunks the audio.
    setPhase("preparing");
    const upRes = await fetch(`/api/recordings/${signed.recordingId}/uploaded`, {
      method: "POST",
    });
    const up = await upRes.json();
    if (!upRes.ok) throw new Error(up.error || "Could not prepare audio");

    // 4) Hand off to the detail page, which runs the transcription worker.
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

  const busy = phase === "uploading" || phase === "preparing";

  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-sm">
      <h2 className="font-semibold">New interview recording</h2>
      <p className="mt-1 text-sm text-muted">
        Upload audio — we&apos;ll transcribe it and build a nested summary.
      </p>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex-1">
          <span className="mb-1.5 block text-sm font-medium">Title (optional)</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Dr. Patel — Phase III discussion"
            disabled={busy}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
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
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="inline-flex shrink-0 items-center justify-center rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-fg shadow-sm transition hover:bg-primary-hover disabled:opacity-60"
        >
          {phase === "uploading"
            ? `Uploading… ${progress}%`
            : phase === "preparing"
              ? "Preparing audio…"
              : "Choose audio file"}
        </button>
      </div>

      {phase === "uploading" && (
        <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-canvas">
          <div
            className="h-full rounded-full bg-accent transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {error && (
        <p className="mt-3 rounded-lg bg-status-error/10 px-3 py-2 text-sm text-status-error">
          {error}
        </p>
      )}
    </div>
  );
}
