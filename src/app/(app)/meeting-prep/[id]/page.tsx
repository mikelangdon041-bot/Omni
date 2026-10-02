"use client";

// One meeting: Setup -> Brief -> Questions -> Practice -> Debrief.
// Brief generation lives here (not in the Brief tab) so it keeps running in
// the background while the user moves between tabs.

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Check, CloudUpload, Pencil, Target, Trash2 } from "lucide-react";
import { BackButton } from "@/components/BackButton";
import { useChatScope } from "@/components/chat/ChatScope";
import { meetingContext } from "@/lib/chat/context";
import { useConfirm } from "@/components/ui/Feedback";
import { Tabs } from "@/components/ui/Tabs";
import { DiffPreviewModal, type DiffChange } from "@/components/ui/DiffPreviewModal";
import { SetupTab } from "@/components/meetingprep/SetupTab";
import { BriefTab } from "@/components/meetingprep/BriefTab";
import { QuestionsTab } from "@/components/meetingprep/QuestionsTab";
import { GrillTab } from "@/components/meetingprep/GrillTab";
import { DebriefTab } from "@/components/meetingprep/DebriefTab";
import { FolderPicker } from "@/components/meetingprep/FolderPicker";
import {
  useMpMeeting,
  useMpSettings,
  useUserId,
} from "@/lib/meetingprep/hooks";
import { useBriefGenerator, type GenerateOpts } from "@/lib/meetingprep/useBriefGenerator";
import { folderMovePatch, meetingTypeLabel, type BriefSection } from "@/lib/meetingprep/types";
import { usePersistedState } from "@/lib/usePersistedState";

// Plain names. "Grill me" was cute and told you nothing about what the tab
// does; "Practice" does. The stored per-meeting tab falls back to Setup when
// a name changes, which is the right behaviour for a rename.
const TABS = ["Setup", "Brief", "Questions", "Practice", "Debrief"] as const;
type Tab = (typeof TABS)[number];

// The subject line of the session, pinned above the tabs. Click it to change
// it — one field, no modal, no trip to Setup.
function TopicBar({ topic, onSave }: { topic: string; onSave: (t: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(topic);

  function commit() {
    setEditing(false);
    const next = draft.trim();
    if (next !== topic) onSave(next);
  }

  if (editing)
    return (
      <div className="mb-4 rounded-xl border border-[var(--accent)] bg-[var(--accent-soft)]/40 px-3 py-2">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--accent)]">
          What this session is about
        </p>
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setDraft(topic);
              setEditing(false);
            }
          }}
          placeholder="e.g. the panel's published title, or the question on the table"
          className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none focus:border-[var(--accent)]"
        />
        <p className="mt-1 text-[11px] text-muted">
          This is the subject the research, the brief and the questions are all
          written to serve. Change it and both offer to be rewritten around it.
        </p>
      </div>
    );

  return (
    <button
      type="button"
      onClick={() => {
        setDraft(topic);
        setEditing(true);
      }}
      className="group mb-4 flex w-full items-center gap-2 rounded-xl border border-[var(--accent)]/30 bg-[var(--accent-soft)]/40 px-3 py-2 text-left transition hover:border-[var(--accent)]"
    >
      <Target size={15} className="shrink-0 text-[var(--accent)]" />
      <span className="min-w-0 flex-1">
        <span className="block text-[10px] font-semibold uppercase tracking-wide text-[var(--accent)]">
          What this session is about
        </span>
        <span className={`block truncate text-sm ${topic ? "font-medium text-ink" : "text-muted"}`}>
          {topic || "Not set — click to add the topic, and everything gets written to it"}
        </span>
      </span>
      <Pencil size={13} className="shrink-0 text-muted transition group-hover:text-[var(--accent)]" />
    </button>
  );
}

