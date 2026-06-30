"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Candidate } from "./types";

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
