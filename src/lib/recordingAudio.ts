import type { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

// Delete every audio object belonging to one recording — the uploaded
// original and any transcription chunks, whether or not they were consumed.
//
// The rule across Omni is that audio is a means to a transcript and nothing
// more: it is removed as soon as it has been read, and on every path that
// ends a recording (success, failure, or the user deleting it). This is the
// single place that enforces it for the `recordings` bucket, so a new exit
// path can't quietly forget.
export async function purgeRecordingAudio(
  admin: Admin,
  userId: string,
  recordingId: string,
): Promise<void> {
  const prefix = `${userId}/${recordingId}`;
  try {
    const paths: string[] = [];

    const { data: top } = await admin.storage.from("recordings").list(prefix);
    for (const entry of top || []) {
      // Storage's list() reports "folders" as rows with no id.
      if (entry.id) paths.push(`${prefix}/${entry.name}`);
    }

    const { data: chunks } = await admin.storage
      .from("recordings")
      .list(`${prefix}/chunks`);
    for (const entry of chunks || []) {
      if (entry.id) paths.push(`${prefix}/chunks/${entry.name}`);
    }

    if (paths.length) await admin.storage.from("recordings").remove(paths);
  } catch {
    // Best-effort cleanup — never fail the caller's request over it.
  }
}
