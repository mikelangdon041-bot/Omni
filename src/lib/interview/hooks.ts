"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type {
  AppNotification,
  Candidate,
  CandidateActivity,
  CandidateQuestion,
  Interview,
  InterviewFeedback,
  InterviewNote,
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

// Per-candidate planned/asked questions. When `interviewId` is passed, only
// questions attached to that interview are returned (and new ones are attached
// to it); otherwise the candidate's general planned questions are returned.
export function useCandidateQuestions(candidateId: string, interviewId?: string) {
  const [questions, setQuestions] = useState<CandidateQuestion[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    let query = supabase
      .from("candidate_questions")
      .select("*")
      .eq("candidate_id", candidateId);
    query = interviewId
      ? query.eq("interview_id", interviewId)
      : query.is("interview_id", null);
    const { data } = await query
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    setQuestions((data as CandidateQuestion[]) || []);
    setLoading(false);
  }, [candidateId, interviewId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const add = useCallback(
    async (partial: Partial<CandidateQuestion>) => {
      const { data } = await supabase
        .from("candidate_questions")
        .insert({
          ...partial,
          candidate_id: candidateId,
          interview_id: interviewId ?? null,
          sort_order: questions.length,
        })
        .select("*")
        .single();
      if (data) setQuestions((prev) => [...prev, data as CandidateQuestion]);
      return (data as CandidateQuestion) || null;
    },
    [candidateId, interviewId, questions.length],
  );

  const addMany = useCallback(
    async (items: Partial<CandidateQuestion>[]) => {
      if (items.length === 0) return;
      const base = questions.length;
      const rows = items.map((p, i) => ({
        ...p,
        candidate_id: candidateId,
        interview_id: interviewId ?? null,
        sort_order: base + i,
      }));
      const { data } = await supabase
        .from("candidate_questions")
        .insert(rows)
        .select("*");
      if (data) setQuestions((prev) => [...prev, ...(data as CandidateQuestion[])]);
    },
    [candidateId, interviewId, questions.length],
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

  // Move a question up/down and persist the new order.
  const move = useCallback(
    async (id: string, dir: -1 | 1) => {
      setQuestions((prev) => {
        const idx = prev.findIndex((q) => q.id === id);
        const swap = idx + dir;
        if (idx < 0 || swap < 0 || swap >= prev.length) return prev;
        const next = [...prev];
        [next[idx], next[swap]] = [next[swap], next[idx]];
        // Persist the two affected sort orders.
        void supabase
          .from("candidate_questions")
          .update({ sort_order: swap })
          .eq("id", next[swap].id);
        void supabase
          .from("candidate_questions")
          .update({ sort_order: idx })
          .eq("id", next[idx].id);
        return next.map((q, i) => ({ ...q, sort_order: i }));
      });
    },
    [],
  );

  return { questions, loading, refresh, add, addMany, update, remove, move };
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

  const rename = useCallback(async (id: string, title: string) => {
    setRecordings((prev) => prev.map((r) => (r.id === id ? { ...r, title } : r)));
    await supabase.from("recordings").update({ title }).eq("id", id);
  }, []);

  const assign = useCallback(async (id: string, candidateId: string) => {
    setRecordings((prev) => prev.filter((r) => r.id !== id));
    await supabase.from("recordings").update({ candidate_id: candidateId }).eq("id", id);
  }, []);

  const remove = useCallback(async (id: string) => {
    setRecordings((prev) => prev.filter((r) => r.id !== id));
    await supabase.from("recordings").delete().eq("id", id);
  }, []);

  return { recordings, loading, refresh, rename, assign, remove };
}

// Interview scorecards / structured feedback for a candidate.
export function useInterviewFeedback(candidateId: string, userId: string | null) {
  const [all, setAll] = useState<InterviewFeedback[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const { data } = await supabase
      .from("interview_feedback")
      .select("*")
      .eq("candidate_id", candidateId);
    setAll((data as InterviewFeedback[]) || []);
    setLoading(false);
  }, [candidateId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const mine = userId ? all.find((f) => f.user_id === userId) || null : null;
  const others = userId ? all.filter((f) => f.user_id !== userId) : [];

  const save = useCallback(
    async (partial: Partial<InterviewFeedback>) => {
      if (!userId) return;
      await supabase
        .from("interview_feedback")
        .upsert(
          { candidate_id: candidateId, user_id: userId, ...partial },
          { onConflict: "candidate_id,user_id" },
        );
      await refresh();
    },
    [candidateId, userId, refresh],
  );

  const submit = useCallback(
    async (partial: Partial<InterviewFeedback>) => {
      await save({ ...partial, submitted: true, submitted_at: new Date().toISOString() });
    },
    [save],
  );

  return { all, mine, others, loading, refresh, save, submit };
}

// Written interviews (no recording) for a candidate.
export function useInterviewNotes(candidateId: string, userId: string | null) {
  const [notes, setNotes] = useState<InterviewNote[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const { data } = await supabase
      .from("interview_notes")
      .select("*")
      .eq("candidate_id", candidateId)
      .order("created_at", { ascending: false });
    setNotes((data as InterviewNote[]) || []);
    setLoading(false);
  }, [candidateId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const add = useCallback(async () => {
    if (!userId) return null;
    const { data } = await supabase
      .from("interview_notes")
      .insert({ candidate_id: candidateId, user_id: userId, title: "Interview notes" })
      .select("*")
      .single();
    if (data) setNotes((prev) => [data as InterviewNote, ...prev]);
    return (data as InterviewNote) || null;
  }, [candidateId, userId]);

  const update = useCallback(async (id: string, partial: Partial<InterviewNote>) => {
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, ...partial } : n)));
    await supabase.from("interview_notes").update(partial).eq("id", id);
  }, []);

  const remove = useCallback(async (id: string) => {
    setNotes((prev) => prev.filter((n) => n.id !== id));
    await supabase.from("interview_notes").delete().eq("id", id);
  }, []);

  return { notes, loading, refresh, add, update, remove };
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

// Recordings attached to a specific interview.
export function useInterviewRecordings(interviewId: string) {
  const [recordings, setRecordings] = useState<CandidateRecording[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!interviewId) return;
    const { data } = await supabase
      .from("recordings")
      .select("id, title, status, total_chunks, chunks_done, created_at")
      .eq("interview_id", interviewId)
      .order("created_at", { ascending: false });
    setRecordings((data as CandidateRecording[]) || []);
    setLoading(false);
  }, [interviewId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const rename = useCallback(async (id: string, title: string) => {
    setRecordings((prev) => prev.map((r) => (r.id === id ? { ...r, title } : r)));
    await supabase.from("recordings").update({ title }).eq("id", id);
  }, []);

  return { recordings, loading, refresh, rename };
}

// ------------------------------------------------------------------
// Interviews (scheduled, assignable workspaces)
// ------------------------------------------------------------------
export function useInterviews(candidateId: string) {
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const { data } = await supabase
      .from("interviews")
      .select("*")
      .eq("candidate_id", candidateId)
      .order("scheduled_at", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false });
    setInterviews((data as Interview[]) || []);
    setLoading(false);
  }, [candidateId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const add = useCallback(
    async (partial: Partial<Interview>, createdBy: string | null) => {
      const { data, error } = await supabase
        .from("interviews")
        .insert({ ...partial, candidate_id: candidateId, created_by: createdBy })
        .select("*")
        .single();
      if (error || !data) return null;
      setInterviews((prev) => [data as Interview, ...prev]);
      return data as Interview;
    },
    [candidateId],
  );

  const update = useCallback(async (id: string, partial: Partial<Interview>) => {
    setInterviews((prev) =>
      prev.map((i) => (i.id === id ? { ...i, ...partial } : i)),
    );
    await supabase.from("interviews").update(partial).eq("id", id);
  }, []);

  const remove = useCallback(async (id: string) => {
    setInterviews((prev) => prev.filter((i) => i.id !== id));
    await supabase.from("interviews").delete().eq("id", id);
  }, []);

  return { interviews, loading, refresh, add, update, remove };
}

