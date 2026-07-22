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
import {
  DEFAULT_BRIEF_SECTIONS,
  meetingTypeLabel,
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
}: {
  meeting: MpMeeting | null;
  save: (p: Partial<MpMeeting>) => void;
  flush: () => Promise<void>;
  customSections: CustomSection[];
}) {
  const toast = useToast();
  // null | "all" | <sectionKey being redone/added>
  const [busy, setBusy] = useState<string | null>(null);

  // Always read the freshest meeting: the user may keep editing while a
  // generation is in flight.
  const mRef = useRef(meeting);
  useEffect(() => {
    mRef.current = meeting;
  }, [meeting]);

  const generate = useCallback(
    async (opts: GenerateOpts = {}): Promise<GenerateResult | null> => {
      const m = mRef.current;
      if (!m) return null;
      const sections = m.brief?.sections || [];

      // Standard sections + saved profile sections + any one-off sections
      // already present in this brief.
      const blueprint = [...DEFAULT_BRIEF_SECTIONS, ...customSections];
      const known = new Set(blueprint.map((s) => s.key));
      for (const s of sections) {
        if (!known.has(s.key)) {
          blueprint.push({ key: s.key, title: s.title, prompt: `Section "${s.title}" as before.` });
        }
      }

      // A section redo only sends THAT section's own current content as
      // context — never the rest of the brief — so the model can't touch
      // anything else and has nothing to "improve" beyond what was asked.
      const previousSections = opts.onlyKey
        ? sections.filter((s) => s.key === opts.onlyKey)
        : opts.refine
          ? sections
          : undefined;

      setBusy(opts.extra ? opts.extra.key : opts.onlyKey || "all");
      try {
        await flush();
        const res = await fetch("/api/meeting/ai", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            action: "brief",
            meeting: {
              title: m.title,
              meetingType: meetingTypeLabel(m.meeting_type),
              date: m.date,
              durationMin: m.duration_min,
              format: m.format,
              location: m.location,
              attendees: m.attendees,
              explain: m.explain,
              objectives: m.objectives,
              background: m.background,
              concerns: m.concerns,
              priorTranscript: m.prior_transcript,
              documents: (m.documents || []).map((d) => ({
                name: d.name,
                note: d.note,
                text: d.text,
              })),
            },
            sections: opts.extra
              ? [opts.extra]
              : opts.onlyKey
                ? blueprint.filter((s) => s.key === opts.onlyKey)
                : blueprint,
            kolId: m.kol_id || "",
            guidance: opts.guidance || "",
            previousSections,
            onlyKey: opts.onlyKey || "",
          }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Brief generation failed");
        const incoming: BriefSection[] = json.sections || [];
        if (!incoming.length) throw new Error("The model returned nothing usable — try again.");
        return { incoming, opts };
      } catch (e) {
        toast("error", (e as Error).message);
        return null;
      } finally {
        setBusy(null);
      }
    },
    [customSections, flush, toast],
  );

  // Writes a previously-fetched proposal to the meeting. Called only after
  // the user reviews and accepts it.
  const applyGenerated = useCallback(
    (incoming: BriefSection[], opts: GenerateOpts) => {
      const latest = mRef.current;
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

  return { busy, generate, applyGenerated, briefStale };
}
