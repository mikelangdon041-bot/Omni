"use client";

// Outlook-style day-column calendar (spec §7): 30-minute grid, 3 visible days
// on phones / 5 on desktop, cluster-based side-by-side overlap layout, a live
// "now" line computed in the conference's timezone, zoom, booth shift bands,
// priority bars, and an optional poster overlay.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Lock, Minus, Plus } from "lucide-react";
import { cn } from "@/lib/ui";
import { layoutOverlaps } from "@/lib/conference/layout";
import {
  EVENT_TYPES,
  EVENT_TYPE_ORDER,
  PRIORITIES,
  resolvePriority,
  type Attendee,
  type Conference,
  type Poster,
} from "@/lib/conference/types";
import type { EventWithPeople } from "@/lib/conference/hooks";
import {
  addDaysKey,
  dateKeyInTz,
  firstName,
  fmtDayKey,
  fmtTime,
  listDays,
  minutesInTz,
  normalizeFreeDate,
  parseFreeTime,
  todayKey,
} from "@/lib/conference/utils";

const MIN_SLOT = 24; // px per 30 min
const MAX_SLOT = 72;
const MIN_EVENT_PX = 22;

export interface PosterBlock {
  poster: Poster;
  dayKey: string;
  startMin: number;
  repName: string;
}

