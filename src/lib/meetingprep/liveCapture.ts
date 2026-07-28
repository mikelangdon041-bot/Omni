"use client";

// Live meeting capture: the audio plumbing behind "record the meeting I'm in
// right now", separated from the UI so the component stays readable.
//
// Two sources, mixed into one track:
//   * the microphone (what the room / this person says), and
//   * optionally the meeting's own audio — Teams, Zoom, Meet — captured via
//     getDisplayMedia. A browser tab can't reach another app's sound directly;
//     the user picks the window/screen to share and the browser hands us its
//     audio. On Windows that means "Entire Screen" + "Share system audio" for
//     the Teams desktop app, or the tab itself for Teams on the web.
//
// Audio never leaves the device as audio: each ~4-minute segment is posted to
// Whisper, transcribed, and dropped. The only copy that outlives the segment
// is the crash vault in IndexedDB, and `discard()` wipes that.

import { clearSession, saveChunk } from "@/lib/conference/recordingVault";

export const SEGMENT_MS = 4 * 60 * 1000;

export interface CaptureCallbacks {
  /** A segment finished transcribing; `index` lets late arrivals slot in. */
  onSegment: (index: number, text: string) => void;
  onProgress: (done: number, total: number) => void;
  /** The shared window/tab went away — treat it as "the meeting ended". */
  onSourceEnded: () => void;
  onError: (message: string) => void;
}

export interface LiveCapture {
  stop: () => Promise<string>;
  discard: () => Promise<void>;
  /** True when meeting audio (not just the mic) is being captured. */
  hasMeetingAudio: boolean;
}

async function transcribeSegment(blob: Blob, index: number): Promise<string> {
  const form = new FormData();
  form.append(
    "audio",
    new File([blob], `segment-${index}.webm`, { type: blob.type || "audio/webm" }),
  );
  const res = await fetch("/api/ai/transcribe", {
    method: "POST",
    credentials: "same-origin",
    body: form,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `Transcription failed (${res.status})`);
  return String(json.text || "");
}

export async function startLiveCapture(
  vaultKey: string,
  includeMeetingAudio: boolean,
  cb: CaptureCallbacks,
): Promise<LiveCapture> {
  const mic = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
  });

  let display: MediaStream | null = null;
  if (includeMeetingAudio) {
    // Chrome/Edge only hand over audio alongside a video track, so we ask for
    // video and immediately ignore it — we never read a frame.
    // These hints do real work in Chrome and Edge: `systemAudio: "include"`
    // makes the share-audio checkbox default to ticked (the small one that is
    // easy to miss, and without which the recording is mic-only), and
    // `displaySurface: "monitor"` preselects the whole-screen option, which is
    // the only surface that carries desktop-app audio. Browsers that don't
    // know these fields ignore them.
    display = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: "monitor" },
      audio: { echoCancellation: false, noiseSuppression: false },
      systemAudio: "include",
      selfBrowserSurface: "exclude",
      surfaceSwitching: "include",
    } as DisplayMediaStreamOptions);
    if (display.getAudioTracks().length === 0) {
      display.getTracks().forEach((t) => t.stop());
      display = null;
      cb.onError(
        "That share didn't include any audio. Re-share and tick “Also share tab/system audio”, or keep going with just your microphone.",
      );
    }
  }

  // Mix both sources into a single track so MediaRecorder produces one file.
  const ctx = new AudioContext();
  const mixed = ctx.createMediaStreamDestination();
  ctx.createMediaStreamSource(mic).connect(mixed);
  if (display) ctx.createMediaStreamSource(display).connect(mixed);
  const stream = mixed.stream;

  // "Stop sharing" in the browser bar, or closing the shared window, means
  // the meeting is over — that's what drives the automatic end-of-meeting
  // prompt without the user having to come back to this tab first.
  display?.getVideoTracks()[0]?.addEventListener("ended", () => cb.onSourceEnded());

  const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
    ? "audio/webm;codecs=opus"
    : "audio/webm";

  let stopping = false;
  let recorder: MediaRecorder | null = null;
  let segTimer: ReturnType<typeof setTimeout> | null = null;
  const parts: string[] = [];
  let queue: Promise<unknown> = Promise.resolve();
  let done = 0;
  let total = 0;

  function enqueue(blob: Blob, index: number) {
    total += 1;
    cb.onProgress(done, total);
    queue = queue
      .then(async () => {
        const text = await transcribeSegment(blob, index);
        parts[index] = text;
        done += 1;
        cb.onProgress(done, total);
        cb.onSegment(index, text);
      })
      .catch((e) => {
        // One bad segment must not sink the whole recording — the rest of
        // the transcript is still worth having.
        parts[index] = parts[index] ?? "";
        done += 1;
        cb.onProgress(done, total);
        cb.onError((e as Error).message);
      });
  }

  function startSegment(index: number) {
    const rec = new MediaRecorder(stream, { mimeType: mime });
    const chunks: Blob[] = [];
    let chunkNo = 0;
    rec.ondataavailable = (e) => {
      if (!e.data.size) return;
      chunks.push(e.data);
      // Crash insurance: every chunk hits IndexedDB as it arrives, so a dead
      // battery or a killed tab loses seconds, not the meeting.
      void saveChunk(vaultKey, index, chunkNo++, e.data, mime);
    };
    rec.onstop = () => {
      if (chunks.length) enqueue(new Blob(chunks, { type: mime }), index);
      if (!stopping) startSegment(index + 1);
    };
    rec.start(5000);
    recorder = rec;
    segTimer = setTimeout(() => {
      if (rec.state === "recording") rec.stop();
    }, SEGMENT_MS);
  }

  startSegment(0);

  function teardown() {
    stopping = true;
    if (segTimer) clearTimeout(segTimer);
    try {
      if (recorder?.state === "recording") recorder.stop();
    } catch {
      // already stopped
    }
    mic.getTracks().forEach((t) => t.stop());
    display?.getTracks().forEach((t) => t.stop());
    void ctx.close().catch(() => {});
  }

  return {
    hasMeetingAudio: !!display,

    async stop() {
      teardown();
      // Give the final segment's onstop a tick to queue its transcription.
      await new Promise((r) => setTimeout(r, 150));
      await queue;
      // The audio has served its purpose — wipe the crash vault now, before
      // anything is shown or saved. Only text survives this line.
      await clearSession(vaultKey);
      return parts.filter(Boolean).join("\n\n").trim();
    },

    async discard() {
      teardown();
      parts.length = 0;
      await clearSession(vaultKey);
    },
  };
}
