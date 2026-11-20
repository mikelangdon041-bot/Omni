import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { anthropic, CHECK_MODEL } from "@/lib/anthropic";
import { cleanEmail, resolvePerson, type DirectoryPerson } from "@/lib/directory";
import { stripEmDashes } from "@/lib/writer/sanitize";
import { pickSamples } from "@/lib/writer/voice";

export const runtime = "nodejs";
export const maxDuration = 120;

// Drafts the reminder and the follow-up for "Remind or follow up" in the
// Outlook pane. Nothing is scheduled here: the pane shows both for the user to
// edit, then saves them to email_followups. See lib/followups.ts.

const SCHEMA = {
  type: "object" as const,
  properties: {
    // Who the reminder and follow-up go to, as written; looked up afterwards.
    to: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: { name: { type: "string" as const }, email: { type: "string" as const } },
        required: ["name", "email"],
        additionalProperties: false,
      },
    },
    // Local "YYYY-MM-DDTHH:MM" when the email gives a reason for a different
    // day than a week out (a deadline, an event); "" for the default.
    remindAt: { type: "string" as const },
    reminder: { type: "string" as const },
    followup: { type: "string" as const },
    why: { type: "string" as const },
  },
  required: ["to", "remindAt", "reminder", "followup", "why"],
  additionalProperties: false,
};

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const thread = String(body?.thread || "").slice(0, 30000);
  const subject = String(body?.subject || "").slice(0, 300);
  const request = String(body?.request || "").slice(0, 2000);
  const now = String(body?.now || "").slice(0, 80);
  const me = {
    name: String(body?.me?.name || "").slice(0, 120),
    email: cleanEmail(String(body?.me?.email || "")),
  };
  const onThread: DirectoryPerson[] = (Array.isArray(body?.people) ? body.people : [])
    .slice(0, 80)
    .map((p: { name?: unknown; email?: unknown }) => ({
      name: String(p?.name || "").slice(0, 120),
      email: cleanEmail(String(p?.email || "")),
    }))
    .filter((p: DirectoryPerson) => p.email && p.email !== me.email);
  const signature = String(body?.signature || "").slice(0, 2000);
  const signsOff = !!body?.signsOff;
  const voices: { name: string; text: string; samples?: string }[] = (
    Array.isArray(body?.voices) ? body.voices : []
  ).slice(0, 4);
  const swaps: { avoid: string; prefer: string }[] = (
    Array.isArray(body?.wordSwaps) ? body.wordSwaps : []
  ).slice(0, 60);
  if (!thread.trim() && !request.trim())
    return NextResponse.json({ error: "Open an email first." }, { status: 400 });

  const who = me.name || "the user";
  const voiceBlock = voices
    .map((v) => {
      const samples = pickSamples(String(v.samples || ""), 80, 3);
      return `${String(v.text || "").slice(0, 3000)}${
        samples.length ? `\n\nThings ${who} actually wrote:\n${samples.join("\n---\n")}` : ""
      }`;
    })
    .join("\n\n");

  try {
    const res = await anthropic().messages.create(
      {
        model: CHECK_MODEL,
        max_tokens: 8000,
        output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
        system: `You write two short emails for ${who}${me.email ? ` <${me.email}>` : ""}, about the email they have open. Both go out later as replies on the same thread, from them.

It is now ${now || "unknown"} in their time zone.

1. reminder: a nudge sent on a later day, before anything is overdue. It reminds the people what this thread needs from them, or about the event it sets up, with the date, time, deadline or ask from the email in it. If they said what it should say, it says that.
2. followup: sent only if nobody has answered by then. Shorter, polite and direct: "Following up on this" in their own words, restating the one thing still needed.

Rules:
- Both are plain text, ready to send verbatim, laid out like a real email so it is easy to read:
  - The greeting alone on the first line ("Hi Sara and Adam," / "Hi all,"), then a blank line.
  - The point in short paragraphs of one to three sentences, with a blank line between paragraphs. Two to four sentences in all. A date, time or ask that matters goes in its own sentence, not buried mid-paragraph.
  - ${
          signsOff
            ? `Then a blank line and exactly this sign-off, on its own lines:\n${signature}`
            : signature.trim()
              ? "No sign-off and no name at the end: the signature is added separately."
              : `Then a blank line, "Thanks," on its own line, and ${who.split(/\s+/)[0]} on the line after.`
        }
- No em dashes. No "I hope this finds you well", no "just circling back", no "gentle reminder". No markdown.
- to: who the reminder is for. When ${who} names people, those people. Otherwise the people on the email who owe the answer or attend the event, never ${who}. "name" as written (a first name is fine), "email" only if it appears in the material, otherwise "".
- remindAt: "" unless the email makes a week from now wrong: then local "YYYY-MM-DDTHH:MM" at 09:00 on a working day, such as two working days before a deadline or event that falls sooner than a week out, or the day they asked for.
- why: "" unless remindAt is set; then one short sentence saying why that day.${
          swaps.length
            ? `\n- ${who} never writes these words; use the one after the arrow instead:\n${swaps
                .map((s) => `  ${s.avoid} -> ${s.prefer}`)
                .join("\n")}`
            : ""
        }${voiceBlock ? `\n\nHow ${who} writes:\n${voiceBlock}` : ""}
Return only the JSON.`,
        messages: [
          {
            role: "user",
            content: [
              request.trim() ? `What they want:\n${request}` : "",
              subject ? `Subject: ${subject}` : "",
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
      { signal: req.signal },
    );
    if (res.stop_reason === "refusal") throw new Error("The model declined that one.");
    const text = res.content.find((b) => b.type === "text");
    const raw = text && "text" in text ? text.text : "";
    if (!raw.trim() || res.stop_reason === "max_tokens")
      throw new Error("It ran out of room before finishing. Try again.");
    const parsed = JSON.parse(raw) as {
      to: { name: string; email: string }[];
      remindAt: string;
      reminder: string;
      followup: string;
      why: string;
    };

    // Same lookup as the meeting invite, so "Rachel" is the same Rachel.
    const { data: rows } = await supabase
      .from("directory_people")
      .select("name, email, title, department, source, sent_count, last_sent, relation, company, is_me")
      .eq("user_id", user.id)
      .in(
        "email",
        // Only who could match: the addresses named, plus everyone whose
        // name contains a word that was asked for.
        parsed.to.map((t) => cleanEmail(t.email)).filter(Boolean).concat(["-"]),
      );
    const named = parsed.to.map((t) => t.name.trim().split(/\s+/)[0]).filter((w) => w.length > 1);
    let byName: DirectoryPerson[] = [];
    if (named.length) {
      const safe = named.map((w) => w.replace(/[^\p{L}\p{N}' -]/gu, "")).filter(Boolean);
      const { data } = await supabase
        .from("directory_people")
        .select("name, email, title, department, source, sent_count, last_sent, relation, company, is_me")
        .eq("user_id", user.id)
        .or(safe.map((w) => `name.ilike.%${w}%`).join(","))
        .limit(400);
      byName = (data || []) as DirectoryPerson[];
    }
    const all = [...((rows || []) as DirectoryPerson[]), ...byName];
    const meRow = all.find((p) => p.is_me) || null;
    const directory = all.filter((p) => !p.is_me && p.email !== me.email);
    const seen = new Set<string>();
    const to = parsed.to
      .map((t) => resolvePerson(t.name, t.email, onThread, directory, meRow))
      .filter((r) => {
        const key = r.person?.email || `?${r.asked.toLowerCase()}`;
        if (r.person?.email === me.email || seen.has(key)) return false;
        seen.add(key);
        return true;
      });

    // What the pane shows is exactly what goes out, signature included.
    const sign = (t: string) => {
      const clean = stripEmDashes(t).trim();
      return !signsOff && signature.trim() ? `${clean}\n\n${signature.trim()}` : clean;
    };
    const when = String(parsed.remindAt || "").match(/^(\d{4}-\d{2}-\d{2})[T ](\d{1,2}):(\d{2})/);
    return NextResponse.json({
      to,
      remindAt: when ? `${when[1]}T${when[2].padStart(2, "0")}:${when[3]}` : "",
      why: when ? stripEmDashes(parsed.why || "") : "",
      reminder: sign(parsed.reminder || ""),
      followup: sign(parsed.followup || ""),
    });
  } catch (e) {
    if (req.signal.aborted) return new NextResponse(null, { status: 499 });
    const msg = e instanceof Error && /ran out of room|declined/.test(e.message) ? e.message : "";
    return NextResponse.json({ error: msg || "Couldn't write those. Try again." }, { status: 500 });
  }
}
