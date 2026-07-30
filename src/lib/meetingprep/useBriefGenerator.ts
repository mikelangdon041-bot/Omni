"use client";

// Page-level brief generation state. Lives in the meeting page (not the Brief
// tab) so a running generation keeps going while the user switches tabs, and
// the Setup tab's "Generate brief" CTA can kick it off and jump to the Brief
// tab immediately.
//
// `generate()` only fetches the AI's proposal — it never writes to the
// meeting. The caller previews the proposal (old vs new) and calls
// `applyGenerated()` to actually save it, so nothing the AI writes lands on
// the brief without the user seeing it first.

import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "@/components/ui/Feedback";
import { canAutofill, runAutofill } from "./autofill";
import {
  DEFAULT_BRIEF_SECTIONS,
  meetingTypeLabel,
  orderSections,
  setupFingerprint,
  type BriefSection,
  type CustomSection,
  type MpMeeting,
} from "./types";

export interface GenerateOpts {
  /** Redo just this section (only that section's own current content is sent as context). */
  onlyKey?: string;
  /** Free-text guidance about what should be different. */
  guidance?: string;
  /** Refine the whole existing brief instead of writing from scratch. */
  refine?: boolean;
  /** Generate one brand-new section and append it. */
  extra?: { key: string; title: string; prompt: string };
}

export interface GenerateResult {
  /** The sections the AI proposed (only — never auto-applied). */
  incoming: BriefSection[];
  opts: GenerateOpts;
}

