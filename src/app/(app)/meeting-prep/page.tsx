"use client";

// Meeting Prep home: upcoming and past meetings, plus profile settings
// (custom brief sections that appear in every future brief).

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Plus, Settings2, Sparkles, Trash2 } from "lucide-react";
import { ModuleHero } from "@/components/ui/ModuleHero";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { useConfirm } from "@/components/ui/Feedback";
import {
  useMpMeetings,
  useMpSettings,
  useUserId,
} from "@/lib/meetingprep/hooks";
import {
  MEETING_TYPES,
  meetingTypeLabel,
  type CustomSection,
  type MeetingType,
  type MpMeeting,
} from "@/lib/meetingprep/types";

export default function MeetingPrepPage() {
  const router = useRouter();
  const confirm = useConfirm();
  const { userId } = useUserId();
  const { meetings, loading, add, remove } = useMpMeetings(userId);
  const { settings, save: saveSettings } = useMpSettings(userId);
  const [showSettings, setShowSettings] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [creating, setCreating] = useState(false);

  const { upcoming, past } = useMemo(() => {
    const now = Date.now();
    const upcoming: MpMeeting[] = [];
    const past: MpMeeting[] = [];
    for (const m of meetings) {
      if (m.date && new Date(m.date).getTime() < now - 3600_000) past.push(m);
      else upcoming.push(m);
    }
    upcoming.sort((a, b) => {
      if (!a.date) return -1;
      if (!b.date) return 1;
      return +new Date(a.date) - +new Date(b.date);
    });
    return { upcoming, past };
  }, [meetings]);

  // The meeting row is only created once the user confirms the modal — no
  // ghost "Untitled meeting" flashing into the list.
  async function createMeeting(partial: Partial<MpMeeting>) {
    setCreating(true);
    const m = await add(partial);
    setCreating(false);
    if (m) {
      setShowNew(false);
      router.push(`/meeting-prep/${m.id}`);
    }
  }

  const briefed = meetings.filter((m) => (m.brief?.sections || []).length > 0).length;

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
          <div className="flex gap-2">
            <Button
              variant="secondary"
              className="!border-white/40 !bg-white/15 !text-white hover:!bg-white/25"
              onClick={() => setShowSettings(true)}
            >
              <Settings2 size={16} /> My brief
            </Button>
            <Button
              className="!bg-white !text-[var(--accent)] hover:!bg-white/90"
              onClick={() => setShowNew(true)}
            >
              <Plus size={16} /> New meeting
            </Button>
          </div>
        }
      />

      {loading ? (
        <p className="py-16 text-center text-sm text-muted">Loading…</p>
      ) : meetings.length === 0 ? (
        <EmptyState
          title="No meetings yet"
          hint="Create one, tell me who's in the room and what you want out of it, and I'll build your brief."
          action={
            <Button onClick={() => setShowNew(true)}>
              <Plus size={16} /> New meeting
            </Button>
          }
        />
      ) : (
        <div className="space-y-8">
          <MeetingList
            title="Upcoming & undated"
            meetings={upcoming}
            onOpen={(id) => router.push(`/meeting-prep/${id}`)}
            onDelete={async (m) => {
              if (
                await confirm({
                  title: `Delete "${m.title || "this meeting"}"?`,
                  message: "The brief, rehearsal, and debrief are removed.",
                  confirmLabel: "Delete",
                  danger: true,
                })
              )
                await remove(m.id);
            }}
          />
          {past.length > 0 && (
            <MeetingList
              title="Past"
              meetings={past}
              onOpen={(id) => router.push(`/meeting-prep/${id}`)}
              onDelete={async (m) => {
                if (
                  await confirm({
                    title: `Delete "${m.title || "this meeting"}"?`,
                    confirmLabel: "Delete",
                    danger: true,
                  })
                )
                  await remove(m.id);
              }}
            />
          )}
        </div>
      )}

      <NewMeetingModal
        open={showNew}
        creating={creating}
        onClose={() => setShowNew(false)}
        onCreate={createMeeting}
      />

      <CustomSectionsModal
        open={showSettings}
        onClose={() => setShowSettings(false)}
        sections={settings?.custom_sections || []}
        onSave={(custom_sections) => void saveSettings({ custom_sections })}
      />
    </>
  );
}

