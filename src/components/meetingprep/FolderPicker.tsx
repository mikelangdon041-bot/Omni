"use client";

// Where a meeting is filed: a person, a topic, or nothing ("Uncategorized").
// One dropdown, grouped, with "+ New…" at the bottom of each group so
// creating a folder never requires leaving wherever this is dropped — the
// meeting detail page, the meeting list, and the recorder's review step all
// use the same pieces so the picker behaves identically everywhere.
//
//   FolderSelect      — the <select> itself. Takes a preloaded folder list,
//                        so a page with many rows (the meeting list) fetches
//                        folders once rather than once per row.
//   CreateFolderModal — the "+ New person/topic" form, shared so there is
//                        exactly one place that knows how to create one.
//   FolderPicker      — FolderSelect + CreateFolderModal wired together and
//                        self-sufficient (fetches its own folder list) —
//                        the one to reach for anywhere there's a single
//                        picker, like the meeting detail page header.

import { useEffect, useState } from "react";
import { FolderPlus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { useMpFolders } from "@/lib/meetingprep/hooks";
import type { FolderKind, MpFolder } from "@/lib/meetingprep/types";

const supabase = createClient();

export const NEW_PERSON = "__new_person__";
export const NEW_TOPIC = "__new_topic__";

interface KolOption {
  id: string;
  label: string;
  detail: string;
}

export function FolderSelect({
  folders,
  folderId,
  onChange,
  onRequestCreate,
  className,
}: {
  folders: MpFolder[];
  folderId: string | null;
  onChange: (folder: MpFolder | null) => void;
  onRequestCreate: (kind: FolderKind) => void;
  className?: string;
}) {
  const people = folders.filter((f) => f.kind === "person");
  const topics = folders.filter((f) => f.kind === "topic");

  return (
    <select
      value={folderId ?? ""}
      onChange={(e) => {
        const v = e.target.value;
        if (v === NEW_PERSON) return onRequestCreate("person");
        if (v === NEW_TOPIC) return onRequestCreate("topic");
        onChange(folders.find((f) => f.id === v) ?? null);
      }}
      className={
        className ||
        "rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-muted outline-none transition focus:border-[var(--accent)]"
      }
      title="Move to a person or topic folder"
    >
      <option value="">Uncategorized</option>
      <optgroup label="People">
        {people.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
        <option value={NEW_PERSON}>+ New person…</option>
      </optgroup>
      <optgroup label="Topics">
        {topics.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
        <option value={NEW_TOPIC}>+ New topic…</option>
      </optgroup>
    </select>
  );
}

export function CreateFolderModal({
  userId,
  kind,
  onClose,
  onCreated,
}: {
  userId: string | null;
  /** null closes the modal. */
  kind: FolderKind | null;
  onClose: () => void;
  onCreated: (folder: MpFolder) => void;
}) {
  const { create } = useMpFolders(userId);
  const [name, setName] = useState("");
  const [kolQuery, setKolQuery] = useState("");
  const [kolId, setKolId] = useState("");
  const [kolOptions, setKolOptions] = useState<KolOption[]>([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (kind !== "person" || !userId) return;
    void supabase
      .from("kols")
      .select("id, first_name, last_name, specialty, institution")
      .eq("user_id", userId)
      .order("last_name")
      .then(({ data }) => {
        setKolOptions(
          (data || [])
            .map((k) => ({
              id: k.id as string,
              label: `${k.first_name ?? ""} ${k.last_name ?? ""}`.trim(),
              detail: [k.specialty, k.institution].filter(Boolean).join(" · "),
            }))
            .filter((k) => k.label),
        );
      });
  }, [kind, userId]);

  function reset() {
    setName("");
    setKolQuery("");
    setKolId("");
  }

  async function submit() {
    if (!kind || !name.trim()) return;
    setCreating(true);
    try {
      const folder = await create({
        kind,
        name: name.trim(),
        kolId: kind === "person" ? kolId || null : null,
      });
      if (folder) onCreated(folder);
      reset();
      onClose();
    } finally {
      setCreating(false);
    }
  }

  return (
    <Modal
      open={kind !== null}
      onClose={() => {
        reset();
        onClose();
      }}
      title={kind === "person" ? "New person folder" : "New topic folder"}
      size="sm"
    >
      <div className="space-y-3">
        <Input
          label={kind === "person" ? "Their name" : "Topic name"}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={kind === "person" ? "Sam Rivera" : "Compliance"}
          autoFocus
        />
        {kind === "person" && (
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">
              Link to a Territory KOL (optional)
            </label>
            <input
              value={kolQuery}
              onChange={(e) => {
                setKolQuery(e.target.value);
                const hit = kolOptions.find(
                  (k) => k.label.toLowerCase() === e.target.value.trim().toLowerCase(),
                );
                setKolId(hit?.id || "");
                if (hit && !name.trim()) setName(hit.label);
              }}
              list="omni-folder-kol-list"
              placeholder="Search your KOLs — leave blank for an MSL or teammate"
              className="w-full rounded-md border border-border bg-canvas px-2 py-1.5 text-sm outline-none transition focus:border-[var(--accent)]"
            />
            <datalist id="omni-folder-kol-list">
              {kolOptions.map((k) => (
                <option key={k.id} value={k.label}>
                  {k.detail}
                </option>
              ))}
            </datalist>
            {kolId && (
              <p className="mt-1 text-[11px] text-emerald-700">
                Linked — meetings filed here also log against them in Territory Planning.
              </p>
            )}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            onClick={() => {
              reset();
              onClose();
            }}
          >
            Cancel
          </Button>
          <Button disabled={!name.trim() || creating} onClick={() => void submit()}>
            <FolderPlus size={14} /> {creating ? "Creating…" : "Create & file here"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function FolderPicker({
  userId,
  folderId,
  onChange,
  className,
}: {
  userId: string | null;
  folderId: string | null;
  onChange: (folder: MpFolder | null) => void;
  className?: string;
}) {
  const { folders } = useMpFolders(userId);
  const [creatingKind, setCreatingKind] = useState<FolderKind | null>(null);

  return (
    <>
      <FolderSelect
        folders={folders}
        folderId={folderId}
        onChange={onChange}
        onRequestCreate={setCreatingKind}
        className={className}
      />
      <CreateFolderModal
        userId={userId}
        kind={creatingKind}
        onClose={() => setCreatingKind(null)}
        onCreated={onChange}
      />
    </>
  );
}
