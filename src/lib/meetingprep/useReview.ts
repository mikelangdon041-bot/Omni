"use client";

// The read-through, which belongs to the whole pack rather than to one tab.
//
// It used to live inside the Brief tab, which is where it ran from and the
// only place its advice could be seen. That put the notes about the question
// bank on the one screen that cannot act on them, and left the writer with
// nothing on the tab they were actually working in.
//
// It stays ONE call over everything, deliberately. The notes worth the most
// are the ones that span tabs — the agenda allowing twenty minutes for
// questions that run forty two — and a reviewer that could only see one tab
// could not write them. So: one read of the pack, run from anywhere, and each
// tab shows the part of the answer that belongs to it.

import { useState } from "react";
import { useProgress } from "@/components/ui/Progress";
import { useToast } from "@/components/ui/Feedback";
import { htmlToPlain } from "@/lib/writer/types";
import { meetingTypeLabel, sectionTitle, type MpMeeting, type ReviewNote } from "./types";

/** Which tab a note belongs to. "pack" is about the whole thing. */
export type ReviewScope = "brief" | "questions" | "setup" | "pack";

export function scopeOf(note: ReviewNote): ReviewScope {
  if (note.target.startsWith("section:")) return "brief";
  if (note.target === "questions") return "questions";
  if (note.target === "setup") return "setup";
  return "pack";
}

export function useReview({
  meeting: m,
  save,
}: {
  meeting: MpMeeting;
  save: (p: Partial<MpMeeting>) => void;
}) {
  const toast = useToast();
  const [reviewing, setReviewing] = useState(false);
  const pct = useProgress(reviewing, 40000);

  // Stored under `brief` because that is where it has always been stored, and
  // a rename would lose every read-through anyone is mid-way through acting
  // on. It is the pack's, not the brief's.
  const review = m.brief?.review;
  const notes = (review?.notes || []).filter((n) => !n.dismissed);

  const setNotes = (next: ReviewNote[]) =>
    save({ brief: { ...m.brief, review: { ...review, notes: next } } });

  const patchNote = (id: string, p: Partial<ReviewNote>) =>
    setNotes((review?.notes || []).map((n) => (n.id === id ? { ...n, ...p } : n)));

  const clear = () => save({ brief: { ...m.brief, review: undefined } });

  async function runReview() {
    setReviewing(true);
    try {
      const sections = m.brief?.sections || [];
      const briefText = sections
        .map((s) => `[${s.key}] ${sectionTitle(s.key, s.title)}:\n${htmlToPlain(s.content)}`)
        .join("\n\n");
      const questionsText = (m.questions?.items || [])
        .filter((q) => !q.deleted)
        .map((q) => `(${q.category}) ${q.text}`)
        .join("\n");
      const res = await fetch("/api/meeting/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          action: "review",
          meeting: {
            title: m.title,
            topic: m.topic,
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
          },
          kolId: m.kol_id || "",
          briefText,
          questionsText,
          sectionKeys: sections.map((s) => s.key),
          research: m.brief?.research?.notes || "",
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not review it");
      const fresh: ReviewNote[] = (json.notes || []).map(
        (n: Omit<ReviewNote, "id" | "done" | "dismissed">, i: number) => ({
          ...n,
          id: `r${Date.now()}_${i}`,
          done: false,
          dismissed: false,
        }),
      );
      if (!fresh.length) toast("success", "Read it through, nothing worth changing.");
      else toast("success", `${fresh.length} thing${fresh.length === 1 ? "" : "s"} worth a look`);
      // A fresh read-through replaces the last one: advice about a pack that
      // has since been rewritten is worse than no advice.
      save({
        brief: { ...m.brief, review: { notes: fresh, at: new Date().toISOString() } },
      });
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setReviewing(false);
    }
  }

  return { notes, at: review?.at, reviewing, pct, runReview, patchNote, setNotes, clear };
}
