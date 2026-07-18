"use client";

// Practice mode: full-screen run-through with your notes and a timer.
// Record yourself; every slide advance is timestamped. Afterwards you get
// hard metrics (pace, fillers, per-slide time) + AI coaching — which
// compares against your script only if you have one.

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Mic, Square, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Feedback";
import { SlideCanvas } from "./SlideCanvas";
import { deckText, notesToText, type Slide, type SlideTheme } from "@/lib/slides/types";

const FILLERS = [
  "um", "uh", "like", "you know", "sort of", "kind of", "basically",
  "actually", "literally", "right?", "i mean",
];

export interface PracticeResult {
  transcript: string;
  slide_timings: { slideIndex: number; startSec: number }[];
  metrics: {
    durationSec: number;
    wpm: number;
    fillerCount: number;
    fillers: Record<string, number>;
  };
  coaching: string;
}

export function computeMetrics(transcript: string, durationSec: number) {
  const words = transcript.trim().split(/\s+/).filter(Boolean);
  const lower = ` ${transcript.toLowerCase().replace(/[^\w\s?]/g, "")} `;
  const fillers: Record<string, number> = {};
  let fillerCount = 0;
  for (const f of FILLERS) {
    const count = lower.split(` ${f} `).length - 1;
    if (count > 0) {
      fillers[f] = count;
      fillerCount += count;
    }
  }
  return {
    durationSec,
    wpm: durationSec > 0 ? Math.round((words.length / durationSec) * 60) : 0,
    fillerCount,
    fillers,
  };
}

