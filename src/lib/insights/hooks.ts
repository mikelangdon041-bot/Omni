"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useUserId } from "@/lib/territory/hooks";
import type { KOL } from "@/lib/territory/types";
import type {
  AnalysisSpec,
  AnswerValue,
  SavedAnalysis,
  SurveyAnswer,
  SurveyOption,
  SurveyQuestion,
  SurveyResponse,
  SurveyTemplate,
} from "./types";

const supabase = createClient();

export { useUserId };

// Resolve the signed-in user's org id + role (for admin gating + template creation).
export function useOrgProfile() {
  const [orgId, setOrgId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    supabase.auth.getUser().then(async ({ data }) => {
      const uid = data.user?.id;
      if (!uid) {
        if (active) setLoading(false);
        return;
      }
      const { data: profile } = await supabase
        .from("profiles")
        .select("org_id, role")
        .eq("id", uid)
        .single();
      if (!active) return;
      setOrgId((profile?.org_id as string) ?? null);
      setIsAdmin(profile?.role === "admin" || profile?.role === "owner");
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);
  return { orgId, isAdmin, loading };
}

// ------------------------------------------------------------------
// Survey definition (active template + its questions + options).
// "Active" = the published template if one exists, else the latest one.
// ------------------------------------------------------------------
export function useSurveyDefinition() {
  const [template, setTemplate] = useState<SurveyTemplate | null>(null);
  const [questions, setQuestions] = useState<SurveyQuestion[]>([]);
  const [options, setOptions] = useState<SurveyOption[]>([]);
  const [loading, setLoading] = useState(true);

  const loadDefinition = useCallback(async (t: SurveyTemplate | null) => {
    if (!t) {
      setQuestions([]);
      setOptions([]);
      return;
    }
    const { data: qs } = await supabase
      .from("survey_questions")
      .select("*")
      .eq("template_id", t.id)
      .order("sort_order", { ascending: true });
    const questionRows = (qs as SurveyQuestion[]) || [];
    setQuestions(questionRows);

    const qIds = questionRows.map((q) => q.id);
    if (qIds.length) {
      const { data: os } = await supabase
        .from("survey_options")
        .select("*")
        .in("question_id", qIds)
        .order("sort_order", { ascending: true });
      setOptions((os as SurveyOption[]) || []);
    } else {
      setOptions([]);
    }
  }, []);

  const refresh = useCallback(async () => {
    const { data } = await supabase
      .from("survey_templates")
      .select("*")
      .order("status", { ascending: false }) // 'published' > 'draft' > 'archived'
      .order("updated_at", { ascending: false });
    const templates = (data as SurveyTemplate[]) || [];
    const active =
      templates.find((t) => t.status === "published") || templates[0] || null;
    setTemplate(active);
    await loadDefinition(active);
    setLoading(false);
  }, [loadDefinition]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { template, questions, options, loading, refresh };
}

// ------------------------------------------------------------------
// Survey admin: create/publish a template + CRUD on questions & options.
// ------------------------------------------------------------------
export function useSurveyAdmin(orgId: string | null) {
  const def = useSurveyDefinition();

  const createTemplate = useCallback(
    async (partial: Partial<SurveyTemplate>) => {
      if (!orgId) return null;
      const { data } = await supabase
        .from("survey_templates")
        .insert({ org_id: orgId, ...partial })
        .select("*")
        .single();
      await def.refresh();
      return (data as SurveyTemplate) || null;
    },
    [orgId, def],
  );

  const updateTemplate = useCallback(
    async (id: string, partial: Partial<SurveyTemplate>) => {
      await supabase.from("survey_templates").update(partial).eq("id", id);
      await def.refresh();
    },
    [def],
  );

  const addQuestion = useCallback(
    async (partial: Partial<SurveyQuestion>) => {
      if (!def.template) return null;
      const { data } = await supabase
        .from("survey_questions")
        .insert({ template_id: def.template.id, ...partial })
        .select("*")
        .single();
      await def.refresh();
      return (data as SurveyQuestion) || null;
    },
    [def],
  );

  const updateQuestion = useCallback(
    async (id: string, partial: Partial<SurveyQuestion>) => {
      await supabase.from("survey_questions").update(partial).eq("id", id);
      await def.refresh();
    },
    [def],
  );

  const removeQuestion = useCallback(
    async (id: string) => {
      await supabase.from("survey_questions").delete().eq("id", id);
      await def.refresh();
    },
    [def],
  );

  const addOption = useCallback(
    async (partial: Partial<SurveyOption>) => {
      const { data } = await supabase
        .from("survey_options")
        .insert(partial)
        .select("*")
        .single();
      await def.refresh();
      return (data as SurveyOption) || null;
    },
    [def],
  );

  const updateOption = useCallback(
    async (id: string, partial: Partial<SurveyOption>) => {
      await supabase.from("survey_options").update(partial).eq("id", id);
      await def.refresh();
    },
    [def],
  );

  const removeOption = useCallback(
    async (id: string) => {
      await supabase.from("survey_options").delete().eq("id", id);
      await def.refresh();
    },
    [def],
  );

  return {
    ...def,
    createTemplate,
    updateTemplate,
    addQuestion,
    updateQuestion,
    removeQuestion,
    addOption,
    updateOption,
    removeOption,
  };
}

// ------------------------------------------------------------------
// Responses roster (all of the rep's KOL surveys + every answer, for the
// tracker and the analytics workbench).
// ------------------------------------------------------------------
export interface ResponseWithKol extends SurveyResponse {
  kol: KOL;
}

export function useResponses(userId: string | null) {
  const [responses, setResponses] = useState<ResponseWithKol[]>([]);
  const [answers, setAnswers] = useState<SurveyAnswer[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase
      .from("survey_responses")
      .select("*, kol:kols(*)")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });
    const rows = (data as ResponseWithKol[]) || [];
    setResponses(rows);

    const ids = rows.map((r) => r.id);
    if (ids.length) {
      const { data: ans } = await supabase
        .from("survey_answers")
        .select("*")
        .in("response_id", ids);
      setAnswers((ans as SurveyAnswer[]) || []);
    } else {
      setAnswers([]);
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Ensure a response exists for a KOL under the active template (idempotent).
  const ensureResponse = useCallback(
    async (kolId: string, templateId: string, orgId: string | null) => {
      if (!userId) return null;
      const existing = responses.find(
        (r) => r.kol_id === kolId && r.template_id === templateId,
      );
      if (existing) return existing;
      const { data } = await supabase
        .from("survey_responses")
        .insert({
          kol_id: kolId,
          template_id: templateId,
          user_id: userId,
          org_id: orgId,
        })
        .select("*, kol:kols(*)")
        .single();
      if (data) {
        const row = data as ResponseWithKol;
        setResponses((prev) => [row, ...prev]);
        return row;
      }
      return null;
    },
    [userId, responses],
  );

  const removeResponse = useCallback(async (id: string) => {
    setResponses((prev) => prev.filter((r) => r.id !== id));
    setAnswers((prev) => prev.filter((a) => a.response_id !== id));
    await supabase.from("survey_responses").delete().eq("id", id);
  }, []);

  return { responses, answers, loading, refresh, ensureResponse, removeResponse };
}

// ------------------------------------------------------------------
// A single survey instance's answers (the take-survey flow).
// ------------------------------------------------------------------
export function useSurveyAnswers(responseId: string | null) {
  const [answers, setAnswers] = useState<SurveyAnswer[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!responseId) return;
    const { data } = await supabase
      .from("survey_answers")
      .select("*")
      .eq("response_id", responseId);
    setAnswers((data as SurveyAnswer[]) || []);
    setLoading(false);
  }, [responseId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const answerMap = useMemo(() => {
    const m = new Map<string, AnswerValue>();
    for (const a of answers) m.set(a.question_id, a.value);
    return m;
  }, [answers]);

  // Upsert a single answer (optimistic).
  const saveAnswer = useCallback(
    async (questionId: string, value: AnswerValue) => {
      if (!responseId) return;
      setAnswers((prev) => {
        const rest = prev.filter((a) => a.question_id !== questionId);
        return [
          ...rest,
          {
            id: `tmp-${questionId}`,
            response_id: responseId,
            question_id: questionId,
            value,
            answered_at: new Date().toISOString(),
          },
        ];
      });
      await supabase
        .from("survey_answers")
        .upsert(
          { response_id: responseId, question_id: questionId, value },
          { onConflict: "response_id,question_id" },
        );
    },
    [responseId],
  );

  const setStatus = useCallback(
    async (status: SurveyResponse["status"]) => {
      if (!responseId) return;
      const patch: Partial<SurveyResponse> = { status };
      if (status === "in_progress") patch.started_at = new Date().toISOString();
      if (status === "complete") patch.completed_at = new Date().toISOString();
      await supabase.from("survey_responses").update(patch).eq("id", responseId);
    },
    [responseId],
  );

  return { answers, answerMap, loading, refresh, saveAnswer, setStatus };
}

// ------------------------------------------------------------------
// Saved analyses (workbench).
// ------------------------------------------------------------------
export function useSavedAnalyses(userId: string | null) {
  const [analyses, setAnalyses] = useState<SavedAnalysis[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase
      .from("saved_analyses")
      .select("*")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });
    setAnalyses((data as SavedAnalysis[]) || []);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = useCallback(
    async (title: string, spec: AnalysisSpec, templateId: string | null, orgId: string | null) => {
      if (!userId) return null;
      const { data } = await supabase
        .from("saved_analyses")
        .insert({ user_id: userId, org_id: orgId, template_id: templateId, title, spec })
        .select("*")
        .single();
      if (data) setAnalyses((prev) => [data as SavedAnalysis, ...prev]);
      return (data as SavedAnalysis) || null;
    },
    [userId],
  );

  const remove = useCallback(async (id: string) => {
    setAnalyses((prev) => prev.filter((a) => a.id !== id));
    await supabase.from("saved_analyses").delete().eq("id", id);
  }, []);

  return { analyses, loading, refresh, save, remove };
}
