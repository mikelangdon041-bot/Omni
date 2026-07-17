"use client";

// Write a completed Meeting Prep meeting into Territory Planning as a real
// meeting record — the same activity + meeting rows the KOL page's
// "Complete meeting" flow creates, so the cycle stepper, meeting history,
// and AI prep all pick it up.

import { createClient } from "@/lib/supabase/client";
import { activeCycle } from "@/lib/territory/activity";
import { presetToDate, type Activity, type DueDatePreset } from "@/lib/territory/types";

const supabase = createClient();

export interface TerritoryLogInput {
  kolId: string;
  userId: string;
  dateISO: string;
  method: string; // in_person | video_call | phone
  topicsDiscussed: string; // HTML
  topicsMissed: string; // HTML
  followUpActions: string; // HTML
  reminder: DueDatePreset | "none";
}

export async function logMeetingToTerritory(input: TerritoryLogInput): Promise<void> {
  const { data: acts } = await supabase
    .from("activities")
    .select("*")
    .eq("kol_id", input.kolId)
    .order("date", { ascending: true });
  const cycleNum = activeCycle((acts as Activity[]) || []);

  const { count } = await supabase
    .from("meetings")
    .select("id", { count: "exact", head: true })
    .eq("kol_id", input.kolId);
  const meetingNumber = (count || 0) + 1;

  const { data: act, error: actErr } = await supabase
    .from("activities")
    .insert({
      kol_id: input.kolId,
      type: "meeting",
      status: "meeting_completed",
      meeting_cycle: cycleNum,
      outreach_method: input.method,
      date: input.dateISO,
      notes: input.topicsDiscussed,
    })
    .select("id")
    .single();
  if (actErr) throw new Error(actErr.message);

  const { error: meetErr } = await supabase.from("meetings").insert({
    kol_id: input.kolId,
    activity_id: act?.id ?? null,
    meeting_number: meetingNumber,
    date: input.dateISO,
    meeting_method: input.method,
    topics_discussed: input.topicsDiscussed,
    topics_missed: input.topicsMissed,
    follow_up_actions: input.followUpActions,
  });
  if (meetErr) throw new Error(meetErr.message);

  if (input.reminder !== "none") {
    await supabase.from("reminders").insert({
      user_id: input.userId,
      kol_id: input.kolId,
      title: "Follow up after meeting",
      due_date: presetToDate(input.reminder),
    });
  }
}

// Minimal KOL creation for "new person, not in my territory yet" — creates
// the profile in Territory Planning and returns it for linking.
export async function createKolQuick(input: {
  userId: string;
  firstName: string;
  lastName: string;
  specialty?: string;
  institution?: string;
  titlePosition?: string;
  email?: string;
}): Promise<{ id: string; first_name: string; last_name: string } | null> {
  const { data, error } = await supabase
    .from("kols")
    .insert({
      user_id: input.userId,
      first_name: input.firstName,
      last_name: input.lastName,
      specialty: input.specialty || "",
      institution: input.institution || "",
      title_position: input.titlePosition || "",
      email: input.email || "",
    })
    .select("id, first_name, last_name")
    .single();
  if (error) throw new Error(error.message);
  return data;
}
