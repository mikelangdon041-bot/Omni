"use client";

// Key-contact detail (spec §6.2–6.4): auto-saved profile, interest tags,
// rich-text sections, quick links, custom fields, meeting notes (with a
// ?meeting= deep link from the schedule), AI meeting summary, and insights.

import { use, useEffect, useMemo, useRef, useState } from "react";
import { Loading, ProgressBar } from "@/components/conference/Bits";
import Link from "next/link";
import {
  Camera,
  Download,
  ExternalLink,
  MapPin,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { exportKolDocx } from "@/lib/conference/exports";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/Feedback";
import { Input } from "@/components/ui/Input";
import { AutoRichField } from "@/components/ui/AutoRichField";
import { Avatar } from "@/components/ui/Avatar";
import { cn } from "@/lib/ui";
import { useConferenceCtx } from "@/components/conference/ConferenceContext";
import {
  uploadConferenceFile,
  useContact,
  useContactMeetings,
  useInsights,
  useRecordings,
  useCategories,
} from "@/lib/conference/hooks";
import { RecorderPanel, recordingsText } from "@/components/conference/RecorderPanel";
import {
  CategoryChip,
  GenerateInsightsModal,
} from "@/components/conference/InsightAI";
import { TIERS, type Contact, type QuickLink, type Tier } from "@/lib/conference/types";
import { fmtDayKeyLong, initials, stripHtml } from "@/lib/conference/utils";

export default function ContactDetailPage({
  params,
}: {
  params: Promise<{ contactId: string }>;
}) {
  const { contactId } = use(params);
  const confirm = useConfirm();
  const { conference } = useConferenceCtx();
  const { contact, loading, update } = useContact(contactId);
  const { meetings, add: addMeeting, update: updateMeeting, remove: removeMeeting } =
    useContactMeetings(conference.id, contactId);
  const { recordings } = useRecordings(conference.id, { contactId });
  const insightsApi = useInsights(conference.id);
  const { categories } = useCategories(conference.id);

  const [aiOpen, setAiOpen] = useState(false);
  const [summaryRunning, setSummaryRunning] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  // Deep link: scroll to a specific meeting (?meeting=<id>).
  const meetingRefs = useRef<Record<string, HTMLDivElement | null>>({});
  useEffect(() => {
    const target = new URLSearchParams(window.location.search).get("meeting");
    if (!target) return;
    const el = meetingRefs.current[target];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [meetings]);

  const contactInsights = useMemo(
    () => insightsApi.parents.filter((i) => i.contact_id === contactId),
    [insightsApi.parents, contactId],
  );

  if (loading) return <Loading />;
  if (!contact) {
    return (
      <p className="py-12 text-center text-sm text-muted">
        KOL not found.{" "}
        <Link
          href={`/conference-planning/${conference.id}/contacts`}
          className="text-[var(--accent)] hover:underline"
        >
          Back to KOLs
        </Link>
      </p>
    );
  }

  const meetingNotesText = [
    ...meetings.map(
      (m) => `Meeting on ${m.meeting_date}${m.location ? ` at ${m.location}` : ""}:\n${stripHtml(m.notes)}`,
    ),
    recordingsText(recordings),
    ...contactInsights.map((i) => `Insight: ${i.title}`),
  ]
    .filter((t) => t.trim().length > 10)
    .join("\n\n");

  async function generateSummary() {
    setSummaryRunning(true);
    try {
      const res = await fetch("/api/conference/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ action: "meeting_summary", text: meetingNotesText }),
      });
      const json = await res.json();
      if (res.ok && json.content) await update({ ai_summary: json.content });
    } finally {
      setSummaryRunning(false);
    }
  }

  async function uploadPhoto(file: File | null) {
    if (!file) return;
    setUploadingPhoto(true);
    try {
      const url = await uploadConferenceFile(conference.id, `contacts/${contactId}`, file);
      if (url) await update({ photo_url: url });
    } finally {
      setUploadingPhoto(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Profile header */}
      <div className="rounded-xl border border-border bg-surface p-5">
        <div className="flex items-start gap-4">
          <label className="group relative cursor-pointer" title="Upload photo">
            <Avatar src={contact.photo_url || null} initials={initials(contact.name)} size={64} />
            <span className="absolute -bottom-1 -right-1 grid h-6 w-6 place-items-center rounded-full border border-border bg-surface text-muted transition group-hover:text-ink">
              <Camera size={12} />
            </span>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={uploadingPhoto}
              onChange={(e) => uploadPhoto(e.target.files?.[0] || null)}
            />
          </label>
          <div className="min-w-0 flex-1 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <input
                defaultValue={contact.name}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== contact.name) update({ name: v });
                }}
                className="min-w-40 flex-1 rounded-lg border border-transparent bg-transparent text-xl font-bold tracking-tight outline-none transition hover:border-border focus:border-[var(--accent)]"
              />
              <div className="flex gap-1">
                {(["high", "medium", "low"] as Tier[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => update({ tier: t })}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-[11px] font-bold transition",
                      contact.tier === t ? "border-transparent" : "border-border opacity-50",
                    )}
                    style={{ background: TIERS[t].soft, color: TIERS[t].color }}
                  >
                    {TIERS[t].label}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <ProfileField label="Title" value={contact.title} onSave={(v) => update({ title: v })} />
              <ProfileField
                label="Institution"
                value={contact.institution}
                onSave={(v) => update({ institution: v })}
              />
              <ProfileField label="Email" value={contact.email} onSave={(v) => update({ email: v })} />
              <ProfileField label="Phone" value={contact.phone} onSave={(v) => update({ phone: v })} />
            </div>
          </div>
        </div>

        {/* Interests */}
        <div className="mt-4 border-t border-border pt-4">
          <TagEditor
            label="Research / focus interests"
            tags={contact.interests}
            onChange={(interests) => update({ interests })}
          />
        </div>

        <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              exportKolDocx(contact, meetings, contactInsights, insightsApi.childrenOf)
            }
          >
            <Download size={13} /> Export .docx
          </Button>
          {contact.kol_id && (
            <Link
              href={`/territory-planning/kol/${contact.kol_id}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-muted transition hover:text-ink"
            >
              <MapPin size={13} /> Open in Territory Planning
            </Link>
          )}
        </div>
      </div>

      {/* Rich sections */}
      <div className="space-y-4 rounded-xl border border-border bg-surface p-5">
        <AutoRichField
          label="Background"
          initialHtml={contact.background}
          canEdit
          onSave={async (html) => update({ background: html })}
          minHeight="min-h-20"
        />
        <AutoRichField
          label="Engagement activities"
          initialHtml={contact.engagement_activities}
          canEdit
          onSave={async (html) => update({ engagement_activities: html })}
          minHeight="min-h-20"
        />
        <AutoRichField
          label="Meeting objectives"
          initialHtml={contact.meeting_objectives}
          canEdit
          onSave={async (html) => update({ meeting_objectives: html })}
          minHeight="min-h-20"
        />
      </div>

      {/* Quick links + custom fields */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <LinksEditor
          links={contact.links || []}
          onChange={(links) => update({ links })}
        />
        <CustomFieldsEditor
          fields={contact.custom_fields || {}}
          onChange={(custom_fields) => update({ custom_fields })}
        />
      </div>

      {/* Meetings */}
      <MeetingsSection
        contact={contact}
        meetings={meetings}
        addMeeting={addMeeting}
        updateMeeting={updateMeeting}
        removeMeeting={removeMeeting}
        meetingRefs={meetingRefs}
      />

      {/* Meeting recordings (consent-gated) */}
      <RecorderPanel
        contactId={contactId}
        consentNotice
        defaultTitle={`Meeting with ${contact.name}`}
      />

      {/* AI summary */}
      <section className="rounded-xl border border-border bg-surface p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
            AI meeting summary
          </h2>
          <Button size="sm" variant="secondary" onClick={generateSummary} disabled={summaryRunning}>
            <Sparkles size={14} />
            {summaryRunning ? "Generating…" : contact.ai_summary ? "Reanalyze with AI" : "Generate with AI"}
          </Button>
        </div>
        {summaryRunning && (
          <ProgressBar
            percent={null}
            label="AI is distilling everything captured about this KOL…"
            className="mt-3"
          />
        )}
        {contact.ai_summary && (
          <pre className="mt-3 whitespace-pre-wrap font-sans text-sm leading-relaxed text-ink/90">
            {contact.ai_summary}
          </pre>
        )}
      </section>

      {/* Insights */}
      <section className="rounded-xl border border-border bg-surface p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
            Field insights ({contactInsights.length})
          </h2>
          <Button size="sm" onClick={() => setAiOpen(true)}>
            <Sparkles size={14} /> Find potential insights
          </Button>
        </div>
        {contactInsights.length > 0 && (
          <ul className="mt-4 space-y-3">
            {contactInsights.map((ins) => (
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
        sourceText={meetingNotesText}
        contactId={contactId}
        addWithChildren={insightsApi.addWithChildren}
      />
    </div>
  );
}

// ------------------------------------------------------------------

function ProfileField({
  label,
  value,
  onSave,
}: {
  label: string;
  value: string;
  onSave: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
        {label}
      </span>
      <input
        defaultValue={value}
        onBlur={(e) => {
          if (e.target.value.trim() !== value) onSave(e.target.value.trim());
        }}
        className="rounded-md border border-transparent bg-transparent px-1 py-0.5 text-sm outline-none transition hover:border-border focus:border-[var(--accent)]"
        placeholder="—"
      />
    </label>
  );
}

function TagEditor({
  label,
  tags,
  onChange,
}: {
  label: string;
  tags: string[];
  onChange: (tags: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  function addTag() {
    const t = draft.trim();
    if (!t || tags.includes(t)) return;
    onChange([...tags, t]);
    setDraft("");
  }
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
        {label}
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.map((t) => (
          <button
            key={t}
            onClick={() => onChange(tags.filter((x) => x !== t))}
            className="rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-xs font-medium text-[var(--accent)] hover:opacity-70"
            title="Remove"
          >
            {t} ×
          </button>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addTag()}
          onBlur={addTag}
          placeholder="+ add interest"
          className="min-w-28 rounded-full border border-dashed border-border bg-transparent px-2.5 py-1 text-xs outline-none focus:border-[var(--accent)]"
        />
      </div>
    </div>
  );
}

function LinksEditor({
  links,
  onChange,
}: {
  links: QuickLink[];
  onChange: (links: QuickLink[]) => void;
}) {
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
        Links
      </p>
      <ul className="space-y-1">
        {links.map((l, i) => (
          <li key={i} className="flex items-center gap-2 text-sm">
            <ExternalLink size={13} className="shrink-0 text-muted" />
            <a
              href={l.url}
              target="_blank"
              rel="noreferrer"
              className="min-w-0 flex-1 truncate text-[var(--accent)] hover:underline"
            >
              {l.label || l.url}
            </a>
            <button
              onClick={() => onChange(links.filter((_, j) => j !== i))}
              className="rounded p-0.5 text-muted hover:text-red-600"
            >
              <Trash2 size={12} />
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex gap-1.5">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Label"
          className="w-24 rounded-md border border-border bg-surface px-2 py-1.5 text-xs outline-none focus:border-[var(--accent)]"
        />
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…"
          className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1.5 text-xs outline-none focus:border-[var(--accent)]"
        />
        <button
          onClick={() => {
            if (!url.trim()) return;
            onChange([...links, { label: label.trim(), url: url.trim() }]);
            setLabel("");
            setUrl("");
          }}
          className="rounded-md border border-border px-2 text-muted hover:text-ink"
        >
          <Plus size={14} />
        </button>
      </div>
    </div>
  );
}

function CustomFieldsEditor({
  fields,
  onChange,
}: {
  fields: Record<string, string>;
  onChange: (fields: Record<string, string>) => void;
}) {
  const [k, setK] = useState("");
  const [v, setV] = useState("");
  const entries = Object.entries(fields);
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
        Info
      </p>
      <ul className="space-y-1">
        {entries.map(([key, val]) => (
          <li key={key} className="flex items-center gap-2 text-sm">
            <span className="font-medium">{key}:</span>
            <span className="min-w-0 flex-1 truncate text-muted">{val}</span>
            <button
              onClick={() => {
                const next = { ...fields };
                delete next[key];
                onChange(next);
              }}
              className="rounded p-0.5 text-muted hover:text-red-600"
            >
              <Trash2 size={12} />
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex gap-1.5">
        <input
          value={k}
          onChange={(e) => setK(e.target.value)}
          placeholder="Field"
          className="w-24 rounded-md border border-border bg-surface px-2 py-1.5 text-xs outline-none focus:border-[var(--accent)]"
        />
        <input
          value={v}
          onChange={(e) => setV(e.target.value)}
          placeholder="Value"
          className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1.5 text-xs outline-none focus:border-[var(--accent)]"
        />
        <button
          onClick={() => {
            if (!k.trim()) return;
            onChange({ ...fields, [k.trim()]: v.trim() });
            setK("");
            setV("");
          }}
          className="rounded-md border border-border px-2 text-muted hover:text-ink"
        >
          <Plus size={14} />
        </button>
      </div>
    </div>
  );
}

function MeetingsSection({
  contact,
  meetings,
  addMeeting,
  updateMeeting,
  removeMeeting,
  meetingRefs,
}: {
  contact: Contact;
  meetings: {
    id: string;
    meeting_date: string;
    meeting_time: string;
    location: string;
    notes: string;
    event_id: string | null;
  }[];
  addMeeting: (partial: {
    meeting_date: string;
    meeting_time: string;
    location: string;
  }) => Promise<unknown>;
  updateMeeting: (id: string, partial: { notes?: string }) => Promise<void>;
  removeMeeting: (id: string) => Promise<void>;
  meetingRefs: React.MutableRefObject<Record<string, HTMLDivElement | null>>;
}) {
  const confirm = useConfirm();
  const [showAdd, setShowAdd] = useState(false);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [location, setLocation] = useState("");

  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
          Meeting notes ({meetings.length})
        </h2>
        <Button size="sm" variant="secondary" onClick={() => setShowAdd((v) => !v)}>
          <Plus size={14} /> Add meeting
        </Button>
      </div>

      {showAdd && (
        <div className="mt-3 space-y-2 rounded-lg bg-canvas p-3">
          <p className="text-xs text-muted">
            Recordings may only be captured/uploaded if all participants were
            informed and consented, per applicable privacy law and policy.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Input label="Date *" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <Input label="Time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
          <Input
            label="Location"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              disabled={!date}
              onClick={async () => {
                await addMeeting({ meeting_date: date, meeting_time: time, location });
                setShowAdd(false);
                setDate("");
                setTime("");
                setLocation("");
              }}
            >
              Add
            </Button>
          </div>
        </div>
      )}

      <div className="mt-4 space-y-4">
        {meetings.map((m) => (
          <div
            key={m.id}
            ref={(el) => {
              meetingRefs.current[m.id] = el;
            }}
            className="rounded-lg border border-border p-4"
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-sm font-semibold">
                {fmtDayKeyLong(m.meeting_date)}
                {m.meeting_time && <span className="text-muted"> · {m.meeting_time}</span>}
                {m.location && <span className="text-muted"> · {m.location}</span>}
                {m.event_id && (
                  <span className="ml-2 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-700">
                    On schedule
                  </span>
                )}
              </p>
              <button
                onClick={async () => {
                  if (
                    await confirm({
                      title: "Delete this meeting note?",
                      confirmLabel: "Delete",
                      danger: true,
                    })
                  )
                    await removeMeeting(m.id);
                }}
                className="rounded p-1 text-muted hover:text-red-600"
              >
                <Trash2 size={13} />
              </button>
            </div>
            <AutoRichField
              label={`Notes — meeting with ${contact.name}`}
              initialHtml={m.notes}
              canEdit
              onSave={async (html) => updateMeeting(m.id, { notes: html })}
              minHeight="min-h-20"
            />
          </div>
        ))}
        {meetings.length === 0 && !showAdd && (
          <p className="text-sm text-muted">
            No meetings yet. Meetings created from the Schedule (KOL-meeting
            events) appear here automatically.
          </p>
        )}
      </div>
    </section>
  );
}
