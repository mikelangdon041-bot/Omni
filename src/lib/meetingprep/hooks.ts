"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { dropCached, getCached, setCached } from "@/lib/cache";
import type { FolderKind, MpFolder, MpMeeting, MpSettings } from "./types";

const supabase = createClient();

// The list query below already selects every column, so each row IS the same
// full record the detail page needs — no separate per-item fetch required to
// warm the detail cache (unlike a list endpoint that returns a slim row).
function cacheEachMeeting(userId: string, rows: MpMeeting[]) {
  for (const row of rows) setCached(`mtg:${userId}:${row.id}`, { _t: Date.now(), row });
}

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
    const rows = (data as MpMeeting[]) || [];
    setMeetings(rows);
    setLoading(false);
    setCached(`meetings:${userId}`, rows);
    // Warm every meeting's detail cache in the background so opening any one
    // of them from the list — even on a first visit — instant-paints.
    cacheEachMeeting(userId, rows);
  }, [userId]);

  useEffect(() => {
    // Instant paint from cache, then refresh in the background.
    if (userId) {
      const cached = getCached<MpMeeting[]>(`meetings:${userId}`);
      if (cached) {
        setMeetings(cached);
        setLoading(false);
      }
    }
    void refresh();
  }, [refresh, userId]);

  const add = useCallback(
    async (partial: Partial<MpMeeting>) => {
      if (!userId) return null;
      const { data } = await supabase
        .from("mp_meetings")
        .insert({ ...partial, user_id: userId })
        .select("*")
        .single();
      if (data) {
        setMeetings((prev) => {
          const next = [data as MpMeeting, ...prev];
          setCached(`meetings:${userId}`, next);
          return next;
        });
      }
      return (data as MpMeeting) || null;
    },
    [userId],
  );

  const remove = useCallback(
    async (id: string) => {
      setMeetings((prev) => {
        const next = prev.filter((m) => m.id !== id);
        if (userId) setCached(`meetings:${userId}`, next);
        return next;
      });
      await supabase.from("mp_meetings").delete().eq("id", id);
      if (userId) dropCached(`mtg:${userId}:${id}`);
    },
    [userId],
  );

  return { meetings, loading, add, remove, refresh };
}

/**
 * Start a meeting from material that lives in another app — today, a piece in
 * Writing Studio whose chat was asked to get the person ready for the
 * conversation rather than to change the writing. Everything lands in `explain`,
 * the plain-language fast path the setup tab is built around, so "Fill in the
 * details" picks the attendees, objectives and concerns out of it exactly as it
 * would from something typed there by hand. Standalone rather than part of
 * useMpMeetings so a page that only ever creates one doesn't have to load the
 * caller's whole meeting list to do it.
 */
export async function createMeetingFromMaterial(
  userId: string,
  input: { title: string; explain: string },
): Promise<MpMeeting | null> {
  const { data } = await supabase
    .from("mp_meetings")
    .insert({
      user_id: userId,
      title: input.title.slice(0, 200),
      explain: input.explain,
    })
    .select("*")
    .single();
  if (!data) return null;
  // The list cache would otherwise paint without the new meeting on the way in.
  dropCached(`meetings:${userId}`);
  return data as MpMeeting;
}

export type SaveState = "idle" | "pending" | "saving" | "saved";

