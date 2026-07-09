"use client";

import { useState } from "react";
import { Modal } from "@/components/territory/ui/Modal";
import { Input, Select } from "@/components/territory/ui/Input";
import { Button } from "@/components/territory/ui/Button";
import { RichText } from "@/components/ui/RichText";
import { STATUS_LABELS, EVENT_TYPES, EVENT_TYPE_KEYS } from "@/lib/territory/activity";
import { METHOD_LABELS } from "@/lib/territory/utils";
import { presetToDate, type Activity, type DueDatePreset } from "@/lib/territory/types";

const INTERACTION_TYPES = [
  { key: "outbound", label: "Outbound (I reached out)" },
  { key: "inbound", label: "Inbound (they responded)" },
  { key: "unsolicited", label: "Unsolicited (they reached out)" },
  { key: "note", label: "Note" },
];

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
  categoryLabels = {},
}: {
  open: boolean;
  onClose: () => void;
  cycle: number;
  defaultStatus?: string;
  onLog: (activity: Partial<Activity>) => Promise<unknown>;
  onFollowUp: (title: string, dueDateISO: string) => Promise<unknown>;
  /** Org-level renames for the event categories (admin-configurable). */
  categoryLabels?: Record<string, string>;
}) {
  const [type, setType] = useState<string>("outbound");
  const [status, setStatus] = useState(defaultStatus || "1st_outreach");
  const [method, setMethod] = useState("email");
  const [date, setDate] = useState(() => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  });
  const [attendees, setAttendees] = useState("");
  const [notes, setNotes] = useState("");
  const [followUp, setFollowUp] = useState<DueDatePreset | "none">("none");
  const [saving, setSaving] = useState(false);

  const isEvent = EVENT_TYPE_KEYS.has(type);
  const eventDef = EVENT_TYPES.find((t) => t.key === type);
  const isScheduling = type === "outbound" && status === "meeting_scheduled";

  async function submit() {
    setSaving(true);
    const activity: Partial<Activity> = {
      type: type as Activity["type"],
      meeting_cycle: cycle,
      date: new Date(date).toISOString(),
      notes,
      status: type === "outbound" ? status : "no_outreach",
      outreach_method:
        type === "note" || isEvent ? null : (method as Activity["outreach_method"]),
    };
    if (isEvent && eventDef?.attendees && attendees.trim() !== "") {
      activity.attendees = Number(attendees) || 0;
    }
    await onLog(activity);
    if (followUp !== "none") {
      await onFollowUp("Follow up", presetToDate(followUp));
    }
    setSaving(false);
    // reset
    setNotes("");
    setAttendees("");
    setFollowUp("none");
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="Log activity">
      <div className="space-y-4">
        <Select
          label="Type"
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          <optgroup label="Interactions">
            {INTERACTION_TYPES.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </optgroup>
          <optgroup label="Activities">
            {EVENT_TYPES.map((t) => (
              <option key={t.key} value={t.key}>
                {categoryLabels[t.key] || t.label}
              </option>
            ))}
          </optgroup>
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

        {!isEvent && type !== "note" && (
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

        {isEvent && eventDef?.attendees && (
          <Input
            label="Number of attendees (optional)"
            type="number"
            min={0}
            value={attendees}
            onChange={(e) => setAttendees(e.target.value)}
          />
        )}

        <Input
          label={isScheduling ? "Meeting date & time" : "Date & time"}
          type="datetime-local"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        {isScheduling && (
          <p className="-mt-2 text-xs text-muted">
            Enter when the meeting will happen — a green “Meeting completed?”
            banner will appear on the Activity and Meetings tabs afterwards.
          </p>
        )}

        <div>
          <p className="mb-1.5 text-sm font-medium text-ink">Notes</p>
          <RichText
            value={notes}
            onChange={setNotes}
            placeholder="What happened?"
            minHeight="min-h-20"
          />
        </div>

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
