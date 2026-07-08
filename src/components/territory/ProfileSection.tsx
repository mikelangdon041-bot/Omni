"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import type { KOL } from "@/lib/territory/types";
import { HOW_MET_LABELS } from "@/lib/territory/utils";
import { Button } from "@/components/territory/ui/Button";
import { Input, Select } from "@/components/territory/ui/Input";
import { RichText, RichTextView } from "@/components/ui/RichText";

// Editable text fields. Contact info now lives on the header card; this tab is
// the KOL's background (Profile) and their links.
const SECTIONS: { title: string; fields: { key: keyof KOL; label: string; long?: boolean }[] }[] = [
  {
    title: "Profile",
    fields: [
      { key: "tier", label: "Tier" },
      { key: "how_met", label: "How did you meet?" },
      { key: "society_associations", label: "Societies / associations", long: true },
      { key: "leadership_appointments", label: "Leadership appointments", long: true },
      { key: "publications", label: "Publications", long: true },
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
];
// Note: engagement-strategy fields live on the Strategy tab (StrategySection),
// not here — the Profile tab is for who the KOL is, the Strategy tab is the plan.

export function ProfileSection({
  kol,
  update,
  editing: editingProp,
  onEditingChange,
}: {
  kol: KOL;
  update: (partial: Partial<KOL>) => Promise<void>;
  editing?: boolean;
  onEditingChange?: (v: boolean) => void;
}) {
  const controlled = editingProp !== undefined;
  const [editingState, setEditingState] = useState(false);
  const editing = controlled ? !!editingProp : editingState;
  const setEditing = (v: boolean) => {
    if (controlled) onEditingChange?.(v);
    else setEditingState(v);
  };
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
      {/* When editing is controlled by the parent (tab row), the parent shows
          the Edit trigger; we only render Save/Cancel while editing. */}
      {(editing || !controlled) && (
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
      )}

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
              // "How did you meet?" is a fixed dropdown (plus a free-text
              // field when "Other" is picked), not a plain input.
              if (field.key === "how_met") {
                const howMet = value || "other";
                const other = (draft.how_met_other ?? kol.how_met_other ?? "") as string;
                if (!editing) {
                  // Everyone defaults to "other"; only show once it says something.
                  if (howMet === "other" && !other) return null;
                  return (
                    <div key={field.key} className={span}>
                      <p className="text-xs text-muted">{field.label}</p>
                      <p className="text-sm text-ink">
                        {howMet === "other" && other
                          ? `Other — ${other}`
                          : HOW_MET_LABELS[howMet] || howMet}
                      </p>
                    </div>
                  );
                }
                return (
                  <div key={field.key} className={`space-y-2 ${span}`}>
                    <Select
                      label={field.label}
                      value={howMet}
                      onChange={(e) => set("how_met", e.target.value)}
                    >
                      {Object.entries(HOW_MET_LABELS).map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </Select>
                    {howMet === "other" && (
                      <Input
                        label="Other — please specify"
                        value={other}
                        onChange={(e) => set("how_met_other", e.target.value)}
                      />
                    )}
                  </div>
                );
              }
              if (!editing) {
                if (!value) return null;
                return (
                  <div key={field.key} className={span}>
                    <p className="text-xs text-muted">{field.label}</p>
                    {field.long ? (
                      <RichTextView html={value} />
                    ) : (
                      <p className="text-sm text-ink whitespace-pre-wrap">{value}</p>
                    )}
                  </div>
                );
              }
              return (
                <div key={field.key} className={span}>
                  {field.long ? (
                    <>
                      <p className="mb-1 text-xs font-medium text-muted">{field.label}</p>
                      <RichText value={value} onChange={(html) => set(field.key, html)} />
                    </>
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
            section.fields.every((f) =>
              f.key === "how_met"
                ? ((kol.how_met ?? "other") === "other" && !kol.how_met_other)
                : !((kol[f.key] ?? "") as string),
            ) && <p className="text-sm text-muted">No information yet.</p>}
        </div>
      ))}
    </div>
  );
}
