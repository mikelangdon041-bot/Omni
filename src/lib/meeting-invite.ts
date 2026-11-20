// "Set up a meeting" in the Outlook pane: read the email that is open, work
// out the meeting or meetings it is asking for, and hand back everything
// Outlook's own new-meeting window needs, with every attendee's address
// looked up.
//
// More than one, because the real request is often a schedule: "make holds
// for each of these five sessions with the people I bolded". One invite per
// session, each with its own people.
//
// Server only (it calls the model). The route at /api/outlook/meeting checks
// the session and loads the directory; scripts/check-meeting-invite.ts calls
// this directly against a real model.

import { anthropic, CHECK_MODEL } from "@/lib/anthropic";
import { stripEmDashes } from "@/lib/writer/sanitize";
import { resolvePerson, type DirectoryPerson, type Resolved } from "@/lib/directory";

const MEETING = {
  type: "object" as const,
  properties: {
    subject: { type: "string" as const },
    // Local wall-clock time, "YYYY-MM-DDTHH:MM", or "" when nothing says when.
    start: { type: "string" as const },
    durationMinutes: { type: "integer" as const },
    location: { type: "string" as const },
    agenda: { type: "string" as const },
    attendees: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          name: { type: "string" as const },
          email: { type: "string" as const },
          optional: { type: "boolean" as const },
        },
        required: ["name", "email", "optional"],
        additionalProperties: false,
      },
    },
    note: { type: "string" as const },
  },
  required: ["subject", "start", "durationMinutes", "location", "agenda", "attendees", "note"],
  additionalProperties: false,
};

const SCHEMA = {
  type: "object" as const,
  properties: { meetings: { type: "array" as const, items: MEETING } },
  required: ["meetings"],
  additionalProperties: false,
};

export interface MeetingInput {
  thread: string;
  subject: string;
  /** What the user typed about the meeting they want, if anything. */
  request: string;
  /** Their local date and time, with the zone, for "next Thursday". */
  now: string;
  me: { name: string; email: string };
  /** Everyone on the open email, with addresses, never including me. */
  onThread: DirectoryPerson[];
  /** Their directory, imported rows first. */
  directory: DirectoryPerson[];
  /** Their own directory row, if imported: department and company. */
  meRow?: DirectoryPerson | null;
  /** Aborted when the user presses Stop, so the model call stops too. */
  signal?: AbortSignal;
}

export interface MeetingPlan {
  subject: string;
  /** Local "YYYY-MM-DDTHH:MM", or "" when nothing said when. */
  start: string;
  durationMinutes: number;
  location: string;
  agenda: string;
  attendees: (Resolved & { optional: boolean })[];
  note: string;
}

