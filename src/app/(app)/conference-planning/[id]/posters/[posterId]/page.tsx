"use client";

// Poster detail (spec §10.2, §25): editable fields, coverage, priority banner,
// per-rep notes + photos, AI background/data/conclusion summary, insight
// extraction, and — for poster sessions — the list of sub-posters.

import { use, useMemo, useState } from "react";
import { Loading } from "@/components/conference/Bits";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  Clock,
  ImagePlus,
  MapPin,
  Pencil,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { AutoRichField } from "@/components/ui/AutoRichField";
import { RichTextView } from "@/components/ui/RichText";
import { useConferenceCtx } from "@/components/conference/ConferenceContext";
import {
  uploadConferenceFile,
  useCategories,
  useInsights,
  usePosterNotes,
  usePosters,
} from "@/lib/conference/hooks";
import { PosterModal } from "@/components/conference/PosterModal";
import { PriorityBanner } from "@/components/conference/Priority";
import { PresenceAvatars } from "@/components/conference/PresenceAvatars";
import {
  CategoryChip,
  GenerateInsightsModal,
} from "@/components/conference/InsightAI";
import { normalizeFreeDate, stripHtml } from "@/lib/conference/utils";

const supabase = createClient();

export default function PosterDetailPage({
  params,
}: {
  params: Promise<{ posterId: string }>;
}) {
  const { posterId } = use(params);
  const { conference, attendees, me, canManage } = useConferenceCtx();
  const { posters, loading, save, remove } = usePosters(conference.id);
  const { notes, upsertMine } = usePosterNotes(conference.id, posterId);
  const insightsApi = useInsights(conference.id);
  const { categories } = useCategories(conference.id);

  const poster = useMemo(() => posters.find((p) => p.id === posterId) || null, [posters, posterId]);
  const subPosters = useMemo(
    () => posters.filter((p) => p.parent_id === posterId).sort((a, b) => (a.sub_index || 0) - (b.sub_index || 0)),
    [posters, posterId],
  );

  const [editOpen, setEditOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [uploading, setUploading] = useState(false);

  const myNote = useMemo(() => notes.find((n) => n.user_id === me?.id) || null, [notes, me]);
  const otherNotes = useMemo(
    () => notes.filter((n) => n.user_id !== me?.id && (n.notes.trim() || n.images.length)),
    [notes, me],
  );
  const posterInsights = useMemo(
    () => insightsApi.parents.filter((i) => i.poster_id === posterId),
    [insightsApi.parents, posterId],
  );

  if (loading) return <Loading />;
  if (!poster) {
    return (
      <p className="py-12 text-center text-sm text-muted">
        Poster not found.{" "}
        <Link
          href={`/conference-planning/${conference.id}/posters`}
          className="text-[var(--accent)] hover:underline"
        >
          Back to posters
        </Link>
      </p>
    );
  }

  const repNames = poster.reps
    .map((r) => attendees.find((a) => a.id === r.attendee_id)?.name)
    .filter(Boolean) as string[];
  const notesText = notes.map((n) => stripHtml(n.notes)).filter(Boolean).join("\n\n");
  const confYear = Number(conference.start_date.slice(0, 4)) || undefined;

  async function generateSummary() {
    setSummarizing(true);
    try {
      const res = await fetch("/api/conference/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          action: "poster_summary",
          title: poster!.title,
          abstract: poster!.abstract,
          notes: notesText,
        }),
      });
      const json = await res.json();
      if (res.ok) {
        const summary = [
          json.background && `Background: ${json.background}`,
          json.data && `Data: ${json.data}`,
          json.conclusion && `Conclusion: ${json.conclusion}`,
        ]
          .filter(Boolean)
          .join("\n\n");
        if (summary) await save(poster!.id, { ai_summary: summary });
      }
    } finally {
      setSummarizing(false);
    }
  }

  async function uploadImages(files: FileList | null) {
    if (!files || !me) return;
    setUploading(true);
    try {
      const urls: string[] = [];
      for (const f of Array.from(files)) {
        const url = await uploadConferenceFile(conference.id, `posters/${posterId}`, f);
        if (url) urls.push(url);
      }
      if (urls.length) {
        await upsertMine(me.id, { images: [...(myNote?.images || []), ...urls] });
      }
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
            {poster.session_label && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                {poster.session_label}
              </span>
            )}
            <h1 className="mt-2 text-xl font-bold tracking-tight">{poster.title}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-muted">
              <span className="inline-flex items-center gap-1">
                <Clock size={14} />
                {[poster.date, poster.time].filter(Boolean).join(" · ") || "No date"}
              </span>
              {poster.location && (
                <span className="inline-flex items-center gap-1">
                  <MapPin size={14} /> {poster.location}
                </span>
              )}
            </p>
            {poster.authors && (
              <p className="mt-1 text-sm text-muted">{poster.authors}</p>
            )}
            {repNames.length > 0 && (
              <p className="mt-1 flex items-center gap-1 text-sm font-medium text-[var(--accent)]">
                <Users size={14} /> Covered by {repNames.join(", ")}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <PresenceAvatars channelKey={`poster-${posterId}`} />
            <Button size="sm" variant="secondary" onClick={() => setEditOpen(true)}>
              <Pencil size={13} /> Edit
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="!text-red-600 hover:!bg-red-50"
              onClick={async () => {
                if (confirm(`Delete "${poster.title}"${poster.is_session ? " and its sub-posters" : ""}?`)) {
                  await remove(poster.id);
                  window.history.back();
                }
              }}
            >
              <Trash2 size={13} />
            </Button>
          </div>
        </div>
        <div className="mt-4">
          <PriorityBanner
            suspected={poster.suspected_priority}
            confirmed={poster.confirmed_priority}
            canManage={canManage}
            onChange={async (field, value) => {
              await save(poster.id, {
                [field]: value,
                priority_set_by: me?.id || null,
                priority_set_at: new Date().toISOString(),
              });
              void supabase.from("conf_priority_history").insert({
                conference_id: conference.id,
                item_type: "poster",
                item_id: poster.id,
                field: field === "suspected_priority" ? "suspected" : "confirmed",
                value,
                set_by: me?.id,
              });
            }}
          />
        </div>
      </div>

      {/* Sub-posters (session) */}
      {poster.is_session && (
        <section className="rounded-xl border border-border bg-surface p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
            Posters in this session ({subPosters.length})
          </h2>
          <div className="space-y-1.5">
            {subPosters.map((sp) => (
              <Link
                key={sp.id}
                href={`/conference-planning/${conference.id}/posters/${sp.id}`}
                className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm transition hover:bg-canvas"
              >
                <span className="rounded bg-canvas px-1.5 py-0.5 text-[10px] font-bold text-muted">
                  #{sp.sub_index}
                </span>
                <span className="min-w-0 flex-1 truncate">{sp.title}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Abstract */}
      {poster.abstract && (
        <section className="rounded-xl border border-border bg-surface p-5">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">
            Abstract
          </h2>
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{poster.abstract}</p>
        </section>
      )}

      {/* My notes + photos */}
      <section className="rounded-xl border border-border bg-surface p-5">
        <AutoRichField
          label="My poster notes"
          initialHtml={myNote?.notes || ""}
          canEdit={!!me}
          onSave={async (html) => {
            if (me) await upsertMine(me.id, { notes: html });
          }}
          placeholder="What did you learn at this poster?"
          minHeight="min-h-28"
        />
        <div className="mt-3 flex items-center justify-between">
          <p className="text-xs text-muted">{(myNote?.images || []).length} photo(s)</p>
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-muted transition hover:text-ink">
            <ImagePlus size={14} />
            {uploading ? "Uploading…" : "Add poster photos"}
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => uploadImages(e.target.files)}
            />
          </label>
        </div>
        {(myNote?.images || []).length > 0 && (
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {(myNote?.images || []).map((url) => (
              <div key={url} className="group relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt="poster"
                  className="h-32 w-full rounded-lg border border-border object-cover"
                />
                <button
                  onClick={async () => {
                    if (me && confirm("Delete this photo?")) {
                      await upsertMine(me.id, {
                        images: (myNote?.images || []).filter((u) => u !== url),
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
      </section>

      {/* Teammates' notes */}
      {otherNotes.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
            Team notes
          </h2>
          {otherNotes.map((n) => (
            <div key={n.id} className="rounded-xl border border-border bg-surface p-5">
              <p className="mb-2 text-sm font-semibold">
                {attendees.find((a) => a.user_id === n.user_id)?.name || "Teammate"}
              </p>
              <RichTextView html={n.notes} />
              {n.images.length > 0 && (
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {n.images.map((url) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={url}
                      src={url}
                      alt="poster"
                      className="h-24 w-full rounded-lg border border-border object-cover"
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </section>
      )}

      {/* AI summary */}
      <section className="rounded-xl border border-border bg-surface p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
            AI poster summary
          </h2>
          <Button size="sm" variant="secondary" onClick={generateSummary} disabled={summarizing}>
            <Sparkles size={14} />
            {summarizing ? "Summarizing…" : poster.ai_summary ? "Reanalyze" : "Summarize"}
          </Button>
        </div>
        {poster.ai_summary && (
          <pre className="mt-3 whitespace-pre-wrap font-sans text-sm leading-relaxed text-ink/90">
            {poster.ai_summary}
          </pre>
        )}
      </section>

      {/* Insights */}
      <section className="rounded-xl border border-border bg-surface p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">
            Insights from this poster ({posterInsights.length})
          </h2>
          <Button size="sm" onClick={() => setAiOpen(true)}>
            <Sparkles size={14} /> Find potential insights
          </Button>
        </div>
        {posterInsights.length > 0 && (
          <ul className="mt-4 space-y-3">
            {posterInsights.map((ins) => (
              <li key={ins.id} className="rounded-lg border border-border p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium">{ins.title}</p>
                  <button
                    onClick={async () => {
                      if (confirm("Delete this insight?")) await insightsApi.remove(ins.id);
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
        sourceText={[poster.abstract, poster.ai_summary, notesText].filter(Boolean).join("\n\n")}
        imageUrls={notes.flatMap((n) => n.images || [])}
        posterId={posterId}
        insightDate={normalizeFreeDate(poster.date, confYear || new Date().getFullYear()) || undefined}
        addWithChildren={insightsApi.addWithChildren}
      />

      <PosterModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        poster={poster}
        onSave={save}
      />
    </div>
  );
}
