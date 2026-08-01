# Chat everywhere: what it would take, and what it would do

Written 2026-07-31, after the Writing Studio chat learned to hand work off
instead of overwriting the piece on screen. For assessment, not a commitment.

**Built 2026-08-01.** The shared chat now ships in every app: one bubble mounted
in the app shell, per-page scope registration, a 24-verb action catalog, the
cross-app lookup (level 3 read) and the handoff agent (levels 1 and 2). What
follows is the plan as written; §7 at the end records what actually landed and
what did not.

## 1. Where chat actually exists today

Short answer: **it does not exist in all the apps. It exists in one and a half.**

| App | What's there now |
| --- | --- |
| **Writing Studio** | A real chat. Conversation history, sees the draft and the current version, takes screenshots and files, and can act three ways: answer, change the piece, or start something new alongside it. `WriterChat.tsx` + `chatPrompt.ts`. |
| **Dashboard** | A prompt box, not a chat. One shot: plain language in, chart spec out, render, optionally save as a tile. No history, so "now split that by tier" does not work. `DashboardChat.tsx`. |
| Meeting Prep | No chat. Nine fixed AI buttons: brief, autofill, ideas, grill, coach, debrief, capture, simplify, recap email. |
| Slide Studio | No chat. Eight fixed actions: outline, refine outline, content, refine slide, revise deck, script, coach, image. |
| Conference Planning | No chat. Extractors and summarizers: insights, daily/meeting summary, poster summary, schedule parsing, deck template mapping. |
| Insights | No chat. Natural language to analysis spec, plus suggested analyses. |
| Territory Planning | No chat. Two helpers: generate meeting prep, summarize meeting. |
| Interview Prep | No chat. Question generation and suggestion, resume parsing. |
| Home / Tasks | No chat, no AI. |

So: seven apps have AI but no conversation. The AI is behind buttons someone
has to know exist, and each button does exactly one thing.

## 2. The contract worth copying

What made the Writing Studio fix work is not the writing part. It is that every
message gets sorted into one of three outcomes before anything happens:

- **(a) Answer.** A question, an opinion, options. Nothing is created or changed.
- **(b) Change what I'm looking at.** The result replaces the thing on screen.
  One object afterwards.
- **(c) Make something new alongside.** Two objects afterwards, the original
  untouched. In-app or in another app.

The test that sorts them, which needs no list of phrasings: **when this is done,
does the person have one thing or two?** That question ports to every app in the
suite. Everything below is just working out what (b) and (c) mean per app.

Each app then needs three things declared: **what the chat can see**, **what it
may change**, and **what it may create**. That is the whole per-app cost.

---

## 3. Per-app: what we'd want the chat to do

### Territory Planning
*Sees: the KOL (profile, tier, relationship level, how met), their activity
history, meetings, the active cycle, quarterly goals, reminders, the map.*

- (a) "When did I last see Dr. Chen and what did we actually talk about?"
- (a) "Who in my territory have I not touched this cycle?"
- (a) "Am I going to hit my Q3 goal? What's the gap?"
- (a) "Which of my high-tier KOLs are drifting?" (relationship level down, or no activity in N weeks)
- (b) Update the KOL profile from what you just told it: "she's moved to Mass General and is now co-chairing the guidelines committee"
- (b) Re-tier a KOL, with the reason written into the record
- (b) Rewrite a meeting summary that reads badly
- (c) Log an activity or meeting from a sentence: "spoke to Chen Tuesday, 20 min, she wants the trial data"
- (c) Set a reminder or a follow-up
- (c) A quarterly goal from "I want to get all my tier ones to advisory-board-ready by December"
- (c) Add a new KOL from a business card photo or a signature block

### Meeting Prep
*Sees: the whole meeting record — explain, objectives, background, concerns,
attendees, documents, the generated brief sections, grill Q&A, debrief.*

- (a) "What am I missing about this person?"
- (a) "What's the hardest question I'm going to get?"
- (a) "Is this objective actually achievable in 30 minutes?"
- (b) Rework one brief section without regenerating the whole brief
- (b) Change the whole brief's angle: "make this about the data, not the relationship"
- (b) Add an attendee and re-cut the brief around them
- (b) Harder or easier grill questions
- (c) The follow-up email, from the debrief (exists as a button, belongs in chat)
- (c) Talking points or a one-pager to hold during the meeting
- (c) The prep for the *next* meeting, seeded from this one's debrief
- (c) Tasks from the follow-up actions

### Insights
*Sees: the survey template and its questions, the responses, the current
analysis spec and chart.*

- (a) "What's the most surprising thing in this data?"
- (a) "Is this sample big enough to say that?"
- (a) "Which question is doing no work?" (everyone answers the same way)
- (b) Change the analysis: group differently, filter, switch chart type
- (b) Rewrite a leading or double-barrelled question
- (b) Reorder or re-branch the survey
- (c) A new analysis alongside the current one, saved separately
- (c) A follow-up survey aimed at what this one turned up
- (c) The write-up of what the data says (→ Writing Studio)

