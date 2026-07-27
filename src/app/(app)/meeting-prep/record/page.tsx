"use client";

// Record a meeting that's happening right now. The recorder handles capture,
// the discard prompt, and the summary; this page just persists what comes
// out of it as a real meeting so the notes live alongside every other
// meeting, with the same debrief/follow-up/Territory-logging machinery.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BackButton } from "@/components/BackButton";
import { useToast } from "@/components/ui/Feedback";
import {
  MeetingRecorder,
  type CaptureResult,
} from "@/components/meetingprep/MeetingRecorder";
import { useMpMeetings, useUserId } from "@/lib/meetingprep/hooks";

export default function RecordMeetingPage() {
  const router = useRouter();
  const toast = useToast();
  const { userId } = useUserId();
  const { add } = useMpMeetings(userId);
  const [saving, setSaving] = useState(false);

  async function handleSave(result: CaptureResult) {
    setSaving(true);
    try {
      const meeting = await add({
        title: result.title,
        date: new Date().toISOString(),
        // A recording is by definition a meeting that already happened.
        meeting_type: "other",
        // Names given for the voices carry onto the meeting, so the roster is
        // captured once instead of retyped in Setup.
        attendees: (result.attendees || []).map((name) => ({
          name,
          role: "",
          org: "",
          notes: "",
        })),
        debrief: {
          transcript: result.transcript,
          sections: result.sections,
          // Only the ones still ticked on the review screen arrive here.
          actions: result.actions.map((a) => ({
            text: a.text,
            done: false,
            selected: true,
          })),
        },
      });
      if (!meeting) throw new Error("Could not save the meeting");
      // Land on the Debrief tab, where the follow-ups can be pushed to the
      // to-do list and the meeting logged to Territory.
      try {
        localStorage.setItem(`mp-tab:${meeting.id}`, "Debrief");
      } catch {
        // Tab memory is a nicety, not a requirement.
      }
      router.push(`/meeting-prep/${meeting.id}`);
    } catch (e) {
      toast("error", (e as Error).message);
      setSaving(false);
    }
  }

  return (
    <>
      <BackButton label="Meeting Prep" />
      <div className="mb-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--accent)]">
          Meeting Prep
        </p>
        <h1 className="mt-0.5 text-2xl font-semibold tracking-tight">
          Upload or record a meeting
        </h1>
        <p className="mt-1 text-sm text-muted">
          Either way you get the same thing: a transcript, nested-bullet notes,
          the action items pulled out, and a meeting created to hold it all.
        </p>
      </div>
      <MeetingRecorder onSave={handleSave} saving={saving} />
    </>
  );
}
