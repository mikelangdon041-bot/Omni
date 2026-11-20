// "Set up a meeting" in the Outlook pane: read the email that is open, work
// out the meeting it is asking for, and hand back everything Outlook's own
// new-meeting window needs, with every attendee's address looked up.
//
// Server only (it calls the model). The route at /api/outlook/meeting checks
// the session and loads the directory; scripts/check-meeting-invite.ts calls
// this directly against a real model.

import { anthropic, CHECK_MODEL } from "@/lib/anthropic";
import { stripEmDashes } from "@/lib/writer/sanitize";
import { resolvePerson, type DirectoryPerson, type Resolved } from "@/lib/directory";

const SCHEMA = {
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
  directorySize: number;
}

export async function planMeeting({
  thread,
  subject,
  request,
  now,
  me,
  onThread,
  directory,
  meRow = null,
}: MeetingInput): Promise<MeetingPlan> {
  const res = await anthropic().messages.create({
    model: CHECK_MODEL,
    max_tokens: 3000,
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
    system: `You set up meeting invites in Outlook for ${me.name || "the user"}${
      me.email ? ` <${me.email}>` : ""
    }. You are given the email they have open and, sometimes, a line from them about the meeting they want. Work out the meeting and fill in the invite. They will check it in Outlook and send it themselves.

It is now ${now || "unknown"} in their time zone.

Rules:
- Their own line, when there is one, outranks the email. "30 min with Shane next week" decides the length and who comes, whatever the thread says.
- subject: what the meeting is for, the way a colleague would title it ("Q1 KOL plan: review with Shane"). Not "Meeting", not "Re: ...".
- start: the agreed time as local "YYYY-MM-DDTHH:MM", worked out from today's date ("Thursday" is the next Thursday after today; "the 14th" is the next 14th). If several times were offered and one was accepted, that one. If times were offered and none chosen, the first, and say so in note. If nothing says when, "".
- durationMinutes: what was said; otherwise 30 for a quick check-in or a call, 60 for a review, workshop or anything with an agenda of several items.
- location: a room, address or "Phone" only if one was named. "" otherwise. Never write "Teams" or a link: the online meeting is switched on in Outlook.
- attendees: everyone who should get the invite, never ${me.name || "the user"} themselves. By default that is the other people on the email. Add anyone the email or their line says should come; leave out anyone it says should not, and people who were only copied for information when the meeting plainly is not for them. Someone it is unsure about ("should Glenn join?") is optional: true. "name" is the person as written; "email" is their address ONLY if it appears in the material, otherwise "".
- agenda: what the meeting will cover, as 2 to 5 short plain-text lines each starting "- ", taken from what the email actually says needs deciding or discussing. Write it as the organiser would, ready to send as it is. No greeting, no sign-off, no "Agenda:" heading, no markdown beyond the dashes.
- note: one short sentence for the user about a guess they should check: which of two offered times you took, or a time you had to work out from something vague. Never mention email addresses (they are looked up after you), a missing time (the app says that itself), who you left off when they asked you to, or a duration you picked by the rule above. "" if there is nothing like that, which is most of the time.
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
  });

  if (res.stop_reason === "refusal")
    throw new Error("The model declined that one.");
  const text = res.content.find((b) => b.type === "text");
  const parsed = JSON.parse((text && "text" in text ? text.text : "") || "{}");

  const asked: { name: string; email: string; optional: boolean }[] = Array.isArray(
    parsed.attendees,
  )
    ? parsed.attendees.slice(0, 40)
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

  const start = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(parsed.start || ""))
    ? String(parsed.start)
    : "";
  return {
    subject: stripEmDashes(String(parsed.subject || subject), { asSubject: true }),
    start,
    durationMinutes: Math.min(480, Math.max(5, Number(parsed.durationMinutes) || 30)),
    location: String(parsed.location || ""),
    agenda: stripEmDashes(String(parsed.agenda || "")),
    attendees,
    note: stripEmDashes(String(parsed.note || "")),
    directorySize: directory.length,
  };
}