export function PracticeMode({
  slides,
  theme,
  onClose,
  onComplete,
}: {
  slides: Slide[];
  theme: SlideTheme;
  onClose: () => void;
  onComplete: (r: PracticeResult) => Promise<void>;
}) {
  const toast = useToast();
  const [index, setIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [phase, setPhase] = useState<"ready" | "recording" | "analyzing" | "done">("ready");
  const [result, setResult] = useState<PracticeResult | null>(null);
  const [canvasW, setCanvasW] = useState(720);

  const timingsRef = useRef<{ slideIndex: number; startSec: number }[]>([]);
  const elapsedRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const measure = () => {
      const w = wrapRef.current?.clientWidth || 760;
      setCanvasW(Math.min(900, w - 16));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      try {
        mediaRef.current?.stop();
      } catch {
        // already stopped
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // Arrow-key navigation.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") next();
      if (e.key === "ArrowLeft") prev();
      if (e.key === "Escape" && phase !== "recording") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, phase]);

  function goTo(i: number) {
    const clamped = Math.max(0, Math.min(slides.length - 1, i));
    if (clamped !== index && phase === "recording") {
      timingsRef.current.push({ slideIndex: clamped, startSec: elapsedRef.current });
    }
    setIndex(clamped);
  }
  const next = () => goTo(index + 1);
  const prev = () => goTo(index - 1);

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const rec = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size) chunksRef.current.push(e.data);
      };
      rec.start(5000);
      mediaRef.current = rec;
      elapsedRef.current = 0;
      timingsRef.current = [{ slideIndex: index, startSec: 0 }];
      setElapsed(0);
      setPhase("recording");
      timerRef.current = setInterval(() => {
        elapsedRef.current += 1;
        setElapsed(elapsedRef.current);
      }, 1000);
    } catch {
      toast("error", "Microphone access was denied — you can still click through silently.");
    }
  }

  async function stop() {
    if (timerRef.current) clearInterval(timerRef.current);
    const rec = mediaRef.current;
    if (!rec) return;
    setPhase("analyzing");
    await new Promise<void>((resolve) => {
      rec.onstop = () => resolve();
      try {
        rec.stop();
      } catch {
        resolve();
      }
    });
    streamRef.current?.getTracks().forEach((t) => t.stop());

    try {
      const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
      if (!blob.size) throw new Error("Nothing was recorded.");
      const form = new FormData();
      form.append("audio", new File([blob], "practice.webm", { type: blob.type }));
      const tRes = await fetch("/api/ai/transcribe", {
        method: "POST",
        credentials: "same-origin",
        body: form,
      });
      const tJson = await tRes.json().catch(() => ({}));
      if (!tRes.ok) throw new Error(tJson.error || "Transcription failed");
      const transcript: string = tJson.text || "";
      if (!transcript.trim()) throw new Error("No speech detected in the run.");

      const metrics = computeMetrics(transcript, elapsedRef.current);
      const notesText = slides
        .map((s, i) => {
          const t = notesToText(s.notes);
          return t ? `Slide ${i + 1}: ${t}` : "";
        })
        .filter(Boolean)
        .join("\n");

      const cRes = await fetch("/api/slides/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          action: "coach",
          transcript,
          deckText: deckText(slides),
          notesText, // empty = coach without script comparison
          metrics,
          timings: timingsRef.current,
        }),
      });
      const cJson = await cRes.json().catch(() => ({}));
      if (!cRes.ok) throw new Error(cJson.error || "Coaching failed");

      const r: PracticeResult = {
        transcript,
        slide_timings: timingsRef.current,
        metrics,
        coaching: cJson.coaching || "",
      };
      setResult(r);
      setPhase("done");
      await onComplete(r);
    } catch (e) {
      toast("error", (e as Error).message);
      setPhase("ready");
    }
  }

  const mmss = useMemo(
    () =>
      `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`,
    [elapsed],
  );

  const slide = slides[index];

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-ink/95 p-4 text-white">
      {/* Top bar */}
      <div className="mb-3 flex items-center gap-3">
        <span className="text-sm font-semibold">
          Slide {index + 1} / {slides.length}
        </span>
        {phase === "recording" && (
          <span className="flex items-center gap-2 rounded-full bg-red-500/20 px-3 py-1 text-sm font-semibold text-red-300">
            <span className="h-2 w-2 animate-pulse rounded-full bg-red-400" /> {mmss}
          </span>
        )}
        <span className="flex-1" />
        {phase === "ready" && (
          <Button size="sm" onClick={start}>
            <Mic size={14} /> Start recording
          </Button>
        )}
        {phase === "recording" && (
          <Button size="sm" variant="danger" onClick={stop}>
            <Square size={14} /> Finish & analyze
          </Button>
        )}
        <button
          className="rounded-lg p-2 text-white/70 transition hover:bg-white/10 hover:text-white"
          onClick={onClose}
          disabled={phase === "analyzing"}
        >
          <X size={18} />
        </button>
      </div>

      {phase === "analyzing" ? (
        <div className="grid flex-1 place-items-center">
          <p className="text-sm text-white/80">
            Transcribing your run and preparing coaching…
          </p>
        </div>
      ) : phase === "done" && result ? (
        <div className="mx-auto w-full max-w-3xl flex-1 overflow-y-auto rounded-xl bg-white p-5 text-ink">
          <h2 className="mb-3 text-lg font-semibold">Practice results</h2>
          <div className="mb-4 grid grid-cols-3 gap-2">
            <Stat label="Duration" value={fmtDur(result.metrics.durationSec)} />
            <Stat
              label="Pace"
              value={`${result.metrics.wpm} wpm`}
              hint={
                result.metrics.wpm > 170
                  ? "fast"
                  : result.metrics.wpm < 110 && result.metrics.wpm > 0
                    ? "slow"
                    : "good range"
              }
            />
            <Stat
              label="Filler words"
              value={String(result.metrics.fillerCount)}
              hint={Object.entries(result.metrics.fillers)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3)
                .map(([w, n]) => `${w}×${n}`)
                .join(", ")}
            />
          </div>
          <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-muted">
            Coaching
          </h3>
          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">
            {result.coaching}
          </pre>
          <div className="mt-4 flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setPhase("ready");
                setResult(null);
                setIndex(0);
              }}
            >
              Run it again
            </Button>
            <Button onClick={onClose}>Done</Button>
          </div>
        </div>
      ) : (
        <>
          {/* Slide */}
          <div ref={wrapRef} className="flex flex-1 items-center justify-center overflow-hidden">
            {slide && <SlideCanvas slide={slide} theme={theme} width={canvasW} />}
          </div>

          {/* Notes + nav */}
          <div className="mx-auto mt-3 w-full max-w-4xl">
            <div className="max-h-28 overflow-y-auto rounded-lg bg-white/10 px-4 py-3 text-sm leading-relaxed text-white/90">
              {slide?.notes ? (
                <span className="whitespace-pre-wrap">{notesToText(slide.notes)}</span>
              ) : (
                <span className="text-white/50">No notes for this slide.</span>
              )}
            </div>
            <div className="mt-3 flex items-center justify-center gap-3">
              <Button variant="secondary" size="sm" onClick={prev} disabled={index === 0}>
                <ChevronLeft size={14} /> Prev
              </Button>
              <Button size="sm" onClick={next} disabled={index >= slides.length - 1}>
                Next <ChevronRight size={14} />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-canvas px-3 py-2 text-center">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="text-lg font-bold">{value}</p>
      {hint && <p className="text-[11px] text-muted">{hint}</p>}
    </div>
  );
}

function fmtDur(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}
