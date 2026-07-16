"use client";

// Venue map (spec §12): upload a floor plan, set the venue address, tap the
// image to drop shared pins (Meeting Point / Team Hub / Custom).

import { useRef, useState } from "react";
import { ImagePlus, MapPin, Navigation, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { EmptyState } from "@/components/ui/EmptyState";
import { useToast } from "@/components/ui/Feedback";
import { useConferenceCtx } from "@/components/conference/ConferenceContext";
import { uploadConferenceFile, usePins } from "@/lib/conference/hooks";
import {
  ATTENDEE_COLORS,
  PIN_TYPES,
  type PinType,
  type VenuePin,
} from "@/lib/conference/types";
import { mapsUrl } from "@/lib/conference/utils";
import { cn } from "@/lib/ui";

export default function VenueMapPage() {
  const toast = useToast();
  const { conference, updateConference } = useConferenceCtx();
  const { pins, add, remove } = usePins(conference.id);
  const imgRef = useRef<HTMLDivElement>(null);

  const [uploading, setUploading] = useState(false);
  const [draft, setDraft] = useState<{ x: number; y: number } | null>(null);
  const [selected, setSelected] = useState<VenuePin | null>(null);
  const [editAddress, setEditAddress] = useState(false);
  const [address, setAddress] = useState(conference.venue_address);

  async function uploadPlan(file: File | null) {
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadConferenceFile(conference.id, "floorplan", file);
      if (url) await updateConference({ floor_plan_url: url });
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  function onMapClick(e: React.MouseEvent) {
    const el = imgRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    setDraft({ x, y });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {conference.venue_address ? (
          <a
            href={mapsUrl(conference.venue_address)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-2 text-xs font-medium text-white transition hover:bg-[var(--accent-hover)]"
          >
            <Navigation size={14} /> Navigate to venue
          </a>
        ) : null}
        <button
          onClick={() => setEditAddress(true)}
          className="rounded-lg border border-border bg-surface px-3 py-2 text-xs font-medium text-muted transition hover:text-ink"
        >
          {conference.venue_address ? "Edit address" : "Set venue address"}
        </button>
        <span className="flex-1" />
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-xs font-medium text-muted transition hover:text-ink">
          <ImagePlus size={14} />
          {uploading ? "Uploading…" : conference.floor_plan_url ? "Replace floor plan" : "Upload floor plan"}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => uploadPlan(e.target.files?.[0] || null)}
          />
        </label>
      </div>

      {!conference.floor_plan_url ? (
        <EmptyState
          title="No floor plan yet"
          hint="Upload a photo or image of the venue floor plan, then tap it to drop shared pins — meeting points, the team hub, and more."
        />
      ) : (
        <>
          <div
            ref={imgRef}
            onClick={onMapClick}
            className="relative w-full cursor-crosshair overflow-hidden rounded-xl border border-border bg-surface"
            title="Tap to drop a pin"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={conference.floor_plan_url}
              alt="Venue floor plan"
              className="block w-full select-none"
              draggable={false}
            />
            {pins.map((p) => (
              <button
                key={p.id}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelected(p);
                }}
                className="absolute -translate-x-1/2 -translate-y-full drop-shadow"
                style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
                title={p.label}
              >
                <MapPin size={26} fill={p.color} className="text-white" />
              </button>
            ))}
          </div>
          <p className="text-xs text-muted">
            Tap anywhere on the plan to drop a pin. Pins are shared live with the team.
          </p>
          {pins.length > 0 && (
            <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {pins.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm"
                >
                  <MapPin size={15} style={{ color: p.color }} />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">{p.label}</span>
                    <span className="text-muted"> · {PIN_TYPES[p.pin_type]}</span>
                    {p.description && <span className="text-muted"> — {p.description}</span>}
                  </span>
                  <button
                    onClick={() => remove(p.id)}
                    className="rounded p-1 text-muted hover:text-red-600"
                  >
                    <Trash2 size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {/* New pin */}
      <PinModal
        open={!!draft}
        onClose={() => setDraft(null)}
        onSave={async (partial) => {
          if (draft) await add({ ...partial, x: draft.x, y: draft.y });
          setDraft(null);
        }}
      />

      {/* Pin detail */}
      <Modal open={!!selected} onClose={() => setSelected(null)} title={selected?.label} size="sm">
        {selected && (
          <div className="space-y-3">
            <p className="text-sm text-muted">
              {PIN_TYPES[selected.pin_type]}
              {selected.description && ` — ${selected.description}`}
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="danger"
                size="sm"
                onClick={async () => {
                  await remove(selected.id);
                  setSelected(null);
                }}
              >
                <Trash2 size={13} /> Remove pin
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Address editor */}
      <Modal open={editAddress} onClose={() => setEditAddress(false)} title="Venue address" size="sm">
        <div className="space-y-3">
          <Input
            label="Address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Convention center street address"
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditAddress(false)}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                await updateConference({ venue_address: address.trim() });
                setEditAddress(false);
              }}
            >
              Save
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function PinModal({
  open,
  onClose,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (partial: Partial<VenuePin>) => Promise<void>;
}) {
  const [label, setLabel] = useState("");
  const [pinType, setPinType] = useState<PinType>("meeting_point");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState(ATTENDEE_COLORS[0]);

  return (
    <Modal open={open} onClose={onClose} title="Drop a pin" size="sm">
      <div className="space-y-3">
        <Input
          label="Label *"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. Team meetup spot"
          autoFocus
        />
        <Select
          label="Type"
          value={pinType}
          onChange={(e) => setPinType(e.target.value as PinType)}
        >
          {(Object.keys(PIN_TYPES) as PinType[]).map((t) => (
            <option key={t} value={t}>
              {PIN_TYPES[t]}
            </option>
          ))}
        </Select>
        <Textarea
          label="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          {ATTENDEE_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className={cn("h-6 w-6 rounded-full", color === c && "ring-2 ring-ink ring-offset-2")}
              style={{ background: c }}
            />
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!label.trim()}
            onClick={async () => {
              await onSave({ label: label.trim(), pin_type: pinType, description, color });
              setLabel("");
              setDescription("");
            }}
          >
            Drop pin
          </Button>
        </div>
      </div>
    </Modal>
  );
}
