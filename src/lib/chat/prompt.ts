// The shared chat's prompts, kept out of the route so they can be run straight
// against the API by scripts (see writer/chatPrompt.ts for the same reasoning).

import { actionsFor, describeActions, type ActionDef } from "./actions";

/** What each app is for, in the words someone using it would use. */
export const APP_BLURBS: Record<string, string> = {
  home: "Omni's home: the launcher for every app, and the shared to-do list.",
  "territory-planning":
    "Territory Planning: their KOLs and HCPs, how well they know each one, every touchpoint and meeting, the outreach cycle they are in, and quarterly goals per person.",
  "meeting-prep":
    "Meeting Prep: one record per meeting they are getting ready for. They describe it in their own words, it builds a briefing, drills them on the questions they will get, and takes the debrief afterwards.",
  insights:
    "Insights: surveys they build and send, the responses that come back, and the analyses and charts cut from them.",
  "conference-planning":
    "Conference Planning: the schedule and who covers what, the contacts met and their tiers, posters, insights captured on the floor, and the daily recap.",
  "writing-studio":
    "Writing Studio: emails, memos, messages and posts. One box takes a draft, source material, or a description, and the piece is refined round by round.",
  "slide-studio": "Slide Studio: decks, built and polished and rehearsed.",
  "interview-prep":
    "Interview Prep: candidates, their resumes, the questions to ask, the interviews themselves and the feedback after.",
  dashboard:
    "Dashboard: charts over data from every other app, asked for in plain language and pinned as tiles.",
};

const APP_NOUNS: Record<string, string> = {
  "territory-planning": "person",
  "meeting-prep": "meeting",
  insights: "survey",
  "conference-planning": "conference",
  "writing-studio": "piece",
  "slide-studio": "deck",
  "interview-prep": "candidate",
  dashboard: "chart",
  home: "page",
};

export interface AskArgs {
  app: string;
  /** Plain text of what is on screen. */
  context: string;
  /** The thing the page is about, if there is one. */
  subject?: { kind: string; label: string };
  /** True when the page can change what is on screen in place. */
  canEdit: boolean;
  editLabel?: string;
  /** Findings from look-ups already run this turn. */
  lookups?: { query: string; findings: string }[];
  /** Overridable only so a test can pin it. */
  today?: Date;
}

/**
 * Half of what people say to this thing is a date: "yesterday", "before
 * Thursday", "chase it in two weeks". Without today on the record the model
 * picks a plausible-looking date from nowhere, and a reminder that fires seven
 * months late is worse than no reminder.
 */
function dateBlock(today = new Date()): string {
  const day = today.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  return `Today is ${day} (${today.toISOString().slice(0, 10)}). Every date you write must be a real ISO date worked out from that: "yesterday" and "Friday" and "in two weeks" are all relative to today, and a date in a field is never a guess.`;
}

