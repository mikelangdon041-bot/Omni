"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  EMPTY_CONTEXT,
  type WriterDoc,
  type WriterSettings,
  type WriterStyle,
  type WriterVersion,
} from "./types";

const supabase = createClient();

function normalizeDoc(row: WriterDoc): WriterDoc {
  return { ...row, context: { ...EMPTY_CONTEXT, ...(row.context || {}) } };
}

export function useWriterDocs(userId: string | null) {
  const [docs, setDocs] = useState<WriterDoc[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase
      .from("writer_docs")
      .select("*")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(300);
    setDocs(((data as WriterDoc[]) || []).map(normalizeDoc));
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const add = useCallback(
    async (partial: Partial<WriterDoc>) => {
      if (!userId) return null;
      const { data } = await supabase
        .from("writer_docs")
        .insert({ ...partial, user_id: userId })
        .select("*")
        .single();
      if (data) setDocs((prev) => [normalizeDoc(data as WriterDoc), ...prev]);
      return (data as WriterDoc) || null;
    },
    [userId],
  );

  const remove = useCallback(async (id: string) => {
    setDocs((prev) => prev.filter((d) => d.id !== id));
    await supabase.from("writer_docs").delete().eq("id", id);
  }, []);

  return { docs, loading, add, remove, refresh };
}

export function useWriterDoc(id: string) {
  const [doc, setDoc] = useState<WriterDoc | null>(null);
  const [versions, setVersions] = useState<WriterVersion[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void (async () => {
      const [{ data: d }, { data: v }] = await Promise.all([
        supabase.from("writer_docs").select("*").eq("id", id).maybeSingle(),
        supabase
          .from("writer_versions")
          .select("*")
          .eq("doc_id", id)
          .order("created_at", { ascending: false })
          .limit(100),
      ]);
      if (!active) return;
      setDoc(d ? normalizeDoc(d as WriterDoc) : null);
      setVersions((v as WriterVersion[]) || []);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [id]);

  // Autosave: optimistic local update immediately, debounced merged write to
  // the database (typing in rich-text fields would otherwise write per key).
  const pendingRef = useRef<Partial<WriterDoc>>({});
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(async () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    const p = pendingRef.current;
    pendingRef.current = {};
    if (Object.keys(p).length) await supabase.from("writer_docs").update(p).eq("id", id);
  }, [id]);

  const save = useCallback(
    (partial: Partial<WriterDoc>) => {
      setDoc((prev) => (prev ? { ...prev, ...partial } : prev));
      pendingRef.current = { ...pendingRef.current, ...partial };
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => void flush(), 800);
    },
    [flush],
  );

  // Push any unsaved keystrokes when the page is left.
  useEffect(() => {
    return () => {
      void flush();
    };
  }, [flush]);

  const addVersion = useCallback(
    async (v: Omit<WriterVersion, "id" | "created_at">) => {
      const { data } = await supabase
        .from("writer_versions")
        .insert(v)
        .select("*")
        .single();
      if (data) setVersions((prev) => [data as WriterVersion, ...prev]);
      return (data as WriterVersion) || null;
    },
    [],
  );

  return { doc, versions, loading, save, flush, addVersion };
}

export function useWriterStyles(userId: string | null) {
  const [styles, setStyles] = useState<WriterStyle[]>([]);

  const refresh = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase
      .from("writer_styles")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: true });
    setStyles((data as WriterStyle[]) || []);
  }, [userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const add = useCallback(
    async (partial: Partial<WriterStyle>) => {
      if (!userId) return null;
      const { data } = await supabase
        .from("writer_styles")
        .insert({ ...partial, user_id: userId })
        .select("*")
        .single();
      if (data) setStyles((prev) => [...prev, data as WriterStyle]);
      return (data as WriterStyle) || null;
    },
    [userId],
  );

  const update = useCallback(async (id: string, partial: Partial<WriterStyle>) => {
    setStyles((prev) => prev.map((s) => (s.id === id ? { ...s, ...partial } : s)));
    await supabase.from("writer_styles").update(partial).eq("id", id);
  }, []);

  const remove = useCallback(async (id: string) => {
    setStyles((prev) => prev.filter((s) => s.id !== id));
    await supabase.from("writer_styles").delete().eq("id", id);
  }, []);

  return { styles, add, update, remove };
}

const DEFAULT_SETTINGS: Omit<WriterSettings, "user_id"> = {
  signature: "",
  show_diff: true,
  variant_count: 1,
};

export function useWriterSettings(userId: string | null) {
  const [settings, setSettings] = useState<WriterSettings | null>(null);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    void supabase
      .from("writer_settings")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle()
      .then(({ data }) => {
        if (!active) return;
        setSettings(
          (data as WriterSettings) || { user_id: userId, ...DEFAULT_SETTINGS },
        );
      });
    return () => {
      active = false;
    };
  }, [userId]);

  const save = useCallback(
    async (partial: Partial<WriterSettings>) => {
      if (!userId) return;
      setSettings((prev) =>
        prev ? { ...prev, ...partial } : { user_id: userId, ...DEFAULT_SETTINGS, ...partial },
      );
      await supabase
        .from("writer_settings")
        .upsert({ user_id: userId, ...partial }, { onConflict: "user_id" });
    },
    [userId],
  );

  return { settings, save };
}

export { useUserId } from "@/lib/territory/hooks";
