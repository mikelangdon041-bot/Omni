"use client";

// Daily recap (spec §9.9): per day (and optionally per person), everything
// captured — sessions with notes, contact meetings, covered posters, and
// standalone insights — priority-ranked, with links back to each item.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Landmark, Mic2, NotebookPen, Sparkles } from "lucide-react";
import { cn } from "@/lib/ui";
import { useConferenceCtx } from "@/components/conference/ConferenceContext";
import {
  useEvents,
  useInsights,
  usePosters,
} from "@/lib/conference/hooks";
import { PriorityPill } from "@/components/conference/Priority";
import {
  SESSION_TYPES,
  priorityRank,
  type ContactMeeting,
  type DailySummary,
} from "@/lib/conference/types";
import {
  dateKeyInTz,
  fmtDayKey,
  fmtDayKeyLong,
  fmtTime,
  listDays,
  normalizeFreeDate,
  todayKey,
} from "@/lib/conference/utils";

const supabase = createClient();

export default function RecapPage() {
  const { conference, attendees, me } = useConferenceCtx();
  const { events } = useEvents(conference.id, me?.id);
  const { posters } = usePosters(conference.id);
  const { parents, childrenOf } = useInsights(conference.id);
  const tz = conference.timezone;
  const confYear = Number(conference.start_date.slice(0, 4)) || new Date().getFullYear();

  const days = listDays(conference.start_date, conference.end_date);
  const today = todayKey(tz);
  const [day, setDay] = useState(days.includes(today) ? today : days[0] || today);
  const [person, setPerson] = useState("all");
  const [meetings, setMeetings] = useState<ContactMeeting[]>([]);
  const [contactNames, setContactNames] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState<DailySummary | null>(null);

  // Contact meetings + names + stored daily summary for the chosen day.
  useEffect(() => {
    let active = true;
    (async () => {
      const [mRes, sRes] = await Promise.all([
        supabase
          .from("conf_contact_meetings")
          .select("*")
          .eq("conference_id", conference.id)
          .eq("meeting_date", day),
        supabase
          .from("conf_daily_summaries")
          .select("*")
          .eq("conference_id", conference.id)
          .eq("date", day)
          .maybeSingle(),
      ]);
      if (!active) return;
      const ms = (mRes.data as ContactMeeting[]) || [];
      setMeetings(ms);
      setSummary((sRes.data as DailySummary) || null);
      const ids = [...new Set(ms.map((m) => m.contact_id))];
      if (ids.length) {
        const { data } = await supabase
          .from("conf_contacts")
          .select("id, name")
          .in("id", ids);
        if (active && data) {
          setContactNames(Object.fromEntries(data.map((c) => [c.id, c.name])));
        }
      } else {
        setContactNames({});
      }
    })();
    return () => {
      active = false;
    };
  }, [conference.id, day]);

  const personAttendee = attendees.find((a) => a.id === person) || null;

  const daySessions = useMemo(
    () =>
      events
        .filter(
          (e) =>
            dateKeyInTz(e.starts_at, tz) === day &&
            (SESSION_TYPES.includes(e.event_type) ||
              (e.event_type === "custom" && e.show_in_sessions)),
        )
        .filter(
          (e) =>
            person === "all" ||
            e.assignments.some((a) => a.attendee_id === person),
        )
        .sort(
          (a, b) =>
            priorityRank(a.suspected_priority, a.confirmed_priority) -
              priorityRank(b.suspected_priority, b.confirmed_priority) ||
            a.starts_at.localeCompare(b.starts_at),
        ),
    [events, tz, day, person],
  );

  const dayPosters = useMemo(
    () =>
      posters
        .filter((p) => !p.parent_id && normalizeFreeDate(p.date, confYear) === day)
        .filter(
          (p) => person === "all" || p.reps.some((r) => r.attendee_id === person),
        )
        .sort(
          (a, b) =>
            priorityRank(a.suspected_priority, a.confirmed_priority) -
            priorityRank(b.suspected_priority, b.confirmed_priority),
        ),
    [posters, confYear, day, person],
  );

  const dayInsights = useMemo(() => {
    const eventDay = new Map(events.map((e) => [e.id, dateKeyInTz(e.starts_at, tz)]));
    const posterDay = new Map(
      posters.map((p) => [p.id, normalizeFreeDate(p.date, confYear) || ""]),
    );
    return parents
      .filter((i) => {
        const d = i.event_id
          ? eventDay.get(i.event_id)
          : i.poster_id
            ? posterDay.get(i.poster_id)
            : i.insight_date || dateKeyInTz(i.created_at, tz);
        if (d !== day) return false;
        if (person !== "all" && personAttendee?.user_id !== i.user_id) return false;
        return true;
      })
      .sort(
        (a, b) =>
          priorityRank(a.suspected_priority, a.confirmed_priority) -
          priorityRank(b.suspected_priority, b.confirmed_priority),
      );
  }, [parents, events, posters, tz, confYear, day, person, personAttendee]);

  const base = `/conference-planning/${conference.id}`;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1.5 overflow-x-auto">
          {days.map((d) => (
            <button
              key={d}
              onClick={() => setDay(d)}
              className={cn(
                "shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-medium transition",
                day === d
                  ? "border-transparent bg-[var(--accent)] text-white"
                  : "border-border bg-surface text-muted hover:text-ink",
              )}
            >
              {fmtDayKey(d)}
            </button>
          ))}
        </div>
        <span className="flex-1" />
        <select
          value={person}
          onChange={(e) => setPerson(e.target.value)}
          className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium outline-none focus:border-[var(--accent)]"
        >
          <option value="all">Whole team</option>
          {attendees.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>

      <h1 className="text-lg font-bold tracking-tight">
        {fmtDayKeyLong(day)}
        {personAttendee ? ` — ${personAttendee.name}` : ""}
      </h1>

      {summary?.content && (
        <section className="rounded-xl border border-border bg-surface p-5">
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted">
            <Sparkles size={14} /> AI daily summary
          </h2>
          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-ink/90">
            {summary.content}
          </pre>
        </section>
      )}

      <RecapSection
        icon={<Mic2 size={14} />}
        title={`Sessions (${daySessions.length})`}
      >
        {daySessions.map((e) => (
          <Link
            key={e.id}
            href={`${base}/sessions/${e.id}`}
            className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5 text-sm transition hover:bg-canvas"
          >
            <span className="min-w-0 flex-1">
              <span className="font-medium">{e.title}</span>
              <span className="text-muted">
                {" "}
                · {fmtTime(e.starts_at, tz)}
                {e.location && ` · ${e.location}`}
              </span>
            </span>
            <PriorityPill suspected={e.suspected_priority} confirmed={e.confirmed_priority} />
          </Link>
        ))}
      </RecapSection>

      <RecapSection
        icon={<Landmark size={14} />}
        title={`KOL meetings (${meetings.length})`}
      >
        {meetings.map((m) => (
          <Link
            key={m.id}
            href={`${base}/contacts/${m.contact_id}?meeting=${m.id}`}
            className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5 text-sm transition hover:bg-canvas"
          >
            <span className="min-w-0 flex-1">
              <span className="font-medium">{contactNames[m.contact_id] || "Contact"}</span>
              <span className="text-muted">
                {m.meeting_time && ` · ${m.meeting_time}`}
                {m.location && ` · ${m.location}`}
              </span>
            </span>
          </Link>
        ))}
      </RecapSection>

      <RecapSection
        icon={<NotebookPen size={14} />}
        title={`Posters (${dayPosters.length})`}
      >
        {dayPosters.map((p) => (
          <Link
            key={p.id}
            href={`${base}/posters/${p.id}`}
            className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5 text-sm transition hover:bg-canvas"
          >
            <span className="min-w-0 flex-1 truncate font-medium">{p.title}</span>
            <PriorityPill suspected={p.suspected_priority} confirmed={p.confirmed_priority} />
          </Link>
        ))}
      </RecapSection>

      <RecapSection
        icon={<Sparkles size={14} />}
        title={`Insights (${dayInsights.length})`}
      >
        {dayInsights.map((i) => (
          <div key={i.id} className="rounded-lg border border-border px-3 py-2.5">
            <div className="flex items-center gap-2">
              <p className="min-w-0 flex-1 text-sm font-medium">{i.title}</p>
              <PriorityPill suspected={i.suspected_priority} confirmed={i.confirmed_priority} />
            </div>
            {childrenOf(i.id).length > 0 && (
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-muted">
                {childrenOf(i.id).map((c) => (
                  <li key={c.id}>{c.title}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </RecapSection>
    </div>
  );
}

function RecapSection({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  const empty = !children || (Array.isArray(children) && children.length === 0);
  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-muted">
        {icon} {title}
      </h2>
      {empty ? (
        <p className="text-sm text-muted">Nothing captured.</p>
      ) : (
        <div className="space-y-1.5">{children}</div>
      )}
    </section>
  );
}
