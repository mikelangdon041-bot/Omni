"use client";

// Meeting Prep home: upcoming and past meetings, plus profile settings
// (custom brief sections that appear in every future brief).

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarClock,
  CalendarOff,
  CalendarPlus,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileAudio,
  FolderKanban,
  Plus,
  Settings2,
  Trash2,
  Undo2,
} from "lucide-react";
import { ModuleHero } from "@/components/ui/ModuleHero";
import { useChatScope } from "@/components/chat/ChatScope";
import { listContext } from "@/lib/chat/context";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { useConfirm } from "@/components/ui/Feedback";
import { CreateFolderModal, FolderPairSelect } from "@/components/meetingprep/FolderPicker";
import {
  useMpFolders,
  useMpMeetings,
  useMpSettings,
  useUserId,
} from "@/lib/meetingprep/hooks";
import {
  DEFAULT_BRIEF_SECTIONS,
  folderMovePatch,
  isHeld,
  meetingTypeLabel,
  needsFiling,
  orderSections,
  type CustomSection,
  type FolderKind,
  type MpFolder,
  type MpMeeting,
} from "@/lib/meetingprep/types";

export default function MeetingPrepPage() {
  const router = useRouter();
  const confirm = useConfirm();
  const { userId } = useUserId();
  const { meetings, loading, add, remove, refresh, patch } = useMpMeetings(userId);
  const { settings, save: saveSettings } = useMpSettings(userId);
  const { folders } = useMpFolders(userId);
  const [creatingFolderKind, setCreatingFolderKind] = useState<FolderKind | null>(null);
  // Which meeting a "+ New person/topic" was opened from, so the folder that
  // comes out of the modal is filed onto the right card rather than left for
  // a second click.
  const [creatingFolderFor, setCreatingFolderFor] = useState<MpMeeting | null>(null);

  async function moveFolder(m: MpMeeting, kind: FolderKind, folder: MpFolder | null) {
    // Touching either select is an answer, even when the answer is "neither".
    // Without this, picking "No topic" on an unfiled meeting changed nothing
    // at all and the amber "file this" chip stayed put — which is exactly
    // what it looks like when a control is broken.
    await patch(m.id, { ...folderMovePatch(kind, folder), filing_reviewed: true });
    await refresh();
  }
  // Every meeting on the list, so "what have I got next week" and "start a prep
  // for the exec review" both work from here.
  useChatScope({
    app: "meeting-prep",
    context: listContext(
      "Meetings being prepared for",
      meetings.map((m) =>
        [
          m.title || "(untitled)",
          meetingTypeLabel(m.meeting_type),
          m.date ? new Date(m.date).toLocaleString() : "no date set",
          isHeld(m) ? "already held" : "still to come",
          (m.brief?.sections || []).length ? "briefed" : "no brief yet",
        ].join(" | "),
      ),
      80,
    ),
  });

  const [showSettings, setShowSettings] = useState(false);
  const [creating, setCreating] = useState(false);

  const { upcoming, past } = useMemo(() => {
    const upcoming: MpMeeting[] = [];
    const past: MpMeeting[] = [];
    for (const m of meetings) (isHeld(m) ? past : upcoming).push(m);
    upcoming.sort((a, b) => {
      if (!a.date) return -1;
      if (!b.date) return 1;
      return +new Date(a.date) - +new Date(b.date);
    });
    past.sort((a, b) => {
      const at = a.held_at || a.date || a.updated_at;
      const bt = b.held_at || b.date || b.updated_at;
      return +new Date(bt) - +new Date(at);
    });
    return { upcoming, past };
  }, [meetings]);

  // "New meeting" doesn't stop to ask for a title, type, or date: the row is
  // created empty and you land on the page with the caret in the Explain box.
  // Everything the old modal collected either gets typed in the fields there
  // or is picked out of what you write by "Fill in the details".
  async function createMeeting() {
    if (creating) return;
    setCreating(true);
    const m = await add({});
    setCreating(false);
    if (m) router.push(`/meeting-prep/${m.id}?new=1`);
  }

  const briefed = meetings.filter((m) => (m.brief?.sections || []).length > 0).length;
  // "Uncategorized" isn't every undated meeting — plenty of upcoming ones are
  // still being prepped and have nothing to file yet. It's specifically a
  // recording that finished (a transcript or notes exist) with nowhere to go,
  // and whose owner hasn't already said it belongs nowhere.
  const uncategorizedRecorded = meetings.filter(
    (m) =>
      needsFiling(m) &&
      ((m.debrief?.transcript || "").trim() || (m.debrief?.notesHtml || "").trim()),
  ).length;

  const listProps = {
    folders,
    onOpen: (id: string) => router.push(`/meeting-prep/${id}`),
    onMoveFolder: moveFolder,
    onPatch: patch,
    onRequestCreateFolder: (kind: FolderKind, m: MpMeeting) => {
      setCreatingFolderKind(kind);
      setCreatingFolderFor(m);
    },
    onDelete: async (m: MpMeeting) => {
      if (
        await confirm({
          title: `Delete "${m.title || "this meeting"}"?`,
          message: "The brief, rehearsal, and debrief are removed.",
          confirmLabel: "Delete",
          danger: true,
        })
      )
        await remove(m.id);
    },
  };

  return (
    <>
      <ModuleHero
        eyebrow="Meeting Prep"
        title="Never walk in cold."
        subtitle="Tell me who you're meeting and why — get a full brief, rehearse the hard questions, then debrief and log it."
        icon={CalendarClock}
        stats={[
          { label: "Meetings", value: meetings.length },
          { label: "Briefed", value: briefed },
        ]}
        action={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              className="!border-white/40 !bg-white/15 !text-white hover:!bg-white/25"
              onClick={() => router.push("/meeting-prep/folders")}
            >
              <FolderKanban size={16} /> Folders
            </Button>
            <Button
              variant="secondary"
              className="!border-white/40 !bg-white/15 !text-white hover:!bg-white/25"
              onClick={() => setShowSettings(true)}
            >
              <Settings2 size={16} /> Brief settings
            </Button>
            <Button
              variant="secondary"
              className="!border-white/40 !bg-white/15 !text-white hover:!bg-white/25"
              disabled={creating}
              onClick={() => void createMeeting()}
            >
              <Plus size={16} /> {creating ? "Opening…" : "New meeting"}
            </Button>
            <Button
              className="!bg-white !text-[var(--accent)] hover:!bg-white/90"
              onClick={() => router.push("/meeting-prep/record")}
            >
              <FileAudio size={16} /> Upload or record
            </Button>
          </div>
        }
      />

      {uncategorizedRecorded > 0 && (
        <button
          onClick={() => router.push("/meeting-prep/folders/uncategorized")}
          className="mb-6 flex w-full items-center gap-2 rounded-xl border border-amber-300/60 bg-amber-50 px-4 py-2.5 text-left text-sm text-amber-900 transition hover:border-amber-400"
        >
          <FolderKanban size={15} className="shrink-0" />
          {uncategorizedRecorded} recorded meeting{uncategorizedRecorded === 1 ? "" : "s"} not yet
          filed under a person or topic — <span className="font-semibold underline">file them</span>
        </button>
      )}

      {loading ? (
        <p className="py-16 text-center text-sm text-muted">Loading…</p>
      ) : meetings.length === 0 ? (
        <EmptyState
          title="No meetings yet"
          hint="Prepping for one that hasn't happened yet? Create it and I'll build your brief. Already have a recording of one? Use the panel above and I'll do the rest."
          action={
            <Button disabled={creating} onClick={() => void createMeeting()}>
              <Plus size={16} /> {creating ? "Opening…" : "New meeting"}
            </Button>
          }
        />
      ) : (
        <div className="space-y-8">
          <MeetingList title="Coming up" meetings={upcoming} {...listProps} />
          <MeetingList title="Already happened" meetings={past} held {...listProps} />
        </div>
      )}

      <BriefSettingsModal
        open={showSettings}
        onClose={() => setShowSettings(false)}
        sections={settings?.custom_sections || []}
        onSave={(custom_sections) => void saveSettings({ custom_sections })}
        order={settings?.section_order || []}
        onSaveOrder={(section_order) => void saveSettings({ section_order })}
      />

      <CreateFolderModal
        userId={userId}
        kind={creatingFolderKind}
        onClose={() => {
          setCreatingFolderKind(null);
          setCreatingFolderFor(null);
        }}
        onCreated={(folder) => {
          if (creatingFolderFor) void moveFolder(creatingFolderFor, folder.kind, folder);
        }}
      />
    </>
  );
}

