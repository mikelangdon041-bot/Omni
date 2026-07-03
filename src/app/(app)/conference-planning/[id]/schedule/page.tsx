"use client";

// Schedule tab: the day-column calendar plus filters ("my events", person,
// hide types, single-day pin), poster overlay, a list view, Who-Is-Where,
// per-person calendar export, and event create/edit via the form sheet.

import { useMemo, useState } from "react";
import {
  CalendarDays,
  Download,
  FileSpreadsheet,
  List,
  Plus,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/ui";
import { useConferenceCtx } from "@/components/conference/ConferenceContext";
import {
  useEvents,
  usePosters,
  type EventWithPeople,
} from "@/lib/conference/hooks";
import {
  ScheduleCalendar,
  buildPosterBlocks,
} from "@/components/conference/ScheduleCalendar";
import { EventFormModal } from "@/components/conference/EventFormModal";
import { EventPeek } from "@/components/conference/EventPeek";
import { ImportScheduleModal } from "@/components/conference/ImportScheduleModal";
import { PriorityPill } from "@/components/conference/Priority";
import {
  EVENT_TYPES,
  EVENT_TYPE_ORDER,
  type EventType,
} from "@/lib/conference/types";
import { buildICS, downloadICS } from "@/lib/conference/ics";
import {
  dateKeyInTz,
  fmtDayKey,
  fmtDayKeyLong,
  fmtTime,
  listDays,
} from "@/lib/conference/utils";
import { useRouter } from "next/navigation";

export default function SchedulePage() {
  const router = useRouter();
  const { conference, attendees, me, myAttendee } = useConferenceCtx();
  const { events, loading, save, remove } = useEvents(conference.id, me?.id);
  const { posters } = usePosters(conference.id);

  // Filters (persisted per conference).
  const [myOnly, setMyOnly] = usePersisted(`omni_conf_myonly_${conference.id}`, false);
  const [hiddenTypes, setHiddenTypes] = usePersisted<EventType[]>(
    `omni_conf_hidden_${conference.id}`,
    [],
  );
  const [showPosters, setShowPosters] = usePersisted(
    `omni_conf_posters_${conference.id}`,
    false,
  );
  const [personFilter, setPersonFilter] = useState<string>("all");
  const [dayFilter, setDayFilter] = useState<string | null>(null);
  const [view, setView] = useState<"calendar" | "list" | "who">("calendar");

  // Editing state.
  const [peek, setPeek] = useState<EventWithPeople | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<EventWithPeople | null>(null);
  const [createDay, setCreateDay] = useState<string | undefined>();
  const [createMin, setCreateMin] = useState<number | undefined>();

  const filtered = useMemo(() => {
    return events.filter((e) => {
      if (hiddenTypes.includes(e.event_type)) return false;
      if (myOnly && myAttendee) {
        const mine =
          e.assignments.some((a) => a.attendee_id === myAttendee.id) ||
          e.shifts.some((s) => s.attendee_id === myAttendee.id);
        if (!mine) return false;
      }
      if (personFilter !== "all") {
        const has =
          e.assignments.some((a) => a.attendee_id === personFilter) ||
          e.shifts.some((s) => s.attendee_id === personFilter);
        if (!has) return false;
      }
      return true;
    });
  }, [events, hiddenTypes, myOnly, myAttendee, personFilter]);

  const posterBlocks = useMemo(
    () => (showPosters ? buildPosterBlocks(posters, attendees, conference) : []),
    [showPosters, posters, attendees, conference],
  );

  const days = listDays(conference.start_date, conference.end_date);

  function exportPerson(attendeeId: string) {
    const a = attendees.find((x) => x.id === attendeeId);
    const theirs = events.filter(
      (e) =>
        e.assignments.some((x) => x.attendee_id === attendeeId) ||
        e.shifts.some((s) => s.attendee_id === attendeeId),
    );
    if (!theirs.length) {
      alert("No events assigned to this person yet.");
      return;
    }
    downloadICS(`${a?.name || "schedule"} — ${conference.name}`, buildICS(theirs, conference));
  }

  return (
    <div>
      {/* Filter row */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <FilterPill active={myOnly} onClick={() => setMyOnly(!myOnly)}>
          My events
        </FilterPill>
        <select
          value={personFilter}
          onChange={(e) => setPersonFilter(e.target.value)}
          className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium outline-none focus:border-[var(--accent)]"
        >
          <option value="all">Everyone</option>
          {attendees.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <select
          value={dayFilter || "all"}
          onChange={(e) => setDayFilter(e.target.value === "all" ? null : e.target.value)}
          className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium outline-none focus:border-[var(--accent)]"
        >
          <option value="all">All days</option>
          {days.map((d) => (
            <option key={d} value={d}>
              {fmtDayKey(d)}
            </option>
          ))}
        </select>
        <FilterPill active={showPosters} onClick={() => setShowPosters(!showPosters)}>
          📌 Posters
        </FilterPill>

        <span className="mx-1 hidden h-5 w-px bg-border sm:block" />
        {EVENT_TYPE_ORDER.map((t) => (
          <button
            key={t}
            onClick={() =>
              setHiddenTypes(
                hiddenTypes.includes(t)
                  ? hiddenTypes.filter((x) => x !== t)
                  : [...hiddenTypes, t],
              )
            }
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-medium transition",
              hiddenTypes.includes(t)
                ? "border-border bg-canvas text-muted line-through opacity-60"
                : "border-transparent text-white",
            )}
            style={hiddenTypes.includes(t) ? undefined : { background: EVENT_TYPES[t].color }}
            title={hiddenTypes.includes(t) ? "Show type" : "Hide type"}
          >
            {EVENT_TYPES[t].label}
          </button>
        ))}

        <span className="flex-1" />
        <div className="flex overflow-hidden rounded-lg border border-border">
          <ViewBtn active={view === "calendar"} onClick={() => setView("calendar")} title="Calendar">
            <CalendarDays size={15} />
          </ViewBtn>
          <ViewBtn active={view === "list"} onClick={() => setView("list")} title="List">
            <List size={15} />
          </ViewBtn>
          <ViewBtn active={view === "who"} onClick={() => setView("who")} title="Who is where">
            <UserRound size={15} />
          </ViewBtn>
        </div>
        <ExportMenu attendees={attendees} onExport={exportPerson} />
        <Button size="sm" variant="secondary" onClick={() => setImportOpen(true)}>
          <FileSpreadsheet size={15} /> Import
        </Button>
        <Button
          size="sm"
          onClick={() => {
            setEditing(null);
            setCreateDay(dayFilter || undefined);
            setCreateMin(undefined);
            setFormOpen(true);
          }}
        >
          <Plus size={15} /> Event
        </Button>
      </div>

      {loading ? (
        <p className="py-12 text-center text-sm text-muted">Loading schedule…</p>
      ) : view === "who" ? (
        <WhoIsWhere events={events} />
      ) : view === "list" ? (
        <ListView
          events={filtered}
          onTap={(e) => setPeek(e)}
          onDelete={async (e) => {
            if (confirm(`Delete "${e.title}"?`)) await remove(e.id);
          }}
        />
      ) : (
        <ScheduleCalendar
          conference={conference}
          events={filtered}
          posters={posterBlocks}
          attendees={attendees}
          dayFilter={dayFilter}
          onSlotTap={(day, minutes) => {
            setEditing(null);
            setCreateDay(day);
            setCreateMin(minutes);
            setFormOpen(true);
          }}
          onEventTap={(e) => setPeek(e)}
          onPosterTap={(p) =>
            router.push(`/conference-planning/${conference.id}/posters/${p.id}`)
          }
        />
      )}

      <EventPeek
        event={peek}
        onClose={() => setPeek(null)}
        onEdit={(e) => {
          setPeek(null);
          setEditing(e);
          setFormOpen(true);
        }}
        onDelete={async (e) => {
          setPeek(null);
          await remove(e.id);
        }}
      />

      <EventFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        event={editing}
        initialDay={createDay}
        initialMinutes={createMin}
        onSave={save}
      />

      <ImportScheduleModal open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  );
}

// ------------------------------------------------------------------

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1.5 text-xs font-medium transition",
        active
          ? "border-transparent bg-[var(--accent)] text-white"
          : "border-border bg-surface text-muted hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

function ViewBtn({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        "px-2.5 py-1.5",
        active ? "bg-[var(--accent)] text-white" : "bg-surface text-muted hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

function ExportMenu({
  attendees,
  onExport,
}: {
  attendees: { id: string; name: string }[];
  onExport: (attendeeId: string) => void;
}) {
  return (
    <div className="relative">
      <select
        value=""
        onChange={(e) => e.target.value && onExport(e.target.value)}
        className="w-9 cursor-pointer appearance-none rounded-lg border border-border bg-surface py-1.5 pl-2.5 text-transparent outline-none"
        title="Export a person's schedule (.ics)"
      >
        <option value="">Export schedule…</option>
        {attendees.map((a) => (
          <option key={a.id} value={a.id} className="text-ink">
            {a.name}
          </option>
        ))}
      </select>
      <Download
        size={15}
        className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
      />
    </div>
  );
}

// List view grouped by day (spec §7.11).
function ListView({
  events,
  onTap,
  onDelete,
}: {
  events: EventWithPeople[];
  onTap: (e: EventWithPeople) => void;
  onDelete: (e: EventWithPeople) => void;
}) {
  const { conference, attendees } = useConferenceCtx();
  const tz = conference.timezone;

  const groups = useMemo(() => {
    const map = new Map<string, EventWithPeople[]>();
    for (const e of events) {
      const key = dateKeyInTz(e.starts_at, tz);
      map.set(key, [...(map.get(key) || []), e]);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [events, tz]);

  if (groups.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border bg-surface px-6 py-12 text-center text-sm text-muted">
        No events match these filters.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {groups.map(([day, list]) => (
        <section key={day}>
          <h3 className="mb-2 text-sm font-semibold text-muted">{fmtDayKeyLong(day)}</h3>
          <div className="space-y-1.5">
            {list.map((e) => {
              const names = e.assignments
                .map((a) => attendees.find((x) => x.id === a.attendee_id)?.name?.split(" ")[0])
                .filter(Boolean);
              return (
                <div
                  key={e.id}
                  className="flex cursor-pointer items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 transition hover:shadow-sm"
                  onClick={() => onTap(e)}
                >
                  <span
                    className="h-8 w-1.5 shrink-0 rounded-full"
                    style={{ background: EVENT_TYPES[e.event_type].color }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{e.title}</p>
                    <p className="truncate text-xs text-muted">
                      {fmtTime(e.starts_at, tz)}–{fmtTime(e.ends_at, tz)}
                      {e.location && ` · ${e.location}`}
                      {names.length > 0 && ` · ${names.join(", ")}`}
                    </p>
                  </div>
                  <PriorityPill
                    suspected={e.suspected_priority}
                    confirmed={e.confirmed_priority}
                  />
                  <button
                    onClick={(ev) => {
                      ev.stopPropagation();
                      onDelete(e);
                    }}
                    className="rounded p-1 text-muted transition hover:text-red-600"
                    title="Delete"
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

// Who Is Where (spec §7.10): each person's current and next event.
function WhoIsWhere({ events }: { events: EventWithPeople[] }) {
  const { conference, attendees } = useConferenceCtx();
  const tz = conference.timezone;
  const [now] = useState(() => Date.now());

  const rows = useMemo(() => {
    return attendees
      .map((a) => {
        const theirs = events
          .filter(
            (e) =>
              e.assignments.some((x) => x.attendee_id === a.id) ||
              e.shifts.some((s) => s.attendee_id === a.id),
          )
          .sort((x, y) => x.starts_at.localeCompare(y.starts_at));
        const current = theirs.find(
          (e) => new Date(e.starts_at).getTime() <= now && now < new Date(e.ends_at).getTime(),
        );
        const next = theirs.find((e) => new Date(e.starts_at).getTime() > now);
        return { attendee: a, current, next, count: theirs.length };
      })
      .filter((r) => r.count > 0);
  }, [attendees, events, now]);

  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border bg-surface px-6 py-12 text-center text-sm text-muted">
        Nobody has assigned events yet.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {rows.map(({ attendee, current, next }) => (
        <div key={attendee.id} className="rounded-xl border border-border bg-surface p-4">
          <p className="flex items-center gap-2 font-semibold">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: attendee.color }} />
            {attendee.name}
          </p>
          <div className="mt-2 space-y-1.5 text-sm">
            {current ? (
              <p>
                <span className="mr-1.5 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                  NOW
                </span>
                {current.title}
                <span className="text-muted">
                  {" "}
                  · until {fmtTime(current.ends_at, tz)}
                  {current.location && ` · ${current.location}`}
                </span>
              </p>
            ) : (
              <p className="text-muted">Free right now</p>
            )}
            {next && (
              <p className="text-muted">
                <span className="mr-1.5 rounded-full bg-canvas px-2 py-0.5 text-[10px] font-bold">
                  NEXT
                </span>
                {next.title} · {fmtDayKey(dateKeyInTz(next.starts_at, tz))}{" "}
                {fmtTime(next.starts_at, tz)}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// localStorage-persisted state, keyed per conference (spec §18.9).
function usePersisted<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") return initial;
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  const set = (v: T) => {
    setValue(v);
    try {
      localStorage.setItem(key, JSON.stringify(v));
    } catch {
      // ignore
    }
  };
  return [value, set];
}
