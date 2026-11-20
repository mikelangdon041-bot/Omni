import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { cleanEmail, type DirectoryPerson } from "@/lib/directory";
import { planMeetings } from "@/lib/meeting-invite";

export const runtime = "nodejs";
export const maxDuration = 120;

// "Set up a meeting" in the Outlook pane. Nothing is sent from here: the pane
// opens Outlook's meeting form filled in, and the person presses Send there.
// See lib/meeting-invite.ts and components/outlook/MeetingCard.tsx.

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const thread = String(body?.thread || "").slice(0, 30000);
  const request = String(body?.request || "").slice(0, 2000);
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
  if (!thread.trim() && !request.trim())
    return NextResponse.json({ error: "Nothing to set a meeting up from." }, { status: 400 });

  const { data: rows } = await supabase
    .from("directory_people")
    .select("name, email, title, department, source, sent_count, last_sent, relation, company, is_me")
    .eq("user_id", user.id)
    .order("email")
    .range(0, 999);
  // In pages: the API hands back at most 1000 rows per request whatever
  // .limit() says, and a company directory is several thousand. Reading one
  // page cut Shelbi and Erin out of an 8,533-person directory.
  const all = (rows || []) as DirectoryPerson[];
  for (let from = 1000; rows && all.length === from && from < 50000; from += 1000) {
    const { data } = await supabase
      .from("directory_people")
      .select("name, email, title, department, source, sent_count, last_sent, relation, company, is_me")
      .eq("user_id", user.id)
      .order("email")
      .range(from, from + 999);
    all.push(...((data || []) as DirectoryPerson[]));
  }
  // What the user imported is the better record of a person than what a mail
  // header happened to call them, so it is searched first.
  // Your own row, for "same department" and "same company".
  const meRow = all.find((p) => p.is_me) || all.find((p) => p.email === me.email) || null;
  const directory: DirectoryPerson[] = all
    .filter((p) => p !== meRow && p.email !== me.email)
    .sort((a, b) => (a.source === b.source ? 0 : a.source === "import" ? -1 : 1));

  try {
    return NextResponse.json(
      await planMeetings({
        thread,
        subject: String(body?.subject || "").slice(0, 300),
        request,
        now: String(body?.now || "").slice(0, 80),
        me,
        onThread,
        directory,
        meRow,
        // Stop in the pane aborts the fetch, which aborts this request.
        signal: req.signal,
      }),
    );
  } catch (e) {
    if (req.signal.aborted) return new NextResponse(null, { status: 499 });
    const msg = e instanceof Error && /ran out of room|didn't find|declined/.test(e.message) ? e.message : "";
    return NextResponse.json(
      { error: msg || "Couldn't read the meeting out of that. Try again." },
      { status: 500 },
    );
  }
}