import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { suggestAnalyses } from "@/lib/insights/ai";
import type { SurveyOption, SurveyQuestion } from "@/lib/insights/types";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const templateId = String(body.templateId || "");
  if (!templateId)
    return NextResponse.json({ error: "templateId required" }, { status: 400 });

  const { data: questions } = await supabase
    .from("survey_questions")
    .select("*")
    .eq("template_id", templateId);
  const qs = (questions as SurveyQuestion[]) || [];
  const qIds = qs.map((q) => q.id);
  const { data: options } = qIds.length
    ? await supabase.from("survey_options").select("*").in("question_id", qIds)
    : { data: [] };

  try {
    const suggestions = await suggestAnalyses({
      questions: qs,
      options: (options as SurveyOption[]) || [],
    });
    return NextResponse.json({ suggestions });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not suggest";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
