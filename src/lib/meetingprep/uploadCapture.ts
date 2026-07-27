"use client";

// Client half of "upload a meeting recording": pushes the file to storage and
// reports one honest percentage for the whole job.
//
// The file is sliced into parts rather than sent whole, because two separate
// ceilings sit in the way: Vercel rejects request bodies past ~4.5 MB (so it
// can't be POSTed to our own API), and Supabase storage rejects any single
// object over 50 MB — reported as a 400 whose body says 413, which is how a
// perfectly ordinary 90-minute meeting used to fail with "Upload failed
// (400)". Each slice is well under that cap; the server stitches them back
// together and deletes them once it has read the audio.
//
// The bar covers upload and transcription on a single 0-100 scale: the bytes
// are the first quarter, transcribing the rest. Two bars that each reset to
// zero read as "it started over".

const ENDPOINT = "/api/meeting/transcribe-upload";
const UPLOAD_SHARE = 25;
// Comfortably under Supabase's 50 MB per-object limit.
const PART_BYTES = 40 * 1024 * 1024;

export interface UploadProgress {
  /** 0-100 across the whole operation. */
  percent: number;
  /** Short status line, already written for a human. */
  label: string;
}

function post(payload: Record<string, unknown>, signal?: AbortSignal) {
  return fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(payload),
    signal,
  });
}

// PUT one slice to its signed URL, surfacing the server's own error text —
// a bare status code sent us chasing the wrong cause once already.
function putSlice(
  url: string,
  slice: Blob,
  contentType: string,
  onBytes: (loaded: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onBytes(e.loaded);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let detail = "";
      try {
        const parsed = JSON.parse(xhr.responseText);
        detail = parsed.message || parsed.error || "";
      } catch {
        detail = (xhr.responseText || "").slice(0, 200);
      }
      reject(new Error(`Upload failed (${xhr.status})${detail ? `: ${detail}` : ""}`));
    };
    xhr.onerror = () => reject(new Error("Upload failed — check your connection."));
    xhr.onabort = () => reject(new Error("Upload cancelled."));
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(slice);
  });
}

export async function transcribeUpload(
  file: File,
  onProgress: (p: UploadProgress) => void,
  signal?: AbortSignal,
): Promise<string> {
  const ext = (file.name.split(".").pop() || "webm").toLowerCase();
  const uploadId = crypto.randomUUID();
  const contentType = file.type || "application/octet-stream";
  const parts = Math.max(1, Math.ceil(file.size / PART_BYTES));

  // Cleans up parts that made it to storage but never became a transcript.
  const discard = () =>
    post({ action: "discard", uploadId, ext }).catch(() => {});

  try {
    onProgress({ percent: 0, label: "Uploading" });

    let uploadedBefore = 0;
    for (let i = 0; i < parts; i++) {
      const signRes = await post({ action: "sign", uploadId, part: i, ext }, signal);
      const signed = await signRes.json().catch(() => ({}));
      if (!signRes.ok) throw new Error(signed.error || "Could not start the upload");

      const slice = file.slice(i * PART_BYTES, (i + 1) * PART_BYTES);
      const base = uploadedBefore;
      await putSlice(
        signed.signedUrl,
        slice,
        contentType,
        (loaded) =>
          onProgress({
            percent: Math.round(((base + loaded) / file.size) * UPLOAD_SHARE),
            label: "Uploading",
          }),
        signal,
      );
      uploadedBefore += slice.size;
    }

    onProgress({ percent: UPLOAD_SHARE, label: "Reading the recording" });
    const res = await post({ action: "from-storage", uploadId, parts, ext }, signal);
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
    // The server removed the parts once it read them; nothing left to discard.
    return text;
  } catch (e) {
    await discard();
    throw e;
  }
}
