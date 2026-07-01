"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { RecordingPanel, type Recording } from "@/components/interview/RecordingPanel";
import type { SummaryNodeRow } from "@/lib/summaryTree";

export type { Recording };

export function RecordingView({
  initialRecording,
  initialNodes,
}: {
  initialRecording: Recording;
  initialNodes: SummaryNodeRow[];
}) {
  const router = useRouter();
  return (
    <>
      <button
        onClick={() => router.back()}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink"
      >
        <ArrowLeft size={15} /> Back
      </button>
      <RecordingPanel
        recordingId={initialRecording.id}
        initialRecording={initialRecording}
        initialNodes={initialNodes}
      />
    </>
  );
}
