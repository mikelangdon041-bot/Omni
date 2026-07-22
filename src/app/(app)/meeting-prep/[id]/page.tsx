"use client";

// One meeting: Setup → Brief → Grill me → Debrief.
// Brief generation lives here (not in the Brief tab) so it keeps running in
// the background while the user moves between tabs.

import { useState } from "react";
import { useParams } from "next/navigation";
import { Check, CloudUpload } from "lucide-react";
import { BackButton } from "@/components/BackButton";
import { Tabs } from "@/components/ui/Tabs";
import { DiffPreviewModal, type DiffChange } from "@/components/ui/DiffPreviewModal";
import { SetupTab } from "@/components/meetingprep/SetupTab";
import { BriefTab } from "@/components/meetingprep/BriefTab";
import { GrillTab } from "@/components/meetingprep/GrillTab";
import { DebriefTab } from "@/components/meetingprep/DebriefTab";
import {
  useMpMeeting,
  useMpSettings,
  useUserId,
} from "@/lib/meetingprep/hooks";
import { useBriefGenerator, type GenerateOpts } from "@/lib/meetingprep/useBriefGenerator";
import { meetingTypeLabel } from "@/lib/meetingprep/types";
import { usePersistedState } from "@/lib/usePersistedState";

const TABS = ["Setup", "Brief", "Grill me", "Debrief"] as const;
type Tab = (typeof TABS)[number];

export default function MeetingPage() {
  const { id } = useParams<{ id: string }>();
  const { userId } = useUserId();
  const { meeting, loading, save, flush, saveState } = useMpMeeting(id, userId);
  const { settings, save: saveSettings } = useMpSettings(userId);
  // Remembers which tab you were on for THIS meeting specifically.
  const [tab, setTab] = usePersistedState<Tab>(`mp-tab:${id}`, "Setup", TABS);

  const generator = useBriefGenerator({
    meeting,
    save,
    flush,
    customSections: settings?.custom_sections || [],
  });

  // Nothing an AI regenerate writes lands on the brief until the user has
  // seen it and applied it — lives here (not in BriefTab) so a generation
  // kicked off from Setup still shows its preview once it lands on Brief.
  const [preview, setPreview] = useState<{ changes: DiffChange[]; opts: GenerateOpts } | null>(
    null,
  );
  const [applying, setApplying] = useState(false);
  const hasBrief = (meeting?.brief?.sections || []).length > 0;

  // Only for the very first generation from an empty brief — there's nothing
  // to compare against, so it applies straight away (same as before).
  async function generateDirect(opts?: GenerateOpts) {
    const result = await generator.generate(opts);
    if (result) generator.applyGenerated(result.incoming, result.opts);
  }

  async function generateWithPreview(opts?: GenerateOpts) {
    const result = await generator.generate(opts);
    if (!result) return;
    const cur = meeting?.brief?.sections || [];
    const changes: DiffChange[] = result.incoming.map((inc) => ({
      key: inc.key,
      title: inc.title,
      oldContent: cur.find((s) => s.key === inc.key)?.content || "",
      newContent: inc.content,
    }));
    setPreview({ changes, opts: result.opts });
  }

  function applyPreview() {
    if (!preview) return;
    setApplying(true);
    generator.applyGenerated(
      preview.changes.map((c) => ({ key: c.key, title: c.title, content: c.newContent })),
      preview.opts,
    );
    setApplying(false);
    setPreview(null);
  }

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
          hasBrief={hasBrief}
          onGenerate={() => {
            setTab("Brief");
            // First-ever brief: nothing to compare against, apply straight
            // away. A brief that already exists but is stale goes through
            // the same preview as every other regenerate.
            void (hasBrief ? generateWithPreview() : generateDirect());
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
          generateDirect={generateDirect}
          generateWithPreview={generateWithPreview}
          goSetup={() => setTab("Setup")}
          customSections={settings?.custom_sections || []}
          saveCustomSections={(custom_sections) => void saveSettings({ custom_sections })}
        />
      )}
      {tab === "Grill me" && <GrillTab m={meeting} save={save} flush={flush} />}
      {tab === "Debrief" && <DebriefTab m={meeting} save={save} userId={userId} />}

      <DiffPreviewModal
        open={!!preview}
        onClose={() => setPreview(null)}
        changes={preview?.changes || []}
        onApply={applyPreview}
        applying={applying}
        title={
          preview?.opts.onlyKey
            ? "Review the section"
            : preview?.opts.extra
              ? "Review the new section"
              : "Review the changes"
        }
      />
    </>
  );
}
