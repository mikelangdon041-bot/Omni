"use client";

// Running what the chat offered to do.
//
// Every write goes through the same client, and therefore the same RLS, as the
// screen the person could have done it on by hand. There is no privileged path:
// if they could not create it themselves, the chat cannot create it for them.
//
// A handoff is the interesting one. Rather than a second implementation of
// another app's creation logic, it asks the model to stand in that app and say
// what it would make (POST /api/chat compose), then runs THAT action through
// this same table. The person stays where they are and gets told when it lands.

import { createClient } from "@/lib/supabase/client";
import { activeCycle } from "@/lib/territory/activity";
import type { Activity } from "@/lib/territory/types";
import { logMeetingToTerritory } from "@/lib/meetingprep/territoryLog";
import { emptyContext } from "@/lib/writer/types";
import { getAction } from "./actions";
import type { ActionOutcome, ChatScopeValue, ProposedAction } from "./types";

const supabase = createClient();

export interface RunEnv {
  userId: string;
  scope: ChatScopeValue;
  /** A line into the thread while something long is happening. */
  note?: (message: string) => void;
}

const str = (v: unknown, max = 4000) => String(v ?? "").trim().slice(0, max);
const html = (v: unknown, max = 8000) => {
  const text = str(v, max);
  if (!text) return "";
  // The rich-text fields store HTML; anything typed into them by a person comes
  // out as paragraphs, so what the chat writes should look the same.
  return text
    .split(/\n{2,}/)
    .map((b) => `<p>${escapeHtml(b).replace(/\n/g, "<br>")}</p>`)
    .join("");
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** An ISO date the model gave us, or now. */
function date(v: unknown): string {
  const raw = str(v, 40);
  if (!raw) return new Date().toISOString();
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

/** The id the model named, or the thing the page is looking at. */
function subjectId(params: Record<string, unknown>, key: string, env: RunEnv): string {
  const given = str(params[key], 80);
  if (given) return given;
  return env.scope.subject?.id || "";
}

function need(value: string, what: string): string {
  if (!value) throw new Error(`I don't know which ${what} that is from here.`);
  return value;
}

export async function runAction(
  a: ProposedAction,
  env: RunEnv,
  depth = 0,
): Promise<ActionOutcome> {
  const def = getAction(a.id);
  if (!def) throw new Error("That isn't something I can do.");
  const p = a.params || {};

  switch (a.id) {
    // ------------------------------------------------------------- global
    case "task.create": {
      const title = need(str(p.title, 200), "task");
      const due = str(p.dueDate, 40);
      const { error } = await supabase.from("tasks").insert({
        user_id: env.userId,
        title,
        notes: str(p.notes, 2000),
        app: env.scope.app === "home" ? "general" : env.scope.app,
        entity_label: env.scope.subject?.label || "",
        link: typeof window === "undefined" ? "" : window.location.pathname,
        due_date: due ? date(due) : null,
      });
      if (error) throw new Error(error.message);
      return { message: `Added to your to-do list: ${title}`, detail: title };
    }

    case "reminder.create": {
      const title = need(str(p.title, 200), "reminder");
      const { error } = await supabase.from("reminders").insert({
        user_id: env.userId,
        kol_id: env.scope.subject?.kind === "kol" ? env.scope.subject.id : null,
        title,
        description: str(p.description, 2000),
        due_date: date(p.dueDate),
      });
      if (error) throw new Error(error.message);
      return {
        message: `Reminder set for ${date(p.dueDate).slice(0, 10)}: ${title}`,
        detail: title,
      };
    }

    case "open":
      return { message: str(p.label, 120) || "Opened", href: str(p.href, 300) };

    case "handoff": {
      if (depth > 0) throw new Error("That handoff tried to hand off again.");
      const app = str(p.app, 40);
      const brief = need(str(p.brief, 6000), "handoff");
      env.note?.(`Working in ${appLabel(app)}…`);
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          action: "compose",
          app,
          brief,
          title: str(p.title, 200),
          sourceApp: env.scope.app,
          sourceContext: env.scope.context,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "That didn't go through.");
      const outcome = await runAction(
        { id: String(json.id), label: "", params: json.params || {} },
        env,
        depth + 1,
      );
      // The composer's sentence is the better one: it knows what it made and
      // why. The handler's is the fallback for when it said nothing useful.
      return {
        ...outcome,
        message: str(json.summary, 400) || outcome.message,
      };
    }

    // ---------------------------------------------------------- territory
    case "territory.kol.create": {
      const first = need(str(p.firstName, 80), "person");
      const { data, error } = await supabase
        .from("kols")
        .insert({
          user_id: env.userId,
          first_name: first,
          last_name: str(p.lastName, 80),
          specialty: str(p.specialty, 200),
          institution: str(p.institution, 200),
          title_position: str(p.titlePosition, 200),
          email: str(p.email, 200),
          phone: str(p.phone, 60),
          tier: str(p.tier, 20),
          how_met: str(p.howMet, 40) || "other",
          other_info: str(p.notes, 4000),
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      const name = `${first} ${str(p.lastName, 80)}`.trim();
      return {
        message: `Added ${name} to your territory.`,
        href: `/territory-planning/kol/${data.id}`,
        detail: name,
      };
    }

    case "territory.kol.update": {
      const id = need(subjectId(p, "kolId", env), "person");
      const patch: Record<string, unknown> = {};
      const map: Record<string, string> = {
        tier: "tier",
        relationshipLevel: "relationship_level",
        institution: "institution",
        titlePosition: "title_position",
        specialty: "specialty",
        email: "email",
        phone: "phone",
        areasOfInterest: "areas_of_interest",
        primaryObjective: "primary_objective",
        otherInfo: "other_info",
      };
      for (const [from, to] of Object.entries(map)) {
        const v = str(p[from], 4000);
        if (v) patch[to] = v;
      }
      if (!Object.keys(patch).length) throw new Error("There was nothing to change.");
      const { error } = await supabase.from("kols").update(patch).eq("id", id);
      if (error) throw new Error(error.message);
      return {
        message: `Updated ${env.scope.subject?.label || "the record"}: ${Object.keys(patch)
          .map((k) => k.replace(/_/g, " "))
          .join(", ")}.`,
        href: `/territory-planning/kol/${id}`,
      };
    }

    case "territory.activity.log": {
      const id = need(subjectId(p, "kolId", env), "person");
      const { data: acts } = await supabase
        .from("activities")
        .select("*")
        .eq("kol_id", id)
        .order("date", { ascending: true });
      const { error } = await supabase.from("activities").insert({
        kol_id: id,
        type: str(p.type, 30) || "note",
        outreach_method: str(p.outreachMethod, 30) || null,
        meeting_cycle: activeCycle((acts as Activity[]) || []),
        date: date(p.date),
        notes: html(p.notes),
      });
      if (error) throw new Error(error.message);
      return {
        message: `Logged against ${env.scope.subject?.label || "them"}.`,
        href: `/territory-planning/kol/${id}`,
      };
    }

    case "territory.meeting.log": {
      const id = need(subjectId(p, "kolId", env), "person");
      await logMeetingToTerritory({
        kolId: id,
        userId: env.userId,
        dateISO: date(p.date),
        method: str(p.method, 30) || "in_person",
        topicsDiscussed: html(p.topicsDiscussed),
        topicsMissed: html(p.topicsMissed),
        followUpActions: html(p.followUpActions),
        reminder: "none",
      });
      return {
        message: `Meeting logged for ${env.scope.subject?.label || "them"}, with the cycle moved on.`,
        href: `/territory-planning/kol/${id}`,
      };
    }

    case "territory.goal.create": {
      const id = need(subjectId(p, "kolId", env), "person");
      const now = new Date();
      const { error } = await supabase.from("quarterly_goals").insert({
        kol_id: id,
        year: Number(p.year) || now.getFullYear(),
        quarter: Number(p.quarter) || Math.floor(now.getMonth() / 3) + 1,
        goal: need(str(p.goal, 500), "goal"),
      });
      if (error) throw new Error(error.message);
      return {
        message: `Goal set for ${env.scope.subject?.label || "them"}.`,
        href: `/territory-planning/kol/${id}`,
      };
    }

    // -------------------------------------------------------- meeting prep
    case "meetingprep.create": {
      const { data, error } = await supabase
        .from("mp_meetings")
        .insert({
          user_id: env.userId,
          title: str(p.title, 200) || "Meeting",
          explain: html(p.explain, 20000),
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return {
        message: `Started a prep: ${str(p.title, 200) || "Meeting"}.`,
        href: `/meeting-prep/${data.id}`,
      };
    }

    case "meetingprep.update": {
      const id = need(subjectId(p, "meetingId", env), "meeting");
      const patch: Record<string, unknown> = {};
      if (str(p.title, 200)) patch.title = str(p.title, 200);
      for (const f of ["objectives", "background", "concerns"] as const) {
        const v = html(p[f]);
        if (v) patch[f] = v;
      }
      if (str(p.date, 40)) patch.date = date(p.date);
      if (Number(p.durationMin)) patch.duration_min = Number(p.durationMin);
      if (!Object.keys(patch).length) throw new Error("There was nothing to change.");
      const { error } = await supabase.from("mp_meetings").update(patch).eq("id", id);
      if (error) throw new Error(error.message);
      return {
        message: `Updated the meeting: ${Object.keys(patch).join(", ")}.`,
        href: `/meeting-prep/${id}`,
      };
    }

    case "meetingprep.attendee.add": {
      const id = need(subjectId(p, "meetingId", env), "meeting");
      const { data } = await supabase
        .from("mp_meetings")
        .select("attendees")
        .eq("id", id)
        .maybeSingle();
      const list = Array.isArray(data?.attendees) ? data.attendees : [];
      const name = need(str(p.name, 120), "attendee");
      const { error } = await supabase
        .from("mp_meetings")
        .update({
          attendees: [
            ...list,
            {
              name,
              role: str(p.role, 120),
              org: str(p.org, 120),
              notes: str(p.notes, 1000),
            },
          ],
        })
        .eq("id", id);
      if (error) throw new Error(error.message);
      return { message: `Added ${name} to the meeting.`, href: `/meeting-prep/${id}` };
    }

    case "meetingprep.grill.add": {
      const id = need(subjectId(p, "meetingId", env), "meeting");
      const { data } = await supabase
        .from("mp_meetings")
        .select("grill")
        .eq("id", id)
        .maybeSingle();
      const list = Array.isArray(data?.grill) ? data.grill : [];
      const question = need(str(p.question, 500), "question");
      const { error } = await supabase
        .from("mp_meetings")
        .update({
          grill: [
            ...list,
            {
              id: `g${Date.now()}`,
              question,
              modelAnswer: str(p.modelAnswer, 3000),
              userAnswer: "",
              coaching: "",
              revealed: false,
            },
          ],
        })
        .eq("id", id);
      if (error) throw new Error(error.message);
      return { message: "Added it to the questions you'll be drilled on.", href: `/meeting-prep/${id}` };
    }

    // ---------------------------------------------------------- conference
    case "conference.contact.create": {
      const conferenceId = need(
        str(p.conferenceId, 80) || env.scope.ids?.conferenceId || "",
        "conference",
      );
      const name = need(str(p.name, 120), "contact");
      const { data, error } = await supabase
        .from("conf_contacts")
        .insert({
          conference_id: conferenceId,
          name,
          tier: ["high", "medium", "low"].includes(str(p.tier, 10))
            ? str(p.tier, 10)
            : "medium",
          institution: str(p.institution, 200),
          title: str(p.title, 200),
          email: str(p.email, 200),
          interests: str(p.interests, 400)
            ? str(p.interests, 400)
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
            : [],
          background: str(p.background, 4000),
          meeting_objectives: str(p.meetingObjectives, 2000),
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return {
        message: `Added ${name} to the contact list.`,
        href: `/conference-planning/${conferenceId}/contacts/${data.id}`,
        detail: name,
      };
    }

    case "conference.meeting.log": {
      const conferenceId = need(
        str(p.conferenceId, 80) || env.scope.ids?.conferenceId || "",
        "conference",
      );
      const contactId = need(
        str(p.contactId, 80) ||
          (env.scope.subject?.kind === "contact" ? env.scope.subject.id : ""),
        "contact",
      );
      const { error } = await supabase.from("conf_contact_meetings").insert({
        conference_id: conferenceId,
        contact_id: contactId,
        meeting_date: date(p.date).slice(0, 10),
        meeting_time: str(p.time, 20),
        location: str(p.location, 200),
        notes: str(p.notes, 4000),
      });
      if (error) throw new Error(error.message);
      return {
        message: "Logged the conversation.",
        href: `/conference-planning/${conferenceId}/contacts/${contactId}`,
      };
    }

    case "conference.insight.capture": {
      const conferenceId = need(
        str(p.conferenceId, 80) || env.scope.ids?.conferenceId || "",
        "conference",
      );
      const priority = str(p.priority, 10);
      const { error } = await supabase.from("conf_insights").insert({
        conference_id: conferenceId,
        user_id: env.userId,
        title: need(str(p.title, 300), "insight"),
        notes: html(p.notes),
        source_type: str(p.sourceType, 60),
        suspected_priority: ["high", "medium", "low"].includes(priority) ? priority : null,
        insight_date: new Date().toISOString().slice(0, 10),
      });
      if (error) throw new Error(error.message);
      return {
        message: "Captured it as an insight.",
        href: `/conference-planning/${conferenceId}/insights`,
      };
    }

    // ------------------------------------------------------------ insights
    case "insights.question.add": {
      const templateId = need(
        str(p.templateId, 80) || env.scope.ids?.templateId || env.scope.subject?.id || "",
        "survey",
      );
      const { count } = await supabase
        .from("survey_questions")
        .select("id", { count: "exact", head: true })
        .eq("template_id", templateId);
      const type = str(p.type, 20);
      const { error } = await supabase.from("survey_questions").insert({
        template_id: templateId,
        text: need(str(p.text, 500), "question"),
        type: ["single", "multi", "boolean", "scale", "number", "text"].includes(type)
          ? type
          : "text",
        help_text: str(p.helpText, 500),
        section: str(p.section, 120),
        sort_order: count || 0,
      });
      if (error) throw new Error(error.message);
      return { message: "Added the question to the survey.", href: "/insights/survey" };
    }

    // ------------------------------------------------------------ interview
    case "interview.candidate.create": {
      const first = need(str(p.firstName, 80), "candidate");
      const { data, error } = await supabase
        .from("candidates")
        .insert({
          user_id: env.userId,
          first_name: first,
          last_name: str(p.lastName, 80),
          role_title: str(p.roleTitle, 200),
          email: str(p.email, 200),
          phone: str(p.phone, 60),
          location: str(p.location, 200),
          status: str(p.status, 30) || "active",
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      const name = `${first} ${str(p.lastName, 80)}`.trim();
      return {
        message: `Added ${name}.`,
        href: `/interview-prep/candidate/${data.id}`,
        detail: name,
      };
    }

    case "interview.note.add": {
      const id = need(subjectId(p, "candidateId", env), "candidate");
      const { error } = await supabase.from("interview_notes").insert({
        candidate_id: id,
        user_id: env.userId,
        title: str(p.title, 200) || "Note",
        content: html(p.content),
      });
      if (error) throw new Error(error.message);
      return { message: "Note saved.", href: `/interview-prep/candidate/${id}` };
    }

    // ------------------------------------------------------- writing studio
    case "writer.edit": {
      const instruction = need(str(p.instruction, 4000), "change");
      if (!env.scope.onEdit) throw new Error("There's nothing on screen to change.");
      await env.scope.onEdit(instruction);
      return { message: "Done." };
    }

    case "writer.create": {
      const title = str(p.title, 200) || "Untitled";
      const { data, error } = await supabase
        .from("writer_docs")
        .insert({
          user_id: env.userId,
          doc_type: str(p.docType, 30) || "other",
          mode: "create",
          title,
          context: {
            ...emptyContext(),
            fidelity: "draft",
            brief: html(p.brief, 20000),
          },
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return {
        message: `Started it: ${title}.`,
        href: `/writing-studio/${data.id}?go=1`,
        detail: title,
      };
    }

    // --------------------------------------------------------- slide studio
    case "slides.deck.create": {
      const title = str(p.title, 200) || "Untitled deck";
      const { data, error } = await supabase
        .from("sl_decks")
        .insert({ user_id: env.userId, title, source: "topic" })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return {
        message: `Created the deck: ${title}. Open it and the outline step is waiting with your topic.`,
        href: `/slide-studio/${data.id}`,
        detail: title,
      };
    }

    // ------------------------------------------------------------ dashboard
    case "dashboard.tile.create": {
      const prompt = need(str(p.prompt, 1000), "chart");
      const proposed = await fetch("/api/dashboard/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ action: "propose", prompt }),
      });
      const pj = await proposed.json();
      if (!proposed.ok) throw new Error(pj.error || "Couldn't work out that chart.");
      const spec = pj.spec || {};
      const res = await fetch("/api/dashboard/tiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          title: str(p.title, 200) || prompt.slice(0, 60),
          datasetId: spec.datasetId,
          spec,
        }),
      });
      const tj = await res.json();
      if (!res.ok) throw new Error(tj.error || "Couldn't pin that chart.");
      return { message: "Pinned it to the dashboard.", href: "/dashboard" };
    }

    default:
      throw new Error("That isn't something I can do yet.");
  }
}

function appLabel(app: string): string {
  const labels: Record<string, string> = {
    "territory-planning": "Territory Planning",
    "meeting-prep": "Meeting Prep",
    insights: "Insights",
    "conference-planning": "Conference Planning",
    "writing-studio": "Writing Studio",
    "slide-studio": "Slide Studio",
    "interview-prep": "Interview Prep",
    dashboard: "Dashboard",
    home: "your to-do list",
  };
  return labels[app] || app;
}
