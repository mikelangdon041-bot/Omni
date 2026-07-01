"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Input";
import { RELATIONSHIP_LABELS } from "@/lib/territory/utils";
import type { KOL, RelationshipLevel } from "@/lib/territory/types";

// Create a brand-new KOL. Writes to the shared `kols` table, so the KOL also
// shows up in Territory Planning ("added back to the territory plan").
export function AddKolModal({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (partial: Partial<KOL>) => Promise<KOL | null>;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const f = new FormData(e.currentTarget);
    const first = String(f.get("first_name") || "").trim();
    const last = String(f.get("last_name") || "").trim();
    if (!first || !last) {
      setError("First and last name are required.");
      return;
    }
    setSaving(true);
    const kol = await onCreate({
      first_name: first,
      last_name: last,
      specialty: String(f.get("specialty") || "").trim(),
      institution: String(f.get("institution") || "").trim(),
      email: String(f.get("email") || "").trim(),
      tier: String(f.get("tier") || "").trim(),
      relationship_level: String(
        f.get("relationship_level") || "not_yet_established",
      ) as RelationshipLevel,
    });
    setSaving(false);
    if (!kol) {
      setError("Could not save. Please try again.");
      return;
    }
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="Add a new KOL" size="md">
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <p className="rounded-lg bg-accent-soft px-3 py-2 text-xs font-medium text-accent">
          New KOLs are added to your Territory too, so everything stays in sync.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label="First name" name="first_name" required />
          <Input label="Last name" name="last_name" required />
          <Input label="Specialty" name="specialty" />
          <Input label="Institution" name="institution" />
          <Input label="Email" name="email" type="email" />
          <Input label="Tier" name="tier" placeholder="e.g. A" />
        </div>
        <Select label="Relationship" name="relationship_level" defaultValue="not_yet_established">
          {(Object.keys(RELATIONSHIP_LABELS) as RelationshipLevel[]).map((r) => (
            <option key={r} value={r}>
              {RELATIONSHIP_LABELS[r]}
            </option>
          ))}
        </Select>

        {error && <p className="text-sm text-status-error">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Add KOL"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