### Conference Planning
*Sees: the conference, the schedule and assignments, contacts and tiers,
posters, session notes, insights captured, booth logs, daily summaries.*

- (a) "Who haven't we covered?" (sessions with no assignment, tier-one contacts with no meeting)
- (a) "What came out of yesterday that I should act on?"
- (a) "Is anyone double-booked Thursday?"
- (b) Reassign a session, move a shift, fix a clash
- (b) Re-tier a contact from what you learned talking to them
- (b) Clean up a session note into something readable
- (c) Log a contact and a meeting from "just met Dr. Okafor at the poster, she runs the registry, wants our protocol"
- (c) Capture an insight from a photo of a poster or a slide
- (c) The daily summary, or the recap email to the team
- (c) Push a conference contact into Territory Planning as a KOL

### Writing Studio *(built)*
- (a) Is it too long, does the ask land, how does it read to them
- (b) Any edit to the piece
- (c) Another piece from the same material; a meeting prep for the conversation it's about

### Slide Studio
*Sees: the deck, every slide's elements, the theme, versions, practice runs.*

- (a) "Where does this drag?"
- (a) "Which slide is doing two jobs?"
- (a) "Will this land with a room of payers rather than clinicians?"
- (b) Rework one slide, or the whole deck's arc
- (b) Cut it to fit the time: "I have 12 minutes, not 25"
- (b) Fix the theme: contrast, font sizes, consistency
- (c) The speaker script or the handout
- (c) A backup-slides appendix for the questions you'll get
- (c) A short version of the deck for a different audience, kept separately
- (c) The prep for the meeting where you present it (→ Meeting Prep)

### Interview Prep
*Sees: the candidate, the resume, assigned questions, the interview record,
notes, feedback and scorecards.*

