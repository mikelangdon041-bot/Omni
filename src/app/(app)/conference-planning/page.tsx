"use client";

// Conference Planning home — pick (or create) the conference to work in.

import { useState } from "react";
import { Loading } from "@/components/conference/Bits";
import Link from "next/link";
import { Plus, MapPin, CalendarDays, Pencil, Presentation } from "lucide-react";
import { ModuleHero } from "@/components/ui/ModuleHero";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ConferenceModal } from "@/components/conference/ConferenceModal";
import { useConferences } from "@/lib/conference/hooks";
import { conferenceStatus, daysAway, fmtDateRange } from "@/lib/conference/utils";
import type { Conference } from "@/lib/conference/types";

export default function ConferencePlanningHome() {
  const { conferences, loading, add, update } = useConferences();
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<Conference | null>(null);

  const live = conferences.filter((c) => conferenceStatus(c) === "live").length;
  const upcoming = conferences.filter((c) => conferenceStatus(c) === "upcoming").length;

  return (
    <>
      <ModuleHero
        eyebrow="Conference Planning"
        icon={Presentation}
        title="Run conferences as a team"
        subtitle="Who is where, what's the schedule, who's covering the booth, and what did we learn — one shared workspace per event."
        stats={[
          { label: "Conferences", value: conferences.length },
          { label: "Live now", value: live },
          { label: "Upcoming", value: upcoming },
        ]}
        action={
          <Button onClick={() => setShowNew(true)} className="!bg-white !text-ink hover:!bg-white/90">
            <Plus size={16} /> New conference
          </Button>
        }
      />

      {loading ? (
        <Loading />
      ) : conferences.length === 0 ? (
        <EmptyState
          title="No conferences yet"
          hint="Create your first conference to start planning coverage with your team."
          action={
            <Button onClick={() => setShowNew(true)}>
              <Plus size={16} /> New conference
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {conferences.map((c) => {
            const status = conferenceStatus(c);
            const away = daysAway(c);
            return (
              <div
                key={c.id}
                className="group relative overflow-hidden rounded-xl border border-border bg-surface shadow-sm transition hover:shadow-md"
              >
                <div className="h-1.5 w-full bg-[var(--accent)]" />
                <Link href={`/conference-planning/${c.id}`} className="block p-5">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="font-semibold tracking-tight">{c.name}</h2>
                    {status === "live" ? (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                        LIVE
                      </span>
                    ) : status === "upcoming" ? (
                      <span className="shrink-0 rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--accent)]">
                        {away}d away
                      </span>
                    ) : (
                      <span className="shrink-0 rounded-full bg-canvas px-2 py-0.5 text-[11px] font-medium text-muted">
                        Past
                      </span>
                    )}
                  </div>
                  <p className="mt-2 flex items-center gap-1.5 text-sm text-muted">
                    <CalendarDays size={14} /> {fmtDateRange(c)}
                  </p>
                  {c.location && (
                    <p className="mt-1 flex items-center gap-1.5 text-sm text-muted">
                      <MapPin size={14} /> {c.location}
                    </p>
                  )}
                </Link>
                <button
                  onClick={() => setEditing(c)}
                  className="absolute bottom-3 right-3 rounded-lg p-1.5 text-muted opacity-0 transition hover:bg-canvas hover:text-ink group-hover:opacity-100"
                  title="Edit conference"
                >
                  <Pencil size={15} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <ConferenceModal
        open={showNew}
        onClose={() => setShowNew(false)}
        onSave={async (partial) => {
          await add(partial);
        }}
      />
      <ConferenceModal
        open={!!editing}
        onClose={() => setEditing(null)}
        conference={editing}
        onSave={async (partial) => {
          if (editing) await update(editing.id, partial);
        }}
      />
    </>
  );
}
