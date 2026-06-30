"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { KOL } from "@/lib/territory/types";
import { METHOD_COLORS, kolFullName } from "@/lib/territory/utils";

const supabase = createClient();
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface Act {
  id: string;
  kol_id: string;
  type: string;
  date: string;
  outreach_method: string | null;
}

export function TerritoryCalendar({ kols }: { kols: KOL[] }) {
  const [acts, setActs] = useState<Act[]>([]);
  const [offset, setOffset] = useState(0);
  const kolName = useMemo(
    () => Object.fromEntries(kols.map((k) => [k.id, kolFullName(k)])),
    [kols],
  );

  useEffect(() => {
    supabase
      .from("activities")
      .select("id, kol_id, type, date, outreach_method")
      .then(({ data }) => setActs((data as Act[]) || []));
  }, []);

  const now = new Date();
  const month = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const year = month.getFullYear();
  const mon = month.getMonth();
  const firstDay = new Date(year, mon, 1).getDay();
  const daysInMonth = new Date(year, mon + 1, 0).getDate();

  const byDay = useMemo(() => {
    const map: Record<number, Act[]> = {};
    for (const a of acts) {
      const d = new Date(a.date);
      if (d.getFullYear() === year && d.getMonth() === mon) {
        (map[d.getDate()] ||= []).push(a);
      }
    }
    return map;
  }, [acts, year, mon]);

  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <button
          onClick={() => setOffset((o) => o - 1)}
          className="rounded-lg border border-border bg-surface p-2 text-muted transition hover:text-ink"
        >
          <ChevronLeft size={16} />
        </button>
        <h3 className="text-sm font-semibold">
          {month.toLocaleString(undefined, { month: "long", year: "numeric" })}
        </h3>
        <button
          onClick={() => setOffset((o) => o + 1)}
          className="rounded-lg border border-border bg-surface p-2 text-muted transition hover:text-ink"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-border bg-border">
        {DOW.map((d) => (
          <div key={d} className="bg-canvas px-2 py-1.5 text-center text-xs font-medium text-muted">
            {d}
          </div>
        ))}
        {cells.map((day, i) => (
          <div key={i} className="min-h-24 bg-surface p-1.5">
            {day && (
              <>
                <p className="text-[11px] text-muted">{day}</p>
                <div className="mt-0.5 space-y-0.5">
                  {(byDay[day] || []).slice(0, 3).map((a) => (
                    <Link
                      key={a.id}
                      href={`/territory-planning/kol/${a.kol_id}`}
                      className="block truncate rounded px-1 py-0.5 text-[10px] font-medium text-white"
                      style={{
                        backgroundColor:
                          METHOD_COLORS[a.outreach_method || "other"] || "#64748b",
                      }}
                      title={kolName[a.kol_id]}
                    >
                      {kolName[a.kol_id] || "KOL"}
                    </Link>
                  ))}
                  {(byDay[day] || []).length > 3 && (
                    <p className="text-[10px] text-muted">
                      +{(byDay[day] || []).length - 3} more
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
