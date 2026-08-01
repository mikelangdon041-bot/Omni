// "What does Omni already know about this person?"
//
// The chat can see the page it is sitting on and nothing else, which is exactly
// the gap a colleague would fill: they would remember that you met this person
// three weeks ago and promised them the trial data. This reads across the apps
// for a name or a topic and hands back a digest.
//
// Runs server-side on the caller's own session, so RLS decides what comes back:
// there is no way to read around it from here, and nothing needs a service key.

import type { SupabaseClient } from "@supabase/supabase-js";

type DB = SupabaseClient;

/** Plain text out of the rich-text columns, short enough to sit in a prompt. */
function plain(html: string, max = 400): string {
  return (html || "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6])>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function when(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

/**
 * Everything the person's own apps hold about `query`, oldest concern first:
 * who they are, then what has actually happened with them.
 */
export async function crossAppLookup(supabase: DB, query: string): Promise<string> {
  const q = query.trim().slice(0, 120);
  if (!q) return "";
  const like = `%${q}%`;
  const sections: string[] = [];

  // Territory: the person and their history. The richest source by far, so it
  // goes first and gets the most room.
  const { data: kols } = await supabase
    .from("kols")
    .select(
      "id,first_name,last_name,specialty,institution,title_position,tier,relationship_level,primary_objective,areas_of_interest,other_info",
    )
    .or(`first_name.ilike.${like},last_name.ilike.${like},institution.ilike.${like}`)
    .limit(4);

  for (const k of kols || []) {
    const name = `${k.first_name} ${k.last_name}`.trim();
    const head = [
      `TERRITORY — ${name}`,
      [k.title_position, k.specialty, k.institution].filter(Boolean).join(", "),
      k.tier && `Tier ${k.tier}`,
      k.relationship_level && `Relationship: ${String(k.relationship_level).replace(/_/g, " ")}`,
      k.primary_objective && `Objective: ${plain(k.primary_objective, 200)}`,
      k.areas_of_interest && `Interests: ${plain(k.areas_of_interest, 200)}`,
      k.other_info && `Notes: ${plain(k.other_info, 300)}`,
    ]
      .filter(Boolean)
      .join("\n");

    const [{ data: meetings }, { data: acts }] = await Promise.all([
      supabase
        .from("meetings")
        .select("date,meeting_method,topics_discussed,follow_up_actions")
        .eq("kol_id", k.id)
        .order("date", { ascending: false })
        .limit(3),
      supabase
        .from("activities")
        .select("date,type,outreach_method,notes")
        .eq("kol_id", k.id)
        .order("date", { ascending: false })
        .limit(5),
    ]);

    const history = [
      ...(meetings || []).map(
        (m) =>
          `  ${when(m.date)} meeting (${m.meeting_method || "unspecified"}): ${plain(
            m.topics_discussed,
            300,
          )}${m.follow_up_actions ? ` | follow-up: ${plain(m.follow_up_actions, 200)}` : ""}`,
      ),
      ...(acts || []).map(
        (a) =>
          `  ${when(a.date)} ${a.type}${a.outreach_method ? ` (${a.outreach_method})` : ""}: ${plain(
            a.notes,
            200,
          )}`,
      ),
    ];
    sections.push(history.length ? `${head}\nRecent history:\n${history.join("\n")}` : head);
  }

  // Conference contacts: often the same human, met somewhere else.
  const { data: contacts } = await supabase
    .from("conf_contacts")
    .select("name,tier,institution,title,background,meeting_objectives,interests")
    .ilike("name", like)
    .eq("archived", false)
    .limit(4);
  for (const c of contacts || []) {
    sections.push(
      [
        `CONFERENCE CONTACT — ${c.name}`,
        [c.title, c.institution].filter(Boolean).join(", "),
        c.tier && `Tier: ${c.tier}`,
        (c.interests || []).length && `Interests: ${(c.interests || []).join(", ")}`,
        c.background && `Background: ${plain(c.background, 300)}`,
        c.meeting_objectives && `Objectives: ${plain(c.meeting_objectives, 200)}`,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  // Meetings prepped for, and how they actually went.
  const { data: preps } = await supabase
    .from("mp_meetings")
    .select("id,title,date,meeting_type,explain,objectives,attendees,debrief")
    .or(`title.ilike.${like},explain.ilike.${like}`)
    .order("updated_at", { ascending: false })
    .limit(3);
  for (const m of preps || []) {
    const debrief = m.debrief as { summary?: string; whatWorked?: string } | null;
    sections.push(
      [
        `MEETING PREP — ${m.title || "(untitled)"}${m.date ? ` on ${when(m.date)}` : ""}`,
        (m.attendees as { name?: string }[] | null)?.length &&
          `Attendees: ${(m.attendees as { name?: string }[])
            .map((a) => a?.name)
            .filter(Boolean)
            .join(", ")}`,
        m.objectives && `Objectives: ${plain(m.objectives, 250)}`,
        !m.objectives && m.explain && `In their words: ${plain(m.explain, 250)}`,
        debrief?.summary && `Debrief: ${plain(debrief.summary, 300)}`,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  // What they have already written about it, so a second piece doesn't
  // contradict the first.
  const { data: docs } = await supabase
    .from("writer_docs")
    .select("id,title,doc_type,subject,content,updated_at")
    .or(`title.ilike.${like},subject.ilike.${like}`)
    .order("updated_at", { ascending: false })
    .limit(3);
  for (const d of docs || []) {
    sections.push(
      `WRITING — ${d.title || d.subject || "(untitled)"} (${d.doc_type}, ${when(
        d.updated_at,
      )})\n${plain(d.content, 400)}`,
    );
  }

  // Candidates, for the interview side of the house.
  const { data: cands } = await supabase
    .from("candidates")
    .select("first_name,last_name,role_title,status,summary")
    .or(`first_name.ilike.${like},last_name.ilike.${like},role_title.ilike.${like}`)
    .limit(3);
  for (const c of cands || []) {
    sections.push(
      `CANDIDATE — ${c.first_name} ${c.last_name}${c.role_title ? `, ${c.role_title}` : ""} (${
        c.status
      })${c.summary ? `\n${plain(c.summary, 300)}` : ""}`,
    );
  }

  if (!sections.length) return `Nothing in any app matches "${q}".`;
  return sections.join("\n\n");
}
