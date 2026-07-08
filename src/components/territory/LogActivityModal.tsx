"use client";

import { useState } from "react";
import { Modal } from "@/components/territory/ui/Modal";
import { Input, Select, Textarea } from "@/components/territory/ui/Input";
import { Button } from "@/components/territory/ui/Button";
import { STATUS_LABELS } from "@/lib/territory/activity";
import { METHOD_LABELS } from "@/lib/territory/utils";
import { presetToDate, type Activity, type DueDatePreset } from "@/lib/territory/types";

type LogType = "outbound" | "inbound" | "unsolicited" | "note";

const OUTBOUND_STATUSES = [
  "1st_outreach",
  "2nd_outreach",
  "3rd_outreach",
  "meeting_scheduled",
  "non_responsive",
  "other",
];

const METHODS = ["email", "phone", "in_person", "video_call", "text", "other"];

export function LogActivityModal({
  open,
  onClose,
  cycle,
  defaultStatus,
  onLog,
  onFollowUp,
}: {
  open: boolean;
  onClose: () => void;
  cycle: number;
  defaultStatus?: string;
  onLog: (activity: Partial<Activity>) => Promise<unknown>;
  onFollowUp: (title: string, dueDateISO: string) => Promise<unknown>;
}) {
  const [type, setType] = useState<LogType>("outbound");
  const [status, setStatus] = useState(defaultStatus || "1st_outreach");
  const [method, setMethod] = useState("email");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 16));
  const [notes, setNotes] = useState("");
  const [followUp, setFollowUp] = useState<DueDatePreset | "none">("none");
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    const activity: Partial<Activity> = {
      type,
      meeting_cycle: cycle,
      date: new Date(date).toISOString(),
      notes: notes.trim(),
      status: type === "outbound" ? status : "no_outreach",
      outreach_method: type === "note" ? null : (method as Activity["outreach_method"]),
    };
    await onLog(activity);
    if (followUp !== "none") {
      await onFollowUp("Follow up", presetToDate(followUp));
    }
    setSaving(false);
    // reset
    setNotes("");
    setFollowUp("none");
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="Log activity">
      <div className="space-y-4">
        <Select
          label="Type"
          value={type}
          onChange={(e) => setType(e.target.value as LogType)}
        >
          <option value="outbound">Outbound (I reached out)</option>
          <option value="inbound">Inbound (they responded)</option>
          <option value="unsolicited">Unsolicited (they reached out)</option>
          <option value="note">Note</option>
        </Select>

        {type === "outbound" && (
          <Select
            label="Status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {OUTBOUND_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s] || s}
              </option>
            ))}
          </Select>
        )}

        {type !== "note" && (
          <Select
            label="Method"
            value={method}
            onChange={(e) => setMethod(e.target.value)}
          >
            {METHODS.map((m) => (
              <option key={m} value={m}>
                {METHOD_LABELS[m] || m}
              </option>
            ))}
          </Select>
        )}

        <Input
          label={
            type === "outbound" && status === "meeting_scheduled"
              ? "Meeting date & time"
              : "Date & time"
          }
          type="datetime-local"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        {type === "outbound" && status === "meeting_scheduled" && (
          <p className="-mt-2 text-xs text-muted">
            Enter when the meeting will happen — a green “Meeting completed?”
            banner will appear on the Activity and Meetings tabs afterwards.
          </p>
        )}

        <Textarea
          label="Notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="What happened?"
        />

        <Select
          label="Set a follow-up reminder?"
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
            {saving ? "Saving…" : "Log activity"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
