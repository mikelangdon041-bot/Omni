"use client";

// Browse recordings by person or topic — the shape the user actually thinks
// in: "the folder for Sam", not a flat list of every meeting ever recorded.
// Folders sort alphabetically within People and Topics; open one and its
// meetings sort by date, newest first (see [id]/page.tsx).

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FolderOpen, Pencil, Plus, Tag, Trash2, User } from "lucide-react";
import { BackButton } from "@/components/BackButton";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { useConfirm } from "@/components/ui/Feedback";
import { CreateFolderModal } from "@/components/meetingprep/FolderPicker";
import { useMpFolders, useMpMeetings, useUserId } from "@/lib/meetingprep/hooks";
import { isUnfiled, type FolderKind, type MpFolder } from "@/lib/meetingprep/types";

export default function FoldersPage() {
  const router = useRouter();
  const confirm = useConfirm();
  const { userId } = useUserId();
  const { meetings } = useMpMeetings(userId);
  const { folders, rename, remove, refresh } = useMpFolders(userId);
  const [creatingKind, setCreatingKind] = useState<FolderKind | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    let uncategorized = 0;
    for (const m of meetings) {
      // A meeting filed under both a person and a topic counts in both: it is
      // genuinely in both, and crediting only one would make the other look
      // emptier than it is.
      for (const id of [m.person_folder_id, m.topic_folder_id]) {
        if (id) map.set(id, (map.get(id) || 0) + 1);
      }
      if (isUnfiled(m)) uncategorized += 1;
    }
    return { byFolder: map, uncategorized };
  }, [meetings]);

  const people = folders.filter((f) => f.kind === "person");
  const topics = folders.filter((f) => f.kind === "topic");

  function startEdit(f: MpFolder) {
    setEditingId(f.id);
    setEditingName(f.name);
  }

  function commitEdit() {
    if (editingId && editingName.trim()) rename(editingId, editingName.trim());
    setEditingId(null);
    setEditingName("");
  }

  async function deleteFolder(f: MpFolder) {
    const n = counts.byFolder.get(f.id) || 0;
    if (
      await confirm({
        title: `Delete the "${f.name}" folder?`,
        message: n
          ? `${n} meeting${n === 1 ? "" : "s"} lose this label. Any with no other folder move to Uncategorized. The meetings themselves aren't deleted.`
          : "This folder is empty.",
        confirmLabel: "Delete folder",
        danger: true,
      })
    )
      await remove(f.id);
  }

  function FolderCard({ f }: { f: MpFolder }) {
    const n = counts.byFolder.get(f.id) || 0;
    const editing = editingId === f.id;
    return (
      <li className="group rounded-xl border border-border bg-surface p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-[var(--accent)]/40 hover:shadow-md">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
            {f.kind === "person" ? <User size={18} /> : <Tag size={18} />}
          </span>
          <div className="min-w-0 flex-1">
            {editing ? (
              <div className="flex items-center gap-1">
                <input
                  autoFocus
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitEdit();
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  onBlur={commitEdit}
                  className="w-full rounded-md border border-border bg-canvas px-2 py-1 text-sm outline-none focus:border-[var(--accent)]"
                />
              </div>
            ) : (
              <button
                className="block w-full truncate text-left font-semibold tracking-tight hover:text-[var(--accent)]"
                onClick={() => router.push(`/meeting-prep/folders/${f.id}`)}
              >
                {f.name}
              </button>
            )}
            <p className="mt-0.5 text-xs text-muted">
              {n} meeting{n === 1 ? "" : "s"}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1 opacity-0 transition group-hover:opacity-100">
            <button
              className="rounded p-1 text-muted hover:bg-canvas hover:text-ink"
              aria-label={`Rename ${f.name}`}
              onClick={() => startEdit(f)}
            >
              <Pencil size={13} />
            </button>
            <button
              className="rounded p-1 text-muted hover:bg-canvas hover:text-red-600"
              aria-label={`Delete ${f.name}`}
              onClick={() => void deleteFolder(f)}
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>
      </li>
    );
  }

  return (
    <>
      <BackButton label="Meeting Prep" href="/meeting-prep" />
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--accent)]">
            Meeting Prep
          </p>
          <h1 className="mt-0.5 text-2xl font-semibold tracking-tight">Folders</h1>
          <p className="mt-1 text-sm text-muted">
            Every recording lives under a person or a topic. File one on the
            spot while it&apos;s recording, or move it any time.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setCreatingKind("topic")}>
            <Plus size={15} /> New topic
          </Button>
          <Button onClick={() => setCreatingKind("person")}>
            <Plus size={15} /> New person
          </Button>
        </div>
      </div>

      {/* Uncategorized always shown, even empty — it's where a recording
          lands the moment nobody chose a destination, so it's never a
          surprise that it exists. */}
      <button
        onClick={() => router.push("/meeting-prep/folders/uncategorized")}
        className={`mb-6 flex w-full items-center gap-3 rounded-xl border p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
          counts.uncategorized > 0
            ? "border-amber-300/60 bg-amber-50 hover:border-amber-400"
            : "border-border bg-surface hover:border-[var(--accent)]/40"
        }`}
      >
        <span
          className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${
            counts.uncategorized > 0 ? "bg-amber-100 text-amber-700" : "bg-canvas text-muted"
          }`}
        >
          <FolderOpen size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold tracking-tight">Uncategorized</p>
          <p className="mt-0.5 text-xs text-muted">
            {counts.uncategorized} meeting{counts.uncategorized === 1 ? "" : "s"} not yet filed
          </p>
        </div>
      </button>

      {folders.length === 0 ? (
        <EmptyState
          title="No folders yet"
          hint="Create one for a person you meet regularly, or a topic like Compliance — then file recordings under it as they come in."
          action={
            <Button onClick={() => setCreatingKind("person")}>
              <Plus size={15} /> New person
            </Button>
          }
        />
      ) : (
        <div className="space-y-8">
          {people.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
                People
              </h2>
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {people.map((f) => (
                  <FolderCard key={f.id} f={f} />
                ))}
              </ul>
            </section>
          )}
          {topics.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
                Topics
              </h2>
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {topics.map((f) => (
                  <FolderCard key={f.id} f={f} />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      <CreateFolderModal
        userId={userId}
        kind={creatingKind}
        onClose={() => setCreatingKind(null)}
        // Stays put rather than jumping into the new folder — the modal's
        // own useMpFolders instance doesn't share state with this page's, so
        // the new folder wouldn't show up here without a refresh either way,
        // and staying put is what lets "New person" a second time add the
        // next one without a detour.
        onCreated={() => void refresh()}
      />
    </>
  );
}
