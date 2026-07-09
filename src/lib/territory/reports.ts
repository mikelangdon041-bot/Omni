"use client";

// Monthly/quarterly MSL activity reporting: aggregates the activity log
// (meetings, outreach, presentations, MIRFs, trainings…) and auto-counts
// congress engagement by matching Conference Planning contacts to KOLs by
// email or name. Org admins can rename the categories company-wide
// (territory_category_labels — e.g. "Scientific exchange").

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { norm } from "./dedupe";
import { EVENT_TYPES } from "./activity";
import { kolFullName } from "./utils";
import type { Activity, KOL } from "./types";

const supabase = createClient();

// Reporting rows. "response" merges inbound + unsolicited.
export const REPORT_CATEGORIES: { key: string; label: string; attendees?: boolean }[] = [
  { key: "meeting", label: "KOL meetings completed" },
  { key: "outbound", label: "Outreach attempts" },
  { key: "response", label: "KOL responses" },
  ...EVENT_TYPES,
];

// ------------------------------------------------------------------
// Org-level category renames
// ------------------------------------------------------------------
export function useCategoryLabels() {
  const [labels, setLabels] = useState<Record<string, string>>({});
  const refresh = useCallback(async () => {
    const { data } = await supabase
      .from("territory_category_labels")
      .select("key, label");
    if (data) {
      setLabels(Object.fromEntries(data.map((r) => [r.key, r.label])));
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { labels, refresh };
}

export async function saveCategoryLabels(
  orgId: string,
  labels: Record<string, string>,
): Promise<string | null> {
  const rows = Object.entries(labels)
    .filter(([, label]) => label.trim())
    .map(([key, label]) => ({ org_id: orgId, key, label: label.trim() }));
  const { error } = await supabase
    .from("territory_category_labels")
    .upsert(rows, { onConflict: "org_id,key" });
  return error ? error.message : null;
}

// The current user's org + admin role (profiles table).
export function useOrgRole(userId: string | null) {
  const [orgId, setOrgId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    if (!userId) return;
    let active = true;
    supabase
      .from("profiles")
      .select("org_id, role")
      .eq("id", userId)
      .single()
      .then(({ data }) => {
        if (!active || !data) return;
        setOrgId(data.org_id ?? null);
        setIsAdmin(data.role === "admin" || data.role === "owner");
      });
    return () => {
      active = false;
    };
  }, [userId]);
  return { orgId, isAdmin };
}

// ------------------------------------------------------------------
// Report entries
// ------------------------------------------------------------------
export interface ReportEntry {
  date: string; // ISO
  category: string; // REPORT_CATEGORIES key
  attendees: number;
  auto?: boolean; // derived from Conference Planning attendance
}

function categoryOf(a: Activity): string | null {
  if (a.type === "meeting") return "meeting";
  if (a.type === "outbound") return "outbound";
  if (a.type === "inbound" || a.type === "unsolicited") return "response";
  if (EVENT_TYPES.some((t) => t.key === a.type)) return a.type;
  return null; // notes / status changes aren't reported
}

export function useTerritoryReport(userId: string | null, kols: KOL[]) {
  const [entries, setEntries] = useState<ReportEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!userId) return;
    const out: ReportEntry[] = [];

    // 1) Activities on the rep's KOLs.
    const kolIds = kols.map((k) => k.id);
    if (kolIds.length > 0) {
      const { data } = await supabase
        .from("activities")
        .select("*")
        .in("kol_id", kolIds);
      for (const a of (data as Activity[]) || []) {
        const cat = categoryOf(a);
        if (cat) out.push({ date: a.date, category: cat, attendees: a.attendees || 0 });
      }
    }

    // 2) Standalone entries (no KOL) added from this page. Tolerates the
    //    user_id column not existing yet (pre-0016).
    try {
      const { data } = await supabase
        .from("activities")
        .select("*")
        .eq("user_id", userId)
        .is("kol_id", null);
      for (const a of (data as Activity[]) || []) {
        const cat = categoryOf(a);
        if (cat) out.push({ date: a.date, category: cat, attendees: a.attendees || 0 });
      }
    } catch {
      // column missing — skip
    }

    // 3) Congress engagement from Conference Planning: a KOL who appears as
    //    a key contact of one of the org's conferences counts as congress
    //    activity in the month of that conference.
    try {
      const [{ data: confs }, { data: contacts }] = await Promise.all([
        supabase.from("conferences").select("id, name, start_date"),
        supabase.from("conf_contacts").select("conference_id, name, email, archived"),
      ]);
      if (confs && contacts) {
        const confById = new Map(confs.map((c) => [c.id, c]));
        const emails = new Set(
          kols.map((k) => (k.email || "").trim().toLowerCase()).filter(Boolean),
        );
        const names = new Set(kols.map((k) => norm(kolFullName(k))).filter(Boolean));
        for (const c of contacts) {
          if (c.archived) continue;
          const conf = confById.get(c.conference_id);
          if (!conf?.start_date) continue;
          const emailMatch = c.email && emails.has(c.email.trim().toLowerCase());
          const nameMatch = c.name && names.has(norm(c.name));
          if (emailMatch || nameMatch) {
            out.push({
              date: new Date(conf.start_date).toISOString(),
              category: "congress_activity",
              attendees: 0,
              auto: true,
            });
          }
        }
      }
    } catch {
      // conference module not set up — skip
    }

    setEntries(out);
    setLoading(false);
  }, [userId, kols]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { entries, loading, refresh };
}

// ------------------------------------------------------------------
// Period helpers
// ------------------------------------------------------------------
export interface Period {
  key: string;
  label: string;
  contains: (d: Date) => boolean;
}

export function lastMonths(n: number): Period[] {
  const out: Period[] = [];
  const now = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const y = d.getFullYear();
    const m = d.getMonth();
    out.push({
      key: `${y}-${m}`,
      label: d.toLocaleDateString(undefined, { month: "short", year: "2-digit" }),
      contains: (x) => x.getFullYear() === y && x.getMonth() === m,
    });
  }
  return out;
}

export function lastQuarters(n: number): Period[] {
  const out: Period[] = [];
  const now = new Date();
  let y = now.getFullYear();
  let q = Math.floor(now.getMonth() / 3); // 0-based
  for (let i = 0; i < n; i++) {
    const yy = y;
    const qq = q;
    out.push({
      key: `${yy}-Q${qq + 1}`,
      label: `Q${qq + 1} ${yy}`,
      contains: (x) =>
        x.getFullYear() === yy && Math.floor(x.getMonth() / 3) === qq,
    });
    q -= 1;
    if (q < 0) {
      q = 3;
      y -= 1;
    }
  }
  return out;
}
