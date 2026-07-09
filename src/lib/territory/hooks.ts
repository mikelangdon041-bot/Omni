"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type {
  Activity,
  KOL,
  Meeting,
  QuarterlyGoal,
  Reminder,
} from "./types";

const supabase = createClient();

// Resolve the current rep's auth user id (client-side, from the session cookie).
export function useUserId() {
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    supabase.auth.getUser().then(({ data }) => {
      if (!active) return;
      setUserId(data.user?.id ?? null);
      setLoading(false);
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
export function useKOLs(userId: string | null) {
  const [kols, setKols] = useState<KOL[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase
      .from("kols")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    setKols((data as KOL[]) || []);
    setLoading(false);
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
      setKols((prev) => [kol, ...prev]);

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
              setKols((prev) =>
                prev.map((k) => (k.id === kol.id ? { ...k, latitude: lat, longitude: lng } : k)),
              );
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
      if (data) setKols((prev) => [...(data as KOL[]), ...prev]);
      return data?.length ?? 0;
    },
    [userId],
  );

  const update = useCallback(async (id: string, partial: Partial<KOL>) => {
    setKols((prev) =>
      prev.map((k) => (k.id === id ? { ...k, ...partial } : k)),
    );
    await supabase.from("kols").update(partial).eq("id", id);
  }, []);

  const remove = useCallback(async (id: string) => {
    setKols((prev) => prev.filter((k) => k.id !== id));
    await supabase.from("kols").delete().eq("id", id);
  }, []);

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
  const [kol, setKol] = useState<KOL | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const { data } = await supabase.from("kols").select("*").eq("id", id).single();
    setKol((data as KOL) || null);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Optimistic update; returns the DB error message (if any) so callers can
  // surface silent failures (e.g. a column that needs a pending migration).
  const update = useCallback(
    async (partial: Partial<KOL>) => {
      setKol((prev) => (prev ? { ...prev, ...partial } : prev));
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
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const { data } = await supabase
      .from("activities")
      .select("*")
      .eq("kol_id", kolId)
      .order("date", { ascending: false });
    setActivities((data as Activity[]) || []);
    setLoading(false);
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
      if (data) setActivities((prev) => [data as Activity, ...prev]);
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
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const { data } = await supabase
      .from("meetings")
      .select("*")
      .eq("kol_id", kolId)
      .order("meeting_number", { ascending: false });
    setMeetings((data as Meeting[]) || []);
    setLoading(false);
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
      if (data) setMeetings((prev) => [data as Meeting, ...prev]);
      return (data as Meeting) || null;
    },
    [kolId],
  );

  const update = useCallback(async (id: string, partial: Partial<Meeting>) => {
    setMeetings((prev) =>
      prev.map((m) => (m.id === id ? { ...m, ...partial } : m)),
    );
    await supabase.from("meetings").update(partial).eq("id", id);
  }, []);

  const remove = useCallback(async (id: string) => {
    setMeetings((prev) => prev.filter((m) => m.id !== id));
    await supabase.from("meetings").delete().eq("id", id);
  }, []);

  return { meetings, loading, refresh, add, update, remove };
}

// ------------------------------------------------------------------
// Quarterly goals
// ------------------------------------------------------------------
export function useQuarterlyGoals(kolId: string) {
  const [goals, setGoals] = useState<QuarterlyGoal[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const { data } = await supabase
      .from("quarterly_goals")
      .select("*")
      .eq("kol_id", kolId)
      .order("year", { ascending: true })
      .order("quarter", { ascending: true })
      .order("sort_order", { ascending: true });
    setGoals((data as QuarterlyGoal[]) || []);
    setLoading(false);
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
      if (data) setGoals((prev) => [...prev, data as QuarterlyGoal]);
      return (data as QuarterlyGoal) || null;
    },
    [kolId],
  );

  const update = useCallback(
    async (id: string, partial: Partial<QuarterlyGoal>) => {
      setGoals((prev) =>
        prev.map((g) => (g.id === id ? { ...g, ...partial } : g)),
      );
      await supabase.from("quarterly_goals").update(partial).eq("id", id);
    },
    [],
  );

  const remove = useCallback(async (id: string) => {
    setGoals((prev) => prev.filter((g) => g.id !== id));
    await supabase.from("quarterly_goals").delete().eq("id", id);
  }, []);

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
      if (data) setGoals((prev) => [...prev, data as QuarterlyGoal]);
      return (data as QuarterlyGoal) || null;
    },
    [],
  );

  return { goals, loading, refresh, add, update, remove, carryForward };
}

// ------------------------------------------------------------------
// Reminders / tasks
// ------------------------------------------------------------------
export function useReminders(userId: string | null) {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase
      .from("reminders")
      .select("*")
      .eq("user_id", userId)
      .eq("dismissed", false)
      .order("due_date", { ascending: true });
    setReminders((data as Reminder[]) || []);
    setLoading(false);
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
      if (data) setReminders((prev) => [...prev, data as Reminder]);
      return (data as Reminder) || null;
    },
    [userId],
  );

  const complete = useCallback(async (id: string) => {
    const at = new Date().toISOString();
    setReminders((prev) =>
      prev.map((r) => (r.id === id ? { ...r, completed_at: at } : r)),
    );
    await supabase.from("reminders").update({ completed_at: at }).eq("id", id);
  }, []);

  const uncomplete = useCallback(async (id: string) => {
    setReminders((prev) =>
      prev.map((r) => (r.id === id ? { ...r, completed_at: null } : r)),
    );
    await supabase.from("reminders").update({ completed_at: null }).eq("id", id);
  }, []);

  const dismiss = useCallback(async (id: string) => {
    setReminders((prev) => prev.filter((r) => r.id !== id));
    await supabase.from("reminders").update({ dismissed: true }).eq("id", id);
  }, []);

  const undismiss = useCallback(
    async (id: string) => {
      await supabase.from("reminders").update({ dismissed: false }).eq("id", id);
      await refresh();
    },
    [refresh],
  );

  const update = useCallback(async (id: string, partial: Partial<Reminder>) => {
    setReminders((prev) =>
      prev.map((r) => (r.id === id ? { ...r, ...partial } : r)),
    );
    await supabase.from("reminders").update(partial).eq("id", id);
  }, []);

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
