import { openai } from "@/lib/openai";

const MODEL = process.env.OPENAI_SUMMARY_MODEL || "gpt-4o";

export interface MeetingPrep {
  opener: string;
  talkingPoints: string[];
  reminders: string[];
  followUps: string[];
}

const PREP_SYSTEM = `You are a field medical engagement advisor helping a Medical Science Liaison prepare for a meeting with a key contact (KOL).
- Return ONLY JSON: {"opener": string, "talkingPoints": string[], "reminders": string[], "followUps": string[]}.
- opener: one warm, specific conversation starter.
- talkingPoints: 4-6 prioritized, specific points to cover, grounded in the contact's interests, objectives, and goals.
- reminders: 2-4 relationship-aware reminders (tone, cadence, sensitivities) based on the relationship level.
- followUps: any open items from the last meeting to revisit.
- Use only the information provided. Do not invent facts, studies, or data. Be concise and practical. Neutral tone, no brand or product promotion.`;

export async function generateMeetingPrep(input: {
  name: string;
  specialty?: string;
  institution?: string;
  relationship?: string;
  areasOfInterest?: string;
  primaryObjective?: string;
  backupQuestions?: string;
  goals?: string[];
  lastMeeting?: string;
}): Promise<MeetingPrep> {
  const user = `Contact: ${input.name}
Specialty: ${input.specialty || "—"}
Institution: ${input.institution || "—"}
Relationship level: ${input.relationship || "—"}
Areas of interest: ${input.areasOfInterest || "—"}
Primary objective: ${input.primaryObjective || "—"}
Backup questions: ${input.backupQuestions || "—"}
Current quarterly goals:
${input.goals?.length ? input.goals.map((g) => `- ${g}`).join("\n") : "—"}
Last meeting notes:
${input.lastMeeting || "— (no prior meeting)"}`;

  const res = await openai().chat.completions.create({
    model: MODEL,
    temperature: 0.4,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: PREP_SYSTEM },
      { role: "user", content: user },
    ],
  });
  try {
    const p = JSON.parse(res.choices[0]?.message?.content || "{}");
    return {
      opener: String(p.opener || ""),
      talkingPoints: Array.isArray(p.talkingPoints) ? p.talkingPoints.map(String) : [],
      reminders: Array.isArray(p.reminders) ? p.reminders.map(String) : [],
      followUps: Array.isArray(p.followUps) ? p.followUps.map(String) : [],
    };
  } catch {
    return { opener: "", talkingPoints: [], reminders: [], followUps: [] };
  }
}

export async function summarizeMeeting(input: {
  topicsDiscussed: string;
  topicsMissed: string;
  followUps: string;
}): Promise<string> {
  const res = await openai().chat.completions.create({
    model: MODEL,
    temperature: 0.3,
    messages: [
      {
        role: "system",
        content:
          "Summarize this KOL meeting into a concise paragraph (3-5 sentences) capturing what was discussed, what to revisit, and follow-up actions. Only use what's provided; do not invent.",
      },
      {
        role: "user",
        content: `Discussed: ${input.topicsDiscussed || "—"}\nTo revisit: ${input.topicsMissed || "—"}\nFollow-ups: ${input.followUps || "—"}`,
      },
    ],
  });
  return res.choices[0]?.message?.content?.trim() || "";
}
