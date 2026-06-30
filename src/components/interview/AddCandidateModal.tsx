"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { Input, Select } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import {
  CANDIDATE_STATUSES,
  STATUS_LABELS,
  type Candidate,
  type CandidateStatus,
} from "@/lib/interview/types";

export function AddCandidateModal({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (partial: Partial<Candidate>) => Promise<Candidate | null>;
}) {
  const router = useRouter();
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
    const c = await onCreate({
      first_name: first,
      last_name: last,
      role_title: String(f.get("role_title") || "").trim(),
      email: String(f.get("email") || "").trim(),
      phone: String(f.get("phone") || "").trim(),
      location: String(f.get("location") || "").trim(),
      status: String(f.get("status") || "active") as CandidateStatus,
    });
    setSaving(false);
    if (!c) {
      setError("Could not save. Please try again.");
      return;
    }
    onClose();
    router.push(`/interview-prep/candidate/${c.id}`);
  }

  return (
    <Modal open={open} onClose={onClose} title="Add candidate" size="lg">
      <form onSubmit={onSubmit} className="space-y-5">
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label="First name" name="first_name" required />
          <Input label="Last name" name="last_name" required />
          <Input label="Role / position" name="role_title" />
          <Select label="Status" name="status" defaultValue="active">
            {CANDIDATE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
          <Input label="Email" name="email" type="email" />
          <Input label="Phone" name="phone" />
          <Input label="Location" name="location" />
        </section>

        {error && <p className="text-sm text-status-error">{error}</p>}

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Add candidate"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