export function useInterview(id: string) {
  const [interview, setInterview] = useState<Interview | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const { data } = await supabase
      .from("interviews")
      .select("*")
      .eq("id", id)
      .single();
    setInterview((data as Interview) || null);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const update = useCallback(
    async (partial: Partial<Interview>) => {
      setInterview((prev) => (prev ? { ...prev, ...partial } : prev));
      await supabase.from("interviews").update(partial).eq("id", id);
    },
    [id],
  );

  return { interview, loading, refresh, update };
}

// Interviews assigned to the current user (across candidates), with the
// candidate's name for display.
export interface AssignedInterview extends Interview {
  candidate?: { first_name: string; last_name: string; role_title: string };
}
export function useMyAssignments(userId: string | null) {
  const [items, setItems] = useState<AssignedInterview[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase
      .from("interviews")
      .select("*, candidate:candidates(first_name, last_name, role_title)")
      .eq("assignee_id", userId)
      .order("scheduled_at", { ascending: true, nullsFirst: false });
    setItems((data as AssignedInterview[]) || []);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { items, loading, refresh };
}

// ------------------------------------------------------------------
// In-app notifications
// ------------------------------------------------------------------
export function useNotifications(userId: string | null) {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(30);
    setItems((data as AppNotification[]) || []);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void refresh();
    if (!userId) return;
    const t = setInterval(refresh, 60000);
    return () => clearInterval(t);
  }, [refresh, userId]);

  const unread = items.filter((n) => !n.read).length;

  const markRead = useCallback(async (id: string) => {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    await supabase.from("notifications").update({ read: true }).eq("id", id);
  }, []);

  const markAll = useCallback(async () => {
    if (!userId) return;
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    await supabase
      .from("notifications")
      .update({ read: true })
      .eq("user_id", userId)
      .eq("read", false);
  }, [userId]);

  return { items, loading, unread, refresh, markRead, markAll };
}
