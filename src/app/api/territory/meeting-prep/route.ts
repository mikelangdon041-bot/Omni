import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateMeetingPrep } from "@/lib/territory/ai";
import { stripHtml } from "@/lib/territory/utils";

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

  // select("*") so newly added strategy columns flow through without edits
  // (and the route keeps working even before optional migrations run).
  const { data: kol } = await supabase
    .from("kols")
    .select("*")
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
    ? `Discussed: ${stripHtml(last.topics_discussed)}\nTo revisit: ${stripHtml(last.topics_missed)}\nFollow-ups: ${stripHtml(last.follow_up_actions)}`
    : "";

  try {
    const prep = await generateMeetingPrep({
      name: `${kol.first_name} ${kol.last_name}`,
      specialty: kol.specialty,
      institution: kol.institution,
      relationship: kol.relationship_level,
      areasOfInterest: stripHtml(kol.areas_of_interest),
      potentialCollaborations: stripHtml(kol.potential_collaborations),
      otherInfo: stripHtml(kol.other_info),
      trialsInterest: kol.interested_in_trials
        ? stripHtml(kol.trials_interest_notes) || "Yes"
        : "",
      primaryObjective: stripHtml(kol.primary_objective),
      backupQuestions: stripHtml(kol.backup_questions),
      goals: (goals || []).map((g) => g.goal),
      lastMeeting,
    });
    return NextResponse.json({ prep });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not generate prep";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
