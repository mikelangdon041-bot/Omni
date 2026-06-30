import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateMeetingPrep } from "@/lib/territory/ai";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const kolId = String(body.kolId || "");
  if (!kolId) return NextResponse.json({ error: "kolId required" }, { status: 400 });

  const { data: kol } = await supabase
    .from("kols")
    .select(
      "first_name, last_name, specialty, institution, relationship_level, areas_of_interest, primary_objective, backup_questions",
    )
    .eq("id", kolId)
    .single();
  if (!kol) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: goals } = await supabase
    .from("quarterly_goals")
    .select("goal")
    .eq("kol_id", kolId)
    .eq("discussed", false);

  const { data: meetings } = await supabase
    .from("meetings")
    .select("topics_discussed, topics_missed, follow_up_actions")
    .eq("kol_id", kolId)
    .order("meeting_number", { ascending: false })
    .limit(1);

  const last = meetings?.[0];
  const lastMeeting = last
    ? `Discussed: ${last.topics_discussed}\nTo revisit: ${last.topics_missed}\nFollow-ups: ${last.follow_up_actions}`
    : "";

  try {
    const prep = await generateMeetingPrep({
      name: `${kol.first_name} ${kol.last_name}`,
      specialty: kol.specialty,
      institution: kol.institution,
      relationship: kol.relationship_level,
      areasOfInterest: kol.areas_of_interest,
      primaryObjective: kol.primary_objective,
      backupQuestions: kol.backup_questions,
      goals: (goals || []).map((g) => g.goal),
      lastMeeting,
    });
    return NextResponse.json({ prep });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not generate prep";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
