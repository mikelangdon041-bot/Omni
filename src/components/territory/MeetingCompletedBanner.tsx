"use client";

// Green call-to-action shown on the Activity and Meetings tabs while a
// meeting is scheduled but not yet completed. Clicking it opens the
// Complete Meeting form prefilled with the scheduled date.

import { useState } from "react";
import { CalendarCheck } from "lucide-react";
import {
  CompleteMeetingModal,
  type CompletedMeeting,
} from "@/components/territory/CompleteMeetingModal";

export function MeetingCompletedBanner({
  scheduledFor,
  method,
  meetingNumber,
  onComplete,
}: {
  scheduledFor: string; // ISO date of the scheduled meeting
  method?: string | null;
  meetingNumber: number;
  onComplete: (m: CompletedMeeting) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const when = new Date(scheduledFor);
  const dateStr = when.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const past = when.getTime() < Date.now();

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 shadow-sm">
        <CalendarCheck size={18} className="shrink-0 text-emerald-600" />
        <p className="min-w-0 flex-1 text-sm text-emerald-900">
          <span className="font-semibold">Meeting scheduled</span> for {dateStr}.{" "}
          {past ? "Did it happen?" : "Once it happens, log it here."}
        </p>
        <button
          onClick={() => setOpen(true)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700"
        >
          <CalendarCheck size={14} /> Meeting completed
        </button>
      </div>

      <CompleteMeetingModal
        key={scheduledFor}
        open={open}
        onClose={() => setOpen(false)}
        meetingNumber={meetingNumber}
        defaultDate={scheduledFor}
        defaultMethod={method || undefined}
        onComplete={onComplete}
      />
    </>
  );
}
