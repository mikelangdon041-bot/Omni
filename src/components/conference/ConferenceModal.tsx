"use client";

// Create / edit a conference: name, location, timezone (auto-detected but
// always shown for confirmation), venue address, date range.

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Input";
import { COMMON_TIMEZONES, type Conference } from "@/lib/conference/types";
import { slugify } from "@/lib/conference/utils";

export function ConferenceModal({
  open,
  onClose,
  conference,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  conference?: Conference | null; // present = edit
  onSave: (partial: Partial<Conference>) => Promise<void>;
}) {
  const browserTz =
    typeof Intl !== "undefined"
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : "America/New_York";

  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [venueAddress, setVenueAddress] = useState("");
  const [timezone, setTimezone] = useState(browserTz);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(conference?.name || "");
    setLocation(conference?.location || "");
    setVenueAddress(conference?.venue_address || "");
    setTimezone(conference?.timezone || browserTz);
    setStartDate(conference?.start_date || "");
    setEndDate(conference?.end_date || "");
  }, [open, conference, browserTz]);

  const timezones = COMMON_TIMEZONES.includes(timezone)
    ? COMMON_TIMEZONES
    : [timezone, ...COMMON_TIMEZONES];

  async function save() {
    if (!name.trim() || !startDate || !endDate) return;
    setSaving(true);
    await onSave({
      name: name.trim(),
      slug: slugify(name),
      location: location.trim(),
      venue_address: venueAddress.trim(),
      timezone,
      start_date: startDate,
      end_date: endDate <= startDate ? startDate : endDate,
    });
    setSaving(false);
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={conference ? "Edit conference" : "New conference"}
    >
      <div className="space-y-4">
        <Input
          label="Name *"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. National Neurology Congress 2026"
          autoFocus
        />
        <Input
          label="Location"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="City, State"
        />
        <Input
          label="Venue address"
          value={venueAddress}
          onChange={(e) => setVenueAddress(e.target.value)}
          placeholder="Convention center address (for navigation)"
        />
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Start date *"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
          <Input
            label="End date *"
            type="date"
            value={endDate}
            min={startDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>
        <div>
          <Select
            label="Timezone"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
          >
            {timezones.map((tz) => (
              <option key={tz} value={tz}>
                {tz.replace(/_/g, " ")}
              </option>
            ))}
          </Select>
          <p className="mt-1.5 text-xs text-muted">
            All event times use this timezone, no matter where team members are.
          </p>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || !name.trim() || !startDate || !endDate}>
            {saving ? "Saving…" : conference ? "Save changes" : "Create conference"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
