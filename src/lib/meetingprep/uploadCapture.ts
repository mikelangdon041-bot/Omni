"use client";

// Client half of "upload a meeting recording": pushes the file to storage and
// reports one honest percentage for the whole job.
//
// Every file takes the same path regardless of size — Vercel rejects request
// bodies past ~4.5 MB, and going through storage is also what lets the server
// split the audio into chunks it can report as it finishes them. The audio is
// deleted server-side as soon as it has been read.
//
// The bar covers both phases on a single 0-100 scale: uploading the bytes is
// the first quarter, transcribing the chunks is the rest. Two separate bars
// that each reset to zero read as "it started over".

const ENDPOINT = "/api/meeting/transcribe-upload";
const UPLOAD_SHARE = 25;

export interface UploadProgress {
  /** 0-100 across the whole operation. */
  percent: number;
  /** Short status line, already written for a human. */
  label: string;
}

export async function transcribeUpload(
  file: File,
  onProgress: (p: UploadProgress) => void,
  signal?: AbortSignal,
): Promise<string> {
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
  // transcript, so no orphaned audio is left behind.
  const discard = () =>
    fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ action: "discard", path }),
    }).catch(() => {});

  try {
    onProgress({ percent: 0, label: "Uploading" });
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", signed.signedUrl);
      xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          onProgress({
            percent: Math.round((e.loaded / e.total) * UPLOAD_SHARE),
            label: "Uploading",
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

    onProgress({ percent: UPLOAD_SHARE, label: "Reading the recording" });
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
          if (msg.total) {
            const share = (msg.done ?? 0) / msg.total;
            onProgress({
              percent: Math.round(UPLOAD_SHARE + share * (100 - UPLOAD_SHARE)),
              label: "Transcribing",
            });
          } else if (msg.label) {
            onProgress({ percent: UPLOAD_SHARE, label: msg.label });
          }
        }
        if (msg.type === "error") throw new Error(msg.error || "Transcription failed");
        if (msg.type === "done") text = msg.text || "";
      }
    }
    onProgress({ percent: 100, label: "Transcribing" });
    // The server removed the file once it read it; nothing left to discard.
    return text;
  } catch (e) {
    await discard();
    throw e;
  }
}
