// Everything the chat is allowed to do, in one list.
//
// This is the only place an app's verbs are declared. The server reads it to
// tell the model what is on offer where; the client reads it to run what comes
// back and to refuse anything that wasn't offered. Adding a verb to an app is
// an entry here plus a handler in run.ts — nothing else.

import type { ChatAppId } from "./types";

export interface ActionDef {
  id: string;
  /** Which apps offer it. "*" means everywhere. */
  apps: ChatAppId[] | "*";
  /** One line the model reads: what it does and when to reach for it. */
  when: string;
  /** Parameter name → what goes in it. "?" suffix marks it optional. */
  params: Record<string, string>;
  /**
   * Reads nothing but public state and changes nothing, so it runs on arrival
   * instead of waiting for a button. Only ever true for look-ups.
   */
  auto?: boolean;
  /**
   * Falls back to the page's subject when the model doesn't name one, and is
   * only offered when the page has a subject of this kind.
   */
  subject?: string;
}

const ISO = "ISO date, e.g. 2026-08-04. Today if they said today.";

export const ACTIONS: ActionDef[] = [
  // ---------------------------------------------------------------- global
  {
    id: "lookup",
    apps: "*",
    when: "Look up what Omni already knows about a person or a topic, across territory, conference contacts, meeting preps, interviews and written pieces. Use it BEFORE saying you don't know something about a person by name, and before writing to or about someone. Read-only.",
    params: { query: "the person's name, or a topic" },
    auto: true,
  },
  {
    id: "task.create",
    apps: "*",
    when: "Put something on their to-do list. The list is shared across every app, so this works from anywhere.",
    params: {
      title: "the task, imperative and short",
      "notes?": "any detail worth keeping",
      "dueDate?": ISO,
    },
  },
  {
    id: "reminder.create",
    apps: "*",
    when: "A dated nudge rather than a to-do: chase this, check in then.",
    params: {
      title: "what to be reminded of",
      dueDate: ISO,
      "description?": "context for when it fires",
    },
  },
  {
    id: "open",
    apps: "*",
    when: "Point them at a page in Omni. Only for pages you are certain exist.",
    params: { href: "a path like /territory-planning", label: "what the link says" },
  },
  {
    id: "handoff",
    apps: "*",
    when: "What they want belongs to another app. This starts it over there from this page's material and reports back here when it is done: they stay where they are. Use it for anything that is not about the thing on screen.",
    params: {
      app: "one of: territory-planning, meeting-prep, insights, conference-planning, writing-studio, slide-studio, interview-prep, dashboard",
      title: "a 3 to 7 word name for the new thing",
      brief: "what the new thing needs to be, in two or three imperative sentences, with the specifics from this page filled in",
    },
  },

  // ------------------------------------------------------- territory planning
  {
    id: "territory.kol.create",
    apps: ["territory-planning"],
    when: "Add a person to their territory.",
    params: {
      firstName: "",
      lastName: "",
      "specialty?": "",
      "institution?": "",
      "titlePosition?": "their role",
      "email?": "",
      "phone?": "",
      "tier?": "1, 2 or 3 if they said",
      "howMet?": "conference | unresponsive_emails | commercial_introduction | clinical_trial_site | meets_regularly | special_program | other",
      "notes?": "anything else they said about them",
    },
  },
  {
    id: "territory.kol.update",
    apps: ["territory-planning"],
    subject: "kol",
    when: "Change what is on record for this person: they moved, took a new role, warmed up, changed tier.",
    params: {
      "kolId?": "leave empty for the person on screen",
      "tier?": "",
      "relationshipLevel?": "not_yet_established | infancy | hesitant | moderate | strong | advocate",
      "institution?": "",
      "titlePosition?": "",
      "specialty?": "",
      "email?": "",
      "phone?": "",
      "areasOfInterest?": "",
      "primaryObjective?": "what you are trying to achieve with them",
      "otherInfo?": "anything else worth keeping on the record",
    },
  },
  {
    id: "territory.activity.log",
    apps: ["territory-planning"],
    subject: "kol",
    when: "Record a touchpoint: an email out, a call, a note to self.",
    params: {
      "kolId?": "leave empty for the person on screen",
      type: "outbound | inbound | unsolicited | note",
      "outreachMethod?": "email | phone | in_person | video_call | text | other",
      "date?": ISO,
      notes: "what happened, in their words",
    },
  },
  {
    id: "territory.meeting.log",
    apps: ["territory-planning"],
    subject: "kol",
    when: "Record a meeting that actually happened, with what was covered and what follows.",
    params: {
      "kolId?": "leave empty for the person on screen",
      "date?": ISO,
      "method?": "in_person | video_call | phone",
      topicsDiscussed: "",
      "topicsMissed?": "what you meant to cover and didn't",
      "followUpActions?": "",
    },
  },
  {
    id: "territory.goal.create",
    apps: ["territory-planning"],
    subject: "kol",
    when: "Set a quarterly goal for this person.",
    params: {
      "kolId?": "leave empty for the person on screen",
      goal: "one sentence, something you could tell was done",
      "quarter?": "1-4, this quarter if unsaid",
      "year?": "this year if unsaid",
    },
  },

  // ------------------------------------------------------------- meeting prep
  {
    id: "meetingprep.create",
    apps: ["meeting-prep"],
    when: "Start a new meeting to prepare for.",
    params: {
      title: "",
      explain: "the meeting in their own words: who is in the room, what they want out of it, what they are worried about",
    },
  },
  {
    id: "meetingprep.update",
    apps: ["meeting-prep"],
    subject: "meeting",
    when: "Change this meeting's setup: sharpen the objective, add background, name a concern, set the date.",
    params: {
      "meetingId?": "leave empty for the meeting on screen",
      "title?": "",
      "objectives?": "",
      "background?": "",
      "concerns?": "",
      "date?": ISO,
      "durationMin?": "",
    },
  },
  {
    id: "meetingprep.attendee.add",
    apps: ["meeting-prep"],
    subject: "meeting",
    when: "Someone else is coming.",
    params: {
      "meetingId?": "leave empty for the meeting on screen",
      name: "",
      "role?": "",
      "org?": "",
      "notes?": "what matters about them being there",
    },
  },
  {
    id: "meetingprep.grill.add",
    apps: ["meeting-prep"],
    subject: "meeting",
    when: "Add a question they should be ready for, with the answer you'd give.",
    params: {
      "meetingId?": "leave empty for the meeting on screen",
      question: "",
      "modelAnswer?": "how you would answer it",
    },
  },

  // -------------------------------------------------------- conference planning
  {
    id: "conference.contact.create",
    apps: ["conference-planning"],
    when: "Someone met at the conference goes on the contact list.",
    params: {
      name: "",
      "tier?": "high | medium | low",
      "institution?": "",
      "title?": "",
      "email?": "",
      "interests?": "comma separated",
      "background?": "",
      "meetingObjectives?": "what you want from them",
    },
  },
  {
    id: "conference.meeting.log",
    apps: ["conference-planning"],
    when: "Record a conversation with a contact.",
    params: {
      "contactId?": "leave empty for the contact on screen",
      "date?": ISO,
      "time?": "e.g. 14:30",
      "location?": "",
      notes: "what was said",
    },
  },
  {
    id: "conference.insight.capture",
    apps: ["conference-planning"],
    when: "Capture something learned: from a session, a poster, a conversation at the booth.",
    params: {
      title: "the insight in one line",
      notes: "the detail",
      "sourceType?": "physician | nurse | pharmacist | competitor | other",
      "priority?": "high | medium | low",
    },
  },

  // ------------------------------------------------------------------ insights
  {
    id: "insights.question.add",
    apps: ["insights"],
    when: "Add a question to the survey being built.",
    params: {
      "templateId?": "leave empty for the survey on screen",
      text: "the question as respondents will read it",
      type: "single | multi | boolean | scale | number | text",
      "helpText?": "",
      "section?": "",
    },
  },

  // ------------------------------------------------------------ interview prep
  {
    id: "interview.candidate.create",
    apps: ["interview-prep"],
    when: "Add a candidate.",
    params: {
      firstName: "",
      lastName: "",
      "roleTitle?": "the role they are up for",
      "email?": "",
      "phone?": "",
      "location?": "",
      "status?": "active | screening | interviewing | offer | hired | rejected | on_hold",
    },
  },
  {
    id: "interview.note.add",
    apps: ["interview-prep"],
    subject: "candidate",
    when: "Write a note against a candidate.",
    params: {
      "candidateId?": "leave empty for the candidate on screen",
      "title?": "",
      content: "the note",
    },
  },

  // ------------------------------------------------------------ writing studio
  {
    id: "writer.edit",
    apps: ["writing-studio"],
    subject: "piece",
    when: "Change the piece on screen. What comes out REPLACES what is there, so only ever describe work on the piece that already exists.",
    params: {
      instruction: "the change as a direct order to a writing assistant that has the piece in front of it. Self-contained, imperative, no preamble.",
    },
  },
  {
    id: "writer.create",
    apps: ["writing-studio"],
    when: "A new piece of writing, alongside anything already open.",
    params: {
      docType: "email | document | message | social | summary | other",
      title: "3 to 7 word working name",
      brief: "what it has to be, who it is for, what it must cover",
    },
  },

  // --------------------------------------------------------------- slide studio
  {
    id: "slides.deck.create",
    apps: ["slide-studio"],
    when: "Start a deck.",
    params: { title: "", topic: "what it is about and who it is for" },
  },

  // ------------------------------------------------------------------ dashboard
  {
    id: "dashboard.tile.create",
    apps: ["dashboard"],
    when: "Build a chart from their data and pin it to the dashboard.",
    params: {
      prompt: "the chart in plain language, e.g. 'KOL count by tier for my team'",
      "title?": "what the tile is called",
    },
  },
];

const BY_ID = new Map(ACTIONS.map((a) => [a.id, a]));

export function getAction(id: string): ActionDef | undefined {
  return BY_ID.get(id);
}

/** What this app can do, given what the page happens to be looking at. */
export function actionsFor(app: string, subjectKind?: string): ActionDef[] {
  return ACTIONS.filter((a) => {
    if (a.apps !== "*" && !a.apps.includes(app as ChatAppId)) return false;
    // A verb that works on the thing on screen is only offered when there is
    // one; otherwise the model invents an id and the write lands nowhere.
    if (a.subject && a.subject !== subjectKind) return false;
    return true;
  });
}

/** The catalog as the model reads it. */
export function describeActions(defs: ActionDef[]): string {
  return defs
    .map((a) => {
      const params = Object.entries(a.params)
        .map(([k, v]) => (v ? `${k} (${v})` : k))
        .join(", ");
      return `- ${a.id}: ${a.when}\n  params: ${params || "none"}`;
    })
    .join("\n");
}
