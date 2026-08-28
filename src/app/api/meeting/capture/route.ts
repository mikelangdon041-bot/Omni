import JSZip from "jszip";
import { NextResponse } from "next/server";
import { routeAuth } from "@/lib/supabase/route";
import { createAdminClient } from "@/lib/supabase/admin";
import { CaptureRefusal, captureFromTranscript } from "@/lib/meetingprep/captureAi";
import { exportHeaderHtml, tidyNotesHtml } from "@/lib/meetingprep/notes";
import { createPage, prependToPage } from "@/lib/microsoft/graph";

export const runtime = "nodejs";
export const maxDuration = 300;

const TRANSCRIPT_BUCKET = "transcripts";

// The bucket isn't declared anywhere else (every other bucket in this app is
// created once by hand in the Supabase dashboard) — created on first use here
// instead, so this feature works the moment the migration is run, with no
// manual dashboard step for a deploy to miss.
async function ensureTranscriptBucket(admin: ReturnType<typeof createAdminClient>) {
  const { error } = await admin.storage.getBucket(TRANSCRIPT_BUCKET);
  if (error) {
    await admin.storage.createBucket(TRANSCRIPT_BUCKET, { public: false });
  }
}

// Archives the transcript as a zip in Supabase storage, filed under the
// meeting's folder (or "uncategorized"). Best-effort: the meeting itself is
// already saved by the time this runs, so a storage hiccup here is worth
// reporting, never worth losing the meeting over.
async function archiveTranscript(
  userId: string,
  meetingId: string,
  folderId: string | null,
  title: string,
  transcript: string,
): Promise<string | null> {
  if (!transcript.trim()) return null;
  try {
    const admin = createAdminClient();
    await ensureTranscriptBucket(admin);
    const zip = new JSZip();
    zip.file("transcript.txt", `${title}\n\n${transcript}`);
    const bytes = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    const path = `${userId}/${folderId || "uncategorized"}/${meetingId}.zip`;
    const { error } = await admin.storage
      .from(TRANSCRIPT_BUCKET)
      .upload(path, bytes, { contentType: "application/zip", upsert: true });
    if (error) return null;
    return path;
  } catch {
    return null;
  }
}

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
// the review-screen defaults applied rather than asked about: drop the
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
    // Opt-in, matching the review screen: the notes are what gets saved, and
    // the transcript only comes with them when the caller explicitly asks. An
    // older recorder build that doesn't send the flag gets the safer answer.
    const kept =
      body.keepTranscript !== true
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

    // Where this meeting is filed — who it was with and what it was about,
    // both chosen mid-recording, either or both left empty. Nothing at all
    // lands it in "Uncategorized" with a reminder to file it later.
    //
    // Every id is resolved server-side rather than trusted from the body, so a
    // stale or foreign one can't attach a meeting to someone else's folder —
    // and each is filed by the kind the row actually has, not by which field
    // it arrived in. `folderId` is the older recorder's single destination and
    // can still be a topic; it lands in the right slot either way.
    const asked = [String(body.folderId || ""), String(body.topicFolderId || "")].filter(Boolean);
    let personFolder: { id: string; kol_id: string | null } | null = null;
    let topicFolder: { id: string } | null = null;
    if (asked.length) {
      const { data: rows } = await supabase
        .from("mp_folders")
        .select("id, kind, kol_id")
        .in("id", asked)
        .eq("user_id", user.id);
      for (const f of rows || []) {
        if (f.kind === "person") personFolder = { id: f.id as string, kol_id: f.kol_id as string | null };
        else topicFolder = { id: f.id as string };
      }
    }

    // An explicit kolId wins; otherwise a person-folder linked to a KOL
    // carries that link along, so filing under "Sam" also keeps Territory
    // Planning's kol_id in step without a second thing to set.
    const kolId = String(body.kolId || "") || personFolder?.kol_id || null;

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
        kol_id: kolId,
        person_folder_id: personFolder?.id ?? null,
        topic_folder_id: topicFolder?.id ?? null,
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

    // The durable copy: transcript zipped and filed in Supabase storage under
    // this meeting's folder. Only reached when a transcript was kept —
    // `archiveTranscript` no-ops on the empty string, so dropping the
    // transcript drops the archive with it rather than filing a blank zip.
    // Filed under the person when there is one, the topic otherwise: a zip
    // lives at exactly one path, and "whose meeting was it" is the question
    // someone digging through storage by hand is asking.
    const zipPath = await archiveTranscript(
      user.id,
      data.id,
      personFolder?.id ?? topicFolder?.id ?? null,
      title,
      kept,
    );
    if (zipPath) {
      await supabase.from("mp_meetings").update({ transcript_zip_path: zipPath }).eq("id", data.id);
    }

    // OneNote is now a manual, optional extra rather than the default
    // hand-off — only reached when the caller explicitly asks for it (the web
    // app's "To OneNote" button; the recorder no longer offers this as its
    // primary destination picker, see desktop/ui/app.js).
    const sectionId = String(body.oneNoteSectionId || "");
    const pageId = String(body.oneNotePageId || "");
    let oneNote: string | null = null;
    if (sectionId || pageId) {
      try {
        const notesHtml =
          exportHeaderHtml(data.title, new Date().toISOString()) +
          tidyNotesHtml(result.notes);
        if (pageId) await prependToPage(user.id, pageId, notesHtml);
        else await createPage(user.id, sectionId, data.title, notesHtml);
        oneNote = "sent";
      } catch (e) {
        // Never fatal. The meeting is saved and the notes exist; OneNote being
        // unreachable is a thing to mention, not a reason to lose a recording
        // that cannot be made again.
        oneNote = (e as Error).message === "NOT_CONNECTED" ? "not-connected" : "failed";
      }
    }

    return NextResponse.json({
      id: data.id,
      title: data.title,
      // Land on the Debrief tab, where the follow-ups can be pushed to the
      // to-do list and the meeting logged to Territory.
      path: `/meeting-prep/${data.id}?tab=Debrief`,
      actions: result.actions.length,
      ungrounded: result.ungrounded,
      folderId: personFolder?.id ?? topicFolder?.id ?? null,
      personFolderId: personFolder?.id ?? null,
      topicFolderId: topicFolder?.id ?? null,
      oneNote,
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