- (a) "What's the gap between this resume and the role?"
- (a) "What did the other interviewers already cover?" (so you don't repeat)
- (a) "Is this feedback specific enough to defend?"
- (b) Sharpen a question, re-order the plan, swap a question out
- (b) Rewrite feedback that is vague or unfair-sounding
- (c) A tailored question set for this candidate
- (c) The debrief summary across interviewers
- (c) The offer or rejection note (→ Writing Studio)

### Dashboard
*Sees: the datasets it already knows (KOLs, activities, meetings, survey
responses, prepped meetings, conference contacts and events), plus imports, and
the user's scope (self / team / org).*

- (a) Actual follow-ups: "now split that by tier", "why is March low?"
- (a) "What should I be looking at that I'm not?"
- (b) Change the chart: regroup, filter, re-scope, restyle
- (b) Edit a saved tile by talking to it
- (c) Save as a tile (exists), or build a whole starter dashboard from a sentence
- (c) The commentary on what the chart shows (→ Writing Studio)
- (c) A scheduled digest of a tile

### Home / Tasks
- (a) "What's actually urgent this week?"
- (a) "What have I been putting off?"
- (b) Reschedule, reprioritize, mark done
- (c) Tasks from anything you paste
- (c) The one place to say "I need to write X / prep for Y / chart Z" and be sent to the right app with it started

---

## 4. Cross-app: three different things, not one

The user's instinct is right, that cross-app is mostly the same machinery. But
it splits into three levels, and only the first is built.

### Level 1 — Create over there, and take me to it *(built, Writing Studio only)*
The material goes across, the object gets created, you land on it. Writing Studio
→ Meeting Prep works this way today; Writing Studio → a second piece too.

Worth having:

| From | To | Trigger |
| --- | --- | --- |
| Writing Studio | Meeting Prep | "get me ready to present this" *(built)* |
| Writing Studio | Slide Studio | "turn this memo into a deck" |
| Meeting Prep | Writing Studio | the follow-up email, the recap, the pre-read |
| Meeting Prep | Meeting Prep | the next meeting in the sequence, seeded from the debrief |
| Territory | Meeting Prep | "prep me for Chen" *(a version of this exists as a button)* |
| Territory | Writing Studio | the outreach email to a KOL, with their history as context |
| Conference | Territory | promote a contact to a KOL |
| Conference | Writing Studio | the recap to the team, the thank-you to a contact |
| Insights | Writing Studio | the write-up of what the data says |
| Insights | Slide Studio | the results deck |
| Slide Studio | Meeting Prep | prep for presenting the deck |
| Interview | Writing Studio | offer / rejection / scheduling notes |
| Dashboard | Writing Studio | commentary on a chart |
| Any | Dashboard | "chart this over time" from a list you're looking at |

### Level 2 — Just do it, don't take me anywhere *(nothing built)*
The thing the user pointed at as "maybe doing it in the background". These
should never navigate: you stay where you are and the chat confirms.

- "Add that to my to-do list" — from any app, any chat. Tasks is already global.
- "Log this to Territory" — Meeting Prep already has the code for it
  (`territoryLog.ts`), but it's a button in one place, not a thing you can say.
- "Remind me to chase this in two weeks"
- "Save that as an insight" — from a conference session note, a meeting debrief,
  a survey comment
- "Add her to my KOL list" — from a conference contact, a meeting attendee, an
  email signature you pasted
- "Put this on the conference schedule"
- "Save this chart to my dashboard"

These are the ones that make the suite feel like one product rather than nine.
They're also the cheapest: each is a single insert against a table the app
already owns, and the confirmation is one line in the chat.

### Level 3 — Answer using another app's data *(nothing built)*
Today the Writing Studio chat can see the piece and nothing else. It cannot see
that you met this person three weeks ago, and that is the thing a colleague
would know.

- Writing to a KOL: the chat should see their territory history, last meeting,
  what you promised, what they pushed back on
- Prepping a meeting: it should see the last debrief, and any conference contact
  record for the same person
- Writing a conference recap: it should see the contacts and insights captured
- Any chat: "what do I already have on this person?" answered across territory,
  conference, meeting prep and interviews at once

This is the biggest unlock and the largest piece of work: it needs a shared
read layer (something like the dashboard's dataset catalog, but for narrative
context rather than charts) plus the scope rules that already exist there
(self / team / org).

---

## 5. What I'd build, in order

1. **Extract the chat.** One `<OmniChat>` component plus a per-app manifest:
   what it can see, what (b) may change, what (c) may create. The Writing Studio
   chat is already 90% of this; the app-specific part is a system prompt and a
   handler map.
2. **Level 2 verbs first.** Tasks, reminders, log-to-territory, save-as-insight.
   Small, safe, no navigation, and they are what people actually say out loud.
3. **Meeting Prep and Dashboard next.** Meeting Prep has the most buttons nobody
   finds; Dashboard already has a prompt box that only needs history and the
   (b) verb to become a chat.
4. **Level 1 handoffs** as each app gains its chat, using the same handoff shape
   Writing Studio now has.
5. **Level 3 shared context** last, and probably narrow at first: person-centric
   only ("everything Omni knows about this human"), which covers most of the
   value.

## 6. Two things to decide

- **Confirmation.** Level 2 actions are writes to other apps' data. Writing
  Studio's rule is that nothing happens without a button press, and that rule is
  worth keeping suite-wide rather than letting a chat write silently.
- **Scope.** Level 3 has to respect the dashboard's existing self / team / org
  rules, or the chat becomes a way to read around them.

---

## 7. What actually landed (2026-08-01)

One chat, mounted once in the app shell, in every app.

**The runtime**

- `lib/chat/actions.ts` — the single catalog of what the chat may do. 24 verbs
  across the nine apps, each an id, the apps that offer it, one line on when to
  reach for it, and its parameters. Adding a verb is an entry here plus a
  handler; nothing else.
- `lib/chat/prompt.ts` — the ask prompt (the one/two test, the action catalog
  for wherever you are, today's date) and the compose prompt for handoffs.
- `lib/chat/run.ts` — the handlers. Every write goes through the same client and
  the same RLS as the screen the person could have used by hand.
- `lib/chat/lookup.ts` — the cross-app read.
- `api/chat` — `ask` and `compose`. Vets every action id against what that app
  actually offers, and drops anything else rather than shipping it to the client
  to fail on.
- `components/chat/OmniChat.tsx` and `ChatScope.tsx` — the bubble, and how pages
  say what they're looking at. A page registers its scope; a layout registers a
  base scope for everything under it (that's how any conference tab knows its
  conference id).

**Levels, as scoped in §4**

- Level 1, create and navigate: any handoff, plus the link on the result.
- Level 2, do it in place: tasks, reminders, logging a meeting, capturing an
  insight, adding a contact. No navigation, the chat reports back.
- Level 3, read across: `lookup` runs server-side inside the answer rather than
  behind a button, because waiting for a click to find out what Omni knows about
  a person makes the answer useless. Cross-app *writing* is the handoff agent: it
  asks the model to stand in the target app and say what it would create there,
  then runs that through the same handler an in-app request would use.

**Pages that register scope**

Territory (list, KOL), Meeting Prep (list, meeting), Conference (base id on
every tab, dashboard, contact), Insights (survey builder), Interview (candidate),
Slide Studio (deck), Writing Studio (piece, with refine), Dashboard. Anywhere
else falls back to the app the route belongs to.

**Not built**

- Writing Studio's old `WriterChat` is gone; its behaviour moved into the shared
  one, including refine-in-place and the writer/meeting-prep handoffs.
- Editing a chart spec by talking to it, editing slides element by element, and
  regenerating a single brief section are still buttons in their own pages.
- Insights has one verb (add a question); analyses are still built in the page.
- Nothing writes without a button press, and there is no schedule or digest.
