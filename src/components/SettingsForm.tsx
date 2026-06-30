"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

const supabase = createClient();

export function SettingsForm({
  userId,
  orgId,
  initialDisplayName,
  initialCompany,
  canRenameCompany,
}: {
  userId: string;
  orgId: string | null;
  initialDisplayName: string;
  initialCompany: string;
  canRenameCompany: boolean;
}) {
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [company, setCompany] = useState(initialCompany);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    setSaving(true);
    setSaved(false);
    await supabase
      .from("profiles")
      .update({ display_name: displayName.trim() })
      .eq("id", userId);
    if (canRenameCompany && orgId) {
      await supabase
        .from("organizations")
        .update({ name: company.trim() })
        .eq("id", orgId);
    }
    setSaving(false);
    setSaved(true);
  }

  return (
    <div className="space-y-4">
      <Input
        label="Display name"
        value={displayName}
        onChange={(e) => {
          setDisplayName(e.target.value);
          setSaved(false);
        }}
      />
      <Input
        label="Company"
        value={company}
        onChange={(e) => {
          setCompany(e.target.value);
          setSaved(false);
        }}
        disabled={!canRenameCompany}
      />
      {!canRenameCompany && (
        <p className="-mt-2 text-xs text-muted">
          Only the company owner can rename it.
        </p>
      )}
      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
        {saved && <span className="text-sm text-status-complete">Saved</span>}
      </div>
    </div>
  );
}
