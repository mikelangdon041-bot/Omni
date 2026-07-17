"use client";

// Meeting Prep home: upcoming and past meetings, plus profile settings
// (custom brief sections that appear in every future brief).

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Plus, Settings2, Trash2 } from "lucide-react";
import { ModuleHero } from "@/components/ui/ModuleHero";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { useConfirm } from "@/components/ui/Feedback";
import {
  useMpMeetings,
  useMpSettings,
  useUserId,
} from "@/lib/meetingprep/hooks";
import {
  meetingTypeLabel,
  type CustomSection,
  type MpMeeting,
} from "@/lib/meetingprep/types";

export default function MeetingPrepPage() {
  const router = useRouter();
  const confirm = useConfirm();
  const { userId } = useUserId();
  const { meetings, loading, add, remove } = useMpMeetings(userId);
  const { settings, save: saveSettings } = useMpSettings(userId);
  const [showSettings, setShowSettings] = useState(false);
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

  async function createMeeting() {
    setCreating(true);
    const m = await add({});
    if (m) router.push(`/meeting-prep/${m.id}`);
    setCreating(false);
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
              disabled={creating}
              onClick={createMeeting}
            >
              <Plus size={16} /> {creating ? "Opening…" : "New meeting"}
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
            <Button onClick={createMeeting} disabled={creating}>
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

      <CustomSectionsModal
        open={showSettings}
        onClose={() => setShowSettings(false)}
        sections={settings?.custom_sections || []}
        onSave={(custom_sections) => void saveSettings({ custom_sections })}
      />
    </>
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
          return (
            <li
              key={m.id}
              className="group cursor-pointer rounded-xl border border-border bg-surface p-4 shadow-sm transition hover:border-[var(--accent)]/50"
              onClick={() => onOpen(m.id)}
            >
              <div className="mb-1 flex items-center gap-2">
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
                <span className="flex-1" />
                <button
                  className="rounded p-1 text-muted opacity-0 transition hover:text-red-600 group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(m);
                  }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
              <p className="truncate text-sm font-medium">{m.title || "Untitled meeting"}</p>
              <p className="mt-0.5 text-xs text-muted">
                {m.date
                  ? new Date(m.date).toLocaleString(undefined, {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })
                  : "No date set"}
                {(m.attendees || []).filter((a) => a.name.trim()).length > 0 &&
                  ` · ${(m.attendees || [])
                    .filter((a) => a.name.trim())
                    .map((a) => a.name)
                    .slice(0, 3)
                    .join(", ")}`}
              </p>
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
