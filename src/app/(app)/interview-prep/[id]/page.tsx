import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { RecordingView, type Recording } from "./RecordingView";

export const dynamic = "force-dynamic";

export default async function RecordingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: recording } = await supabase
    .from("recordings")
    .select("id, title, status, total_chunks, chunks_done, transcript, error")
    .eq("id", id)
    .single();

  if (!recording) notFound();

  const { data: nodes } = await supabase
    .from("summary_nodes")
    .select("id, parent_id, content, depth, sort_order")
    .eq("recording_id", id)
    .order("sort_order", { ascending: true });

  return (
    <RecordingView
      initialRecording={recording as Recording}
      initialNodes={nodes || []}
    />
  );
}
