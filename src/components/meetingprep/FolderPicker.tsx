"use client";

// Where a meeting is filed: who it was with, and what it was about. Two
// independent slots — "Priya" and "1:1" — because a meeting is usually both,
// and making it a choice meant topic folders only ever collected the meetings
// nobody was attached to.
//
// Two selects rather than one grouped dropdown: picking which kind you are
// even looking for should not take reading a combined list first, and once
// both can be set at once there is nothing left for a single control to say.
// The desktop recorder's picker is the same shape (see desktop/ui/app.js).
//
//   FolderSlotSelect  — one <select>, one kind. Takes a preloaded folder list,
//                        so a page with many rows (the meeting list) fetches
//                        folders once rather than once per row.
//   FolderPairSelect  — the person and topic slots together.
//   CreateFolderModal — the "+ New person/topic" form, shared so there is
//                        exactly one place that knows how to create one.
//   FolderPicker      — FolderPairSelect + CreateFolderModal wired together
//                        and self-sufficient (fetches its own folder list) —
//                        the one to reach for anywhere there's a single
//                        picker, like the meeting detail page header.

import { useEffect, useState } from "react";
import { FolderPlus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Feedback";
import { useMpFolders } from "@/lib/meetingprep/hooks";
import type { FolderKind, MpFolder } from "@/lib/meetingprep/types";

const supabase = createClient();

export const NEW_FOLDER = "__new__";

interface KolOption {
  id: string;
  label: string;
  detail: string;
}

const EMPTY_LABEL: Record<FolderKind, string> = {
  person: "No person",
  topic: "No topic",
};

const NEW_LABEL: Record<FolderKind, string> = {
  person: "+ New person…",
  topic: "+ New topic…",
};

export function FolderSlotSelect({
  folders,
  kind,
  folderId,
  onChange,
  onRequestCreate,
  className,
}: {
  folders: MpFolder[];
  kind: FolderKind;
  folderId: string | null;
  onChange: (folder: MpFolder | null) => void;
  onRequestCreate: (kind: FolderKind) => void;
  className?: string;
}) {
  const options = folders.filter((f) => f.kind === kind);

  return (
    <select
      value={folderId ?? ""}
      onChange={(e) => {
        const v = e.target.value;
        if (v === NEW_FOLDER) return onRequestCreate(kind);
        onChange(folders.find((f) => f.id === v) ?? null);
      }}
      className={
        className ||
        "rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-muted outline-none transition focus:border-[var(--accent)]"
      }
      title={kind === "person" ? "Who this meeting was with" : "What this meeting was about"}
      aria-label={kind === "person" ? "Person" : "Topic"}
    >
      <option value="">{EMPTY_LABEL[kind]}</option>
      {options.map((f) => (
        <option key={f.id} value={f.id}>
          {f.name}
        </option>
      ))}
      <option value={NEW_FOLDER}>{NEW_LABEL[kind]}</option>
    </select>
  );
}

/** Both slots. `onChange` is told which one moved, because clearing one sends
    a null that still has to say what it emptied. */
export function FolderPairSelect({
  folders,
  personFolderId,
  topicFolderId,
  onChange,
  onRequestCreate,
  className,
}: {
  folders: MpFolder[];
  personFolderId: string | null;
  topicFolderId: string | null;
  onChange: (kind: FolderKind, folder: MpFolder | null) => void;
  onRequestCreate: (kind: FolderKind) => void;
  className?: string;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <FolderSlotSelect
        folders={folders}
        kind="person"
        folderId={personFolderId}
        onChange={(f) => onChange("person", f)}
        onRequestCreate={onRequestCreate}
        className={className}
      />
      <FolderSlotSelect
        folders={folders}
        kind="topic"
        folderId={topicFolderId}
        onChange={(f) => onChange("topic", f)}
        onRequestCreate={onRequestCreate}
        className={className}
      />
    </span>
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
  const toast = useToast();
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
      if (folder) {
        onCreated(folder);
        reset();
        onClose();
      }
    } catch (e) {
      // Left open on failure — most likely cause is migration 0030
      // (mp_folders) hasn't been run against this database yet, and that's
      // worth reading rather than a modal that just silently closed.
      toast("error", (e as Error).message || "Could not create the folder");
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
          placeholder={kind === "person" ? "Sam Rivera" : "1:1"}
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
  personFolderId,
  topicFolderId,
  onChange,
  className,
}: {
  userId: string | null;
  personFolderId: string | null;
  topicFolderId: string | null;
  onChange: (kind: FolderKind, folder: MpFolder | null) => void;
  className?: string;
}) {
  const { folders } = useMpFolders(userId);
  const [creatingKind, setCreatingKind] = useState<FolderKind | null>(null);

  return (
    <>
      <FolderPairSelect
        folders={folders}
        personFolderId={personFolderId}
        topicFolderId={topicFolderId}
        onChange={onChange}
        onRequestCreate={setCreatingKind}
        className={className}
      />
      <CreateFolderModal
        userId={userId}
        kind={creatingKind}
        onClose={() => setCreatingKind(null)}
        onCreated={(folder) => onChange(folder.kind, folder)}
      />
    </>
  );
}
