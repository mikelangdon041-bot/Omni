"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type {
  Candidate,
  CandidateActivity,
  CandidateQuestion,
  QuestionBankItem,
} from "./types";

const supabase = createClient();

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

// Candidates accessible to the caller (owned + shared, via RLS).
export function useCandidates() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const { data } = await supabase
      .from("candidates")
      .select("*")
      .order("updated_at", { ascending: false });
    setCandidates((data as Candidate[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const add = useCallback(
    async (partial: Partial<Candidate>, userId: string) => {
      const { data, error } = await supabase
        .from("candidates")
        .insert({ ...partial, user_id: userId })
        .select("*")
        .single();
      if (error || !data) return null;
      setCandidates((prev) => [data as Candidate, ...prev]);
      return data as Candidate;
    },
    [],
  );

  return { candidates, loading, refresh, add };
}

export function useCandidate(id: string) {
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const { data } = await supabase
      .from("candidates")
      .select("*")
      .eq("id", id)
      .single();
    setCandidate((data as Candidate) || null);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const update = useCallback(
    async (partial: Partial<Candidate>) => {
      setCandidate((prev) => (prev ? { ...prev, ...partial } : prev));
      await supabase.from("candidates").update(partial).eq("id", id);
    },
    [id],
  );

  return { candidate, loading, refresh, update };
}

export interface CandidateRecording {
  id: string;
  title: string;
  status: string;
  total_chunks: number;
  chunks_done: number;
  created_at: string;
}

// Per-candidate planned/asked questions.
export function useCandidateQuestions(candidateId: string) {
  const [questions, setQuestions] = useState<CandidateQuestion[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const { data } = await supabase
      .from("candidate_questions")
      .select("*")
      .eq("candidate_id", candidateId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    setQuestions((data as CandidateQuestion[]) || []);
    setLoading(false);
  }, [candidateId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const add = useCallback(
    async (partial: Partial<CandidateQuestion>) => {
      const { data } = await supabase
        .from("candidate_questions")
        .insert({ ...partial, candidate_id: candidateId })
        .select("*")
        .single();
      if (data) setQuestions((prev) => [...prev, data as CandidateQuestion]);
      return (data as CandidateQuestion) || null;
    },
    [candidateId],
  );

  const addMany = useCallback(
    async (items: Partial<CandidateQuestion>[]) => {
      if (items.length === 0) return;
      const rows = items.map((p) => ({ ...p, candidate_id: candidateId }));
      const { data } = await supabase
        .from("candidate_questions")
        .insert(rows)
        .select("*");
      if (data) setQuestions((prev) => [...prev, ...(data as CandidateQuestion[])]);
    },
    [candidateId],
  );

  const update = useCallback(
    async (id: string, partial: Partial<CandidateQuestion>) => {
      setQuestions((prev) =>
        prev.map((q) => (q.id === id ? { ...q, ...partial } : q)),
      );
      await supabase.from("candidate_questions").update(partial).eq("id", id);
    },
    [],
  );

  const remove = useCallback(async (id: string) => {
    setQuestions((prev) => prev.filter((q) => q.id !== id));
    await supabase.from("candidate_questions").delete().eq("id", id);
  }, []);

  return { questions, loading, refresh, add, addMany, update, remove };
}

// Reusable question bank (per owner).
export function useQuestionBank(userId: string | null) {
  const [items, setItems] = useState<QuestionBankItem[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase
      .from("question_bank")
      .select("*")
      .eq("user_id", userId)
      .order("favorite", { ascending: false })
      .order("created_at", { ascending: false });
    setItems((data as QuestionBankItem[]) || []);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const add = useCallback(
    async (partial: Partial<QuestionBankItem>) => {
      if (!userId) return null;
      const { data } = await supabase
        .from("question_bank")
        .insert({ ...partial, user_id: userId })
        .select("*")
        .single();
      if (data) setItems((prev) => [data as QuestionBankItem, ...prev]);
      return (data as QuestionBankItem) || null;
    },
    [userId],
  );

  const toggleFavorite = useCallback(
    async (id: string, favorite: boolean) => {
      setItems((prev) =>
        prev.map((i) => (i.id === id ? { ...i, favorite } : i)),
      );
      await supabase.from("question_bank").update({ favorite }).eq("id", id);
    },
    [],
  );

  const update = useCallback(async (id: string, text: string) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, text } : i)));
    await supabase.from("question_bank").update({ text }).eq("id", id);
  }, []);

  const remove = useCallback(async (id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
    await supabase.from("question_bank").delete().eq("id", id);
  }, []);

  return { items, loading, refresh, add, toggleFavorite, update, remove };
}

