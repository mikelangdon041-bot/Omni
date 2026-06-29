/// <reference lib="webworker" />

// Drives the resumable transcription loop off the main thread so browser
// tab-throttling can't stall it. Transcribes one chunk per request in order,
// then kicks off summarization.

interface StartMessage {
  recordingId: string;
  totalChunks: number;
  startIndex: number;
}

type OutMessage =
  | { type: "progress"; chunksDone: number; totalChunks: number }
  | { type: "status"; status: string }
  | { type: "error"; message: string }
  | { type: "complete" };

const post = (m: OutMessage) => self.postMessage(m);

async function postJson(url: string, body?: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

self.onmessage = async (e: MessageEvent<StartMessage>) => {
  const { recordingId, totalChunks, startIndex } = e.data;

  try {
    for (let i = startIndex; i < totalChunks; i++) {
      const data = await postJson(
        `/api/recordings/${recordingId}/transcribe-chunk`,
        { index: i },
      );
      post({
        type: "progress",
        chunksDone: data.chunksDone ?? i + 1,
        totalChunks,
      });
    }

    post({ type: "status", status: "summarizing" });
    await postJson(`/api/recordings/${recordingId}/summarize`);
    post({ type: "complete" });
  } catch (err) {
    post({
      type: "error",
      message: err instanceof Error ? err.message : "Transcription failed",
    });
  }
};
