"use client";

// Session detail (spec §8): collaborative note-taking. Per-person rich-text
// notes (auto-saved), slide photos, structured post-event fields, a priority
// banner, and AI insight extraction with a review step before anything saves.

import { use, useMemo, useState } from "react";
import { Loading, ProgressBar } from "@/components/conference/Bits";
import Link from "next/link";
import { Clock, ImagePlus, MapPin, Pencil, Sparkles, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useConfirm, useToast } from "@/components/ui/Feedback";
import { AutoRichField } from "@/components/ui/AutoRichField";
import { RichTextView } from "@/components/ui/RichText";
import { useConferenceCtx } from "@/components/conference/ConferenceContext";
import {
  uploadConferenceFile,
  useEvents,
  useInsights,
  useRecordings,
  useSessionNotes,
  useCategories,
  type EventWithPeople,
} from "@/lib/conference/hooks";
import { EventFormModal } from "@/components/conference/EventFormModal";
import {
  EditQuestionsButton,
  QuestionsEditorModal,
} from "@/components/conference/Questions";
import { PriorityBanner } from "@/components/conference/Priority";
import { PresenceAvatars } from "@/components/conference/PresenceAvatars";
import { RecorderPanel, recordingsText } from "@/components/conference/RecorderPanel";
import {
  CategoryChip,
  GenerateInsightsModal,
} from "@/components/conference/InsightAI";
import {
  BUILTIN_SESSION_KEYS,
  EVENT_TYPES,
  sessionQuestions,
} from "@/lib/conference/types";
import {
  dateKeyInTz,
  fmtDayKeyLong,
  fmtTime,
  stripHtml,
} from "@/lib/conference/utils";

