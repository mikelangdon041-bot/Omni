"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import type { KOL } from "@/lib/territory/types";
import { Button } from "@/components/territory/ui/Button";
import { Input, Textarea } from "@/components/territory/ui/Input";

// Editable text fields grouped into sections.
const SECTIONS: { title: string; fields: { key: keyof KOL; label: string; long?: boolean }[] }[] = [
  {
    title: "Contact",
    fields: [
      { key: "title_position", label: "Title / position" },
      { key: "specialty", label: "Specialty" },
      { key: "institution", label: "Institution" },
      { key: "phone", label: "Phone" },
      { key: "email", label: "Email" },
      { key: "address", label: "Address" },
    ],
  },
  {
    title: "Links",
    fields: [
      { key: "website_office", label: "Office website" },
      { key: "website_pubmed", label: "PubMed" },
      { key: "website_other", label: "Other link" },
    ],
  },
  {
    title: "Profile",
    fields: [
      { key: "tier", label: "Tier" },
      { key: "society_associations", label: "Societies / associations", long: true },
      { key: "leadership_appointments", label: "Leadership appointments", long: true },
      { key: "publications", label: "Publications", long: true },
    ],
  },
  {
    title: "Engagement strategy",
    fields: [
      { key: "areas_of_interest", label: "Areas of interest", long: true },
      { key: "potential_collaborations", label: "Potential collaborations", long: true },
      { key: "primary_objective", label: "Primary objective", long: true },
      { key: "backup_questions", label: "Backup questions", long: true },
      { key: "other_info", label: "Other info", long: true },
    ],
  },
];

export function ProfileSection({
  kol,
  update,
}: {
  kol: KOL;
  update: (partial: Partial<KOL>) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Partial<KOL>>({});
  const [saving, setSaving] = useState(false);

  function set(key: keyof KOL, value: string) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  async function save() {
    setSaving(true);
    await update(draft);
    setSaving(false);
    setEditing(false);
    setDraft({});
  }

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        {editing ? (
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setEditing(false);
                setDraft({});
              }}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        ) : (
          <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
            <Pencil size={14} /> Edit
          </Button>
        )}
      </div>

      {SECTIONS.map((section) => (
        <div
          key={section.title}
          className="rounded-xl border border-border bg-surface p-5 shadow-sm"
        >
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted">
            {section.title}
          </h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {section.fields.map((field) => {
              const value = (draft[field.key] ?? kol[field.key] ?? "") as string;
              const span = field.long ? "sm:col-span-2" : "";
              if (!editing) {
                if (!value) return null;
                return (
                  <div key={field.key} className={span}>
                    <p className="text-xs text-muted">{field.label}</p>
                    <p className="text-sm text-ink whitespace-pre-wrap">{value}</p>
                  </div>
                );
              }
              return (
                <div key={field.key} className={span}>
                  {field.long ? (
                    <Textarea
                      label={field.label}
                      value={value}
                      onChange={(e) => set(field.key, e.target.value)}
                    />
                  ) : (
                    <Input
                      label={field.label}
                      value={value}
                      onChange={(e) => set(field.key, e.target.value)}
                    />
                  )}
                </div>
              );
            })}
          </div>
          {!editing &&
            section.fields.every((f) => !((kol[f.key] ?? "") as string)) && (
              <p className="text-sm text-muted">No information yet.</p>
            )}
        </div>
      ))}
    </div>
  );
}
