"use client";

import { useState } from "react";
import { Modal } from "@/components/territory/ui/Modal";
import { Input, Select, Textarea } from "@/components/territory/ui/Input";
import { Button } from "@/components/territory/ui/Button";
import type { DueDatePreset } from "@/lib/territory/types";

export interface CompletedMeeting {
  meeting_method: string;
  date: string; // ISO
  topics_discussed: string;
  topics_missed: string;
  follow_up_actions: string;
  followUp: DueDatePreset | "none";
}

export function CompleteMeetingModal({
  open,
  onClose,
  meetingNumber,
  onComplete,
}: {
  open: boolean;
  onClose: () => void;
  meetingNumber: number;
  onComplete: (m: CompletedMeeting) => Promise<unknown>;
}) {
  const [method, setMethod] = useState("in_person");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 16));
  const [discussed, setDiscussed] = useState("");
  const [missed, setMissed] = useState("");
  const [followUpActions, setFollowUpActions] = useState("");
  const [followUp, setFollowUp] = useState<DueDatePreset | "none">("1_month");
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    await onComplete({
      meeting_method: method,
      date: new Date(date).toISOString(),
      topics_discussed: discussed.trim(),
      topics_missed: missed.trim(),
      follow_up_actions: followUpActions.trim(),
      followUp,
    });
    setSaving(false);
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title={`Complete meeting #${meetingNumber}`}>
      <div className="space-y-4">
        <Select label="Method" value={method} onChange={(e) => setMethod(e.target.value)}>
          <option value="in_person">In person</option>
          <option value="video_call">Video call</option>
          <option value="phone">Phone</option>
        </Select>
        <Input
          label="Date & time"
          type="datetime-local"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <Textarea
          label="Topics discussed"
          value={discussed}
          onChange={(e) => setDiscussed(e.target.value)}
        />
        <Textarea
          label="Topics missed / to revisit"
          value={missed}
          onChange={(e) => setMissed(e.target.value)}
        />
        <Textarea
          label="Follow-up actions"
          value={followUpActions}
          onChange={(e) => setFollowUpActions(e.target.value)}
          placeholder="One per line"
        />
        <Select
          label="Create a follow-up reminder?"
          value={followUp}
          onChange={(e) => setFollowUp(e.target.value as DueDatePreset | "none")}
        >
          <option value="none">No reminder</option>
          <option value="1_week">In 1 week</option>
          <option value="1_month">In 1 month</option>
          <option value="3_months">In 3 months</option>
        </Select>

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? "Saving…" : "Complete meeting"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