export default function SessionDetailPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = use(params);
  const confirm = useConfirm();
  const toast = useToast();
  const { conference, updateConference, attendees, me, canManage } = useConferenceCtx();
  const { events, save, setPriority, loading } = useEvents(conference.id, me?.id);
  const event = useMemo(
    () => events.find((e) => e.id === eventId) || null,
    [events, eventId],
  );
  const { notes, upsertMine } = useSessionNotes(conference.id, eventId);
  const { recordings } = useRecordings(conference.id, { eventId });
  const insightsApi = useInsights(conference.id);
  const { categories } = useCategories(conference.id);
  const tz = conference.timezone;

  const [editOpen, setEditOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [slidesOpen, setSlidesOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [questionsOpen, setQuestionsOpen] = useState(false);
  const questions = sessionQuestions(conference);

  const myNote = useMemo(
    () => notes.find((n) => n.user_id === me?.id) || null,
    [notes, me],
  );
  const otherNotes = useMemo(
    () => notes.filter((n) => n.user_id !== me?.id && (n.notes.trim() || n.images.length)),
    [notes, me],
  );
  const sessionInsights = useMemo(
    () => insightsApi.parents.filter((i) => i.event_id === eventId),
    [insightsApi.parents, eventId],
  );

  const nameForUser = (userId: string) =>
    attendees.find((a) => a.user_id === userId)?.name || "Teammate";

  if (loading) return <Loading />;
  if (!event) {
    return (
      <p className="py-12 text-center text-sm text-muted">
        Session not found.{" "}
        <Link
          href={`/conference-planning/${conference.id}/sessions`}
          className="text-[var(--accent)] hover:underline"
        >
          Back to sessions
        </Link>
      </p>
    );
  }

  const type = EVENT_TYPES[event.event_type];
  const assigneeNames = event.assignments
    .map((a) => attendees.find((x) => x.id === a.attendee_id)?.name)
    .filter(Boolean) as string[];
  const allImages = myNote?.images || [];

  async function uploadSlides(files: FileList | null) {
    if (!files || !me) return;
    setUploading(true);
    setUploadPct(0);
    try {
      const list = Array.from(files);
      const urls: string[] = [];
      for (let i = 0; i < list.length; i++) {
        const url = await uploadConferenceFile(conference.id, `sessions/${eventId}`, list[i]);
        if (url) urls.push(url);
        setUploadPct(((i + 1) / list.length) * 100);
      }
      if (urls.length) {
        await upsertMine(me.id, { images: [...allImages, ...urls] });
      }
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Header */}
      <div className="rounded-xl border border-border bg-surface p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <span
              className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-white"
              style={{ background: type.color }}
            >
              {event.event_type === "custom" && event.custom_label
                ? event.custom_label
                : type.label}
            </span>
            <h1 className="mt-2 text-xl font-bold tracking-tight">{event.title}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-muted">
              <span className="inline-flex items-center gap-1">
                <Clock size={14} />
                {fmtDayKeyLong(dateKeyInTz(event.starts_at, tz))} ·{" "}
                {fmtTime(event.starts_at, tz)}–{fmtTime(event.ends_at, tz)}
              </span>
              {event.location && (
                <span className="inline-flex items-center gap-1">
                  <MapPin size={14} /> {event.location}
                </span>
              )}
            </p>
            {assigneeNames.length > 0 && (
              <p className="mt-1 flex items-center gap-1 text-sm text-muted">
                <Users size={14} /> {assigneeNames.join(", ")}
              </p>
            )}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <Button size="sm" variant="secondary" onClick={() => setEditOpen(true)}>
              <Pencil size={13} /> Edit
            </Button>
            <PresenceAvatars channelKey={`session-${eventId}`} />
          </div>
        </div>
        <div className="mt-4">
          <PriorityBanner
            suspected={event.suspected_priority}
            confirmed={event.confirmed_priority}
            canManage={canManage}
            onChange={(field, value) => setPriority(event.id, field, value)}
          />
        </div>
      </div>

      {/* My notes */}
      <section className="rounded-xl border border-border bg-surface p-5">
        <AutoRichField
          label="My session notes"
          initialHtml={myNote?.notes || ""}
          canEdit={!!me}
          onSave={async (html) => {
            if (me) await upsertMine(me.id, { notes: html });
          }}
          placeholder="Take your notes here — they auto-save and are visible to the team."
          minHeight="min-h-40"
        />

        {/* Slides */}
        <div className="mt-4 border-t border-border pt-4">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setSlidesOpen((v) => !v)}
              className="text-xs font-semibold uppercase tracking-wide text-muted hover:text-ink"
            >
              Slides &amp; photos ({allImages.length}) {slidesOpen ? "▾" : "▸"}
            </button>
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-muted transition hover:text-ink">
              <ImagePlus size={14} />
              {uploading ? "Uploading…" : "Add photos"}
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => uploadSlides(e.target.files)}
              />
            </label>
          </div>
          {uploading && (
            <ProgressBar percent={uploadPct} label="Uploading photos…" className="mt-3" />
          )}
          {slidesOpen && allImages.length > 0 && (
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {allImages.map((url) => (
                <div key={url} className="group relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt="slide"
                    className="h-32 w-full rounded-lg border border-border object-cover"
                  />
                  <button
                    onClick={async () => {
                      if (
                        me &&
                        (await confirm({
                          title: "Delete this photo?",
                          confirmLabel: "Delete",
                          danger: true,
                        }))
                      ) {
                        await upsertMine(me.id, {
                          images: allImages.filter((u) => u !== url),
                        });
                      }
                    }}
                    className="absolute right-1.5 top-1.5 rounded-md bg-black/60 p-1 text-white opacity-0 transition group-hover:opacity-100"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Teammates' notes */}
      {otherNotes.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
            Team notes
          </h2>
          {otherNotes.map((n) => (
            <div key={n.id} className="rounded-xl border border-border bg-surface p-5">
              <p className="mb-2 text-sm font-semibold">{nameForUser(n.user_id)}</p>
              <RichTextView html={n.notes} />
              {n.images.length > 0 && (
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {n.images.map((url) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={url}
                      src={url}
                      alt="slide"
                      className="h-24 w-full rounded-lg border border-border object-cover"
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </section>
      )}

      {/* Lecture recordings */}
      <RecorderPanel eventId={eventId} defaultTitle={`${event.title} — recording`} />

      {/* Post-event notes — the question list is organizer-configurable
          (conference settings). Built-in questions store into their legacy
          columns; added ones store into custom_answers. */}
      <section className="space-y-4 rounded-xl border border-border bg-surface p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
            Post-session notes
          </h2>
          {canManage && <EditQuestionsButton onClick={() => setQuestionsOpen(true)} />}
        </div>
        {questions.map((q) => {
          const builtin = BUILTIN_SESSION_KEYS.includes(q.key);
          const current = builtin
            ? ((myNote?.[q.key as "attendance" | "questions_asked" | "impact"] as string) || "")
            : myNote?.custom_answers?.[q.key] || "";
          return (
            <AutoRichField
              key={q.key}
              label={q.label}
              initialHtml={current}
              canEdit={!!me}
              onSave={async (html) => {
                if (!me) return;
                if (builtin) {
                  await upsertMine(me.id, { [q.key]: html });
                } else {
                  await upsertMine(me.id, {
                    custom_answers: { ...(myNote?.custom_answers || {}), [q.key]: html },
                  });
                }
              }}
              placeholder={q.placeholder || "Your notes…"}
              minHeight="min-h-16"
            />
          );
        })}
      </section>

      <QuestionsEditorModal
        open={questionsOpen}
        onClose={() => setQuestionsOpen(false)}
        title="Post-session questions"
        questions={questions}
        onSave={(qs) =>
          updateConference({
            settings: { ...(conference.settings || {}), session_questions: qs },
          })
        }
      />

      {/* Insights */}
      <section className="rounded-xl border border-border bg-surface p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
            Insights from this session ({sessionInsights.length})
          </h2>
          <Button size="sm" onClick={() => setAiOpen(true)}>
            <Sparkles size={14} />
            {sessionInsights.length ? "Reanalyze" : "Generate insights"}
          </Button>
        </div>
        {sessionInsights.length > 0 && (
          <ul className="mt-4 space-y-3">
            {sessionInsights.map((ins) => (
              <li key={ins.id} className="rounded-lg border border-border p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium">{ins.title}</p>
                  <button
                    onClick={async () => {
                      if (
                        await confirm({
                          title: "Delete this insight?",
                          confirmLabel: "Delete",
                          danger: true,
                        })
                      )
                        await insightsApi.remove(ins.id);
                    }}
                    className="rounded p-1 text-muted hover:text-red-600"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
                <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-sm text-ink/85">
                  {insightsApi.childrenOf(ins.id).map((c) => (
                    <li key={c.id}>{c.title}</li>
                  ))}
                </ul>
                {ins.categories.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {ins.categories.map((c) => (
                      <CategoryChip key={c} name={c} categories={categories} />
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <GenerateInsightsModal
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        sourceText={[
          ...notes
            .filter((n) => n.notes.trim())
            .map((n) => `Notes from ${nameForUser(n.user_id)}:\n${stripHtml(n.notes)}`),
          recordingsText(recordings),
        ]
          .filter(Boolean)
          .join("\n\n")}
        imageUrls={notes.flatMap((n) => n.images || [])}
        eventId={eventId}
        insightDate={dateKeyInTz(event.starts_at, tz)}
        addWithChildren={insightsApi.addWithChildren}
      />

      <EventFormModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        event={event as EventWithPeople}
        onSave={save}
      />
    </div>
  );
}