// The date line on a card, which is also where a date gets set or waived.
// Three states, one click each: no answer yet (offer both), a date, or a
// deliberate "there isn't one" — because being asked for a date you don't
// have, on every visit, forever, is the thing that made this list nag.
function CardDate({
  m,
  onPatch,
}: {
  m: MpMeeting;
  onPatch: (id: string, p: Partial<MpMeeting>) => void;
}) {
  const [picking, setPicking] = useState(false);
  const d = m.date ? new Date(m.date) : null;

  if (d)
    return (
      <span className="inline-flex items-center gap-1.5">
        {d.toLocaleString(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })}
      </span>
    );

  if (picking)
    return (
      <input
        type="datetime-local"
        autoFocus
        className="rounded-md border border-[var(--accent)] bg-surface px-1.5 py-0.5 text-xs outline-none"
        onBlur={() => setPicking(false)}
        onChange={(e) => {
          if (!e.target.value) return;
          onPatch(m.id, {
            date: new Date(e.target.value).toISOString(),
            no_date: false,
          });
          setPicking(false);
        }}
      />
    );

  if (m.no_date)
    return (
      <span className="inline-flex items-center gap-1.5">
        No date
        <button
          className="font-medium text-[var(--accent)] underline-offset-2 hover:underline"
          onClick={() => setPicking(true)}
        >
          add one
        </button>
      </span>
    );

  return (
    <span className="inline-flex items-center gap-2">
      <button
        className="inline-flex items-center gap-1 font-medium text-[var(--accent)] underline-offset-2 hover:underline"
        onClick={() => setPicking(true)}
      >
        <CalendarPlus size={12} /> Set a date
      </button>
      <span className="text-border">|</span>
      <button
        className="inline-flex items-center gap-1 hover:text-ink"
        title="This meeting doesn't need a date — stop asking"
        onClick={() => onPatch(m.id, { no_date: true })}
      >
        <CalendarOff size={12} /> No date
      </button>
    </span>
  );
}

