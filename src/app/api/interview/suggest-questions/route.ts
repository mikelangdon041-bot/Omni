import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { suggestInterviewQuestions } from "@/lib/openai";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const candidateId = String(body.candidateId || "");
  if (!candidateId) {
    return NextResponse.json({ error: "candidateId required" }, { status: 400 });
  }

  // RLS ensures the caller can only read candidates they own or are shared.
  const { data: candidate } = await supabase
    .from("candidates")
    .select("role_title, resume_text")
    .eq("id", candidateId)
    .single();
  if (!candidate) {
    return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
  }

  const { data: existingRows } = await supabase
    .from("candidate_questions")
    .select("text")
    .eq("candidate_id", candidateId);
  const existing = (existingRows || []).map((r) => r.text);

  try {
    const questions = await suggestInterviewQuestions({
      resumeText: candidate.resume_text || "",
      role: candidate.role_title || "",
      existing,
      count: 10,
    });
    return NextResponse.json({ questions });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not suggest questions";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
