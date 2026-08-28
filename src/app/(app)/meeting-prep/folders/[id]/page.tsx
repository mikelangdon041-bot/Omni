"use client";

// One folder's meetings, newest first. `id` is either a real mp_folders row
// or the literal "uncategorized" — the bucket a recording lands in when
// nobody picked a destination, which needs the same "here's what's inside,
// move it out" view without being a real row to fetch.
//
// A meeting carries two slots, a person and a topic, so inside a person's
// folder its meetings are grouped by topic ("1:1", "Pipeline review", and a
// "No topic" group at the end for the ones never given one) — and inside a
// topic, by person. Nothing hierarchical is stored: the nesting is just this
// view reading the slot the folder itself doesn't occupy.

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { CalendarClock, FolderOpen, Pencil, Tag, Trash2, User } from "lucide-react";
import { BackButton } from "@/components/BackButton";
import { EmptyState } from "@/components/ui/EmptyState";
import { useConfirm } from "@/components/ui/Feedback";
import { FolderPairSelect, CreateFolderModal } from "@/components/meetingprep/FolderPicker";
import { createClient } from "@/lib/supabase/client";
import { useMpFolders, useMpMeetings, useUserId } from "@/lib/meetingprep/hooks";
import {
  folderMovePatch,
  inFolder,
  isUnfiled,
  meetingTypeLabel,
  type FolderKind,
  type MpFolder,
  type MpMeeting,
} from "@/lib/meetingprep/types";

const supabase = createClient();

