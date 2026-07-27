"use client";

// Client half of "upload a meeting recording": pushes the file to storage and
// reports one honest percentage for the whole job.
//
// The file is sliced into parts rather than sent whole, because two separate
// ceilings sit in the way: Vercel rejects request bodies past ~4.5 MB (so it
// can't be POSTed to our own API), and Supabase storage rejects any single
// object over 50 MB — reported as a 400 whose body says 413, which is how a
// perfectly ordinary 90-minute meeting used to fail with "Upload failed
// (400)".
//
// Transcription then runs one chunk per request, driven from here. Doing every
// chunk inside a single server call put a hard ceiling on recording length: a
// long meeting ran past the function's time limit and lost the entire job.
// Spreading it across requests means length costs more requests, not failure.
//
// The bar covers all three stages on a single 0-100 scale. Separate bars that
// each reset to zero read as "it started over".

const ENDPOINT = "/api/meeting/transcribe-upload";
// Comfortably under Supabase's 50 MB per-object limit.
const PART_BYTES = 40 * 1024 * 1024;
// Stage weights, summing to 100.
const UPLOAD_SHARE = 20;
const PREPARE_SHARE = 15;
// Chunk requests in flight at once. Enough to keep things moving without
// tripping rate limits on a long recording.
const CONCURRENCY = 3;

export interface UploadProgress {
  /** 0-100 across the whole operation. */
  percent: number;
  /** Short status line, already written for a human. */
  label: string;
}

async function post<T>(payload: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(payload),
    signal,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json as T;
}

// One chunk, with a couple of retries — a single dropped connection shouldn't
// cost the whole recording when we're 40 chunks in.
async function transcribeChunk(
  payload: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<string> {
  let last: Error | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const { text } = await post<{ text?: string }>(payload, signal);
      return text || "";
    } catch (e) {
      if (signal?.aborted) throw e;
      last = e as Error;
      if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 1500));
    }
  }
  throw last ?? new Error("Transcription failed");
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

  // Cleans up anything that made it to storage but never became a transcript.
  const discard = () => post({ action: "discard", uploadId }).catch(() => {});

  try {
    // --- 1. Upload the file in parts -------------------------------------
    onProgress({ percent: 0, label: "Uploading" });
    let uploadedBefore = 0;
    for (let i = 0; i < parts; i++) {
      const { signedUrl } = await post<{ signedUrl: string }>(
        { action: "sign", uploadId, part: i, ext },
        signal,
      );
      const slice = file.slice(i * PART_BYTES, (i + 1) * PART_BYTES);
      const base = uploadedBefore;
      await putSlice(
        signedUrl,
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

    // --- 2. Reassemble and split ------------------------------------------
    onProgress({ percent: UPLOAD_SHARE, label: "Preparing the audio" });
    const { totalChunks, chunkExt } = await post<{
      totalChunks: number;
      chunkExt: string;
    }>({ action: "prepare", uploadId, parts, ext }, signal);

    // --- 3. Transcribe, one chunk per request ------------------------------
    const base = UPLOAD_SHARE + PREPARE_SHARE;
    const span = 100 - base;
    onProgress({ percent: base, label: "Transcribing" });

    const texts: string[] = new Array(totalChunks).fill("");
    let done = 0;
    let next = 0;
    const worker = async () => {
      for (;;) {
        const i = next++;
        if (i >= totalChunks) return;
        texts[i] = await transcribeChunk(
          { action: "chunk", uploadId, index: i, chunkExt },
          signal,
        );
        done += 1;
        onProgress({
          percent: Math.round(base + (done / totalChunks) * span),
          label: "Transcribing",
        });
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, totalChunks) }, worker),
    );

    onProgress({ percent: 100, label: "Transcribing" });
    // Each chunk was removed as it was read; this clears anything left over.
    await discard();
    return texts.filter(Boolean).join("\n\n");
  } catch (e) {
    await discard();
    throw e;
  }
}