function MeetingList({
  title,
  meetings,
  folders,
  held = false,
  onOpen,
  onMoveFolder,
  onPatch,
  onRequestCreateFolder,
  onDelete,
}: {
  title: string;
  meetings: MpMeeting[];
  folders: MpFolder[];
  /** This list is the "already happened" one. */
  held?: boolean;
  onOpen: (id: string) => void;
  onMoveFolder: (m: MpMeeting, kind: FolderKind, folder: MpFolder | null) => void;
  onPatch: (id: string, p: Partial<MpMeeting>) => void;
  onRequestCreateFolder: (kind: FolderKind, m: MpMeeting) => void;
  onDelete: (m: MpMeeting) => void;
}) {
  if (meetings.length === 0) return null;
  const folderName = (id: string | null) => folders.find((f) => f.id === id)?.name || null;
  // Both names when it's filed under both, either one on its own when it
  // isn't. One chip rather than two: on a card this size the second badge
  // costs more room than the separator does.
  const filedAs = (m: MpMeeting) =>
    [folderName(m.person_folder_id), folderName(m.topic_folder_id)].filter(Boolean).join(" · ");
  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted">
        {title}
        <span className="rounded-full bg-canvas px-2 py-0.5 text-[11px] font-semibold normal-case tracking-normal">
          {meetings.length}
        </span>
      </h2>
      <ul className="grid gap-3 sm:grid-cols-2">
        {meetings.map((m) => {
          const hasBrief = (m.brief?.sections || []).length > 0;
          const d = m.date ? new Date(m.date) : null;
          const names = (m.attendees || [])
            .filter((a) => a.name.trim())
            .map((a) => a.name);
          return (
            <li
              key={m.id}
              className="group cursor-pointer rounded-xl border border-border bg-surface p-4 transition hover:border-[var(--accent)]/50 hover:shadow-md"
              onClick={() => onOpen(m.id)}
            >
              <div className="flex items-start gap-3">
                {/* Date block */}
                <div
                  className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl text-white ${
                    held
                      ? "bg-ink/70"
                      : "bg-gradient-to-br from-[var(--grad-from)] to-[var(--grad-via)]"
                  }`}
                >
                  {d ? (
                    <div className="text-center leading-none">
                      <p className="text-[9px] font-bold uppercase tracking-wide opacity-90">
                        {d.toLocaleString(undefined, { month: "short" })}
                      </p>
                      <p className="mt-0.5 text-lg font-bold">{d.getDate()}</p>
                    </div>
                  ) : held ? (
                    <CheckCircle2 size={18} className="opacity-90" />
                  ) : (
                    <CalendarClock size={18} className="opacity-90" />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-start gap-1">
                    <p className="min-w-0 flex-1 truncate text-sm font-semibold">
                      {m.title || "Untitled meeting"}
                    </p>
                    {/* The one-click way a meeting leaves "Coming up" — or
                        comes back, when it was marked by mistake. */}
                    <button
                      className="rounded p-1 text-muted opacity-0 transition hover:bg-canvas hover:text-[var(--accent)] group-hover:opacity-100"
                      aria-label={held ? "Move back to coming up" : "Mark as already happened"}
                      title={held ? "Move back to coming up" : "I've had this meeting"}
                      onClick={(e) => {
                        e.stopPropagation();
                        onPatch(m.id, { held_at: held ? null : new Date().toISOString() });
                      }}
                    >
                      {held ? <Undo2 size={13} /> : <CheckCircle2 size={13} />}
                    </button>
                    <button
                      className="rounded p-1 text-muted opacity-0 transition hover:bg-red-50 hover:text-red-600 group-hover:opacity-100"
                      aria-label="Delete meeting"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(m);
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                  {m.topic && (
                    <p className="mt-0.5 truncate text-xs text-muted">{m.topic}</p>
                  )}
                  <div
                    className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-muted"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <CardDate m={m} onPatch={onPatch} />
                    {names.length > 0 && (
                      <span className="truncate">
                        · {names.slice(0, 3).join(", ")}
                        {names.length > 3 && ` +${names.length - 3}`}
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--accent)]">
                      {meetingTypeLabel(m.meeting_type)}
                    </span>
                    {hasBrief && (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                        Briefed
                      </span>
                    )}
                    {(m.questions?.items || []).length > 0 && (
                      <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-700">
                        {(m.questions?.items || []).length} questions
                      </span>
                    )}
                    {m.territory_logged && (
                      <span className="rounded-full bg-teal-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-teal-700">
                        Logged
                      </span>
                    )}
                  </div>
                  {/* Folder chip + quick move — the same control the meeting
                      detail page and the recorder use, dropped here so a
                      meeting can be filed without opening it. The selects
                      stay visible rather than appearing on hover: a control
                      nobody can see is a control nobody uses. */}
                  <div
                    className="mt-2 flex flex-wrap items-center gap-1.5"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        needsFiling(m) ? "bg-amber-50 text-amber-700" : "bg-canvas text-muted"
                      }`}
                    >
                      {filedAs(m) || (m.filing_reviewed ? "Not filed" : "Uncategorized")}
                    </span>
                    <FolderPairSelect
                      folders={folders}
                      personFolderId={m.person_folder_id}
                      topicFolderId={m.topic_folder_id}
                      onChange={(kind, folder) => onMoveFolder(m, kind, folder)}
                      onRequestCreate={(kind) => onRequestCreateFolder(kind, m)}
                      className="rounded-md border border-transparent bg-transparent px-1 py-0.5 text-[10px] text-muted outline-none transition hover:border-border focus:border-[var(--accent)]"
                    />
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// "Brief settings": the order the boxes come in, plus the custom sections
// appended to every future brief.
function BriefSettingsModal({
  open,
  onClose,
  sections,
  onSave,
  order,
  onSaveOrder,
}: {
  open: boolean;
  onClose: () => void;
  sections: CustomSection[];
  onSave: (s: CustomSection[]) => void;
  order: string[];
  onSaveOrder: (o: string[]) => void;
}) {
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");

  // Everything that can appear in a brief, in the order it currently would.
  const all = orderSections(
    [
      ...DEFAULT_BRIEF_SECTIONS.map((s) => ({ key: s.key, title: s.title, custom: false })),
      ...sections.map((s) => ({ key: s.key, title: s.title, custom: true })),
    ],
    order,
  );

  function move(index: number, delta: number) {
    const next = [...all];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onSaveOrder(next.map((s) => s.key));
  }

  return (
    <Modal open={open} onClose={onClose} title="Brief settings">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
        Order of the brief
      </p>
      <p className="mb-3 text-sm text-muted">
        Top to bottom, the order the boxes appear in — in every brief, including
        the ones you&apos;ve already generated. Put what you read first at the
        top.
      </p>
      <ul className="mb-5 space-y-1.5">
        {all.map((s, i) => (
          <li
            key={s.key}
            className="flex items-center gap-2 rounded-lg border border-border bg-canvas/40 py-1.5 pl-3 pr-1.5"
          >
            <span className="w-5 shrink-0 text-xs font-semibold tabular-nums text-muted">
              {i + 1}
            </span>
            <p className="min-w-0 flex-1 truncate text-sm">
              {s.title}
              {s.custom && (
                <span className="ml-1.5 rounded bg-[var(--accent-soft)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--accent)]">
                  Yours
                </span>
              )}
            </p>
            <button
              className="rounded p-1 text-muted transition hover:text-ink disabled:opacity-25"
              aria-label={`Move "${s.title}" up`}
              disabled={i === 0}
              onClick={() => move(i, -1)}
            >
              <ChevronUp size={15} />
            </button>
            <button
              className="rounded p-1 text-muted transition hover:text-ink disabled:opacity-25"
              aria-label={`Move "${s.title}" down`}
              disabled={i === all.length - 1}
              onClick={() => move(i, 1)}
            >
              <ChevronDown size={15} />
            </button>
          </li>
        ))}
      </ul>
      {order.length > 0 && (
        <div className="mb-5 flex justify-end">
          <Button size="sm" variant="ghost" onClick={() => onSaveOrder([])}>
            Reset to the default order
          </Button>
        </div>
      )}

      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
        Your own sections
      </p>
      <p className="mb-3 text-sm text-muted">
        Sections you add here appear in <b>every</b> brief from now on.
      </p>
      {sections.length > 0 && (
        <ul className="mb-4 space-y-2">
          {sections.map((s) => (
            <li
              key={s.key}
              className="flex items-start gap-2 rounded-lg border border-border p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{s.title}</p>
                <p className="mt-0.5 text-xs text-muted">{s.prompt}</p>
              </div>
              <button
                className="rounded p-1 text-muted hover:text-red-600"
                onClick={() => onSave(sections.filter((x) => x.key !== s.key))}
              >
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="space-y-2 rounded-lg border border-border p-3">
        <Input
          label="Section title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder='e.g. "Compliance reminders"'
        />
        <Textarea
          label="What should it contain?"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe what the AI should write in this section…"
          className="min-h-16"
        />
        <div className="flex justify-end">
          <Button
            size="sm"
            disabled={!title.trim() || !prompt.trim()}
            onClick={() => {
              onSave([
                ...sections,
                {
                  key: `custom_${Date.now()}`,
                  title: title.trim(),
                  prompt: prompt.trim(),
                },
              ]);
              setTitle("");
              setPrompt("");
            }}
          >
            <Plus size={14} /> Add section
          </Button>
        </div>
      </div>
    </Modal>
  );
}
