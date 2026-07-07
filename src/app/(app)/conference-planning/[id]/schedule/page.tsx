"use client";

// Schedule tab: the day-column calendar plus filters ("my events", person,
// hide types, single-day pin), poster overlay, a list view, Who-Is-Where,
// per-person calendar export, and event create/edit via the form sheet.

import { useMemo, useState } from "react";
import { Loading } from "@/components/conference/Bits";
import {
  CalendarDays,
  Download,
  FileSpreadsheet,
  List,
  Plus,
  SlidersHorizontal,
  Trash2,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useConfirm, useToast } from "@/components/ui/Feedback";
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
  PRIORITIES,
  type EventType,
  type Priority,
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
  const confirm = useConfirm();
  const toast = useToast();
  const { conference, attendees, me, myAttendee } = useConferenceCtx();
  const {
    events,
    loading,
    save,
    remove,
    bulkUpdate,
    bulkRemove,
    bulkAssign,
    bulkUnassign,
  } = useEvents(conference.id, me?.id);
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
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Multi-select (list view) for bulk actions. Select mode is explicit: while
  // it's on, tapping anywhere on an event toggles it (no peek), and the bulk
  // bar stays visible even with nothing selected yet.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  function exitSelect() {
    setSelectMode(false);
    setSelectedIds(new Set());
  }

  function toggleSelected(id: string) {
    setSelectMode(true);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleMany(ids: string[]) {
    setSelectedIds((prev) => {
      const allIn = ids.every((id) => prev.has(id));
      const next = new Set(prev);
      ids.forEach((id) => (allIn ? next.delete(id) : next.add(id)));
      return next;
    });
  }

  async function bulkDelete() {
    const n = selectedIds.size;
    const ok = await confirm({
      title: `Delete ${n} event${n === 1 ? "" : "s"}?`,
      message: "They disappear from everyone's schedule. This can't be undone here.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await bulkRemove([...selectedIds]);
      exitSelect();
      toast("success", `Deleted ${n} event${n === 1 ? "" : "s"}.`);
    } catch (e) {
      toast("error", `Delete failed: ${(e as Error).message}`);
    }
  }

  // Editing state.
  const [peek, setPeek] = useState<EventWithPeople | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<EventWithPeople | null>(null);
  const [createDay, setCreateDay] = useState<string | undefined>();
  const [createMin, setCreateMin] = useState<number | undefined>();
  const [createEndMin, setCreateEndMin] = useState<number | undefined>();

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
      toast("info", "No events assigned to this person yet.");
      return;
    }
    downloadICS(`${a?.name || "schedule"} — ${conference.name}`, buildICS(theirs, conference));
  }

  const activeFilterCount =
    (myOnly ? 1 : 0) +
    (personFilter !== "all" ? 1 : 0) +
    (dayFilter ? 1 : 0) +
    (showPosters ? 1 : 0) +
    hiddenTypes.length;

  return (
    <div>
      {/* Primary toolbar — always visible, one row on phones */}
      <div className="mb-3 flex items-center gap-2">
        <button
          onClick={() => setFiltersOpen((v) => !v)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition sm:hidden",
            filtersOpen || activeFilterCount > 0
              ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
              : "border-border bg-surface text-muted",
          )}
        >
          <SlidersHorizontal size={14} />
          Filters
          {activeFilterCount > 0 && (
            <span className="grid h-4 min-w-4 place-items-center rounded-full bg-[var(--accent)] px-1 text-[10px] font-bold text-white">
              {activeFilterCount}
            </span>
          )}
        </button>
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
        {view === "list" && !selectMode && (
          <button
            onClick={() => setSelectMode(true)}
            className="rounded-lg border border-border bg-surface px-3 py-2 text-xs font-medium text-muted transition hover:border-[var(--accent)] hover:text-ink"
          >
            Select
          </button>
        )}
        <span className="flex-1" />
        <div className="hidden items-center gap-2 sm:flex">
          <ExportMenu attendees={attendees} onExport={exportPerson} />
          <Button size="sm" variant="secondary" onClick={() => setImportOpen(true)}>
            <FileSpreadsheet size={15} /> Import
          </Button>
        </div>
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

      {/* Filters — collapsible on phones, always visible from sm up */}
      <div
        className={cn(
          "mb-4 flex-wrap items-center gap-2",
          filtersOpen ? "flex" : "hidden sm:flex",
        )}
      >
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
        <div className="flex items-center gap-2 sm:hidden">
          <ExportMenu attendees={attendees} onExport={exportPerson} />
          <Button size="sm" variant="secondary" onClick={() => setImportOpen(true)}>
            <FileSpreadsheet size={15} /> Import
          </Button>
        </div>
      </div>

      {loading ? (
        <Loading />
      ) : view === "who" ? (
        <WhoIsWhere events={events} />
      ) : view === "list" ? (
        <>
          {/* Bulk actions — visible while selecting; tap events to build the batch */}
          {selectMode && (
            <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--accent)]/50 bg-[var(--accent-soft)]/60 px-3 py-2 text-sm">
              {selectedIds.size > 0 ? (
                <>
                  <span className="font-semibold text-[var(--accent)]">
                    {selectedIds.size} selected
                  </span>
                  <select
                    value=""
                    onChange={(e) => {
                      if (!e.target.value) return;
                      void bulkUpdate([...selectedIds], {
                        event_type: e.target.value as EventType,
                      })
                        .then(() => {
                          setSelectedIds(new Set());
                          toast("success", "Type updated.");
                        })
                        .catch((err: Error) =>
                          toast("error", `Update failed: ${err.message}`),
                        );
                    }}
                    className="rounded-md border border-[var(--accent)]/50 bg-surface px-2 py-1 text-xs font-semibold text-[var(--accent)] outline-none"
                  >
                    <option value="" disabled>
                      Type…
                    </option>
                    {EVENT_TYPE_ORDER.filter((t) => t !== "poster").map((t) => (
                      <option key={t} value={t}>
                        {EVENT_TYPES[t].label}
                      </option>
                    ))}
                  </select>
                  <select
                    value=""
                    onChange={(e) => {
                      if (!e.target.value) return;
                      const v =
                        e.target.value === "none" ? null : (e.target.value as Priority);
                      void bulkUpdate([...selectedIds], {
                        suspected_priority: v,
                        priority_set_by: me?.id || null,
                        priority_set_at: new Date().toISOString(),
                      })
                        .then(() => {
                          setSelectedIds(new Set());
                          toast("success", "Priority updated.");
                        })
                        .catch((err: Error) =>
                          toast("error", `Update failed: ${err.message}`),
                        );
                    }}
                    className="rounded-md border border-[var(--accent)]/50 bg-surface px-2 py-1 text-xs font-semibold text-[var(--accent)] outline-none"
                  >
                    <option value="" disabled>
                      Priority…
                    </option>
                    {(["high", "medium", "low"] as Priority[]).map((p) => (
                      <option key={p} value={p}>
                        {PRIORITIES[p].label}
                      </option>
                    ))}
                    <option value="none">Clear priority</option>
                  </select>
                  <select
                    value=""
                    onChange={(e) => {
                      if (!e.target.value) return;
                      void bulkAssign([...selectedIds], e.target.value)
                        .then(() => toast("success", "Added to the selected events."))
                        .catch((err: Error) =>
                          toast("error", `Assign failed: ${err.message}`),
                        );
                    }}
                    className="rounded-md border border-[var(--accent)]/50 bg-surface px-2 py-1 text-xs font-semibold text-[var(--accent)] outline-none"
                  >
                    <option value="" disabled>
                      ＋ Add person…
                    </option>
                    {attendees.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value=""
                    onChange={(e) => {
                      if (!e.target.value) return;
                      void bulkUnassign([...selectedIds], e.target.value)
                        .then(() => toast("success", "Removed from the selected events."))
                        .catch((err: Error) =>
                          toast("error", `Remove failed: ${err.message}`),
                        );
                    }}
                    className="rounded-md border border-border bg-surface px-2 py-1 text-xs font-medium text-muted outline-none"
                  >
                    <option value="" disabled>
                      − Remove person…
                    </option>
                    {attendees.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => void bulkDelete()}
                    className="inline-flex items-center gap-1 rounded-md border border-red-300 bg-surface px-2 py-1 text-xs font-semibold text-red-600 transition hover:bg-red-50"
                  >
                    <Trash2 size={12} /> Delete
                  </button>
                </>
              ) : (
                <span className="text-xs text-muted">
                  Tap events to select them — then set type, priority, people, or
                  delete in one go.
                </span>
              )}
              <span className="flex-1" />
              <button
                onClick={() => setSelectedIds(new Set(filtered.map((e) => e.id)))}
                className="rounded-md border border-border bg-surface px-2 py-1 text-[11px] font-medium transition hover:border-[var(--accent)]"
              >
                Select all shown
              </button>
              <button
                onClick={exitSelect}
                className="rounded-md border border-border bg-surface px-2 py-1 text-[11px] font-semibold transition hover:border-[var(--accent)]"
              >
                Done
              </button>
            </div>
          )}
          <ListView
            events={filtered}
            selectMode={selectMode}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelected}
            onToggleDay={toggleMany}
            onEnterSelect={() => setSelectMode(true)}
            onTap={(e) => setPeek(e)}
            onDelete={async (e) => {
              const ok = await confirm({
                title: `Delete "${e.title}"?`,
                message: "It disappears from everyone's schedule.",
                confirmLabel: "Delete",
                danger: true,
              });
              if (ok) await remove(e.id);
            }}
          />
        </>
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
            setCreateEndMin(undefined);
            setFormOpen(true);
          }}
          onRangeSelect={(day, startMin, endMin) => {
            setEditing(null);
            setCreateDay(day);
            setCreateMin(startMin);
            setCreateEndMin(endMin);
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
        initialEndMinutes={createEndMin}
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

// List view grouped by day (spec §7.11), with multi-select for bulk actions.
function ListView({
  events,
  selectMode,
  selectedIds,
  onToggleSelect,
  onToggleDay,
  onEnterSelect,
  onTap,
  onDelete,
}: {
  events: EventWithPeople[];
  selectMode: boolean;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleDay: (ids: string[]) => void;
  onEnterSelect: () => void;
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
          <div className="mb-2 flex items-center gap-2">
            <h3 className="text-sm font-semibold text-muted">{fmtDayKeyLong(day)}</h3>
            <span className="flex-1" />
            {selectMode ? (
              <button
                onClick={() => onToggleDay(list.map((e) => e.id))}
                title="Add or remove this whole day from the selection"
                className={cn(
                  "rounded-md border px-2 py-1 text-[11px] font-medium transition",
                  list.every((e) => selectedIds.has(e.id))
                    ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                    : "border-border bg-surface hover:border-[var(--accent)]",
                )}
              >
                {list.every((e) => selectedIds.has(e.id)) ? "Deselect day" : "Select day"}
              </button>
            ) : (
              <button
                onClick={onEnterSelect}
                title="Start selecting events for bulk actions"
                className="rounded-md border border-border bg-surface px-2 py-1 text-[11px] font-medium text-muted transition hover:border-[var(--accent)] hover:text-ink"
              >
                Select
              </button>
            )}
          </div>
          <div className="space-y-1.5">
            {list.map((e) => {
              const names = e.assignments
                .map((a) => attendees.find((x) => x.id === a.attendee_id)?.name?.split(" ")[0])
                .filter(Boolean);
              const sel = selectedIds.has(e.id);
              return (
                <div
                  key={e.id}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-xl border bg-surface px-4 py-3 transition hover:shadow-sm",
                    sel
                      ? "border-[var(--accent)] ring-1 ring-[var(--accent)]/40"
                      : "border-border",
                  )}
                  // In select mode the whole card is a select target; otherwise
                  // tapping opens the event peek as before.
                  onClick={() => (selectMode ? onToggleSelect(e.id) : onTap(e))}
                >
                  <button
                    onClick={(ev) => {
                      ev.stopPropagation();
                      onToggleSelect(e.id);
                    }}
                    title={sel ? "Remove from selection" : "Select for bulk actions"}
                    className={cn(
                      "grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[11px] font-bold transition",
                      sel
                        ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                        : "border-border bg-surface text-transparent hover:border-[var(--accent)]",
                    )}
                  >
                    ✓
                  </button>
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
                    className="rounded p-1.5 text-muted transition hover:text-red-600"
                    title="Delete"
                  >
                    <Trash2 size={14} />
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
