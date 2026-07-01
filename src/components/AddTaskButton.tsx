"use client";

import { useState } from "react";
import { ListTodo, Check } from "lucide-react";
import { useUserId } from "@/lib/interview/hooks";
import { useTasks } from "@/lib/tasks/hooks";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";

// Creates a task linked to the current thing (KOL, interview, …). The task
// shows up in the global task bar for everyone's one to-do list.
export function AddTaskButton({
  app,
  link,
  entityLabel,
  label = "Add task",
  compact,
}: {
  app: "territory" | "interview" | "general";
  link?: string;
  entityLabel?: string;
  label?: string;
  compact?: boolean;
}) {
  const { userId } = useUserId();
  const { add } = useTasks(userId);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  async function save() {
    if (!title.trim()) return;
    setSaving(true);
    await add({
      title: title.trim(),
      app,
      link: link || "",
      entity_label: entityLabel || "",
      due_date: due ? new Date(due).toISOString() : null,
    });
    setSaving(false);
    setDone(true);
    setTimeout(() => {
      setOpen(false);
      setDone(false);
      setTitle("");
      setDue("");
    }, 700);
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={
          compact
            ? "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-medium text-muted transition hover:bg-canvas hover:text-ink"
            : "inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-sm font-medium text-ink transition hover:border-[var(--accent)]"
        }
      >
        <ListTodo size={15} /> {label}
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="Add a task" size="sm">
        {done ? (
          <p className="flex items-center gap-2 py-4 text-sm font-medium text-status-complete">
            <Check size={16} /> Added to your tasks.
          </p>
        ) : (
          <div className="space-y-3">
            {entityLabel && (
              <p className="text-xs text-muted">
                Linked to <span className="font-medium text-ink">{entityLabel}</span>
              </p>
            )}
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && save()}
              placeholder="What needs doing?"
              className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)]"
            />
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted">Due (optional)</span>
              <input
                type="date"
                value={due}
                onChange={(e) => setDue(e.target.value)}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
              />
            </label>
            <div className="flex justify-end">
              <Button onClick={save} disabled={saving || !title.trim()}>
                {saving ? "Adding…" : "Add task"}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