export async function planMeetings({
  thread,
  subject,
  request,
  now,
  me,
  onThread,
  directory,
  meRow = null,
  signal,
}: MeetingInput): Promise<{ meetings: MeetingPlan[]; directorySize: number }> {
  const who = me.name || "the user";
  // Thinking is on by default for this model, and it SHARES max_tokens with
  // the answer. At 3000 a five-session schedule spent all of it thinking and
  // returned no JSON at all, which the pane showed as a blank invite. Room for
  // both, and a hard error below if it still runs out.
  const res = await anthropic().messages.create(
    {
      model: CHECK_MODEL,
      max_tokens: 16000,
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
      system: `You set up meeting invites in Outlook for ${who}${
        me.email ? ` <${me.email}>` : ""
      }. You are given the email they have open and, sometimes, a line from them about what they want. Work out the meeting or meetings and fill in one invite for each. They will check each one in Outlook and send it themselves.

It is now ${now || "unknown"} in their time zone.

Rules:
- Their own line, when there is one, outranks the email in everything: which meetings, who comes, how long, what to call them.
- One entry in "meetings" per separate meeting. A schedule of five sessions is five invites, each with its own date, time and people. A single meeting is one.
- Text the sender bolded is marked **like this**. "My bolded choices" and "the people in bold" mean exactly the names inside ** for that session.
- subject: what the meeting is for, the way a colleague would title it ("Disease state lecture: team review"). Not "Meeting", never "Re:" or "RE:". If they call these holds or placeholders, start it "Hold: ".
- start: local "YYYY-MM-DDTHH:MM". A written date ("Thursday, Dec 17") is that date; take the year that puts it on or after today. A weekday alone ("Thursday") is the next one after today. If several times were offered and one was accepted, that one; if none was chosen, the first, and say so in note. If nothing says when, "".
- durationMinutes: from the time range when one is given ("1:00 to 2:30 PM" is 90). Otherwise what was said; otherwise 30 for a check-in or call, 60 for anything with an agenda.
- location: a room, address or "Phone" only if one was named. "" otherwise. Never "Teams" or a link: the online meeting is switched on in Outlook.
- attendees: who gets this invite, never ${who} themselves.
  - When the people for a session are NAMED (presenters listed per session, "my bolded choices", "just Shane and me"), that is the list, plus anyone they add ("also include Chris"). Do NOT also add everyone on the email: the person who approved the plan or was copied on it is not therefore invited.
  - Otherwise, when the email is two or more people arranging to meet each other, the other people on the email come, plus anyone added ("bring Priya in too" adds Priya; it does not drop the rest).
  - Someone it is unsure about ("should Glenn join?") is optional: true. Backups and people merely listed as available are NOT invited.
  - "name" is the person exactly as written (a first name is fine: it is looked up afterwards). "email" is their address ONLY if it appears in the material, otherwise "".
- agenda: the invite's body, plain text, ready to send. For a session from a schedule: its title or topic, and who presents. Short lines starting "- " when there are several points. If they said it is a hold or that someone else will send the real invite, end with one line saying so ("Calendar hold. Chris will send the final invite."). No greeting, no sign-off, no "Agenda:" heading, no markdown beyond the dashes.
- note: one short sentence for the user about a guess they should check, such as which of two offered times you took. Never mention email addresses, a missing time, or who you left off when they asked you to. Usually "".
Return only the JSON.`,
      messages: [
        {
          role: "user",
          content: [
            request.trim() ? `What they want:\n${request}` : "",
            subject ? `Subject of the open email: ${subject}` : "",
            onThread.length
              ? `People on the email:\n${onThread.map((p) => `${p.name} <${p.email}>`).join("\n")}`
              : "",
            thread.trim() ? `The email:\n\n${thread}` : "",
          ]
            .filter(Boolean)
            .join("\n\n"),
        },
      ],
    },
    { signal },
  );

  if (res.stop_reason === "refusal") throw new Error("The model declined that one.");
  const text = res.content.find((b) => b.type === "text");
  const raw = text && "text" in text ? text.text : "";
  // Never turn "no answer" into an empty invite that looks like a real one.
  if (!raw.trim() || res.stop_reason === "max_tokens")
    throw new Error("It ran out of room before finishing. Try again, or ask for fewer meetings at once.");
  const parsed = JSON.parse(raw);

  const meetings: MeetingPlan[] = (Array.isArray(parsed.meetings) ? parsed.meetings : [])
    .slice(0, 20)
    .map((m: Record<string, unknown>) => {
      const asked: { name: string; email: string; optional: boolean }[] = Array.isArray(
        m.attendees,
      )
        ? (m.attendees as { name: string; email: string; optional: boolean }[]).slice(0, 40)
        : [];
      const seen = new Set<string>();
      const attendees = asked
        .map((a) => ({
          ...resolvePerson(String(a.name || ""), String(a.email || ""), onThread, directory, meRow),
          optional: !!a.optional,
        }))
        // The same person named twice ("Shane" and "Shane O'Brien") is one invite.
        .filter((r) => {
          const key = r.person?.email || `?${r.asked.toLowerCase()}`;
          if (r.person?.email === me.email) return false;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      // "2026-12-17T13:00:00", "2026-12-17 13:00" and "2026-12-17T9:00" are
      // all a time. Holding out for the exact shape threw away the first
      // session's 1:00 PM and showed it as "nothing says when".
      const when = String(m.start || "").match(/^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}):(\d{2})/);
      const start = when ? `${when[1]}T${when[2].padStart(2, "0")}:${when[3]}` : "";
      return {
        subject: stripEmDashes(String(m.subject || subject), { asSubject: true }).replace(
          /^(re|fw|fwd):\s*/i,
          "",
        ),
        start,
        durationMinutes: Math.min(480, Math.max(5, Number(m.durationMinutes) || 30)),
        location: String(m.location || ""),
        agenda: stripEmDashes(String(m.agenda || "")),
        attendees,
        note: stripEmDashes(String(m.note || "")),
      };
    });
  if (!meetings.length) throw new Error("It didn't find a meeting to set up in that.");
  return { meetings, directorySize: directory.length };
}
