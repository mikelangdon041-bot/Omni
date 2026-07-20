"use client";

// One meeting: Setup → Brief → Grill me → Debrief.
// Brief generation lives here (not in the Brief tab) so it keeps running in
// the background while the user moves between tabs.

import { useParams } from "next/navigation";
import { Check, CloudUpload } from "lucide-react";
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
import { useBriefGenerator } from "@/lib/meetingprep/useBriefGenerator";
import { meetingTypeLabel } from "@/lib/meetingprep/types";
import { usePersistedState } from "@/lib/usePersistedState";

const TABS = ["Setup", "Brief", "Grill me", "Debrief"] as const;
type Tab = (typeof TABS)[number];

export default function MeetingPage() {
  const { id } = useParams<{ id: string }>();
  const { userId } = useUserId();
  const { meeting, loading, save, flush, saveState } = useMpMeeting(id);
  const { settings, save: saveSettings } = useMpSettings(userId);
  // Remembers which tab you were on for THIS meeting specifically.
  const [tab, setTab] = usePersistedState<Tab>(`mp-tab:${id}`, "Setup", TABS);

  const generator = useBriefGenerator({
    meeting,
    save,
    flush,
    customSections: settings?.custom_sections || [],
  });

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
      <div className="mb-5 flex items-end justify-between gap-3">
        <div className="min-w-0">
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
          <h1 className="mt-0.5 truncate text-2xl font-semibold tracking-tight">
            {meeting.title || "Untitled meeting"}
          </h1>
        </div>
        {/* Autosave indicator — everything on every tab saves as you type. */}
        <p
          className="flex shrink-0 items-center gap-1 pb-0.5 text-[11px] font-medium text-muted"
          title="Everything autosaves as you type"
        >
          {saveState === "pending" || saveState === "saving" ? (
            <>
              <CloudUpload size={13} className="animate-pulse" /> Saving…
            </>
          ) : (
            <>
              <Check size={13} className="text-emerald-600" /> Saved
            </>
          )}
        </p>
      </div>

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {tab === "Setup" && (
        <SetupTab
          m={meeting}
          save={save}
          userId={userId}
          busy={generator.busy}
          briefStale={generator.briefStale}
          hasBrief={(meeting.brief?.sections || []).length > 0}
          onGenerate={() => {
            setTab("Brief");
            void generator.generate();
          }}
          onViewBrief={() => setTab("Brief")}
        />
      )}
      {tab === "Brief" && (
        <BriefTab
          m={meeting}
          save={save}
          userId={userId}
          busy={generator.busy}
          briefStale={generator.briefStale}
          generate={generator.generate}
          goSetup={() => setTab("Setup")}
          customSections={settings?.custom_sections || []}
          saveCustomSections={(custom_sections) => void saveSettings({ custom_sections })}
        />
      )}
      {tab === "Grill me" && <GrillTab m={meeting} save={save} flush={flush} />}
      {tab === "Debrief" && <DebriefTab m={meeting} save={save} userId={userId} />}
    </>
  );
}
