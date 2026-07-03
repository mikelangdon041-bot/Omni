"use client";

// Post-Con Deck dialog (spec §16.1): loads everything captured at the
// conference into a curation list (include/exclude, per-item summary toggle,
// per-image selection — defaults off when an item has >3 photos), lets the
// team upload a branded .pptx template that the AI "adopts" (extracted theme
// + proposal, user guidance before and corrections after), then generates the
// deck client-side with progress and cancel.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  FileUp,
  Presentation,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { cn } from "@/lib/ui";
import { useConferenceCtx } from "@/components/conference/ConferenceContext";
import { uploadConferenceFile } from "@/lib/conference/hooks";
import {
  DEFAULT_THEME,
  generateDeck,
  parseTemplate,
  type DeckItem,
  type DeckTheme,
  type ParsedTemplate,
} from "@/lib/conference/deck";
import { SESSION_TYPES } from "@/lib/conference/types";
import {
  dateKeyInTz,
  fmtDayKey,
  fmtDateRange,
  fmtTime,
  normalizeFreeDate,
  stripHtml,
} from "@/lib/conference/utils";

const supabase = createClient();

interface TemplateRow {
  id: string;
  name: string;
  storage_path: string;
  theme: DeckTheme;
  mapping: {
    description?: string;
    colors?: Partial<Record<"primary" | "secondary" | "text" | "bg", string>>;
    fonts?: { head?: string; body?: string };
    useLogo?: boolean;
    recommendations?: string[];
  };
  guidance: string;
}

interface Proposal {
  description?: string;
  colors?: Partial<Record<"primary" | "secondary" | "text" | "bg", string>>;
  fonts?: { head?: string; body?: string };
  useLogo?: boolean;
  recommendations?: string[];
}

