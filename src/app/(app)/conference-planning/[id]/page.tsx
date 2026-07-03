"use client";

// Per-conference home dashboard: live stat cards linking to each tab, plus
// recent announcements.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  CalendarDays,
  ClipboardList,
  Landmark,
  Megaphone,
  Sparkles,
  Users,
  UtensilsCrossed,
  type LucideIcon,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useConferenceCtx } from "@/components/conference/ConferenceContext";
import { useAnnouncements } from "@/lib/conference/hooks";
import { Avatar } from "@/components/ui/Avatar";
import { initials } from "@/lib/conference/utils";

const supabase = createClient();

interface Counts {
  events: number;
  contacts: number;
  insights: number;
  posters: number;
  openOrders: number;
}

export default function ConferenceDashboard() {
  const { conference, attendees } = useConferenceCtx();
  const { announcements } = useAnnouncements(conference.id);
  const [counts, setCounts] = useState<Counts | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const head = { count: "exact" as const, head: true };
      const [ev, ct, ins, po, fo] = await Promise.all([
        supabase.from("conf_events").select("id", head).eq("conference_id", conference.id).eq("cancelled", false),
        supabase.from("conf_contacts").select("id", head).eq("conference_id", conference.id).eq("archived", false),
        supabase.from("conf_insights").select("id", head).eq("conference_id", conference.id).is("parent_id", null),
        supabase.from("conf_posters").select("id", head).eq("conference_id", conference.id),
        supabase.from("conf_food_orders").select("id", head).eq("conference_id", conference.id).eq("status", "open"),
      ]);
      if (!active) return;
      setCounts({
        events: ev.count || 0,
        contacts: ct.count || 0,
        insights: ins.count || 0,
        posters: po.count || 0,
        openOrders: fo.count || 0,
      });
    })();
    return () => {
      active = false;
    };
  }, [conference.id]);

  // Resolve announcement sender names from the roster.
  const senders = useMemo(() => {
    const map: Record<string, string> = {};
    for (const a of attendees) if (a.user_id) map[a.user_id] = a.name;
    return map;
  }, [attendees]);

  const base = `/conference-planning/${conference.id}`;
  const cards: { label: string; value: number | string; href: string; icon: LucideIcon }[] = [
    { label: "Attendees", value: attendees.length, href: `${base}/team`, icon: Users },
    { label: "KOLs", value: counts?.contacts ?? "…", href: `${base}/contacts`, icon: Landmark },
    { label: "Schedule Events", value: counts?.events ?? "…", href: `${base}/schedule`, icon: CalendarDays },
    { label: "Insights", value: counts?.insights ?? "…", href: `${base}/insights`, icon: Sparkles },
    { label: "Posters", value: counts?.posters ?? "…", href: `${base}/posters`, icon: ClipboardList },
    { label: "Open Food Orders", value: counts?.openOrders ?? "…", href: `${base}/food`, icon: UtensilsCrossed },
  ];

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        {cards.map((c) => (
          <Link
            key={c.label}
            href={c.href}
            className="group rounded-xl border border-border bg-surface p-4 shadow-sm transition hover:shadow-md"
          >
            <div className="flex items-center justify-between">
              <p className="text-2xl font-semibold tracking-tight">{c.value}</p>
              <c.icon
                size={20}
                className="text-muted transition group-hover:text-[var(--accent)]"
              />
            </div>
            <p className="mt-1 text-xs text-muted">{c.label}</p>
          </Link>
        ))}
      </div>

      <section>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted">
          <Megaphone size={15} /> Recent announcements
        </h2>
        {announcements.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border bg-surface px-5 py-8 text-center text-sm text-muted">
            Nothing announced yet. Use the megaphone in the header to broadcast
            to the team.
          </p>
        ) : (
          <ul className="space-y-2">
            {announcements.map((a) => {
              const name = (a.sender_id && senders[a.sender_id]) || "Someone";
              return (
                <li
                  key={a.id}
                  className="flex items-start gap-3 rounded-xl border border-border bg-surface px-4 py-3"
                >
                  <Avatar initials={initials(name)} size={32} />
                  <div className="min-w-0">
                    <p className="text-sm">{a.message}</p>
                    <p className="mt-0.5 text-xs text-muted">
                      {name} ·{" "}
                      {new Date(a.created_at).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
