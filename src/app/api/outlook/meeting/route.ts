import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { cleanEmail, type DirectoryPerson } from "@/lib/directory";
import { planMeeting } from "@/lib/meeting-invite";

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
    .select("name, email, title, department, source")
    .eq("user_id", user.id)
    .limit(20000);
  // What the user imported is the better record of a person than what a mail
  // header happened to call them, so it is searched first.
  const directory: DirectoryPerson[] = ((rows || []) as DirectoryPerson[])
    .filter((p) => p.email !== me.email)
    .sort((a, b) => (a.source === b.source ? 0 : a.source === "import" ? -1 : 1));

  try {
    return NextResponse.json(
      await planMeeting({
        thread,
        subject: String(body?.subject || "").slice(0, 300),
        request,
        now: String(body?.now || "").slice(0, 80),
        me,
        onThread,
        directory,
      }),
    );
  } catch {
    return NextResponse.json(
      { error: "Couldn't read the meeting out of that. Try again." },
      { status: 500 },
    );
  }
}