// One meeting with debounced autosave (same pattern as Writing Studio docs).
// `saveState` drives the "Saving… / All changes saved" indicator.
export function useMpMeeting(id: string, userId: string | null) {
  const [meeting, setMeeting] = useState<MpMeeting | null>(null);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  // Once it's gone, neither the unmount flush nor the cache write may bring
  // it back. Declared up here because both of those are below.
  const deletedRef = useRef(false);

  useEffect(() => {
    // Instant paint from cache (warmed by the meetings list, or by a
    // previous visit to this meeting), then refresh in the background.
    let active = true;
    const cacheKey = userId ? `mtg:${userId}:${id}` : null;
    const cached = cacheKey ? getCached<{ _t: number; row: MpMeeting }>(cacheKey) : null;
    if (cached?.row) {
      setMeeting(cached.row);
      setLoading(false);
    } else {
      setLoading(true);
    }
    void supabase
      .from("mp_meetings")
      .select("*")
      .eq("id", id)
      .maybeSingle()
      .then(({ data }) => {
        if (!active) return;
        const row = (data as MpMeeting) || null;
        setMeeting(row);
        setLoading(false);
        if (row && cacheKey) setCached(cacheKey, { _t: Date.now(), row });
      });
    return () => {
      active = false;
    };
  }, [id, userId]);

  // Any edit (autosave, AI refine, etc.) refreshes the instant-paint cache.
  useEffect(() => {
    if (meeting && userId && !deletedRef.current) {
      setCached(`mtg:${userId}:${id}`, { _t: Date.now(), row: meeting });
    }
  }, [meeting, userId, id]);

  const pendingRef = useRef<Partial<MpMeeting>>({});
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(async () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    const p = pendingRef.current;
    pendingRef.current = {};
    if (deletedRef.current) return;
    if (Object.keys(p).length) {
      setSaveState("saving");
      await supabase.from("mp_meetings").update(p).eq("id", id);
      setSaveState("saved");
    }
  }, [id]);

  // Deleting from the meeting itself, rather than only from the list. A
  // recording that turned out to be the wrong meeting, or one you did not
  // mean to keep, is discovered on this page — the recorder opens straight to
  // it — so having to go back to the list to bin it is a detour.
  const remove = useCallback(async () => {
    deletedRef.current = true;
    pendingRef.current = {};
    if (timerRef.current) clearTimeout(timerRef.current);

    // A kept recording lives in storage, not in the row, so deleting the row
    // alone would orphan the audio where nothing can reach or remove it.
    const audioPath = meeting?.debrief?.audioPath;
    if (audioPath) {
      try {
        await fetch("/api/meeting/transcribe-upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ action: "delete-audio", path: audioPath }),
        });
      } catch {
        // Losing the audio cleanup must not stop the meeting going away.
      }
    }

    await supabase.from("mp_meetings").delete().eq("id", id);
    if (userId) {
      dropCached(`mtg:${userId}:${id}`);
      // The list paints from its own cache, which would otherwise show this
      // meeting again the moment you land back on it.
      const list = getCached<MpMeeting[]>(`meetings:${userId}`);
      if (list) setCached(`meetings:${userId}`, list.filter((m) => m.id !== id));
    }
  }, [id, userId, meeting?.debrief?.audioPath]);

  const save = useCallback(
    (partial: Partial<MpMeeting>) => {
      setMeeting((prev) => (prev ? { ...prev, ...partial } : prev));
      pendingRef.current = { ...pendingRef.current, ...partial };
      setSaveState("pending");
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

  return { meeting, loading, save, flush, saveState, remove };
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
      const { error } = await supabase
        .from("mp_settings")
        .upsert({ user_id: userId, ...partial }, { onConflict: "user_id" });
      // section_order arrived after the table did (migration 0028). Until that
      // migration is run, saving it comes back "column does not exist" and
      // would take the custom sections down with it — so retry without it
      // rather than lose the whole save.
      if (error && "section_order" in partial) {
        const { section_order: _dropped, ...rest } = partial;
        void _dropped;
        if (Object.keys(rest).length) {
          await supabase
            .from("mp_settings")
            .upsert({ user_id: userId, ...rest }, { onConflict: "user_id" });
        }
      }
    },
    [userId],
  );

  return { settings, save };
}

// Person / topic folders recordings are filed under. Direct client + RLS,
// same pattern as useMpMeetings — the API route under /api/meeting/folders
// exists in parallel only for the desktop recorder, which has no JS
// Supabase client to reach RLS with.
export function useMpFolders(userId: string | null) {
  const [folders, setFolders] = useState<MpFolder[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase
      .from("mp_folders")
      .select("*")
      .eq("user_id", userId)
      .order("kind", { ascending: true })
      .order("name", { ascending: true });
    setFolders((data as MpFolder[]) || []);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Creating the same name twice (typed again mid-meeting, or by someone
  // clicking fast) reuses the existing folder instead of erroring — a
  // unique violation on (user_id, kind, lower(name)) or (user_id, kol_id)
  // is resolved by looking the existing row back up.
  const create = useCallback(
    async (input: { kind: FolderKind; name: string; kolId?: string | null }) => {
      if (!userId) return null;
      const name = input.name.trim();
      if (!name) return null;
      const { data, error } = await supabase
        .from("mp_folders")
        .insert({ user_id: userId, kind: input.kind, name, kol_id: input.kolId || null })
        .select("*")
        .single();
      if (data) {
        const folder = data as MpFolder;
        setFolders((prev) =>
          [...prev, folder].sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name)),
        );
        return folder;
      }
      if (error?.code === "23505") {
        const existing = input.kolId
          ? await supabase.from("mp_folders").select("*").eq("user_id", userId).eq("kol_id", input.kolId).maybeSingle()
          : await supabase
              .from("mp_folders")
              .select("*")
              .eq("user_id", userId)
              .eq("kind", input.kind)
              .ilike("name", name)
              .maybeSingle();
        return (existing.data as MpFolder) || null;
      }
      // Anything else (most likely: migration 0030 hasn't been run yet, so
      // mp_folders doesn't exist — "relation does not exist") has to reach
      // the caller rather than look like a folder was created when it wasn't.
      throw new Error(error?.message || "Could not create the folder");
    },
    [userId],
  );

  const rename = useCallback(async (id: string, name: string) => {
    setFolders((prev) => prev.map((f) => (f.id === id ? { ...f, name } : f)));
    await supabase.from("mp_folders").update({ name }).eq("id", id);
  }, []);

  const remove = useCallback(async (id: string) => {
    // mp_meetings.folder_id references this ON DELETE SET NULL, so meetings
    // filed here fall back to Uncategorized rather than disappearing.
    setFolders((prev) => prev.filter((f) => f.id !== id));
    await supabase.from("mp_folders").delete().eq("id", id);
  }, []);

  return { folders, loading, refresh, create, rename, remove };
}

export { useUserId } from "@/lib/territory/hooks";
