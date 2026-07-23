"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getCached, setCached } from "@/lib/cache";
import type {
  Activity,
  KOL,
  Meeting,
  QuarterlyGoal,
  Reminder,
} from "./types";

const supabase = createClient();
const UID_CACHE_KEY = "uid";

// Unlike Conference Planning, Territory data is per-rep (every query below
// filters by user_id or kol_id) with no realtime subscription anywhere in
// this module — it's a plain one-shot fetch, same shape as Meeting Prep /
// Writing Studio. So these hooks use the simple instant-paint-then-refresh
// pattern (read cache on mount, paint it, refetch in the background, write
// the cache back on every change) with no ordering guard needed.

// Resolve the current rep's auth user id (client-side, from the session
// cookie). `supabase.auth.getUser()` is itself a network round trip, which
// otherwise serializes in front of every per-user data fetch that depends on
// it (meetings, docs, decks, KOLs…). We remember the last-resolved id in
// localStorage and hand it back synchronously on mount so those downstream
// hooks can start their own cached-instant-paint immediately, while this
// still reconfirms with Supabase in the background and corrects itself
// (including clearing to null) if the session has changed.
export function useUserId() {
  const [userId, setUserId] = useState<string | null>(() => getCached<string>(UID_CACHE_KEY));
  const [loading, setLoading] = useState(() => !getCached<string>(UID_CACHE_KEY));
  useEffect(() => {
    let active = true;
    supabase.auth.getUser().then(({ data }) => {
      if (!active) return;
      const uid = data.user?.id ?? null;
      setUserId(uid);
      setLoading(false);
      if (uid) setCached(UID_CACHE_KEY, uid);
    });
    return () => {
      active = false;
    };
  }, []);
  return { userId, loading };
}

// ------------------------------------------------------------------
// KOLs
// ------------------------------------------------------------------
function cacheEachKOL(rows: KOL[]) {
  // The list query already selects every column, so each row IS the same
  // full record the detail page needs — warm every KOL's detail cache too.
  for (const row of rows) setCached(`terr-kol:${row.id}`, { _t: Date.now(), row });
}

export function useKOLs(userId: string | null) {
  const cacheKey = userId ? `terr-kols:${userId}` : null;
  const [kols, setKols] = useState<KOL[]>(() => (cacheKey && getCached<KOL[]>(cacheKey)) || []);
  const [loading, setLoading] = useState(() => !(cacheKey && getCached<KOL[]>(cacheKey)));

  const refresh = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase
      .from("kols")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    const rows = (data as KOL[]) || [];
    setKols(rows);
    setLoading(false);
    setCached(`terr-kols:${userId}`, rows);
    cacheEachKOL(rows);
  }, [userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const add = useCallback(
    async (partial: Partial<KOL>) => {
      if (!userId) return null;
      const { data, error } = await supabase
        .from("kols")
        .insert({ ...partial, user_id: userId })
        .select("*")
        .single();
      if (error || !data) return null;
      const kol = data as KOL;
      setKols((prev) => {
        const next = [kol, ...prev];
        if (userId) setCached(`terr-kols:${userId}`, next);
        return next;
      });
      setCached(`terr-kol:${kol.id}`, { _t: Date.now(), row: kol });

      // Auto-geocode the address in the background so it appears on the map.
      if (kol.address && (kol.latitude == null || kol.longitude == null)) {
        fetch("/api/territory/geocode", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ address: kol.address }),
        })
          .then((r) => r.json())
          .then(({ lat, lng }) => {
            if (lat != null && lng != null) {
              supabase.from("kols").update({ latitude: lat, longitude: lng }).eq("id", kol.id);
              setKols((prev) => {
                const next = prev.map((k) =>
                  k.id === kol.id ? { ...k, latitude: lat, longitude: lng } : k,
                );
                if (userId) setCached(`terr-kols:${userId}`, next);
                return next;
              });
            }
          })
          .catch(() => {});
      }
      return kol;
    },
    [userId],
  );

  // Bulk insert (import). Throws on error so the caller can show it.
  const addMany = useCallback(
    async (partials: Partial<KOL>[]) => {
      if (!userId || partials.length === 0) return 0;
      const rows = partials.map((p) => ({ ...p, user_id: userId }));
      const { data, error } = await supabase.from("kols").insert(rows).select("*");
      if (error) throw new Error(error.message);
      if (data) {
        const inserted = data as KOL[];
        setKols((prev) => {
          const next = [...inserted, ...prev];
          setCached(`terr-kols:${userId}`, next);
          return next;
        });
        cacheEachKOL(inserted);
      }
      return data?.length ?? 0;
    },
    [userId],
  );

  const update = useCallback(
    async (id: string, partial: Partial<KOL>) => {
      setKols((prev) => {
        const next = prev.map((k) => (k.id === id ? { ...k, ...partial } : k));
        if (userId) setCached(`terr-kols:${userId}`, next);
        const updated = next.find((k) => k.id === id);
        if (updated) setCached(`terr-kol:${id}`, { _t: Date.now(), row: updated });
        return next;
      });
      await supabase.from("kols").update(partial).eq("id", id);
    },
    [userId],
  );

  const remove = useCallback(
    async (id: string) => {
      setKols((prev) => {
        const next = prev.filter((k) => k.id !== id);
        if (userId) setCached(`terr-kols:${userId}`, next);
        return next;
      });
      await supabase.from("kols").delete().eq("id", id);
    },
    [userId],
  );

  // Combine duplicate KOLs into one profile: reassign their history to the
  // primary, fill any empty fields on the primary from the duplicates, then
  // delete the duplicates.
  const merge = useCallback(
    async (
      primaryId: string,
      duplicateIds: string[],
      all: KOL[],
      overrides?: Partial<KOL>,
    ) => {
      const dups = duplicateIds.filter((id) => id !== primaryId);
      if (dups.length === 0) return;

      // Move all history to the primary.
      for (const table of ["activities", "meetings", "quarterly_goals", "reminders"]) {
        await supabase.from(table).update({ kol_id: primaryId }).in("kol_id", dups);
      }

      // Base: fill empty fields on the primary from the duplicates. Then apply
      // any user-resolved conflicts (overrides) on top.
      const primary = all.find((k) => k.id === primaryId);
      const sources = all.filter((k) => dups.includes(k.id));
      if (primary) {
        const patch: Record<string, unknown> = {};
        for (const key of Object.keys(primary) as (keyof KOL)[]) {
          if (key === "id" || key === "user_id" || key === "created_at") continue;
          const cur = primary[key];
          if (cur === "" || cur === null || cur === 0 || cur === false) {
            for (const s of sources) {
              const v = s[key];
              if (v !== "" && v !== null && v !== 0 && v !== false) {
                patch[key] = v;
                break;
              }
            }
          }
        }
        if (overrides) Object.assign(patch, overrides);
        if (Object.keys(patch).length) {
          await supabase.from("kols").update(patch).eq("id", primaryId);
        }
      }

      await supabase.from("kols").delete().in("id", dups);
      setKols((prev) => prev.filter((k) => !dups.includes(k.id)));
      await refresh();
    },
    [refresh],
  );

  return { kols, loading, refresh, add, addMany, update, remove, merge };
}