export default function FolderPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const confirm = useConfirm();
  const { userId } = useUserId();
  const { meetings, refresh } = useMpMeetings(userId);
  const { folders, rename, remove } = useMpFolders(userId);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [creatingKind, setCreatingKind] = useState<FolderKind | null>(null);
  const [creatingFor, setCreatingFor] = useState<string | null>(null);

  const isUncategorized = id === "uncategorized";
  const folder = isUncategorized ? null : folders.find((f) => f.id === id) || null;
  // The slot this folder doesn't occupy is the one worth grouping by: a
  // person's meetings sort into topics, a topic's into people.
  const groupKind: FolderKind = folder?.kind === "topic" ? "person" : "topic";

  const list = useMemo(() => {
    const rows = meetings.filter((m) => (isUncategorized ? isUnfiled(m) : inFolder(m, id)));
    return [...rows].sort((a, b) => {
      const ta = a.date ? +new Date(a.date) : +new Date(a.created_at);
      const tb = b.date ? +new Date(b.date) : +new Date(b.created_at);
      return tb - ta;
    });
  }, [meetings, id, isUncategorized]);

  // Grouped by the other slot, alphabetically, with the ones that never got
  // one gathered at the end rather than scattered through the list.
  const groups = useMemo(() => {
    if (isUncategorized) return [{ key: "", label: "", rows: list }];
    const byKey = new Map<string, MpMeeting[]>();
    for (const m of list) {
      const key = (groupKind === "topic" ? m.topic_folder_id : m.person_folder_id) || "";
      const rows = byKey.get(key);
      if (rows) rows.push(m);
      else byKey.set(key, [m]);
    }
    const named = [...byKey.entries()]
      .filter(([key]) => key)
      .map(([key, rows]) => ({
        key,
        label: folders.find((f) => f.id === key)?.name || "",
        rows,
      }))
      // A folder deleted out from under a meeting leaves an id with no name;
      // it belongs with the unlabelled ones rather than under a blank heading.
      .filter((g) => g.label)
      .sort((a, b) => a.label.localeCompare(b.label));
    const orphanKeys = [...byKey.entries()].filter(
      ([key]) => !key || !folders.some((f) => f.id === key),
    );
    const loose = orphanKeys.flatMap(([, rows]) => rows);
    return loose.length
      ? [...named, { key: "", label: groupKind === "topic" ? "No topic" : "No person", rows: loose }]
      : named;
  }, [list, folders, groupKind, isUncategorized]);

  const showHeadings = !isUncategorized && groups.some((g) => g.key) && groups.length > 1;

  async function moveFolder(meetingId: string, kind: FolderKind, target: MpFolder | null) {
    await supabase.from("mp_meetings").update(folderMovePatch(kind, target)).eq("id", meetingId);
    await refresh();
  }

  async function deleteFolder() {
    if (!folder) return;
    if (
      await confirm({
        title: `Delete the "${folder.name}" folder?`,
        message:
          "The meetings aren't deleted — they lose this label, and any that had no other one land in Uncategorized.",
        confirmLabel: "Delete folder",
        danger: true,
      })
    ) {
      await remove(folder.id);
      router.push("/meeting-prep/folders");
    }
  }

  if (!isUncategorized && folders.length > 0 && !folder) {
    return (
      <div className="py-16 text-center">
        <p className="text-sm text-muted">This folder was deleted.</p>
        <div className="mt-3 flex justify-center">
          <BackButton label="Back to Folders" href="/meeting-prep/folders" />
        </div>
      </div>
    );
  }

  // A function returning the row rather than a component: declared inside the
  // page it would be a new component type on every render, and React would
  // remount every row — closing an open dropdown mid-choice each time the
  // meeting list refreshed underneath it.
  function meetingRow(m: MpMeeting) {
    const d = m.date ? new Date(m.date) : null;
    return (
      <li
        key={m.id}
        className="group flex cursor-pointer items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 shadow-sm transition hover:-translate-y-0.5 hover:border-[var(--accent)]/40 hover:shadow-md"
        onClick={() => router.push(`/meeting-prep/${m.id}`)}
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-canvas text-muted">
          <CalendarClock size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{m.title || "Untitled meeting"}</p>
          <p className="mt-0.5 truncate text-xs text-muted">
            {d
              ? d.toLocaleString(undefined, {
                  dateStyle: "medium",
                  timeStyle: "short",
                })
              : new Date(m.created_at).toLocaleDateString(undefined, { dateStyle: "medium" })}
            {" · "}
            {meetingTypeLabel(m.meeting_type)}
          </p>
        </div>
        <div onClick={(e) => e.stopPropagation()} className="shrink-0">
          <FolderPairSelect
            folders={folders}
            personFolderId={m.person_folder_id}
            topicFolderId={m.topic_folder_id}
            onChange={(kind, target) => void moveFolder(m.id, kind, target)}
            onRequestCreate={(kind) => {
              setCreatingKind(kind);
              setCreatingFor(m.id);
            }}
            className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-muted opacity-0 outline-none transition group-hover:opacity-100 focus:opacity-100 focus:border-[var(--accent)]"
          />
        </div>
      </li>
    );
  }

  return (
    <>
      <BackButton label="Folders" href="/meeting-prep/folders" />
      <div className="mb-6 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${
              isUncategorized
                ? "bg-amber-100 text-amber-700"
                : "bg-[var(--accent-soft)] text-[var(--accent)]"
            }`}
          >
            {isUncategorized ? (
              <FolderOpen size={20} />
            ) : folder?.kind === "person" ? (
              <User size={20} />
            ) : (
              <Tag size={20} />
            )}
          </span>
          <div className="min-w-0">
            {editing && folder ? (
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && name.trim()) {
                    rename(folder.id, name.trim());
                    setEditing(false);
                  }
                  if (e.key === "Escape") setEditing(false);
                }}
                onBlur={() => {
                  if (name.trim()) rename(folder.id, name.trim());
                  setEditing(false);
                }}
                className="w-full rounded-md border border-border bg-canvas px-2 py-1 text-2xl font-semibold tracking-tight outline-none focus:border-[var(--accent)]"
              />
            ) : (
              <h1 className="truncate text-2xl font-semibold tracking-tight">
                {isUncategorized ? "Uncategorized" : folder?.name}
              </h1>
            )}
            <p className="mt-0.5 text-sm text-muted">
              {list.length} meeting{list.length === 1 ? "" : "s"}
              {showHeadings && ` in ${groups.length} ${groupKind === "topic" ? "topics" : "people"}`}
              {isUncategorized && " — not yet filed under a person or topic"}
            </p>
          </div>
        </div>
        {folder && (
          <div className="flex shrink-0 items-center gap-1">
            <button
              className="rounded-lg p-1.5 text-muted transition hover:bg-canvas hover:text-ink"
              aria-label="Rename this folder"
              onClick={() => {
                setName(folder.name);
                setEditing(true);
              }}
            >
              <Pencil size={15} />
            </button>
            <button
              className="rounded-lg p-1.5 text-muted transition hover:bg-red-50 hover:text-red-600"
              aria-label="Delete this folder"
              onClick={() => void deleteFolder()}
            >
              <Trash2 size={15} />
            </button>
          </div>
        )}
      </div>

      {isUncategorized && list.length > 0 && (
        <p className="mb-4 rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          File any of these under a person, a topic, or both — it takes one click and can always be
          changed later.
        </p>
      )}

      {list.length === 0 ? (
        <EmptyState
          title="Nothing here yet"
          hint={
            isUncategorized
              ? "Every recording is filed. New ones land here only if you skip the destination picker."
              : "Recordings filed under this folder will show up here, newest first."
          }
        />
      ) : showHeadings ? (
        <div className="space-y-6">
          {groups.map((g) => (
            <section key={g.key || "none"}>
              <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
                {groupKind === "topic" ? <Tag size={12} /> : <User size={12} />}
                {g.label}
                <span className="font-normal normal-case tracking-normal">({g.rows.length})</span>
              </h2>
              <ul className="space-y-2">{g.rows.map(meetingRow)}</ul>
            </section>
          ))}
        </div>
      ) : (
        <ul className="space-y-2">{list.map(meetingRow)}</ul>
      )}

      <CreateFolderModal
        userId={userId}
        kind={creatingKind}
        onClose={() => {
          setCreatingKind(null);
          setCreatingFor(null);
        }}
        onCreated={(f) => {
          if (creatingFor) void moveFolder(creatingFor, f.kind, f);
        }}
      />
    </>
  );
}
