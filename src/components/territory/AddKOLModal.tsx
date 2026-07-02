"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/territory/ui/Modal";
import { Input, Select } from "@/components/territory/ui/Input";
import { Button } from "@/components/territory/ui/Button";
import { RELATIONSHIP_LABELS } from "@/lib/territory/utils";
import { useUserId, useFieldSuggestions } from "@/lib/territory/hooks";
import type { KOL, RelationshipLevel } from "@/lib/territory/types";

export function AddKOLModal({
  open,
  onClose,
  onCreate,
  lists,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (partial: Partial<KOL>) => Promise<KOL | null>;
  lists: string[];
}) {
  const router = useRouter();
  const { userId } = useUserId();
  const suggestions = useFieldSuggestions(userId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ac = (opts?: string[]) =>
    opts && opts.length ? (
      opts.map((o) => <option key={o} value={o} />)
    ) : null;

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
      title_position: String(f.get("title_position") || "").trim(),
      specialty: String(f.get("specialty") || "").trim(),
      clinician_type: String(f.get("clinician_type") || "").trim(),
      institution: String(f.get("institution") || "").trim(),
      address: String(f.get("address") || "").trim(),
      phone: String(f.get("phone") || "").trim(),
      email: String(f.get("email") || "").trim(),
      relationship_level: String(
        f.get("relationship_level") || "not_yet_established",
      ) as RelationshipLevel,
      list_name: String(f.get("list_name") || "").trim(),
      priority: Number(f.get("priority") || 0),
      is_product_a_user: f.get("is_product_a_user") === "on",
      is_product_b_user: f.get("is_product_b_user") === "on",
    });
    setSaving(false);
    if (!kol) {
      setError("Could not save. Please try again.");
      return;
    }
    onClose();
    router.push(`/territory-planning/kol/${kol.id}`);
  }

  return (
    <Modal open={open} onClose={onClose} title="Add KOL" size="lg">
      <form onSubmit={onSubmit} className="space-y-5">
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label="First name" name="first_name" required />
          <Input label="Last name" name="last_name" required />
          <Input label="Title / position" name="title_position" list="ac-title" />
          <Input label="Specialty" name="specialty" list="ac-specialty" />
          <Input label="Clinician type" name="clinician_type" list="ac-clinician" placeholder="Physician, Nurse, NP…" />
          <Input label="Institution" name="institution" list="ac-institution" />
          <Input label="Phone" name="phone" />
          <Input label="Email" name="email" type="email" />
          <Input label="Address" name="address" placeholder="City, ST 12345" list="ac-address" />
          <datalist id="ac-title">{ac(suggestions.title_position)}</datalist>
          <datalist id="ac-specialty">{ac(suggestions.specialty)}</datalist>
          <datalist id="ac-clinician">{ac(suggestions.clinician_type)}</datalist>
          <datalist id="ac-institution">{ac(suggestions.institution)}</datalist>
          <datalist id="ac-address">{ac(suggestions.address)}</datalist>
        </section>

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Select label="Relationship" name="relationship_level" defaultValue="not_yet_established">
            {(Object.keys(RELATIONSHIP_LABELS) as RelationshipLevel[]).map((r) => (
              <option key={r} value={r}>
                {RELATIONSHIP_LABELS[r]}
              </option>
            ))}
          </Select>
          <Input
            label="Priority (0–5)"
            name="priority"
            type="number"
            min={0}
            max={5}
            defaultValue={0}
          />
          <Input label="List" name="list_name" list="kol-lists" placeholder="e.g. 2026" />
          <datalist id="kol-lists">
            {lists.map((l) => (
              <option key={l} value={l} />
            ))}
          </datalist>
        </section>

        <section className="flex flex-wrap gap-5">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="is_product_a_user" className="h-4 w-4 accent-primary" />
            Product A user
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="is_product_b_user" className="h-4 w-4 accent-primary" />
            Product B user
          </label>
        </section>

        {error && <p className="text-sm text-status-error">{error}</p>}

        <div className="flex justify-end gap-2 border-t border-border pt-4">
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
