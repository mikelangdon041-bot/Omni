"use client";

import { useCallback, useState } from "react";
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
  ChevronDown,
} from "lucide-react";
import { BackButton } from "@/components/BackButton";
import { useKOL, useQuarterlyGoals, useMeetings } from "@/lib/territory/hooks";
import {
  METHOD_LABELS,
  RELATIONSHIP_COLORS,
  RELATIONSHIP_LABELS,
  cn,
  kolFullName,
  kolInitials,
} from "@/lib/territory/utils";
import type { MeetingPrep as Prep } from "@/lib/territory/ai";
import type { Meeting } from "@/lib/territory/types";
import { Badge } from "@/components/territory/ui/Badge";
import { EngagementRing } from "@/components/territory/ui/EngagementRing";
import { RichTextView, TextView } from "@/components/ui/RichText";

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
            Your strategy, goals, and meeting history — nothing is sent to the AI
            until you press the button.
          </p>
          {prep && (
            <button
              onClick={generate}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-ink transition hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-60"
            >
              <RefreshCw size={13} className={busy ? "animate-spin" : ""} /> {busy ? "Thinking…" : "Regenerate"}
            </button>
          )}
        </div>
      </div>

      {error && (
        <p className="mb-4 rounded-lg border border-status-error/30 bg-status-error/5 px-4 py-2 text-sm text-status-error">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.5fr_1fr]">
        {/* AI prep — only runs when explicitly requested */}
        <div className="space-y-4">
          {!prep && !busy ? (
            <div className="grid place-items-center gap-3 rounded-xl border border-border bg-surface py-14 text-center shadow-sm">
              <Sparkles size={22} className="text-[var(--accent)]" />
              <div>
                <p className="text-sm font-medium">AI insight</p>
                <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
                  Sends this KOL&apos;s strategy, open goals, and meeting history
                  to the AI and returns an opener, talking points, and follow-ups.
                </p>
              </div>
              <button
                onClick={generate}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
              >
                <Sparkles size={15} /> Generate AI insight
              </button>
            </div>
          ) : busy && !prep ? (
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
            {kol.potential_collaborations && (
              <div className="mt-3">
                <p className="mb-1 text-xs font-medium text-muted">Potential collaborations</p>
                <RichTextView html={kol.potential_collaborations} />
              </div>
            )}
            {kol.interested_in_trials && (
              <div className="mt-3">
                <p className="mb-1 text-xs font-medium text-muted">Interest in clinical trials</p>
                {kol.trials_interest_notes ? (
                  <RichTextView html={kol.trials_interest_notes} />
                ) : (
                  <p className="text-sm text-ink/90">Interested — no details noted yet.</p>
                )}
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

          <PrepCard
            icon={CalendarClock}
            title={`Meetings${meetings.length ? ` (${meetings.length})` : ""}`}
            hint={meetings.length > 1 ? "Tap to expand" : undefined}
          >
            {meetings.length === 0 ? (
              <p className="text-sm text-muted">No prior meetings logged yet.</p>
            ) : (
              <div className="space-y-2">
                {meetings.map((m, i) => (
                  <MeetingHistoryItem key={m.id} meeting={m} defaultOpen={i === 0} />
                ))}
              </div>
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

// One past meeting, collapsible. The latest starts expanded.
function MeetingHistoryItem({
  meeting: m,
  defaultOpen,
}: {
  meeting: Meeting;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className="rounded-lg border border-border">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm"
      >
        <span className="font-medium">Meeting #{m.meeting_number}</span>
        <span className="flex items-center gap-2 text-xs text-muted">
          {new Date(m.date).toLocaleDateString()}
          {m.meeting_method && ` · ${METHOD_LABELS[m.meeting_method] || m.meeting_method}`}
          <ChevronDown
            size={14}
            className={cn("transition-transform", open && "rotate-180")}
          />
        </span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-border px-3 py-2.5 text-sm">
          {m.topics_discussed && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted">Discussed</p>
              <TextView value={m.topics_discussed} />
            </div>
          )}
          {m.topics_missed && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted">To revisit</p>
              <TextView value={m.topics_missed} />
            </div>
          )}
          {m.follow_up_actions && (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted">Follow-ups</p>
              <TextView value={m.follow_up_actions} />
            </div>
          )}
          {!m.topics_discussed && !m.topics_missed && !m.follow_up_actions && (
            <p className="text-muted">No notes recorded.</p>
          )}
        </div>
      )}
    </div>
  );
}
