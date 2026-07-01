import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { nlToAnalysisSpec } from "@/lib/insights/ai";
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
  const prompt = String(body.prompt || "").trim();
  const templateId = String(body.templateId || "");
  if (!prompt) return NextResponse.json({ error: "prompt required" }, { status: 400 });
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
    const spec = await nlToAnalysisSpec({
      prompt,
      questions: qs,
      options: (options as SurveyOption[]) || [],
    });
    return NextResponse.json({ spec });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not analyze";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
