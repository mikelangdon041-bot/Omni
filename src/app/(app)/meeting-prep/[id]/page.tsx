"use client";

// One meeting: Setup → Brief → Grill me → Debrief.

import { useState } from "react";
import { useParams } from "next/navigation";
import { BackButton } from "@/components/BackButton";
import { Tabs } from "@/components/ui/Tabs";
import { SetupTab } from "@/components/meetingprep/SetupTab";
import { BriefTab } from "@/components/meetingprep/BriefTab";
import { GrillTab } from "@/components/meetingprep/GrillTab";
import { DebriefTab } from "@/components/meetingprep/DebriefTab";
import {
  useMpMeeting,
  useMpSettings,
  useUserId,
} from "@/lib/meetingprep/hooks";
import { meetingTypeLabel } from "@/lib/meetingprep/types";

const TABS = ["Setup", "Brief", "Grill me", "Debrief"] as const;
type Tab = (typeof TABS)[number];

export default function MeetingPage() {
  const { id } = useParams<{ id: string }>();
  const { userId } = useUserId();
  const { meeting, loading, save, flush } = useMpMeeting(id);
  const { settings, save: saveSettings } = useMpSettings(userId);
  const [tab, setTab] = useState<Tab>("Setup");

  if (loading) return <p className="py-16 text-center text-sm text-muted">Loading…</p>;
  if (!meeting)
    return (
      <div className="py-16 text-center">
        <p className="text-sm text-muted">This meeting was deleted.</p>
        <div className="mt-3 flex justify-center">
          <BackButton label="Back to Meeting Prep" />
        </div>
      </div>
    );

  return (
    <>
      <BackButton label="Meeting Prep" />
      <div className="mb-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--accent)]">
          {meetingTypeLabel(meeting.meeting_type)}
          {meeting.date &&
            ` · ${new Date(meeting.date).toLocaleString(undefined, {
              weekday: "short",
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}`}
        </p>
        <h1 className="mt-0.5 text-2xl font-semibold tracking-tight">
          {meeting.title || "Untitled meeting"}
        </h1>
      </div>

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {tab === "Setup" && <SetupTab m={meeting} save={save} userId={userId} />}
      {tab === "Brief" && (
        <BriefTab
          m={meeting}
          save={save}
          flush={flush}
          userId={userId}
          customSections={settings?.custom_sections || []}
          saveCustomSections={(custom_sections) => void saveSettings({ custom_sections })}
        />
      )}
      {tab === "Grill me" && <GrillTab m={meeting} save={save} flush={flush} />}
      {tab === "Debrief" && <DebriefTab m={meeting} save={save} userId={userId} />}
    </>
  );
}
