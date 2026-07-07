"use client";

// Create / edit a conference: name, location, timezone (auto-detected but
// always shown for confirmation), venue address, date range. When creating,
// a schedule file can be dropped in and AI prefills the form from it.

import { useEffect, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { FileSpreadsheet, Sparkles } from "lucide-react";
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
  const [extracting, setExtracting] = useState(false);
  const [extractNote, setExtractNote] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setName(conference?.name || "");
    setLocation(conference?.location || "");
    setVenueAddress(conference?.venue_address || "");
    setTimezone(conference?.timezone || browserTz);
    setStartDate(conference?.start_date || "");
    setEndDate(conference?.end_date || "");
    setExtractNote("");
  }, [open, conference, browserTz]);

  // Read a schedule workbook, send a compact excerpt to the AI, and prefill
  // whatever it can find (everything stays editable before saving).
  async function prefillFromFile(file: File | null) {
    if (!file) return;
    setExtracting(true);
    setExtractNote("");
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { cellDates: false });
      const parts: string[] = [
        `Workbook file name: ${file.name}`,
        `Sheet names: ${wb.SheetNames.join(", ")}`,
      ];
      for (const s of wb.SheetNames.slice(0, 6)) {
        const grid: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets[s], {
          header: 1,
          raw: false,
          defval: "",
        });
        const lines = grid
          .slice(0, 10)
          .map((row) =>
            (row || [])
              .slice(0, 8)
              .map((c) => String(c ?? "").trim())
              .join(" | "),
          )
          .filter((l) => l.replace(/\|/g, "").trim());
        parts.push(`--- Sheet "${s}" ---`, ...lines);
      }
      const res = await fetch("/api/conference/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          action: "extract_conference_meta",
          text: parts.join("\n").slice(0, 20000),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Couldn't read that file.");
      const m = (json.meta || {}) as Record<string, unknown>;
      const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
      const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
      if (str(m.name)) setName(str(m.name));
      if (str(m.location)) setLocation(str(m.location));
      if (str(m.venue_address)) setVenueAddress(str(m.venue_address));
      if (isDay(str(m.start_date))) setStartDate(str(m.start_date));
      if (isDay(str(m.end_date))) setEndDate(str(m.end_date));
      if (/^[A-Za-z]+\/[A-Za-z_+-]+/.test(str(m.timezone))) setTimezone(str(m.timezone));
      setExtractNote(
        str(m.name) || isDay(str(m.start_date))
          ? "Prefilled from the file — double-check everything before creating."
          : "Couldn't find conference details in that file — fill the form in manually.",
      );
    } catch (e) {
      setExtractNote((e as Error).message);
    } finally {
      setExtracting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

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
        {!conference && (
          <div>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={extracting}
              className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[var(--accent)]/40 bg-[var(--accent-soft)]/40 px-4 py-3 text-sm font-medium transition hover:border-[var(--accent)] disabled:opacity-60"
            >
              {extracting ? (
                <>
                  <Sparkles size={16} className="animate-pulse" /> Reading the file…
                </>
              ) : (
                <>
                  <FileSpreadsheet size={16} /> Prefill from a schedule file (optional)
                </>
              )}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xlsm,.xlsb,.xls,.csv"
              className="hidden"
              onChange={(e) => prefillFromFile(e.target.files?.[0] || null)}
            />
            {extractNote && <p className="mt-1.5 text-xs text-muted">{extractNote}</p>}
          </div>
        )}
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
