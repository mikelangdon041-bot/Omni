import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const ALLOWED_EXT = new Set([
  "mp3", "m4a", "wav", "aac", "ogg", "oga", "webm", "mp4", "mpeg", "mpga", "flac",
]);

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const title = String(body.title || "Untitled recording").slice(0, 200);
  const ext = String(body.ext || "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
  const candidateId =
    typeof body.candidateId === "string" && body.candidateId ? body.candidateId : null;
  if (!ALLOWED_EXT.has(ext)) {
    return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });
  }

  // Create the record first so we can key the storage path by its id.
  const { data: rec, error: insErr } = await supabase
    .from("recordings")
    .insert({ user_id: user.id, title, status: "uploading", candidate_id: candidateId })
    .select("id")
    .single();
  if (insErr || !rec) {
    return NextResponse.json({ error: "Could not create recording" }, { status: 500 });
  }

  const path = `${user.id}/${rec.id}/original.${ext}`;
  await supabase.from("recordings").update({ storage_path: path }).eq("id", rec.id);

  const admin = createAdminClient();
  const { data: signed, error: signErr } = await admin.storage
    .from("recordings")
    .createSignedUploadUrl(path);
  if (signErr || !signed) {
    return NextResponse.json({ error: "Could not sign upload" }, { status: 500 });
  }

  return NextResponse.json({
    recordingId: rec.id,
    path,
    token: signed.token,
    signedUrl: signed.signedUrl,
  });
}
