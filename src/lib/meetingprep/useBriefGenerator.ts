"use client";

// Page-level brief generation state. Lives in the meeting page (not the Brief
// tab) so a running generation keeps going while the user switches tabs, and
// the Setup tab's "Generate brief" CTA can kick it off and jump to the Brief
// tab immediately.

import { useCallback, useRef, useState } from "react";
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
  /** Redo just this section (previous content is provided to the AI). */
  onlyKey?: string;
  /** Free-text guidance about what should be different. */
  guidance?: string;
  /** Refine the whole existing brief instead of writing from scratch. */
  refine?: boolean;
  /** Generate one brand-new section and append it. */
  extra?: { key: string; title: string; prompt: string };
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
  mRef.current = meeting;

  const generate = useCallback(
    async (opts: GenerateOpts = {}): Promise<boolean> => {
      const m = mRef.current;
      if (!m) return false;
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
            sections: opts.extra ? [opts.extra] : blueprint,
            kolId: m.kol_id || "",
            guidance: opts.guidance || "",
            previousSections: opts.refine || opts.onlyKey ? sections : undefined,
            onlyKey: opts.onlyKey || "",
          }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Brief generation failed");
        const incoming: BriefSection[] = json.sections || [];

        const latest = mRef.current;
        if (!latest) return false;
        const cur = latest.brief?.sections || [];
        let next: BriefSection[];
        if (opts.extra) {
          next = [...cur, ...incoming];
        } else if (opts.onlyKey) {
          next = cur.map((s) => incoming.find((n) => n.key === s.key) || s);
        } else {
          next = incoming;
        }
        save({
          brief: {
            sections: next,
            generatedAt: new Date().toISOString(),
            sourceFingerprint: setupFingerprint(latest),
          },
        });
        return true;
      } catch (e) {
        toast("error", (e as Error).message);
        return false;
      } finally {
        setBusy(null);
      }
    },
    [customSections, flush, save, toast],
  );

  const m = meeting;
  const briefStale = Boolean(
    m &&
      (m.brief?.sections || []).length > 0 &&
      m.brief?.sourceFingerprint &&
      m.brief.sourceFingerprint !== setupFingerprint(m),
  );

  return { busy, generate, briefStale };
}