export function useKOL(id: string) {
  const cacheKey = `terr-kol:${id}`;
  const [kol, setKol] = useState<KOL | null>(() => getCached<{ row: KOL }>(cacheKey)?.row ?? null);
  const [loading, setLoading] = useState(() => !getCached<{ row: KOL }>(cacheKey));

  const refresh = useCallback(async () => {
    const { data } = await supabase.from("kols").select("*").eq("id", id).single();
    const row = (data as KOL) || null;
    setKol(row);
    setLoading(false);
    if (row) setCached(`terr-kol:${id}`, { _t: Date.now(), row });
  }, [id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Optimistic update; returns the DB error message (if any) so callers can
  // surface silent failures (e.g. a column that needs a pending migration).
  const update = useCallback(
    async (partial: Partial<KOL>) => {
      setKol((prev) => {
        const next = prev ? { ...prev, ...partial } : prev;
        if (next) setCached(`terr-kol:${id}`, { _t: Date.now(), row: next });
        return next;
      });
      const { error } = await supabase.from("kols").update(partial).eq("id", id);
      return error?.message ?? null;
    },
    [id],
  );

  return { kol, loading, refresh, update };
}

// ------------------------------------------------------------------
// Activities
// ------------------------------------------------------------------
export function useActivities(kolId: string) {
  const cacheKey = `terr-activities:${kolId}`;
  const [activities, setActivities] = useState<Activity[]>(() => getCached<Activity[]>(cacheKey) || []);
  const [loading, setLoading] = useState(() => !getCached<Activity[]>(cacheKey));

  const refresh = useCallback(async () => {
    const { data } = await supabase
      .from("activities")
      .select("*")
      .eq("kol_id", kolId)
      .order("date", { ascending: false });
    const rows = (data as Activity[]) || [];
    setActivities(rows);
    setLoading(false);
    setCached(`terr-activities:${kolId}`, rows);
  }, [kolId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const add = useCallback(
    async (partial: Partial<Activity>) => {
      const { data } = await supabase
        .from("activities")
        .insert({ ...partial, kol_id: kolId })
        .select("*")
        .single();
      if (data) {
        setActivities((prev) => {
          const next = [data as Activity, ...prev];
          setCached(`terr-activities:${kolId}`, next);
          return next;
        });
      }
      return (data as Activity) || null;
    },
    [kolId],
  );

  return { activities, loading, refresh, add };
}

// ------------------------------------------------------------------
// Meetings
// ------------------------------------------------------------------
export function useMeetings(kolId: string) {
  const cacheKey = `terr-meetings:${kolId}`;
  const [meetings, setMeetings] = useState<Meeting[]>(() => getCached<Meeting[]>(cacheKey) || []);
  const [loading, setLoading] = useState(() => !getCached<Meeting[]>(cacheKey));

  const refresh = useCallback(async () => {
    const { data } = await supabase
      .from("meetings")
      .select("*")
      .eq("kol_id", kolId)
      .order("meeting_number", { ascending: false });
    const rows = (data as Meeting[]) || [];
    setMeetings(rows);
    setLoading(false);
    setCached(`terr-meetings:${kolId}`, rows);
  }, [kolId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const add = useCallback(
    async (partial: Partial<Meeting>) => {
      const { data } = await supabase
        .from("meetings")
        .insert({ ...partial, kol_id: kolId })
        .select("*")
        .single();
      if (data) {
        setMeetings((prev) => {
          const next = [data as Meeting, ...prev];
          setCached(`terr-meetings:${kolId}`, next);
          return next;
        });
      }
      return (data as Meeting) || null;
    },
    [kolId],
  );

  const update = useCallback(
    async (id: string, partial: Partial<Meeting>) => {
      setMeetings((prev) => {
        const next = prev.map((m) => (m.id === id ? { ...m, ...partial } : m));
        setCached(`terr-meetings:${kolId}`, next);
        return next;
      });
      await supabase.from("meetings").update(partial).eq("id", id);
    },
    [kolId],
  );

  const remove = useCallback(
    async (id: string) => {
      setMeetings((prev) => {
        const next = prev.filter((m) => m.id !== id);
        setCached(`terr-meetings:${kolId}`, next);
        return next;
      });
      await supabase.from("meetings").delete().eq("id", id);
    },
    [kolId],
  );

  return { meetings, loading, refresh, add, update, remove };
}

// ------------------------------------------------------------------
// Quarterly goals
// ------------------------------------------------------------------
export function useQuarterlyGoals(kolId: string) {
  const cacheKey = `terr-goals:${kolId}`;
  const [goals, setGoals] = useState<QuarterlyGoal[]>(() => getCached<QuarterlyGoal[]>(cacheKey) || []);
  const [loading, setLoading] = useState(() => !getCached<QuarterlyGoal[]>(cacheKey));

  const refresh = useCallback(async () => {
    const { data } = await supabase
      .from("quarterly_goals")
      .select("*")
      .eq("kol_id", kolId)
      .order("year", { ascending: true })
      .order("quarter", { ascending: true })
      .order("sort_order", { ascending: true });
    const rows = (data as QuarterlyGoal[]) || [];
    setGoals(rows);
    setLoading(false);
    setCached(`terr-goals:${kolId}`, rows);
  }, [kolId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const add = useCallback(
    async (partial: Partial<QuarterlyGoal>) => {
      const { data } = await supabase
        .from("quarterly_goals")
        .insert({ ...partial, kol_id: kolId })
        .select("*")
        .single();
      if (data) {
        setGoals((prev) => {
          const next = [...prev, data as QuarterlyGoal];
          setCached(`terr-goals:${kolId}`, next);
          return next;
        });
      }
      return (data as QuarterlyGoal) || null;
    },
    [kolId],
  );

  const update = useCallback(
    async (id: string, partial: Partial<QuarterlyGoal>) => {
      setGoals((prev) => {
        const next = prev.map((g) => (g.id === id ? { ...g, ...partial } : g));
        setCached(`terr-goals:${kolId}`, next);
        return next;
      });
      await supabase.from("quarterly_goals").update(partial).eq("id", id);
    },
    [kolId],
  );

  const remove = useCallback(
    async (id: string) => {
      setGoals((prev) => {
        const next = prev.filter((g) => g.id !== id);
        setCached(`terr-goals:${kolId}`, next);
        return next;
      });
      await supabase.from("quarterly_goals").delete().eq("id", id);
    },
    [kolId],
  );

  const carryForward = useCallback(
    async (goal: QuarterlyGoal, toYear: number, toQuarter: number) => {
      const { data } = await supabase
        .from("quarterly_goals")
        .insert({
          kol_id: goal.kol_id,
          year: toYear,
          quarter: toQuarter,
          goal: goal.goal,
          carried_from_year: goal.year,
          carried_from_quarter: goal.quarter,
        })
        .select("*")
        .single();
      if (data) {
        setGoals((prev) => {
          const next = [...prev, data as QuarterlyGoal];
          setCached(`terr-goals:${kolId}`, next);
          return next;
        });
      }
      return (data as QuarterlyGoal) || null;
    },
    [kolId],
  );

  return { goals, loading, refresh, add, update, remove, carryForward };
}

// ------------------------------------------------------------------
// Reminders / tasks
// ------------------------------------------------------------------
export function useReminders(userId: string | null) {
  const cacheKey = userId ? `terr-reminders:${userId}` : null;
  const [reminders, setReminders] = useState<Reminder[]>(
    () => (cacheKey && getCached<Reminder[]>(cacheKey)) || [],
  );
  const [loading, setLoading] = useState(() => !(cacheKey && getCached<Reminder[]>(cacheKey)));

  const refresh = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase
      .from("reminders")
      .select("*")
      .eq("user_id", userId)
      .eq("dismissed", false)
      .order("due_date", { ascending: true });
    const rows = (data as Reminder[]) || [];
    setReminders(rows);
    setLoading(false);
    setCached(`terr-reminders:${userId}`, rows);
  }, [userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const add = useCallback(
    async (partial: Partial<Reminder>) => {
      if (!userId) return null;
      const { data } = await supabase
        .from("reminders")
        .insert({ ...partial, user_id: userId })
        .select("*")
        .single();
      if (data) {
        setReminders((prev) => {
          const next = [...prev, data as Reminder];
          setCached(`terr-reminders:${userId}`, next);
          return next;
        });
      }
      return (data as Reminder) || null;
    },
    [userId],
  );

  const complete = useCallback(
    async (id: string) => {
      const at = new Date().toISOString();
      setReminders((prev) => {
        const next = prev.map((r) => (r.id === id ? { ...r, completed_at: at } : r));
        if (userId) setCached(`terr-reminders:${userId}`, next);
        return next;
      });
      await supabase.from("reminders").update({ completed_at: at }).eq("id", id);
    },
    [userId],
  );

  const uncomplete = useCallback(
    async (id: string) => {
      setReminders((prev) => {
        const next = prev.map((r) => (r.id === id ? { ...r, completed_at: null } : r));
        if (userId) setCached(`terr-reminders:${userId}`, next);
        return next;
      });
      await supabase.from("reminders").update({ completed_at: null }).eq("id", id);
    },
    [userId],
  );

  const dismiss = useCallback(
    async (id: string) => {
      setReminders((prev) => {
        const next = prev.filter((r) => r.id !== id);
        if (userId) setCached(`terr-reminders:${userId}`, next);
        return next;
      });
      await supabase.from("reminders").update({ dismissed: true }).eq("id", id);
    },
    [userId],
  );

  const undismiss = useCallback(
    async (id: string) => {
      await supabase.from("reminders").update({ dismissed: false }).eq("id", id);
      await refresh();
    },
    [refresh],
  );

  const update = useCallback(
    async (id: string, partial: Partial<Reminder>) => {
      setReminders((prev) => {
        const next = prev.map((r) => (r.id === id ? { ...r, ...partial } : r));
        if (userId) setCached(`terr-reminders:${userId}`, next);
        return next;
      });
      await supabase.from("reminders").update(partial).eq("id", id);
    },
    [userId],
  );

  return {
    reminders,
    loading,
    refresh,
    add,
    complete,
    uncomplete,
    dismiss,
    undismiss,
    update,
  };
}

// ------------------------------------------------------------------
// Field suggestions for autocomplete (distinct values across the rep's KOLs)
// ------------------------------------------------------------------
export function useFieldSuggestions(userId: string | null) {
  const [suggestions, setSuggestions] = useState<Record<string, string[]>>({});

  useEffect(() => {
    if (!userId) return;
    let active = true;
    supabase
      .from("kols")
      .select(
        "specialty, title_position, clinician_type, address, tier, institution, society_associations, leadership_appointments, publications",
      )
      .eq("user_id", userId)
      .then(({ data }) => {
        if (!active || !data) return;
        const fields = [
          "specialty",
          "title_position",
          "clinician_type",
          "address",
          "tier",
          "institution",
          "society_associations",
          "leadership_appointments",
          "publications",
        ];
        const out: Record<string, string[]> = {};
        for (const f of fields) {
          const set = new Set<string>();
          for (const row of data as Record<string, string>[]) {
            const v = (row[f] || "").trim();
            if (v) set.add(v);
          }
          out[f] = [...set].sort();
        }
        setSuggestions(out);
      });
    return () => {
      active = false;
    };
  }, [userId]);

  return suggestions;
}