export function useBriefGenerator({
  meeting,
  save,
  flush,
  customSections,
  sectionOrder,
}: {
  meeting: MpMeeting | null;
  save: (p: Partial<MpMeeting>) => void;
  flush: () => Promise<void>;
  customSections: CustomSection[];
  /** The user's saved order for the brief's boxes, if they set one. */
  sectionOrder?: string[];
}) {
  const toast = useToast();
  // null | "all" | <sectionKey being redone/added>
  const [busy, setBusy] = useState<string | null>(null);
  // 0–100 for the loader, plus what's happening right now.
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState("");

  // Always read the freshest meeting: the user may keep editing while a
  // generation is in flight.
  const mRef = useRef(meeting);
  useEffect(() => {
    mRef.current = meeting;
  }, [meeting]);

  // The API answers in one shot — there is no token stream to count — so the
  // bar advances on a decaying ramp toward each step's ceiling and only
  // *reaches* a number when that step genuinely finishes. It never goes
  // backwards and never sits at 100 before the brief is actually in hand.
  const ticker = useRef<ReturnType<typeof setInterval> | null>(null);
  const ceiling = useRef(95);

  const stopRamp = useCallback(() => {
    if (ticker.current) clearInterval(ticker.current);
    ticker.current = null;
  }, []);

  const rampTo = useCallback(
    (target: number, label: string) => {
      ceiling.current = target;
      setStage(label);
      stopRamp();
      ticker.current = setInterval(() => {
        setProgress((p) => {
          const cap = ceiling.current;
          if (p >= cap) return p;
          // Fast at first, crawling as it nears the ceiling.
          return Math.min(cap, p + Math.max(0.3, (cap - p) * 0.06));
        });
      }, 350);
    },
    [stopRamp],
  );

  // Clean up if the page unmounts mid-generation.
  useEffect(() => stopRamp, [stopRamp]);

  const generate = useCallback(
    async (opts: GenerateOpts = {}): Promise<GenerateResult | null> => {
      const m = mRef.current;
      if (!m) return null;
      const sections = m.brief?.sections || [];

      // Standard sections + saved profile sections + any one-off sections
      // already present in this brief, arranged the way the user ordered them.
      const blueprint = [...DEFAULT_BRIEF_SECTIONS, ...customSections];
      const known = new Set(blueprint.map((s) => s.key));
      for (const s of sections) {
        if (!known.has(s.key)) {
          blueprint.push({ key: s.key, title: s.title, prompt: `Section "${s.title}" as before.` });
        }
      }
      const ordered = orderSections(blueprint, sectionOrder);

      // A section redo only sends THAT section's own current content as
      // context — never the rest of the brief — so the model can't touch
      // anything else and has nothing to "improve" beyond what was asked.
      const previousSections = opts.onlyKey
        ? sections.filter((s) => s.key === opts.onlyKey)
        : opts.refine
          ? sections
          : undefined;

      setBusy(opts.extra ? opts.extra.key : opts.onlyKey || "all");
      const wholeBrief = !opts.extra && !opts.onlyKey;
      setProgress(0);
      if (wholeBrief) rampTo(30, "Reading what you wrote");
      try {
        await flush();

        // Step 1 — pull the structured details out of Explain. This is no
        // longer something the user has to press: a whole-brief generation
        // always does it first, so the attendees, objectives, and concerns the
        // brief is built from are the ones described in prose. Only blank
        // fields are written, so nothing typed by hand is disturbed.
        let source = m;
        if (wholeBrief && canAutofill(m)) {
          try {
            const { patch, changes } = await runAutofill(m);
            if (changes) {
              source = { ...m, ...patch };
              save(patch);
              await flush();
            }
          } catch {
            // A brief built straight from the prose is still a good brief —
            // never lose the generation over the pre-pass.
          }
        }
        if (wholeBrief) rampTo(95, "Writing your brief");

        const res = await fetch("/api/meeting/ai", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            action: "brief",
            meeting: {
              title: source.title,
              meetingType: meetingTypeLabel(source.meeting_type),
              date: source.date,
              durationMin: source.duration_min,
              format: source.format,
              location: source.location,
              attendees: source.attendees,
              explain: source.explain,
              objectives: source.objectives,
              background: source.background,
              concerns: source.concerns,
              priorTranscript: source.prior_transcript,
              documents: (source.documents || []).map((d) => ({
                name: d.name,
                note: d.note,
                text: d.text,
              })),
            },
            sections: opts.extra
              ? [opts.extra]
              : opts.onlyKey
                ? ordered.filter((s) => s.key === opts.onlyKey)
                : ordered,
            kolId: source.kol_id || "",
            guidance: opts.guidance || "",
            previousSections,
            onlyKey: opts.onlyKey || "",
          }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Brief generation failed");
        const incoming: BriefSection[] = json.sections || [];
        if (!incoming.length) throw new Error("The model returned nothing usable — try again.");
        stopRamp();
        setStage("Done");
        setProgress(100);
        return { incoming, opts };
      } catch (e) {
        toast("error", (e as Error).message);
        stopRamp();
        setProgress(0);
        setStage("");
        return null;
      } finally {
        setBusy(null);
      }
    },
    [customSections, flush, rampTo, save, sectionOrder, stopRamp, toast],
  );

  // Writes a previously-fetched proposal to the meeting. Called only after
  // the user reviews and accepts it.
  const applyGenerated = useCallback(
    (incoming: BriefSection[], opts: GenerateOpts) => {
      const latest = mRef.current;
      setProgress(0);
      setStage("");
      if (!latest) return;
      // Snapshot each freshly-written section's content so the UI can later
      // tell it apart from a hand-edited (dirty) one.
      const stamped = incoming.map((s) => ({ ...s, generatedContent: s.content }));
      const cur = latest.brief?.sections || [];
      let next: BriefSection[];
      const fullRegen = !opts.extra && !opts.onlyKey;
      if (opts.extra) {
        next = [...cur, ...stamped];
      } else if (opts.onlyKey) {
        next = cur.map((s) => stamped.find((n) => n.key === s.key) || s);
      } else {
        next = stamped;
      }
      save({
        brief: {
          ...latest.brief,
          sections: next,
          generatedAt: new Date().toISOString(),
          // A single section redo (or adding one new section) only
          // refreshes part of the brief — the rest may still be stale
          // relative to the current setup, so only a full regenerate or
          // whole-brief refine gets to clear the stale flag.
          sourceFingerprint: fullRegen
            ? setupFingerprint(latest)
            : latest.brief?.sourceFingerprint,
        },
      });
    },
    [save],
  );

  const m = meeting;
  const briefStale = Boolean(
    m &&
      (m.brief?.sections || []).length > 0 &&
      m.brief?.sourceFingerprint &&
      m.brief.sourceFingerprint !== setupFingerprint(m),
  );

  return {
    busy,
    generate,
    applyGenerated,
    briefStale,
    progress: Math.round(progress),
    stage,
  };
}