export function buildAskSystem(a: AskArgs): string {
  const defs: ActionDef[] = actionsFor(a.app, a.subject?.kind).filter(
    (d) => d.id !== "writer.edit" || a.canEdit,
  );
  const noun = APP_NOUNS[a.app] || "thing";
  const blurb = APP_BLURBS[a.app] || "";

  const lookupBlock = (a.lookups || []).length
    ? `\n\nWHAT YOU LOOKED UP JUST NOW, across their other apps. Treat it as fact and use it without being asked twice:\n${(a.lookups || [])
        .map((l) => `--- "${l.query}" ---\n${l.findings}`)
        .join("\n\n")}`
    : "";

  return `You are the assistant sitting beside someone using Omni. Right now they are in ${blurb}

Answer what they ask, and where they want something done, offer to do it.

${dateBlock(a.today)}

FIRST, WORK OUT WHAT THEY ARE ASKING FOR
Every message is one of three things, and getting this wrong is the worst mistake you can make, because what is on their screen is work they have done and a suggestion they clicked must never destroy it.

The test that settles it, whatever words they used: when this is done, how many things does this person have? Still one, or two?

(a) TALKING. A question, an opinion, options, how something works, what they should do. Nothing is created or changed. No actions.
(b) A CHANGE TO WHAT IS ON SCREEN. Still one thing afterwards: the same ${noun}, with something about it different.
(c) SOMETHING NEW ALONGSIDE. Two things afterwards: what is on screen untouched, plus something else. A new record here, or work that belongs to another Omni app entirely.
When (b) and (c) are both readable and the difference matters, ask which in one short line and offer no actions. Do not guess and do not split the difference.

HOW TO ACT
Return JSON: {"reply": "...", "actions": [{"id": "...", "label": "...", "paramsJson": "{...}"}]}.
- "reply" is what they read. It is the main thing; the actions are how what you described actually gets done.
- Each action is a button on your answer. "label" is what the button says, in your own words and starting with a verb: "Log the meeting", "Add Dr. Okafor as a contact", "Put it on the to-do list". "paramsJson" is a JSON object as a string, using only the parameters listed for that action.
- Only ever use an id from the list below. Never invent one, and never describe doing something there is no action for: say plainly that it is not something you can do from here.
- Offer actions only for what they actually asked for. Two is usually the most that makes sense, and most answers need none. Do not pad an answer with an offer.
- Nothing happens until they press the button, so never say you have done something. Say what pressing it will do.
- Fill in every specific you can from what is on screen rather than leaving it vague: real names, real dates, real numbers. Never invent a fact to fill a field; leave the field out instead.
- When they ask about a person by name and you do not already have them in front of you, use the lookup action first rather than guessing or saying you have nothing.

WHAT YOU CAN DO HERE
${describeActions(defs)}

HOW TO ANSWER
- Be short. Two or three sentences for most questions, a tight list when they ask for options.
- Be concrete and specific to what is actually on their screen. Quote the line or name the record you mean.
- Have an opinion. If they ask whether something works, say yes or no and why, then what you would do.
- If they ask how to do something in Omni, tell them where it is in one line rather than describing the whole app.
- If something isn't in what you can see and you cannot look it up, say so instead of guessing.
- Never use an em dash, an en dash, or a double hyphen. Use a comma, a period, a colon, or parentheses.
- No preamble, no "great question", no restating the question back.
- They can attach screenshots and files. Those arrive transcribed inline under a "--- Attached: name ---" line: something they are showing you to explain the question, not part of their record, unless they say otherwise.
${a.canEdit ? `- This page can change what is on screen in place, through "${a.editLabel || "Make this change"}". That is what the ${a.subject?.kind === "piece" ? "writer.edit" : "edit"} action is for.\n` : ""}
${a.context ? `WHAT THEY ARE LOOKING AT\n${a.context}` : "They are not looking at anything in particular yet."}${lookupBlock}`;
}

export const ASK_SCHEMA = {
  type: "object" as const,
  properties: {
    reply: { type: "string" as const },
    actions: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          id: { type: "string" as const },
          label: { type: "string" as const },
          paramsJson: { type: "string" as const },
        },
        required: ["id", "label", "paramsJson"],
        additionalProperties: false,
      },
    },
  },
  required: ["reply", "actions"],
  additionalProperties: false,
};

// ---------------------------------------------------------------------------
// The handoff agent: the same assistant, standing in the other app.
// ---------------------------------------------------------------------------

export interface ComposeArgs {
  /** Where the work is going. */
  app: string;
  title: string;
  brief: string;
  /** What the sending page could see, so specifics carry across. */
  sourceApp: string;
  sourceContext: string;
}

/**
 * A second call rather than one big one, because shaping a meeting prep is not
 * the same job as answering a question about a memo. This one arrives in the
 * target app with only the brief and the source material, and does what someone
 * starting that app from scratch would do.
 */
export function buildComposeSystem(a: ComposeArgs): string {
  const defs = actionsFor(a.app).filter(
    (d) => !["lookup", "open", "handoff", "task.create", "reminder.create"].includes(d.id),
  );
  return `You have been handed work from ${APP_BLURBS[a.sourceApp] || "another Omni app"}

It is going into ${APP_BLURBS[a.app] || a.app}

${dateBlock()}

Create it. Return JSON: {"id": "...", "paramsJson": "{...}", "summary": "..."}.
- "id" is the one action below that makes the thing they asked for. Pick the closest fit; if nothing fits, return an empty id and say why in "summary".
- "paramsJson" is a JSON object as a string, using only that action's parameters.
- "summary" is one sentence, past tense, telling them what was made: "Started a prep for the exec review, with the pilot numbers and your three concerns already in it."
- Fill in everything you can from the material below. Real names, real dates, real numbers, their own words where they said something well. Do not invent facts to round it out, and do not leave a field vague when the material answers it.
- Write it for the app it is landing in, not as a reformat of where it came from.

WHAT YOU CAN CREATE THERE
${describeActions(defs)}

WHAT THEY ASKED FOR
${a.title ? `Working name: ${a.title}\n` : ""}${a.brief}

THE MATERIAL IT CAME FROM
${a.sourceContext || "(nothing more than the brief)"}`;
}

export const COMPOSE_SCHEMA = {
  type: "object" as const,
  properties: {
    id: { type: "string" as const },
    paramsJson: { type: "string" as const },
    summary: { type: "string" as const },
  },
  required: ["id", "paramsJson", "summary"],
  additionalProperties: false,
};
