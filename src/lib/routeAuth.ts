import { createClient } from "@/lib/supabase/server";

// Resolve the signed-in user and confirm they own the given recording.
// Returns the user id and the recording row, or an error code.
export async function requireRecordingOwner(recordingId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized" as const, status: 401 };

  const { data: recording } = await supabase
    .from("recordings")
    .select("*")
    .eq("id", recordingId)
    .eq("user_id", user.id)
    .single();

  if (!recording) return { error: "Not found" as const, status: 404 };

  return { userId: user.id, recording };
}
