"use client";

// Client half of "upload a meeting recording": picks the right transport for
// the file's size and reports real progress, so a 90-minute recording gives
// the same feedback as a 2-minute one.
//
// Small files ride along in a multipart POST. Bigger ones can't — Vercel caps
// request bodies at ~4.5 MB — so they go straight to storage via a signed URL
// and the server streams back chunk-by-chunk transcription progress. Either
// way the audio is deleted server-side as soon as it has been read.

const DIRECT_LIMIT = 4 * 1024 * 1024;
const ENDPOINT = "/api/meeting/transcribe-upload";

export interface UploadProgress {
  /** "uploading" | "transcribing" */
  stage: "uploading" | "transcribing";
  /** 0-100 while uploading; undefined once transcribing by segment count. */
  percent?: number;
  done?: number;
  total?: number;
  label?: string;
}

export async function transcribeUpload(
  file: File,
  onProgress: (p: UploadProgress) => void,
  signal?: AbortSignal,
): Promise<string> {
  if (file.size <= DIRECT_LIMIT) {
    onProgress({ stage: "transcribing", done: 0, total: 1 });
    const form = new FormData();
    form.append("audio", file);
    const res = await fetch(ENDPOINT, {
      method: "POST",
      credentials: "same-origin",
      body: form,
      signal,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `Transcription failed (${res.status})`);
    onProgress({ stage: "transcribing", done: 1, total: 1 });
    return String(json.text || "");
  }

  const ext = (file.name.split(".").pop() || "webm").toLowerCase();
  const signRes = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ action: "sign", ext }),
    signal,
  });
  const signed = await signRes.json().catch(() => ({}));
  if (!signRes.ok) throw new Error(signed.error || "Could not start the upload");
  const path = String(signed.path || "");

  // Cleans up an upload that made it to storage but never became a
  // transcript, so no orphaned audio is left sitting there.
  const discard = () =>
    fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ action: "discard", path }),
    }).catch(() => {});

  try {
    onProgress({ stage: "uploading", percent: 0 });
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", signed.signedUrl);
      xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          onProgress({
            stage: "uploading",
            percent: Math.round((e.loaded / e.total) * 100),
          });
        }
      };
      xhr.onload = () =>
        xhr.status >= 200 && xhr.status < 300
          ? resolve()
          : reject(new Error(`Upload failed (${xhr.status})`));
      xhr.onerror = () => reject(new Error("Upload failed — check your connection."));
      xhr.onabort = () => reject(new Error("Upload cancelled."));
      signal?.addEventListener("abort", () => xhr.abort(), { once: true });
      xhr.send(file);
    });

    onProgress({ stage: "transcribing", label: "Reading the recording…" });
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ action: "from-storage", path }),
      signal,
    });
    if (!res.ok || !res.body) {
      const json = await res.json().catch(() => ({}));
      throw new Error(json.error || `Transcription failed (${res.status})`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let msg: {
          type?: string;
          done?: number;
          total?: number;
          text?: string;
          error?: string;
          label?: string;
        };
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.type === "progress") {
          onProgress({
            stage: "transcribing",
            done: msg.done,
            total: msg.total,
            label: msg.label,
          });
        }
        if (msg.type === "error") throw new Error(msg.error || "Transcription failed");
        if (msg.type === "done") text = msg.text || "";
      }
    }
    // The server removed the file once it read it; nothing left to discard.
    return text;
  } catch (e) {
    await discard();
    throw e;
  }
}
