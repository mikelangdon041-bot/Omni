"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { MpMeeting, MpSettings } from "./types";

const supabase = createClient();

export function useMpMeetings(userId: string | null) {
  const [meetings, setMeetings] = useState<MpMeeting[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase
      .from("mp_meetings")
      .select("*")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(300);
    setMeetings((data as MpMeeting[]) || []);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const add = useCallback(
    async (partial: Partial<MpMeeting>) => {
      if (!userId) return null;
      const { data } = await supabase
        .from("mp_meetings")
        .insert({ ...partial, user_id: userId })
        .select("*")
        .single();
      if (data) setMeetings((prev) => [data as MpMeeting, ...prev]);
      return (data as MpMeeting) || null;
    },
    [userId],
  );

  const remove = useCallback(async (id: string) => {
    setMeetings((prev) => prev.filter((m) => m.id !== id));
    await supabase.from("mp_meetings").delete().eq("id", id);
  }, []);

  return { meetings, loading, add, remove, refresh };
}

// One meeting with debounced autosave (same pattern as Writing Studio docs).
export function useMpMeeting(id: string) {
  const [meeting, setMeeting] = useState<MpMeeting | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void supabase
      .from("mp_meetings")
      .select("*")
      .eq("id", id)
      .maybeSingle()
      .then(({ data }) => {
        if (!active) return;
        setMeeting((data as MpMeeting) || null);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id]);

  const pendingRef = useRef<Partial<MpMeeting>>({});
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(async () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    const p = pendingRef.current;
    pendingRef.current = {};
    if (Object.keys(p).length) await supabase.from("mp_meetings").update(p).eq("id", id);
  }, [id]);

  const save = useCallback(
    (partial: Partial<MpMeeting>) => {
      setMeeting((prev) => (prev ? { ...prev, ...partial } : prev));
      pendingRef.current = { ...pendingRef.current, ...partial };
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => void flush(), 800);
    },
    [flush],
  );

  useEffect(() => {
    return () => {
      void flush();
    };
  }, [flush]);

  return { meeting, loading, save, flush };
}

export function useMpSettings(userId: string | null) {
  const [settings, setSettings] = useState<MpSettings | null>(null);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    void supabase
      .from("mp_settings")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle()
      .then(({ data }) => {
        if (!active) return;
        setSettings((data as MpSettings) || { user_id: userId, custom_sections: [] });
      });
    return () => {
      active = false;
    };
  }, [userId]);

  const save = useCallback(
    async (partial: Partial<MpSettings>) => {
      if (!userId) return;
      setSettings((prev) =>
        prev
          ? { ...prev, ...partial }
          : { user_id: userId, custom_sections: [], ...partial },
      );
      await supabase
        .from("mp_settings")
        .upsert({ user_id: userId, ...partial }, { onConflict: "user_id" });
    },
    [userId],
  );

  return { settings, save };
}

export { useUserId } from "@/lib/territory/hooks";
