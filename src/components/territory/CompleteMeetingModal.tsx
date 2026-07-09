"use client";

import { useState } from "react";
import { Modal } from "@/components/territory/ui/Modal";
import { Input, Select } from "@/components/territory/ui/Input";
import { Button } from "@/components/territory/ui/Button";
import { RichText } from "@/components/ui/RichText";
import { stripHtml } from "@/lib/territory/utils";
import type { DueDatePreset } from "@/lib/territory/types";

export interface CompletedMeeting {
  meeting_method: string;
  date: string; // ISO
  topics_discussed: string;
  topics_missed: string;
  follow_up_actions: string;
  followUp: DueDatePreset | "none";
}

const MEETING_METHODS = ["in_person", "video_call", "phone"];

// datetime-local wants local time, not the UTC slice of toISOString().
function toLocalInput(iso?: string): string {
  const d = iso ? new Date(iso) : new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export function CompleteMeetingModal({
  open,
  onClose,
  meetingNumber,
  onComplete,
  defaultDate,
  defaultMethod,
}: {
  open: boolean;
  onClose: () => void;
  meetingNumber: number;
  onComplete: (m: CompletedMeeting) => Promise<unknown>;
  /** Prefill from the scheduled activity (ISO date). */
  defaultDate?: string;
  defaultMethod?: string;
}) {
  const [method, setMethod] = useState(
    defaultMethod && MEETING_METHODS.includes(defaultMethod) ? defaultMethod : "in_person",
  );
  const [date, setDate] = useState(() => toLocalInput(defaultDate));
  const [discussed, setDiscussed] = useState("");
  const [missed, setMissed] = useState("");
  const [followUpActions, setFollowUpActions] = useState("");
  const [followUp, setFollowUp] = useState<DueDatePreset | "none">("1_month");
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    // Rich-text fields: treat markup-only content (empty paragraphs) as empty.
    const clean = (html: string) => (stripHtml(html) ? html : "");
    await onComplete({
      meeting_method: method,
      date: new Date(date).toISOString(),
      topics_discussed: clean(discussed),
      topics_missed: clean(missed),
      follow_up_actions: clean(followUpActions),
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
        <RichField label="Topics discussed" value={discussed} onChange={setDiscussed} />
        <RichField
          label="Topics missed / to revisit"
          value={missed}
          onChange={setMissed}
        />
        <RichField
          label="Follow-up actions"
          value={followUpActions}
          onChange={setFollowUpActions}
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

function RichField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <p className="mb-1.5 text-sm font-medium text-ink">{label}</p>
      <RichText
        value={value}
        onChange={onChange}
        placeholder={placeholder || "Start typing…"}
        minHeight="min-h-20"
      />
    </div>
  );
}
