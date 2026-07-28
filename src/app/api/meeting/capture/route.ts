import { NextResponse } from "next/server";
import { routeAuth } from "@/lib/supabase/route";
import { CaptureRefusal, captureFromTranscript } from "@/lib/meetingprep/captureAi";
import { tidyNotesHtml } from "@/lib/meetingprep/notes";

export const runtime = "nodejs";
export const maxDuration = 300;

// Transcript in, saved meeting out — the second half of "record a meeting",
// done server-side.
//
// In the browser this is two steps: the record page asks /api/meeting/ai for
// the notes, shows them for review, and inserts the mp_meetings row itself
// once you press Save. That works because the page has a Supabase client and
// a screen to review on. The Windows tray recorder has neither: the whole
// point of it is that stopping the recording is the last thing you do, so the
// meeting has to exist by the time it opens your browser.
//
// So this endpoint runs the same capture prompt and then writes the row, with
// the review-screen defaults applied rather than asked about: keep the
// transcript, cut the opening small talk, keep every follow-up. All of it is
// editable on the meeting page afterwards, which is where the recorder sends
// you.
export async function POST(req: Request) {
  const { supabase, user } = await routeAuth(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Expected JSON" }, { status: 400 });

  const transcript = String(body.transcript || "");
  if (!transcript.trim()) {
    return NextResponse.json({ error: "No transcript provided" }, { status: 400 });
  }

  try {
    const result = await captureFromTranscript({
      transcript,
      hint: String(body.hint || ""),
      ownNotes: String(body.ownNotes || ""),
      emphasizeNotes: body.emphasizeNotes !== false,
    });

    // Same rule the review screen uses: only trim when the quoted first
    // substantive line is actually findable, because a paraphrase would cut
    // at the wrong place or not at all.
    const marker = result.smallTalk.firstSubstantiveLine.trim();
    const cutAt = result.smallTalk.found && marker ? transcript.indexOf(marker) : -1;
    const trimSmallTalk = body.trimSmallTalk !== false;
    const kept =
      body.keepTranscript === false
        ? ""
        : cutAt > 0 && trimSmallTalk
          ? transcript.slice(cutAt)
          : transcript;

    const attendees = [
      ...new Set(
        (Array.isArray(body.attendees) ? body.attendees : [])
          .map((a: unknown) => String(a || "").trim())
          .filter(Boolean),
      ),
    ].map((name) => ({ name: name as string, role: "", org: "", notes: "" }));

    const title =
      String(body.title || "").trim() ||
      result.title ||
      String(body.hint || "").trim() ||
      "Recorded meeting";

    // Inserted through the caller's own client, so RLS applies exactly as it
    // does for the web app rather than being bypassed with the service role.
    const { data, error } = await supabase
      .from("mp_meetings")
      .insert({
        user_id: user.id,
        title,
        // A recording is by definition a meeting that already happened.
        meeting_type: "other",
        date: new Date().toISOString(),
        kol_id: String(body.kolId || "") || null,
        attendees,
        debrief: {
          transcript: kept,
          audioPath: String(body.audioPath || "") || undefined,
          notesHtml: tidyNotesHtml(result.notes),
          actions: result.actions.map((text) => ({ text, done: false, selected: true })),
        },
      })
      .select("id, title")
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: error?.message || "Could not save the meeting" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      id: data.id,
      title: data.title,
      // Land on the Debrief tab, where the follow-ups can be pushed to the
      // to-do list and the meeting logged to Territory.
      path: `/meeting-prep/${data.id}?tab=Debrief`,
      actions: result.actions.length,
      ungrounded: result.ungrounded,
    });
  } catch (e) {
    if (e instanceof CaptureRefusal) {
      return NextResponse.json({ error: e.message }, { status: 502 });
    }
    return NextResponse.json(
      { error: (e as Error).message || "Could not capture the meeting" },
      { status: 500 },
    );
  }
}