export function ScheduleCalendar({
  conference,
  events,
  posters,
  attendees,
  showPriorityBar = true,
  dayFilter,
  onSlotTap,
  onEventTap,
  onPosterTap,
}: {
  conference: Conference;
  events: EventWithPeople[];
  posters: PosterBlock[]; // pre-filtered overlay posters (empty = overlay off)
  attendees: Attendee[];
  showPriorityBar?: boolean;
  dayFilter: string | null; // pin to one day
  onSlotTap: (dayKey: string, minutes: number) => void;
  onEventTap: (event: EventWithPeople) => void;
  onPosterTap: (poster: Poster) => void;
}) {
  const tz = conference.timezone;

  // Zoom (persisted per conference).
  const zoomKey = `omni_conf_zoom_${conference.id}`;
  const [slotH, setSlotH] = useState(36);
  useEffect(() => {
    const saved = Number(localStorage.getItem(zoomKey));
    if (saved >= MIN_SLOT && saved <= MAX_SLOT) setSlotH(saved);
  }, [zoomKey]);
  const zoom = (dir: 1 | -1) => {
    setSlotH((h) => {
      const next = Math.min(MAX_SLOT, Math.max(MIN_SLOT, h + dir * 6));
      localStorage.setItem(zoomKey, String(next));
      return next;
    });
  };
  const pxPerMin = slotH / 30;

  // Visible day-window width: 3 on phones, 5 on desktop.
  const [windowSize, setWindowSize] = useState(3);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const apply = () => setWindowSize(mq.matches ? 5 : 3);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // Day range: conference start..end, auto-expanded up to 7 days either side
  // when events actually fall outside (ignoring wildly-wrong years).
  const days = useMemo(() => {
    let start = conference.start_date;
    let end = conference.end_date;
    const confYear = Number(conference.start_date.slice(0, 4));
    const minKey = addDaysKey(conference.start_date, -7);
    const maxKey = addDaysKey(conference.end_date, 7);
    for (const e of events) {
      const key = dateKeyInTz(e.starts_at, tz);
      if (!key) continue;
      const y = Number(key.slice(0, 4));
      if (Math.abs(y - confYear) > 1) continue; // data-entry typo
      if (key < start && key >= minKey) start = key;
      if (key > end && key <= maxKey) end = key;
    }
    return listDays(start, end);
  }, [conference.start_date, conference.end_date, events, tz]);

  const shownDays = useMemo(
    () => (dayFilter ? [dayFilter] : days),
    [dayFilter, days],
  );
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(shownDays.length / windowSize));
  // Clamp the last page so a full window always shows.
  const pageStart = Math.min(page * windowSize, Math.max(0, shownDays.length - windowSize));
  const visible = shownDays.slice(pageStart, pageStart + windowSize);

  // Land on today's page when the conference is live.
  const today = todayKey(tz);
  const landed = useRef(false);
  useEffect(() => {
    if (landed.current || dayFilter) return;
    const idx = shownDays.indexOf(today);
    if (idx >= 0) setPage(Math.floor(idx / windowSize));
    landed.current = true;
  }, [shownDays, today, windowSize, dayFilter]);

  // Now line ticks every minute (event-timezone minutes).
  const [nowMin, setNowMin] = useState(() => minutesInTz(new Date(), tz));
  useEffect(() => {
    const t = setInterval(() => setNowMin(minutesInTz(new Date(), tz)), 60_000);
    return () => clearInterval(t);
  }, [tz]);

  // Bucket events / posters by visible day.
  const byDay = useMemo(() => {
    const map = new Map<string, EventWithPeople[]>();
    for (const e of events) {
      const key = dateKeyInTz(e.starts_at, tz);
      if (!key) continue;
      map.set(key, [...(map.get(key) || []), e]);
    }
    return map;
  }, [events, tz]);

  const postersByDay = useMemo(() => {
    const map = new Map<string, PosterBlock[]>();
    for (const p of posters) {
      map.set(p.dayKey, [...(map.get(p.dayKey) || []), p]);
    }
    return map;
  }, [posters]);

  const attendeeName = useCallback(
    (id: string | null) => attendees.find((a) => a.id === id)?.name || "",
    [attendees],
  );

  const typeRank = (t: string) => {
    const i = EVENT_TYPE_ORDER.indexOf(t as (typeof EVENT_TYPE_ORDER)[number]);
    return i === -1 ? 99 : i;
  };

  const gridHeight = 24 * 60 * pxPerMin;

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
      {/* Header: paging + day labels + zoom */}
      <div className="flex items-center border-b border-border bg-canvas/60">
        <div className="flex w-12 shrink-0 flex-col items-center gap-0.5 py-1.5">
          <button
            onClick={() => zoom(1)}
            className="rounded p-0.5 text-muted hover:bg-surface hover:text-ink"
            title="Zoom in"
          >
            <Plus size={13} />
          </button>
          <button
            onClick={() => zoom(-1)}
            className="rounded p-0.5 text-muted hover:bg-surface hover:text-ink"
            title="Zoom out"
          >
            <Minus size={13} />
          </button>
        </div>
        <button
          onClick={() => setPage((p) => Math.max(0, p - 1))}
          disabled={pageStart === 0}
          className="p-2 text-muted transition hover:text-ink disabled:opacity-30"
          title="Earlier days"
        >
          <ChevronLeft size={16} />
        </button>
        <div className="grid flex-1" style={{ gridTemplateColumns: `repeat(${visible.length}, 1fr)` }}>
          {visible.map((d) => (
            <div
              key={d}
              className={cn(
                "border-l border-border px-1 py-2 text-center text-xs font-semibold",
                d === today ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "text-ink",
              )}
            >
              {fmtDayKey(d)}
            </div>
          ))}
        </div>
        <button
          onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
          disabled={pageStart + windowSize >= shownDays.length}
          className="p-2 text-muted transition hover:text-ink disabled:opacity-30"
          title="Later days"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {/* Grid */}
      <div className="max-h-[70vh] overflow-y-auto">
        <div className="flex" style={{ height: gridHeight }}>
          {/* Time axis */}
          <div className="relative w-12 shrink-0">
            {Array.from({ length: 24 }, (_, h) => (
              <div
                key={h}
                className="absolute right-1.5 -translate-y-1/2 text-[10px] text-muted"
                style={{ top: h * 60 * pxPerMin }}
              >
                {h === 0 ? "" : `${((h + 11) % 12) + 1}${h < 12 ? "am" : "pm"}`}
              </div>
            ))}
          </div>

          {visible.map((dayKey) => {
            const dayEvents = byDay.get(dayKey) || [];
            const laid = layoutOverlaps(
              dayEvents.map((e) => {
                const start = minutesInTz(e.starts_at, tz);
                const rawEnd = minutesInTz(e.ends_at, tz);
                // Events crossing midnight (or zero-length) clamp within the day.
                const end = rawEnd > start ? rawEnd : Math.min(start + 30, 24 * 60);
                return { start, end, typeRank: typeRank(e.event_type), event: e };
              }),
            );
            const dayPosters = postersByDay.get(dayKey) || [];

            return (
              <div key={dayKey} className="relative flex-1 border-l border-border">
                {/* Slot lines + tap targets */}
                {Array.from({ length: 48 }, (_, i) => (
                  <div
                    key={i}
                    onClick={() => onSlotTap(dayKey, i * 30)}
                    className={cn(
                      "absolute inset-x-0 cursor-pointer transition hover:bg-[var(--accent-soft)]/40",
                      i % 2 === 0 ? "border-t border-border/70" : "border-t border-border/30",
                    )}
                    style={{ top: i * 30 * pxPerMin, height: 30 * pxPerMin }}
                  />
                ))}

                {/* Today shading + now line */}
                {dayKey === today && (
                  <>
                    <div className="pointer-events-none absolute inset-0 bg-[var(--accent)]/[0.03]" />
                    <div
                      className="pointer-events-none absolute inset-x-0 z-20"
                      style={{ top: nowMin * pxPerMin }}
                    >
                      <div className="relative border-t-2 border-red-500">
                        <span className="absolute -left-1 -top-[5px] h-2 w-2 rounded-full bg-red-500" />
                      </div>
                    </div>
                  </>
                )}

                {/* Event blocks */}
                {laid.map(({ item, col, cols }) => {
                  const e = item.event;
                  const top = item.start * pxPerMin;
                  const height = Math.max((item.end - item.start) * pxPerMin, MIN_EVENT_PX);
                  const type = EVENT_TYPES[e.event_type];
                  const resolved = resolvePriority(e.suspected_priority, e.confirmed_priority);
                  const overlapping = cols > 1;
                  const isBooth = e.event_type === "booth";

                  const assigneeNames = e.assignments
                    .map((a) => firstName(attendeeName(a.attendee_id)))
                    .filter(Boolean);

                  // Booth: merge people sharing a time range into bands.
                  const bands = isBooth
                    ? mergeShiftBands(
                        e.shifts.map((s) => ({
                          start: minutesInTz(s.starts_at, tz),
                          end: minutesInTz(s.ends_at, tz),
                          name: s.attendee_id
                            ? firstName(attendeeName(s.attendee_id)) || "?"
                            : "Open",
                        })),
                      )
                    : [];

                  return (
                    <button
                      key={e.id}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        onEventTap(e);
                      }}
                      className={cn(
                        "absolute z-10 flex flex-col overflow-hidden rounded-md px-1.5 py-1 text-left text-white",
                        overlapping && "shadow-md ring-1 ring-inset ring-white/40",
                      )}
                      style={{
                        top,
                        height,
                        left: `calc(${(col / cols) * 100}% + 2px)`,
                        width: `calc(${(1 / cols) * 100}% - 4px)`,
                        background: type.color,
                      }}
                      title={e.title}
                    >
                      <p className="flex items-center gap-1 truncate text-[11px] font-semibold leading-tight">
                        {e.is_private && <Lock size={9} className="shrink-0" />}
                        {isBooth ? "Booth" : e.title}
                      </p>
                      {height > 34 && !isBooth && (
                        <p className="truncate text-[10px] leading-tight opacity-90">
                          {assigneeNames.length ? assigneeNames.join(", ") : "Unassigned"}
                        </p>
                      )}
                      {height > 48 && (
                        <p className="truncate text-[10px] leading-tight opacity-75">
                          {fmtTime(e.starts_at, tz)}–{fmtTime(e.ends_at, tz)}
                          {e.location ? ` · ${e.location}` : ""}
                        </p>
                      )}
                      {isBooth && height > 40 && (
                        <div className="mt-0.5 min-h-0 flex-1 overflow-hidden">
                          {bands.map((b, i) => (
                            <div
                              key={i}
                              className={cn(
                                "truncate border-white/30 text-[10px] leading-tight",
                                i > 0 && "border-t border-dashed",
                                i % 2 === 1 && "bg-white/10",
                              )}
                            >
                              {b.names.join(", ")} · {fmtMin(b.start)}–{fmtMin(b.end)}
                            </div>
                          ))}
                        </div>
                      )}
                      <span className="flex-1" />
                      {showPriorityBar &&
                        resolved &&
                        !isBooth &&
                        e.event_type !== "contact_meeting" &&
                        height > 30 && (
                          <span
                            className="-mx-1.5 -mb-1 block px-1.5 text-[9px] font-bold uppercase tracking-wide"
                            style={{ background: PRIORITIES[resolved].color }}
                          >
                            {PRIORITIES[resolved].label}
                          </span>
                        )}
                    </button>
                  );
                })}

                {/* Poster overlay (short blocks) */}
                {dayPosters.map((p) => {
                  const top = p.startMin * pxPerMin;
                  return (
                    <button
                      key={p.poster.id}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        onPosterTap(p.poster);
                      }}
                      className="absolute inset-x-1 z-10 truncate rounded-md border border-amber-500/40 px-1.5 py-0.5 text-left text-[10px] font-medium"
                      style={{
                        top,
                        height: Math.max(15 * pxPerMin, 18),
                        background: EVENT_TYPES.poster.soft,
                        color: "#92400e",
                      }}
                      title={p.poster.title}
                    >
                      📌 {p.poster.session_label || p.poster.title}
                      {p.repName ? ` · ${p.repName}` : ""}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function fmtMin(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const ap = h < 12 ? "a" : "p";
  const hh = ((h + 11) % 12) + 1;
  return m ? `${hh}:${String(m).padStart(2, "0")}${ap}` : `${hh}${ap}`;
}

// People sharing the same time range merge into one comma-separated band;
// distinct ranges stack ordered by start then longest-first (spec §7.4).
function mergeShiftBands(
  shifts: { start: number; end: number; name: string }[],
): { start: number; end: number; names: string[] }[] {
  const map = new Map<string, { start: number; end: number; names: string[] }>();
  for (const s of shifts) {
    const key = `${s.start}-${s.end}`;
    const cur = map.get(key);
    if (cur) cur.names.push(s.name);
    else map.set(key, { start: s.start, end: s.end, names: [s.name] });
  }
  return [...map.values()].sort(
    (a, b) => a.start - b.start || b.end - b.start - (a.end - a.start),
  );
}

// Build the overlay blocks from posters (free-text date/time — guarded).
export function buildPosterBlocks(
  posters: (Poster & { reps: { attendee_id: string }[] })[],
  attendees: Attendee[],
  conference: Conference,
): PosterBlock[] {
  const confYear = Number(conference.start_date.slice(0, 4)) || new Date().getFullYear();
  const out: PosterBlock[] = [];
  for (const p of posters) {
    if (p.parent_id) continue; // sub-posters show via their session
    const dayKey = normalizeFreeDate(p.date, confYear);
    if (!dayKey) continue;
    const startMin = parseFreeTime(p.time) ?? 9 * 60;
    const rep = p.reps[0]
      ? attendees.find((a) => a.id === p.reps[0].attendee_id)?.name || ""
      : "";
    out.push({ poster: p, dayKey, startMin, repName: firstName(rep) });
  }
  return out;
}