export default function MeetingPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const confirm = useConfirm();
  const { userId } = useUserId();
  const { meeting, loading, save, flush, saveState, remove } = useMpMeeting(id, userId);
  const { settings, save: saveSettings } = useMpSettings(userId);
  // A deep link can say which tab to open — the Windows recorder sends you
  // straight to Debrief, the same place the in-app record flow lands. Read off
  // window rather than useSearchParams so the page needs no Suspense boundary,
  // and read once so a later render can't yank the tab back.
  const [linkedTab] = useState<Tab | null>(() => {
    if (typeof window === "undefined") return null;
    const t = new URLSearchParams(window.location.search).get("tab") || "";
    return (TABS as readonly string[]).includes(t) ? (t as Tab) : null;
  });
  // Arrived here straight from "New meeting" — no modal asked for a title, so
  // land with the caret already in the Explain box.
  const [isNew] = useState(
    () =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("new") === "1",
  );
  // Remembers which tab you were on for THIS meeting specifically.
  const [tab, setTab] = usePersistedState<Tab>(`mp-tab:${id}`, "Setup", TABS, linkedTab);

  // The whole meeting record: setup, the brief as it stands, the questions,
  // the debrief. Everything the chat needs to answer "what am I missing" and to
  // add an attendee or a hard question without leaving the tab you're on.
  useChatScope(
    meeting
      ? {
          app: "meeting-prep",
          subject: { kind: "meeting", id: meeting.id, label: meeting.title || "this meeting" },
          context: meetingContext(meeting),
        }
      : null,
  );

  const generator = useBriefGenerator({
    meeting,
    save,
    flush,
    customSections: settings?.custom_sections || [],
    sectionOrder: settings?.section_order,
  });

  // Nothing an AI regenerate writes lands on the brief until the user has
  // seen it and applied it — lives here (not in BriefTab) so a generation
  // kicked off from Setup still shows its preview once it lands on Brief.
  const [preview, setPreview] = useState<{
    changes: DiffChange[];
    opts: GenerateOpts;
    incoming: BriefSection[];
    research?: string;
  } | null>(null);
  const [applying, setApplying] = useState(false);
  const hasBrief = (meeting?.brief?.sections || []).length > 0;

  // Only for the very first generation from an empty brief — there's nothing
  // to compare against, so it applies straight away (same as before).
  async function generateDirect(opts?: GenerateOpts) {
    const result = await generator.generate(opts);
    if (result) generator.applyGenerated(result.incoming, result.opts, result.research);
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
    setPreview({
      changes,
      opts: result.opts,
      incoming: result.incoming,
      research: result.research,
    });
  }

  function applyPreview() {
    if (!preview) return;
    setApplying(true);
    // A box the model added carries its prompt and origin through; the diff
    // only knows key/title/content, so they come back from the proposal.
    generator.applyGenerated(
      preview.changes.map((c) => {
        const inc = preview.incoming.find((s) => s.key === c.key);
        return {
          key: c.key,
          title: c.title,
          content: c.newContent,
          ...(inc?.prompt ? { prompt: inc.prompt } : {}),
          ...(inc?.origin ? { origin: inc.origin } : {}),
        };
      }),
      preview.opts,
      preview.research,
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
        <div className="flex shrink-0 items-center gap-3 pb-0.5">
          {/* Visible on every tab, not just Setup — moving a meeting to a
              different person or topic (or filing an uncategorized one) is
              something you reach for from wherever you happen to be. */}
          <FolderPicker
            userId={userId}
            personFolderId={meeting.person_folder_id}
            topicFolderId={meeting.topic_folder_id}
            onChange={(kind, folder) => save(folderMovePatch(kind, folder))}
          />
          {/* Autosave indicator — everything on every tab saves as you type. */}
          <p
            className="flex items-center gap-1 text-[11px] font-medium text-muted"
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
          {/* Deleting belongs here as well as on the list. A recording that
              caught the wrong meeting, or one you never meant to keep, is
              discovered on this page — the desktop recorder opens straight to
              it — and going back to the list to bin it is a detour. */}
          <button
            type="button"
            onClick={async () => {
              if (
                await confirm({
                  title: `Delete "${meeting.title || "this meeting"}"?`,
                  message: meeting.debrief?.audioPath
                    ? "The notes, transcript and the kept recording are all removed. This cannot be undone."
                    : "The brief, rehearsal, and debrief are removed. This cannot be undone.",
                  confirmLabel: "Delete",
                  danger: true,
                })
              ) {
                await remove();
                router.push("/meeting-prep");
              }
            }}
            className="rounded-lg p-1.5 text-muted transition hover:bg-red-50 hover:text-red-600"
            title="Delete this meeting"
            aria-label="Delete this meeting"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      {/* What the session is actually about, in front of you on every tab.
          Editable in place: the topic of a panel changes right up to the
          week before, and the fix for that cannot be "ask someone to go and
          change it in the database". Changing it marks the brief and the
          questions stale, so both offer to be rewritten around the new one. */}
      <TopicBar topic={meeting.topic || ""} onSave={(topic) => save({ topic })} />

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      {tab === "Setup" && (
        <SetupTab
          m={meeting}
          save={save}
          userId={userId}
          busy={generator.busy}
          briefStale={generator.briefStale}
          briefOutdated={generator.briefOutdated}
          hasBrief={hasBrief}
          onGenerate={() => {
            setTab("Brief");
            // First-ever brief: nothing to compare against, apply straight
            // away. A brief that already exists but is stale goes through
            // the same preview as every other regenerate.
            void (hasBrief ? generateWithPreview() : generateDirect());
          }}
          onViewBrief={() => setTab("Brief")}
          focusExplain={isNew}
          progress={generator.progress}
        />
      )}
      {tab === "Brief" && (
        <BriefTab
          m={meeting}
          save={save}
          saveState={saveState}
          userId={userId}
          busy={generator.busy}
          briefStale={generator.briefStale}
          briefOutdated={generator.briefOutdated}
          generateDirect={generateDirect}
          generateWithPreview={generateWithPreview}
          goSetup={() => setTab("Setup")}
          customSections={settings?.custom_sections || []}
          saveCustomSections={(custom_sections) => void saveSettings({ custom_sections })}
          progress={generator.progress}
          stage={generator.stage}
          sectionOrder={settings?.section_order}
        />
      )}
      {tab === "Questions" && (
        <QuestionsTab m={meeting} save={save} flush={flush} saveState={saveState} />
      )}
      {tab === "Practice" && <GrillTab m={meeting} save={save} flush={flush} />}
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
