"use client";

// Posters list (spec §10): grouped by free-text date (parsing is guarded —
// malformed dates can never crash the view), searchable, color-coded by date,
// with poster sessions shown once (sub-posters live on the session's page).

import { useMemo, useState } from "react";
import { Loading } from "@/components/conference/Bits";
import Link from "next/link";
import { FileSpreadsheet, Layers, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { useConferenceCtx } from "@/components/conference/ConferenceContext";
import { usePosters, type PosterWithReps } from "@/lib/conference/hooks";
import { PosterModal } from "@/components/conference/PosterModal";
import { ImportScheduleModal } from "@/components/conference/ImportScheduleModal";
import { PriorityPill } from "@/components/conference/Priority";
import { normalizeFreeDate } from "@/lib/conference/utils";
import { usePersistedFilter } from "@/lib/conference/usePersistedFilter";

const DATE_COLORS = ["#0d9488", "#7c3aed", "#d97706", "#0284c7", "#be123c", "#4f46e5", "#ca8a04"];

export default function PostersPage() {
  const { conference, attendees } = useConferenceCtx();
  const { posters, loading, save } = usePosters(conference.id);
  const [search, setSearch] = usePersistedFilter(conference.id, "posters_q", "");
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);

  const confYear = Number(conference.start_date.slice(0, 4)) || new Date().getFullYear();

  const topLevel = useMemo(() => posters.filter((p) => !p.parent_id), [posters]);
  const subCount = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of posters) {
      if (p.parent_id) map.set(p.parent_id, (map.get(p.parent_id) || 0) + 1);
    }
    return map;
  }, [posters]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return topLevel;
    return topLevel.filter((p) =>
      `${p.title} ${p.authors} ${p.location} ${p.session_label} ${p.abstract}`
        .toLowerCase()
        .includes(q),
    );
  }, [topLevel, search]);

  // Group by raw date text; sort groups by the normalized date when parseable.
  const groups = useMemo(() => {
    const map = new Map<string, PosterWithReps[]>();
    for (const p of filtered) {
      const key = p.date.trim() || "No date";
      map.set(key, [...(map.get(key) || []), p]);
    }
    return [...map.entries()].sort(([a], [b]) => {
      const na = normalizeFreeDate(a, confYear) || "9999";
      const nb = normalizeFreeDate(b, confYear) || "9999";
      return na.localeCompare(nb) || a.localeCompare(b);
    });
  }, [filtered, confYear]);

  const repNames = (p: PosterWithReps) =>
    p.reps
      .map((r) => attendees.find((a) => a.id === r.attendee_id)?.name?.split(" ")[0])
      .filter(Boolean)
      .join(", ");

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
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search posters — title, authors, location…"
            className="w-full rounded-lg border border-border bg-surface py-2.5 pl-9 pr-3 text-sm outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20"
          />
        </div>
        <Button variant="secondary" onClick={() => setShowImport(true)}>
          <FileSpreadsheet size={15} /> Import
        </Button>
        <Button onClick={() => setShowAdd(true)}>
          <Plus size={16} /> Add poster
        </Button>
      </div>

      {loading ? (
        <Loading />
      ) : groups.length === 0 ? (
        <EmptyState
          title={topLevel.length === 0 ? "No posters yet" : "No posters match"}
          hint="Track research posters, who's covering them, and what the team learned."
          action={
            topLevel.length === 0 ? (
              <Button onClick={() => setShowAdd(true)}>
                <Plus size={16} /> Add poster
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-6">
          {groups.map(([date, list], gi) => {
            const color = DATE_COLORS[gi % DATE_COLORS.length];
            return (
              <section key={date}>
                <h3
                  className="mb-2 inline-block rounded-full px-3 py-1 text-xs font-bold text-white"
                  style={{ background: color }}
                >
                  {date}
                </h3>
                <div className="space-y-1.5">
                  {list.map((p) => (
                    <Link
                      key={p.id}
                      href={`/conference-planning/${conference.id}/posters/${p.id}`}
                      className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 transition hover:shadow-sm"
                    >
                      <span
                        className="h-9 w-1.5 shrink-0 rounded-full"
                        style={{ background: color }}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-1.5 text-sm font-medium">
                          {p.is_session && (
                            <span
                              className="inline-flex items-center gap-1 rounded-full bg-canvas px-1.5 py-0.5 text-[10px] font-bold text-muted"
                              title="Poster session"
                            >
                              <Layers size={10} /> {subCount.get(p.id) || 0}
                            </span>
                          )}
                          <span className="truncate">{p.title}</span>
                        </p>
                        <p className="truncate text-xs text-muted">
                          {[p.time, p.location, p.authors].filter(Boolean).join(" · ")}
                        </p>
                        {repNames(p) && (
                          <p className="truncate text-xs font-medium text-[var(--accent)]">
                            Covered by {repNames(p)}
                          </p>
                        )}
                      </div>
                      <PriorityPill
                        suspected={p.suspected_priority}
                        confirmed={p.confirmed_priority}
                      />
                    </Link>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <PosterModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        poster={null}
        onSave={save}
      />

      <ImportScheduleModal open={showImport} onClose={() => setShowImport(false)} />
    </div>
  );
}