// Long-term candidate activity timeline.
export function useCandidateActivity(candidateId: string) {
  const [activity, setActivity] = useState<CandidateActivity[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const { data } = await supabase
      .from("candidate_activity")
      .select("*")
      .eq("candidate_id", candidateId)
      .order("created_at", { ascending: false });
    setActivity((data as CandidateActivity[]) || []);
    setLoading(false);
  }, [candidateId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const log = useCallback(
    async (
      type: string,
      body: string,
      userId: string | null,
      meta: Record<string, unknown> = {},
    ) => {
      const { data } = await supabase
        .from("candidate_activity")
        .insert({ candidate_id: candidateId, user_id: userId, type, body, meta })
        .select("*")
        .single();
      if (data) setActivity((prev) => [data as CandidateActivity, ...prev]);
      return (data as CandidateActivity) || null;
    },
    [candidateId],
  );

  const remove = useCallback(async (id: string) => {
    setActivity((prev) => prev.filter((a) => a.id !== id));
    await supabase.from("candidate_activity").delete().eq("id", id);
  }, []);

  return { activity, loading, refresh, log, remove };
}

// Recordings not yet attached to any candidate (e.g. created before candidates).
export function useUnassignedRecordings() {
  const [recordings, setRecordings] = useState<CandidateRecording[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const { data } = await supabase
      .from("recordings")
      .select("id, title, status, total_chunks, chunks_done, created_at")
      .is("candidate_id", null)
      .order("created_at", { ascending: false });
    setRecordings((data as CandidateRecording[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { recordings, loading, refresh };
}

export interface CandidateStat {
  interviews: number;
  questions: number;
}

// Per-candidate counts (interviews + questions) across all accessible candidates.
export function useCandidateStats() {
  const [stats, setStats] = useState<Record<string, CandidateStat>>({});

  useEffect(() => {
    let active = true;
    (async () => {
      const [recs, qs] = await Promise.all([
        supabase.from("recordings").select("candidate_id"),
        supabase.from("candidate_questions").select("candidate_id"),
      ]);
      if (!active) return;
      const map: Record<string, CandidateStat> = {};
      const bump = (id: string | null, key: keyof CandidateStat) => {
        if (!id) return;
        map[id] = map[id] || { interviews: 0, questions: 0 };
        map[id][key] += 1;
      };
      for (const r of (recs.data as { candidate_id: string | null }[]) || [])
        bump(r.candidate_id, "interviews");
      for (const q of (qs.data as { candidate_id: string | null }[]) || [])
        bump(q.candidate_id, "questions");
      setStats(map);
    })();
    return () => {
      active = false;
    };
  }, []);

  return stats;
}

export function useCandidateRecordings(candidateId: string) {
  const [recordings, setRecordings] = useState<CandidateRecording[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const { data } = await supabase
      .from("recordings")
      .select("id, title, status, total_chunks, chunks_done, created_at")
      .eq("candidate_id", candidateId)
      .order("created_at", { ascending: false });
    setRecordings((data as CandidateRecording[]) || []);
    setLoading(false);
  }, [candidateId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { recordings, loading, refresh };
}
