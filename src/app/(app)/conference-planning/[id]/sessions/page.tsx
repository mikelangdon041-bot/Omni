"use client";

// Sessions list (spec §21.1): all session-type events (plus custom events
// flagged "include in sessions"), grouped by day with collapsible headers.
// Past days auto-collapse while the conference is ongoing; searching
// force-expands all days; the query mirrors into the URL so Back restores it.

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { cn } from "@/lib/ui";
import { useConferenceCtx } from "@/components/conference/ConferenceContext";
import { useEvents, type EventWithPeople } from "@/lib/conference/hooks";
import { EventFormModal } from "@/components/conference/EventFormModal";
import { PriorityPill } from "@/components/conference/Priority";
import { EVENT_TYPES, SESSION_TYPES } from "@/lib/conference/types";
import {
  dateKeyInTz,
  fmtDayKeyLong,
  fmtTime,
  todayKey,
} from "@/lib/conference/utils";

export default function SessionsPage() {
  const router = useRouter();
  const { conference, attendees, me } = useConferenceCtx();
  const { events, loading, save, remove } = useEvents(conference.id, me?.id);
  const tz = conference.timezone;
  const today = todayKey(tz);

  // Read the initial query from the URL so Back from a session restores it.
  const [search, setSearch] = useState(() =>
    typeof window === "undefined"
      ? ""
      : new URLSearchParams(window.location.search).get("q") || "",
  );
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [formOpen, setFormOpen] = useState(false);

  function setSearchAndUrl(q: string) {
    setSearch(q);
    const url = q
      ? `/conference-planning/${conference.id}/sessions?q=${encodeURIComponent(q)}`
      : `/conference-planning/${conference.id}/sessions`;
    window.history.replaceState(null, "", url);
  }

  const sessions = useMemo(
    () =>
      events.filter(
        (e) =>
          SESSION_TYPES.includes(e.event_type) ||
          (e.event_type === "custom" && e.show_in_sessions),
      ),
    [events],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((e) => {
      const names = e.assignments
        .map((a) => attendees.find((x) => x.id === a.attendee_id)?.name || "")
        .join(" ");
      return `${e.title} ${e.location} ${e.description} ${EVENT_TYPES[e.event_type].label} ${names}`
        .toLowerCase()
        .includes(q);
    });
  }, [sessions, search, attendees]);

  const groups = useMemo(() => {
    const map = new Map<string, EventWithPeople[]>();
    for (const e of filtered) {
      const key = dateKeyInTz(e.starts_at, tz);
      map.set(key, [...(map.get(key) || []), e]);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [filtered, tz]);

  const isCollapsed = (day: string) => {
    if (search.trim()) return false; // searching force-expands
    if (day in collapsed) return collapsed[day];
    return day < today; // past days auto-collapse
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
          />
          <input
            value={search}
            onChange={(e) => setSearchAndUrl(e.target.value)}
            placeholder="Search sessions — title, location, type, people…"
            className="w-full rounded-lg border border-border bg-surface py-2.5 pl-9 pr-3 text-sm outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20"
          />
        </div>
        <Button onClick={() => setFormOpen(true)}>
          <Plus size={16} /> New session
        </Button>
      </div>

      {loading ? (
        <p className="py-12 text-center text-sm text-muted">Loading…</p>
      ) : groups.length === 0 ? (
        <EmptyState
          title={sessions.length === 0 ? "No sessions yet" : "No sessions match your search"}
          hint="Sessions, educational and competitor talks from the schedule appear here for note-taking."
          action={
            sessions.length === 0 ? (
              <Button onClick={() => setFormOpen(true)}>
                <Plus size={16} /> New session
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-4">
          {groups.map(([day, list]) => {
            const closed = isCollapsed(day);
            return (
              <section key={day} className="overflow-hidden rounded-xl border border-border bg-surface">
                <button
                  onClick={() =>
                    setCollapsed((prev) => ({ ...prev, [day]: !closed }))
                  }
                  className="flex w-full items-center justify-between px-4 py-3 text-left"
                >
                  <span className="text-sm font-semibold">
                    {fmtDayKeyLong(day)}
                    {day === today && (
                      <span className="ml-2 rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[10px] font-bold text-[var(--accent)]">
                        TODAY
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-2 text-xs text-muted">
                    {list.length} session{list.length === 1 ? "" : "s"}
                    <ChevronDown
                      size={15}
                      className={cn("transition-transform", closed && "-rotate-90")}
                    />
                  </span>
                </button>
                {!closed && (
                  <div className="divide-y divide-border border-t border-border">
                    {list.map((e) => {
                      const names = e.assignments
                        .map((a) => attendees.find((x) => x.id === a.attendee_id)?.name?.split(" ")[0])
                        .filter(Boolean);
                      return (
                        <div key={e.id} className="group flex items-center">
                          <Link
                            href={`/conference-planning/${conference.id}/sessions/${e.id}`}
                            className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 transition hover:bg-canvas"
                          >
                            <span
                              className="h-9 w-1.5 shrink-0 rounded-full"
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
                          </Link>
                          <button
                            onClick={async () => {
                              if (confirm(`Delete "${e.title}"?`)) await remove(e.id);
                            }}
                            className="mr-3 rounded p-1.5 text-muted opacity-0 transition hover:text-red-600 group-hover:opacity-100"
                            title="Delete session"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      <EventFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        event={null}
        onSave={async (id, partial, assignees, shifts) => {
          const saved = await save(id, partial, assignees, shifts);
          if (saved) {
            router.push(`/conference-planning/${conference.id}/sessions/${saved.id}`);
          }
          return saved;
        }}
      />
    </div>
  );
}
