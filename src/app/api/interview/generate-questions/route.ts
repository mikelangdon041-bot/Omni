import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { suggestInterviewQuestions } from "@/lib/openai";

export const runtime = "nodejs";
export const maxDuration = 60;

// General question generation for the bank (topic-based, not candidate-specific).
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const topic = String(body.topic || "").trim();
  const seeds: string[] = Array.isArray(body.seeds)
    ? body.seeds.map((s: unknown) => String(s))
    : [];

  try {
    const questions = await suggestInterviewQuestions({
      role: topic,
      resumeText: seeds.length ? `Build on / vary these questions:\n${seeds.join("\n")}` : "",
      existing: seeds,
      count: 8,
    });
    return NextResponse.json({ questions });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not generate";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
