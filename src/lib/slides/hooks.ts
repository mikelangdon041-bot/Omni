"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  DEFAULT_SLIDE_THEME,
  type DeckVersion,
  type PracticeRun,
  type SlideDeck,
  type SlideTheme,
  type Slide,
} from "./types";

const supabase = createClient();

function normalize(row: SlideDeck): SlideDeck {
  return {
    ...row,
    theme: { ...DEFAULT_SLIDE_THEME, ...(row.theme || {}) },
    slides: Array.isArray(row.slides) ? row.slides : [],
  };
}

export function useDecks(userId: string | null) {
  const [decks, setDecks] = useState<SlideDeck[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase
      .from("sl_decks")
      .select("*")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(200);
    setDecks(((data as SlideDeck[]) || []).map(normalize));
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const add = useCallback(
    async (partial: Partial<SlideDeck>) => {
      if (!userId) return null;
      const { data } = await supabase
        .from("sl_decks")
        .insert({ ...partial, user_id: userId })
        .select("*")
        .single();
      if (data) setDecks((prev) => [normalize(data as SlideDeck), ...prev]);
      return (data as SlideDeck) || null;
    },
    [userId],
  );

  const remove = useCallback(async (id: string) => {
    setDecks((prev) => prev.filter((d) => d.id !== id));
    await supabase.from("sl_decks").delete().eq("id", id);
  }, []);

  return { decks, loading, add, remove, refresh };
}

// Direct insert used by the full-page creation flow (no list needed).
export async function createDeck(
  userId: string,
  partial: Partial<SlideDeck>,
): Promise<SlideDeck | null> {
  const { data, error } = await supabase
    .from("sl_decks")
    .insert({ ...partial, user_id: userId })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data ? normalize(data as SlideDeck) : null;
}

// One deck with debounced autosave (slides JSON changes on every drag).
export function useDeck(id: string) {
  const [deck, setDeck] = useState<SlideDeck | null>(null);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");

  useEffect(() => {
    let active = true;
    void supabase
      .from("sl_decks")
      .select("*")
      .eq("id", id)
      .maybeSingle()
      .then(({ data }) => {
        if (!active) return;
        setDeck(data ? normalize(data as SlideDeck) : null);
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id]);

  const pendingRef = useRef<Partial<SlideDeck>>({});
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(async () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    const p = pendingRef.current;
    pendingRef.current = {};
    if (Object.keys(p).length) {
      await supabase.from("sl_decks").update(p).eq("id", id);
      setSaveState("saved");
    }
  }, [id]);

  const save = useCallback(
    (partial: Partial<SlideDeck>) => {
      setDeck((prev) => (prev ? { ...prev, ...partial } : prev));
      pendingRef.current = { ...pendingRef.current, ...partial };
      setSaveState("saving");
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => void flush(), 900);
    },
    [flush],
  );

  useEffect(() => {
    return () => {
      void flush();
    };
  }, [flush]);

  const snapshot = useCallback(
    async (label: string, slides: Slide[], theme: SlideTheme) => {
      await supabase.from("sl_versions").insert({ deck_id: id, slides, theme, label });
    },
    [id],
  );

  const listVersions = useCallback(async (): Promise<DeckVersion[]> => {
    const { data } = await supabase
      .from("sl_versions")
      .select("*")
      .eq("deck_id", id)
      .order("created_at", { ascending: false })
      .limit(50);
    return (data as DeckVersion[]) || [];
  }, [id]);

  return { deck, loading, save, flush, snapshot, listVersions, saveState };
}

export function usePracticeRuns(deckId: string, userId: string | null) {
  const [runs, setRuns] = useState<PracticeRun[]>([]);

  const refresh = useCallback(async () => {
    const { data } = await supabase
      .from("sl_practice")
      .select("*")
      .eq("deck_id", deckId)
      .order("created_at", { ascending: false })
      .limit(30);
    setRuns((data as PracticeRun[]) || []);
  }, [deckId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const add = useCallback(
    async (partial: Partial<PracticeRun>) => {
      if (!userId) return null;
      const { data } = await supabase
        .from("sl_practice")
        .insert({ ...partial, deck_id: deckId, user_id: userId })
        .select("*")
        .single();
      if (data) setRuns((prev) => [data as PracticeRun, ...prev]);
      return (data as PracticeRun) || null;
    },
    [deckId, userId],
  );

  return { runs, add, refresh };
}

export { useUserId } from "@/lib/territory/hooks";