export function DeckDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { conference, me } = useConferenceCtx();
  const tz = conference.timezone;

  const [loading, setLoading] = useState(true);
  const [sessions, setSessions] = useState<DeckItem[]>([]);
  const [posters, setPosters] = useState<DeckItem[]>([]);
  const [booth, setBooth] = useState<{ day: string; text: string; checked: boolean }[]>([]);
  const [meetingLines, setMeetingLines] = useState<string[]>([]);
  const [includeMeetings, setIncludeMeetings] = useState(true);

  // Templates.
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [templateId, setTemplateId] = useState<string>(""); // "" = default look
  const [tplStep, setTplStep] = useState<"none" | "guidance" | "proposal">("none");
  const [tplFile, setTplFile] = useState<File | null>(null);
  const [tplParsed, setTplParsed] = useState<ParsedTemplate | null>(null);
  const [tplGuidance, setTplGuidance] = useState("");
  const [tplName, setTplName] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [tplBusy, setTplBusy] = useState(false);

  // Generation.
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const cancelRef = useRef(false);

  // ---- Load everything on open -----------------------------------------
  const load = useCallback(async () => {
    setLoading(true);
    const [evRes, snRes, recRes, poRes, pnRes, blRes, cmRes, ctRes, tplRes] =
      await Promise.all([
        supabase.from("conf_events").select("*").eq("conference_id", conference.id).eq("cancelled", false),
        supabase.from("conf_session_notes").select("*").eq("conference_id", conference.id),
        supabase.from("conf_recordings").select("*").eq("conference_id", conference.id).eq("status", "complete"),
        supabase.from("conf_posters").select("*").eq("conference_id", conference.id),
        supabase.from("conf_poster_notes").select("*").eq("conference_id", conference.id),
        supabase.from("conf_booth_logs").select("*").eq("conference_id", conference.id),
        supabase.from("conf_contact_meetings").select("*").eq("conference_id", conference.id),
        supabase.from("conf_contacts").select("id, name, institution").eq("conference_id", conference.id),
        supabase.from("conf_deck_templates").select("*").order("created_at", { ascending: false }),
      ]);

    const events = evRes.data || [];
    const sessionNotes = snRes.data || [];
    const recs = recRes.data || [];
    const confYear = Number(conference.start_date.slice(0, 4)) || new Date().getFullYear();

    const items: DeckItem[] = events
      .filter(
        (e) =>
          SESSION_TYPES.includes(e.event_type) ||
          (e.event_type === "custom" && e.show_in_sessions),
      )
      .map((e) => {
        const notes = sessionNotes.filter((n) => n.event_id === e.id);
        const evRecs = recs.filter((r) => r.event_id === e.id);
        const bodyParts = [
          ...notes.map((n) => stripHtml(n.notes)),
          ...notes.map((n) =>
            [n.attendance && `Attendance: ${stripHtml(n.attendance)}`,
             n.questions_asked && `Questions: ${stripHtml(n.questions_asked)}`,
             n.impact && `Impact: ${stripHtml(n.impact)}`]
              .filter(Boolean)
              .join("\n"),
          ),
          ...evRecs.map((r) => r.summary),
        ].filter(Boolean);
        const images = notes.flatMap((n) => n.images || []);
        return {
          id: e.id,
          title: e.title,
          day: dateKeyInTz(e.starts_at, tz),
          meta: [
            fmtTime(e.starts_at, tz),
            e.location,
          ]
            .filter(Boolean)
            .join(" · "),
          body: bodyParts.join("\n"),
          // >3 photos default to unselected (opt-in) to avoid huge slides.
          images: images.length > 3 ? [] : images,
          checked: bodyParts.length > 0 || images.length > 0,
          includeBody: true,
          allImages: images,
        } as DeckItem & { allImages: string[] };
      });
    setSessions(items);

    const posterNotes = pnRes.data || [];
    setPosters(
      (poRes.data || [])
        .filter((p) => !p.parent_id)
        .map((p) => {
          const notes = posterNotes.filter((n) => n.poster_id === p.id);
          const images = notes.flatMap((n) => n.images || []);
          const body = [p.ai_summary, ...notes.map((n) => stripHtml(n.notes))]
            .filter(Boolean)
            .join("\n");
          return {
            id: p.id,
            title: p.title,
            day: normalizeFreeDate(p.date, confYear) || "",
            meta: [p.authors, p.location].filter(Boolean).join(" · "),
            body,
            images: images.length > 3 ? [] : images,
            checked: !!body || images.length > 0,
            includeBody: true,
            allImages: images,
          } as DeckItem & { allImages: string[] };
        }),
    );

    setBooth(
      (blRes.data || []).map((b) => ({
        day: b.date,
        text: [
          b.attendee_count && `- Approx. visitors: ${b.attendee_count}`,
          b.patterns && `- Patterns: ${stripHtml(b.patterns)}`,
          b.standout && `- Stood out: ${stripHtml(b.standout)}`,
          b.custom && `- ${stripHtml(b.custom)}`,
        ]
          .filter(Boolean)
          .join("\n"),
        checked: true,
      })),
    );

    const contactName = new Map((ctRes.data || []).map((c) => [c.id, c.name]));
    setMeetingLines(
      (cmRes.data || [])
        .sort((a, b) => a.meeting_date.localeCompare(b.meeting_date))
        .map((m) =>
          [
            contactName.get(m.contact_id) || "KOL",
            fmtDayKey(m.meeting_date),
            m.location,
          ]
            .filter(Boolean)
            .join(" · "),
        ),
    );

    setTemplates((tplRes.data as TemplateRow[]) || []);
    setLoading(false);
  }, [conference.id, conference.start_date, tz]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  // ---- Template upload + AI adoption ------------------------------------
  async function onTemplateFile(file: File | null) {
    if (!file) return;
    setError("");
    try {
      const parsed = await parseTemplate(file);
      setTplFile(file);
      setTplParsed(parsed);
      setTplName(file.name.replace(/\.pptx?$/i, ""));
      setTplGuidance("");
      setProposal(null);
      setTplStep("guidance");
    } catch {
      setError("Couldn't read that file — is it a valid .pptx?");
    }
  }

  async function runMapping() {
    if (!tplParsed) return;
    setTplBusy(true);
    setError("");
    try {
      const res = await fetch("/api/conference/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          action: "map_deck_template",
          slidesText: tplParsed.slidesText,
          theme: { ...tplParsed.theme, logoDataUrl: tplParsed.theme.logoDataUrl ? "(logo image found)" : undefined },
          guidance: tplGuidance,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Template analysis failed");
      setProposal(json.proposal || {});
      setTplStep("proposal");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTplBusy(false);
    }
  }

  async function saveTemplate() {
    if (!tplFile || !tplParsed || !proposal) return;
    setTplBusy(true);
    try {
      const path = await uploadConferenceFile(conference.id, "deck-templates", tplFile);
      const { data: profile } = await supabase
        .from("profiles")
        .select("org_id")
        .eq("id", me?.id || "")
        .single();
      const { data } = await supabase
        .from("conf_deck_templates")
        .insert({
          org_id: profile?.org_id,
          name: tplName.trim() || tplFile.name,
          storage_path: path || "",
          theme: tplParsed.theme,
          mapping: proposal,
          guidance: tplGuidance,
          created_by: me?.id,
        })
        .select("*")
        .single();
      if (data) {
        setTemplates((prev) => [data as TemplateRow, ...prev]);
        setTemplateId(data.id);
      }
      setTplStep("none");
      setTplFile(null);
      setTplParsed(null);
      setProposal(null);
    } finally {
      setTplBusy(false);
    }
  }

  function themeFor(id: string): DeckTheme {
    const t = templates.find((x) => x.id === id);
    if (!t) return DEFAULT_THEME;
    const m = t.mapping || {};
    return {
      primary: m.colors?.primary || t.theme.primary || DEFAULT_THEME.primary,
      secondary: m.colors?.secondary || t.theme.secondary || DEFAULT_THEME.secondary,
      text: m.colors?.text || t.theme.text || DEFAULT_THEME.text,
      bg: m.colors?.bg || t.theme.bg || DEFAULT_THEME.bg,
      headFont: m.fonts?.head || t.theme.headFont || DEFAULT_THEME.headFont,
      bodyFont: m.fonts?.body || t.theme.bodyFont || DEFAULT_THEME.bodyFont,
      logoDataUrl: m.useLogo === false ? undefined : t.theme.logoDataUrl,
    };
  }

  // ---- Generate ----------------------------------------------------------
  async function generate() {
    setGenerating(true);
    setError("");
    cancelRef.current = false;
    try {
      const ok = await generateDeck(
        {
          conferenceName: conference.name,
          dateRange: fmtDateRange(conference),
          location: conference.location,
          boothByDay: booth.filter((b) => b.checked).map(({ day, text }) => ({ day, text })),
          meetingLines: includeMeetings ? meetingLines : [],
          sessions,
          posters,
        },
        themeFor(templateId),
        setProgress,
        () => cancelRef.current,
      );
      if (ok) onClose();
    } catch (e) {
      setError((e as Error).message || "Deck generation failed");
    } finally {
      setGenerating(false);
      setProgress("");
    }
  }

  const selectedCount = useMemo(
    () =>
      sessions.filter((s) => s.checked).length +
      posters.filter((p) => p.checked).length +
      booth.filter((b) => b.checked && b.text.trim()).length +
      (includeMeetings && meetingLines.length ? 1 : 0),
    [sessions, posters, booth, includeMeetings, meetingLines],
  );

  return (
    <Modal open={open} onClose={onClose} title="Post-Con Deck" size="lg">
      {loading ? (
        <p className="py-8 text-center text-sm text-muted">Compiling everything captured…</p>
      ) : (
        <div className="space-y-5">
          {/* ---- Template ---- */}
          <section className="space-y-2 rounded-lg bg-canvas p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                Look &amp; branding
              </p>
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-muted transition hover:text-ink">
                <FileUp size={13} /> Upload .pptx template
                <input
                  type="file"
                  accept=".pptx,.potx"
                  className="hidden"
                  onChange={(e) => onTemplateFile(e.target.files?.[0] || null)}
                />
              </label>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <TemplateChip
                label="Default look"
                active={templateId === ""}
                theme={DEFAULT_THEME}
                onClick={() => setTemplateId("")}
              />
              {templates.map((t) => (
                <TemplateChip
                  key={t.id}
                  label={t.name}
                  active={templateId === t.id}
                  theme={themeFor(t.id)}
                  onClick={() => setTemplateId(t.id)}
                  onDelete={async () => {
                    if (!confirm(`Delete template "${t.name}"?`)) return;
                    await supabase.from("conf_deck_templates").delete().eq("id", t.id);
                    setTemplates((prev) => prev.filter((x) => x.id !== t.id));
                    if (templateId === t.id) setTemplateId("");
                  }}
                />
              ))}
            </div>

            {/* Template adoption flow */}
            {tplStep === "guidance" && tplParsed && (
              <div className="space-y-2 rounded-lg border border-border bg-surface p-3">
                <p className="text-sm">
                  <b>{tplFile?.name}</b> — {tplParsed.slideCount} slides. Theme
                  extracted: <Swatch hex={tplParsed.theme.primary} />{" "}
                  <Swatch hex={tplParsed.theme.secondary} /> · fonts{" "}
                  {tplParsed.theme.headFont}/{tplParsed.theme.bodyFont}
                  {tplParsed.theme.logoDataUrl && " · logo found"}
                </p>
                <Textarea
                  label="Guidance before the AI reviews it (optional)"
                  value={tplGuidance}
                  onChange={(e) => setTplGuidance(e.target.value)}
                  placeholder='e.g. "Use the dark blue, not the red; the logo goes top-left; titles are uppercase"'
                />
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setTplStep("none")}>
                    Cancel
                  </Button>
                  <Button size="sm" onClick={runMapping} disabled={tplBusy}>
                    <Sparkles size={13} /> {tplBusy ? "Analyzing…" : "Review template"}
                  </Button>
                </div>
              </div>
            )}
            {tplStep === "proposal" && proposal && tplParsed && (
              <div className="space-y-2 rounded-lg border border-[var(--accent)]/40 bg-surface p-3">
                <p className="text-sm">{proposal.description}</p>
                <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                  Colors: <Swatch hex={proposal.colors?.primary || tplParsed.theme.primary} />
                  <Swatch hex={proposal.colors?.secondary || tplParsed.theme.secondary} />
                  · Fonts: {proposal.fonts?.head || tplParsed.theme.headFont} /{" "}
                  {proposal.fonts?.body || tplParsed.theme.bodyFont}
                  {proposal.useLogo !== false && tplParsed.theme.logoDataUrl && " · logo on slides"}
                </p>
                {(proposal.recommendations || []).length > 0 && (
                  <ul className="list-disc pl-5 text-xs text-muted">
                    {(proposal.recommendations || []).map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                )}
                <Input
                  label="Template name"
                  value={tplName}
                  onChange={(e) => setTplName(e.target.value)}
                />
                <Textarea
                  label="Corrections (optional — re-runs the review)"
                  value={tplGuidance}
                  onChange={(e) => setTplGuidance(e.target.value)}
                  placeholder='e.g. "No — primary should be the green; don&apos;t use the logo"'
                />
                <div className="flex justify-between gap-2">
                  <Button size="sm" variant="secondary" onClick={runMapping} disabled={tplBusy}>
                    <Sparkles size={13} /> {tplBusy ? "Re-analyzing…" : "Re-run with corrections"}
                  </Button>
                  <Button size="sm" onClick={saveTemplate} disabled={tplBusy}>
                    {tplBusy ? "Saving…" : "Save template"}
                  </Button>
                </div>
              </div>
            )}
          </section>

          {/* ---- Curation ---- */}
          {booth.some((b) => b.text.trim()) && (
            <CurationSection title="Booth activity">
              {booth.map((b, i) =>
                b.text.trim() ? (
                  <label key={b.day} className="flex items-start gap-2 rounded-lg border border-border p-2.5 text-sm">
                    <input
                      type="checkbox"
                      checked={b.checked}
                      onChange={(e) =>
                        setBooth((prev) =>
                          prev.map((x, j) => (j === i ? { ...x, checked: e.target.checked } : x)),
                        )
                      }
                      className="mt-0.5"
                    />
                    <span className="min-w-0">
                      <span className="font-medium">{fmtDayKey(b.day)}</span>
                      <span className="block truncate text-xs text-muted">{b.text.split("\n")[0]}</span>
                    </span>
                  </label>
                ) : null,
              )}
            </CurationSection>
          )}

          {meetingLines.length > 0 && (
            <CurationSection title={`KOL meetings (${meetingLines.length})`}>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={includeMeetings}
                  onChange={(e) => setIncludeMeetings(e.target.checked)}
                />
                Include the KOL-meetings list slide
              </label>
            </CurationSection>
          )}

          <ItemCuration title={`Sessions (${sessions.length})`} items={sessions} setItems={setSessions} />
          <ItemCuration title={`Posters (${posters.length})`} items={posters} setItems={setPosters} />

          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
            {generating ? (
              <>
                <p className="min-w-0 flex-1 truncate text-sm text-muted">{progress}</p>
                <Button variant="secondary" onClick={() => (cancelRef.current = true)}>
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <p className="text-sm text-muted">{selectedCount} slides&apos; worth of content selected</p>
                <Button onClick={generate} disabled={selectedCount === 0}>
                  <Presentation size={15} /> Generate deck
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------

function Swatch({ hex }: { hex?: string }) {
  if (!hex) return null;
  return (
    <span
      className="inline-block h-3.5 w-3.5 rounded-full align-middle ring-1 ring-border"
      style={{ background: `#${hex.replace(/^#/, "")}` }}
      title={`#${hex}`}
    />
  );
}

function TemplateChip({
  label,
  active,
  theme,
  onClick,
  onDelete,
}: {
  label: string;
  active: boolean;
  theme: DeckTheme;
  onClick: () => void;
  onDelete?: () => void;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
        active ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-border bg-surface",
      )}
    >
      <button onClick={onClick} className="inline-flex items-center gap-1.5">
        <Swatch hex={theme.primary} />
        {label}
      </button>
      {onDelete && (
        <button onClick={onDelete} className="text-muted hover:text-red-600">
          <Trash2 size={11} />
        </button>
      )}
    </span>
  );
}

function CurationSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">{title}</p>
      <div className="space-y-1.5">{children}</div>
    </section>
  );
}

function ItemCuration({
  title,
  items,
  setItems,
}: {
  title: string;
  items: (DeckItem & { allImages?: string[] })[];
  setItems: React.Dispatch<React.SetStateAction<DeckItem[]>>;
}) {
  if (items.length === 0) return null;
  return (
    <CurationSection title={title}>
      {items.map((it) => (
        <div
          key={it.id}
          className={cn(
            "rounded-lg border p-2.5",
            it.checked ? "border-border" : "border-border bg-canvas opacity-60",
          )}
        >
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={it.checked}
              onChange={(e) =>
                setItems((prev) =>
                  prev.map((x) => (x.id === it.id ? { ...x, checked: e.target.checked } : x)),
                )
              }
              className="mt-0.5"
            />
            <span className="min-w-0 flex-1">
              <span className="font-medium">{it.title}</span>
              {it.day && <span className="text-xs text-muted"> · {fmtDayKey(it.day)}</span>}
              {!it.body.trim() && (it.allImages || []).length === 0 && (
                <span className="ml-1.5 rounded-full bg-canvas px-1.5 py-0.5 text-[10px] text-muted">
                  no content
                </span>
              )}
            </span>
          </label>
          {it.checked && (
            <div className="ml-6 mt-1.5 space-y-1.5">
              {it.body.trim() && (
                <label className="flex items-center gap-1.5 text-xs text-muted">
                  <input
                    type="checkbox"
                    checked={it.includeBody}
                    onChange={(e) =>
                      setItems((prev) =>
                        prev.map((x) =>
                          x.id === it.id ? { ...x, includeBody: e.target.checked } : x,
                        ),
                      )
                    }
                  />
                  Include summary text
                </label>
              )}
              {(it.allImages || []).length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {(it.allImages || []).map((url) => {
                    const on = it.images.includes(url);
                    return (
                      <button
                        key={url}
                        onClick={() =>
                          setItems((prev) =>
                            prev.map((x) =>
                              x.id === it.id
                                ? {
                                    ...x,
                                    images: on
                                      ? x.images.filter((u) => u !== url)
                                      : [...x.images, url],
                                  }
                                : x,
                            ),
                          )
                        }
                        className={cn(
                          "relative h-12 w-16 overflow-hidden rounded border-2",
                          on ? "border-[var(--accent)]" : "border-border opacity-50",
                        )}
                        title={on ? "Included — tap to remove" : "Tap to include"}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url} alt="" className="h-full w-full object-cover" />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </CurationSection>
  );
}
