"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  Sparkles,
  RefreshCw,
  MessageSquareQuote,
  Target,
  Bell,
  ListChecks,
  CalendarClock,
  Check,
} from "lucide-react";
import { BackButton } from "@/components/BackButton";
import { useKOL, useQuarterlyGoals, useMeetings } from "@/lib/territory/hooks";
import {
  RELATIONSHIP_COLORS,
  RELATIONSHIP_LABELS,
  cn,
  kolFullName,
  kolInitials,
} from "@/lib/territory/utils";
import type { MeetingPrep as Prep } from "@/lib/territory/ai";
import { Badge } from "@/components/territory/ui/Badge";
import { EngagementRing } from "@/components/territory/ui/EngagementRing";
import { RichTextView } from "@/components/ui/RichText";

export default function MeetingPrepPage() {
  const params = useParams<{ id: string }>();
  const { kol, loading } = useKOL(params.id);
  const { goals } = useQuarterlyGoals(params.id);
  const { meetings } = useMeetings(params.id);

  const [prep, setPrep] = useState<Prep | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const generate = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/territory/meeting-prep", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ kolId: params.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not generate");
      setPrep(data.prep);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }, [params.id]);

  // Auto-generate once the KOL has loaded.
  useEffect(() => {
    if (kol && !prep && !busy) void generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kol]);

  if (loading) return <p className="py-12 text-center text-sm text-muted">Loading…</p>;
  if (!kol) {
    return (
      <div className="py-12 text-center">
        <p className="text-sm text-muted">KOL not found.</p>
        <Link href="/territory-planning" className="mt-2 inline-block text-sm text-primary">
          ← Back to Territory Planning
        </Link>
      </div>
    );
  }

  const openGoals = goals.filter((g) => !g.discussed);
  const last = meetings[0];

  function toggle(key: string) {
    setChecked((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  }

  return (
    <>
      <BackButton label="Back to profile" />

      {/* Hero */}
      <div className="mb-5 overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
        <div className="flex items-center gap-4 bg-[var(--accent-soft)] px-5 py-4">
          {kol.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={kol.photo_url} alt="" className="h-14 w-14 rounded-full object-cover" />
          ) : (
            <span className="grid h-14 w-14 place-items-center rounded-full bg-white/70 text-lg font-semibold text-[var(--accent)]">
              {kolInitials(kol) || "?"}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-widest text-[var(--accent)]">
              Meeting prep
            </p>
            <h1 className="truncate text-xl font-semibold tracking-tight">{kolFullName(kol)}</h1>
            <p className="truncate text-sm text-muted">
              {[kol.title_position, kol.specialty, kol.institution].filter(Boolean).join(" · ")}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <Badge className={RELATIONSHIP_COLORS[kol.relationship_level]}>
              {RELATIONSHIP_LABELS[kol.relationship_level]}
            </Badge>
            <EngagementRing score={kol.engagement_score} size={48} />
          </div>
        </div>
        <div className="flex items-center justify-between px-5 py-2.5">
          <p className="text-xs text-muted">
            AI-generated from this KOL&apos;s profile, goals, and last meeting. Review
            before using.
          </p>
          <button
            onClick={generate}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-ink transition hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-60"
          >
            <RefreshCw size={13} className={busy ? "animate-spin" : ""} /> {busy ? "Thinking…" : "Regenerate"}
          </button>
        </div>
      </div>

      {error && (
        <p className="mb-4 rounded-lg border border-status-error/30 bg-status-error/5 px-4 py-2 text-sm text-status-error">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.5fr_1fr]">
        {/* AI prep */}
        <div className="space-y-4">
          {busy && !prep ? (
            <div className="grid place-items-center rounded-xl border border-border bg-surface py-16 text-sm text-muted shadow-sm">
              <Sparkles size={20} className="mb-2 animate-pulse text-[var(--accent)]" />
              Preparing your talking points…
            </div>
          ) : prep ? (
            <>
              {prep.opener && (
                <PrepCard icon={MessageSquareQuote} title="Open with">
                  <p className="text-sm leading-relaxed text-ink">{prep.opener}</p>
                </PrepCard>
              )}
              {prep.talkingPoints.length > 0 && (
                <PrepCard icon={ListChecks} title="Talking points" hint="Tap to check off during the meeting">
                  <ul className="space-y-1.5">
                    {prep.talkingPoints.map((t, i) => {
                      const key = `tp-${i}`;
                      const on = checked.has(key);
                      return (
                        <li key={key}>
                          <button
                            onClick={() => toggle(key)}
                            className="flex w-full items-start gap-2.5 rounded-lg px-2 py-1.5 text-left transition hover:bg-canvas"
                          >
                            <span
                              className={cn(
                                "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded border transition",
                                on ? "border-[var(--accent)] bg-[var(--accent)] text-white" : "border-border",
                              )}
                            >
                              {on && <Check size={13} />}
                            </span>
                            <span className={cn("text-sm text-ink/90", on && "text-muted line-through")}>{t}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </PrepCard>
              )}
              {prep.followUps.length > 0 && (
                <PrepCard icon={CalendarClock} title="Follow-ups from last time">
                  <List items={prep.followUps} />
                </PrepCard>
              )}
              {prep.reminders.length > 0 && (
                <PrepCard icon={Bell} title="Keep in mind">
                  <List items={prep.reminders} />
                </PrepCard>
              )}
            </>
          ) : null}
        </div>

        {/* Context sidebar */}
        <div className="space-y-4">
          <PrepCard icon={Target} title="Your objective">
            {kol.primary_objective ? (
              <RichTextView html={kol.primary_objective} />
            ) : (
              <p className="text-sm text-muted">No primary objective set on the Strategy tab.</p>
            )}
            {kol.areas_of_interest && (
              <div className="mt-3">
                <p className="mb-1 text-xs font-medium text-muted">Areas of interest</p>
                <RichTextView html={kol.areas_of_interest} />
              </div>
            )}
          </PrepCard>

          <PrepCard icon={ListChecks} title={`Open goals${openGoals.length ? ` (${openGoals.length})` : ""}`}>
            {openGoals.length === 0 ? (
              <p className="text-sm text-muted">No open quarterly goals.</p>
            ) : (
              <ul className="space-y-1.5">
                {openGoals.map((g) => (
                  <li key={g.id} className="flex items-start gap-2 text-sm">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
                    <span className="text-ink/90">
                      {g.goal} <span className="text-xs text-muted">· Q{g.quarter} {g.year}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </PrepCard>

          <PrepCard icon={CalendarClock} title="Last meeting">
            {last ? (
              <div className="space-y-2 text-sm">
                <p className="text-xs text-muted">
                  {last.date ? new Date(last.date).toLocaleDateString() : "—"}
                  {last.meeting_method ? ` · ${last.meeting_method.replace("_", " ")}` : ""}
                </p>
                {last.topics_discussed && (
                  <p><span className="font-medium">Discussed:</span> {last.topics_discussed}</p>
                )}
                {last.topics_missed && (
                  <p><span className="font-medium">To revisit:</span> {last.topics_missed}</p>
                )}
                {last.follow_up_actions && (
                  <p><span className="font-medium">Follow-ups:</span> {last.follow_up_actions}</p>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted">No prior meetings logged yet.</p>
            )}
          </PrepCard>
        </div>
      </div>
    </>
  );
}

function PrepCard({
  icon: Icon,
  title,
  hint,
  children,
}: {
  icon: React.ElementType;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-surface p-5 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]">
          <Icon size={15} />
        </span>
        <h2 className="text-sm font-semibold">{title}</h2>
        {hint && <span className="ml-auto text-[11px] text-muted">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

function List({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((t, i) => (
        <li key={i} className="flex gap-2 text-sm">
          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
          <span className="text-ink/90">{t}</span>
        </li>
      ))}
    </ul>
  );
}