// Collect the essentials up front so the meeting is born with a real name —
// the row is only inserted when the user confirms.
function NewMeetingModal({
  open,
  creating,
  onClose,
  onCreate,
}: {
  open: boolean;
  creating: boolean;
  onClose: () => void;
  onCreate: (partial: Partial<MpMeeting>) => void;
}) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState<MeetingType>("kol_1on1");
  const [date, setDate] = useState("");

  return (
    <Modal open={open} onClose={onClose} title="New meeting">
      <div className="space-y-3">
        <Input
          label="What's the meeting?"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder='e.g. "Q3 review with Dr. Chen"'
          autoFocus
        />
        <div className="grid grid-cols-2 gap-3">
          <Select
            label="Type"
            value={type}
            onChange={(e) => setType(e.target.value as MeetingType)}
          >
            {MEETING_TYPES.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </Select>
          <Input
            label="Date & time (optional)"
            type="datetime-local"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <p className="flex items-start gap-1.5 rounded-lg bg-[var(--accent-soft)]/50 px-3 py-2 text-xs text-muted">
          <Sparkles size={13} className="mt-0.5 shrink-0 text-[var(--accent)]" />
          Next you&apos;ll add attendees, objectives, and background — then I&apos;ll
          build your full brief.
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!title.trim() || creating}
            onClick={() =>
              onCreate({
                title: title.trim(),
                meeting_type: type,
                date: date ? new Date(date).toISOString() : null,
              })
            }
          >
            <Plus size={15} /> {creating ? "Creating…" : "Create meeting"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function MeetingList({
  title,
  meetings,
  onOpen,
  onDelete,
}: {
  title: string;
  meetings: MpMeeting[];
  onOpen: (id: string) => void;
  onDelete: (m: MpMeeting) => void;
}) {
  if (meetings.length === 0) return null;
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
        {title}
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
              className="group cursor-pointer rounded-xl border border-border bg-surface p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-[var(--accent)]/40 hover:shadow-md"
              onClick={() => onOpen(m.id)}
            >
              <div className="flex items-start gap-3">
                {/* Date block */}
                <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-[var(--grad-from)] to-[var(--grad-via)] text-white shadow-sm">
                  {d ? (
                    <div className="text-center leading-none">
                      <p className="text-[9px] font-bold uppercase tracking-wide opacity-90">
                        {d.toLocaleString(undefined, { month: "short" })}
                      </p>
                      <p className="mt-0.5 text-lg font-bold">{d.getDate()}</p>
                    </div>
                  ) : (
                    <CalendarClock size={18} className="opacity-90" />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-start gap-2">
                    <p className="min-w-0 flex-1 truncate text-sm font-semibold">
                      {m.title || "Untitled meeting"}
                    </p>
                    <button
                      className="rounded p-1 text-muted opacity-0 transition hover:text-red-600 group-hover:opacity-100"
                      aria-label="Delete meeting"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(m);
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted">
                    {d
                      ? d.toLocaleString(undefined, {
                          weekday: "short",
                          hour: "numeric",
                          minute: "2-digit",
                        })
                      : "No date set"}
                    {names.length > 0 && ` · ${names.slice(0, 3).join(", ")}`}
                    {names.length > 3 && ` +${names.length - 3}`}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--accent)]">
                      {meetingTypeLabel(m.meeting_type)}
                    </span>
                    {hasBrief && (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                        Briefed
                      </span>
                    )}
                    {m.territory_logged && (
                      <span className="rounded-full bg-teal-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-teal-700">
                        Logged
                      </span>
                    )}
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

// Manage the custom sections appended to every future brief.
function CustomSectionsModal({
  open,
  onClose,
  sections,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  sections: CustomSection[];
  onSave: (s: CustomSection[]) => void;
}) {
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");

  return (
    <Modal open={open} onClose={onClose} title="My brief — custom sections">
      <p className="mb-3 text-sm text-muted">
        Sections you add here appear in <b>every</b> brief from now on, after the
        standard ones.
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
