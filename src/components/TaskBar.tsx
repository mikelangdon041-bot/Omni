"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus, Check, Trash2, X } from "lucide-react";
import { useUserId } from "@/lib/interview/hooks";
import { useTasks, type Task } from "@/lib/tasks/hooks";

const APP_LABEL: Record<string, string> = {
  territory: "Territory",
  interview: "Interview",
  general: "General",
};
const APP_CHIP: Record<string, string> = {
  territory: "bg-emerald-100 text-emerald-700",
  interview: "bg-indigo-100 text-indigo-700",
  general: "bg-slate-100 text-slate-600",
};

function dueClass(due: string | null): string {
  if (!due) return "text-muted";
  const d = new Date(due).getTime();
  const now = Date.now();
  if (d < now) return "text-status-error font-medium";
  if (d < now + 86400000) return "text-amber-600";
  return "text-muted";
}

// Open-task counts for badges (e.g. the account-menu avatar bubble).
// dueNow = overdue or due within the next 24h.
export function useTaskSummary() {
  const { userId } = useUserId();
  const { open, overdue } = useTasks(userId);
  const dueNow = open.filter(
    (t) => t.due_date && new Date(t.due_date).getTime() < Date.now() + 86400000,
  ).length;
  return { openCount: open.length, overdue, dueNow };
}

// The tasks panel, controlled by the caller (lives in the account dropdown
// now, not as its own top-bar button).
export function TasksPanel({ open: show, onClose }: { open: boolean; onClose: () => void }) {
  const { userId } = useUserId();
  const { open, overdue, add, toggle, remove } = useTasks(userId);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");

  async function quickAdd() {
    if (!title.trim()) return;
    await add({
      title: title.trim(),
      app: "general",
      due_date: due ? new Date(due).toISOString() : null,
    });
    setTitle("");
    setDue("");
  }

  if (!show) return null;

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="fixed right-3 top-14 z-50 w-96 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl border border-border bg-surface shadow-lg">
            <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
              <p className="text-sm font-semibold">
                Tasks{overdue > 0 && <span className="ml-2 text-xs text-status-error">{overdue} overdue</span>}
              </p>
              <button onClick={onClose} className="text-muted hover:text-ink">
                <X size={16} />
              </button>
            </div>

            {/* Quick add */}
            <div className="border-b border-border p-3">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && quickAdd()}
                placeholder="Add a task…"
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
              />
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="date"
                  value={due}
                  onChange={(e) => setDue(e.target.value)}
                  className="flex-1 rounded-lg border border-border bg-surface px-2 py-1.5 text-xs outline-none focus:border-[var(--accent)]"
                />
                <button
                  onClick={quickAdd}
                  disabled={!title.trim()}
                  className="inline-flex items-center gap-1 rounded-lg bg-[var(--accent,#4f46e5)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                >
                  <Plus size={13} /> Add
                </button>
              </div>
            </div>

            {open.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted">Nothing on your list.</p>
            ) : (
              <ul className="max-h-96 overflow-y-auto">
                {open.map((t) => (
                  <TaskRow key={t.id} task={t} onToggle={() => toggle(t.id, true)} onRemove={() => remove(t.id)} onClose={onClose} />
                ))}
              </ul>
            )}
      </div>
    </>
  );
}

function TaskRow({
  task,
  onToggle,
  onRemove,
  onClose,
}: {
  task: Task;
  onToggle: () => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const body = (
    <div className="flex items-start gap-2.5">
      <button
        onClick={(e) => {
          e.preventDefault();
          onToggle();
        }}
        className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded border border-border transition hover:border-[var(--accent)]"
        title="Complete"
      >
        <Check size={12} className="opacity-0" />
      </button>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-ink">{task.title}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px]">
          <span className={`rounded-full px-1.5 py-0.5 font-medium ${APP_CHIP[task.app] || APP_CHIP.general}`}>
            {APP_LABEL[task.app] || "General"}
          </span>
          {task.entity_label && <span className="text-muted">{task.entity_label}</span>}
          {task.due_date && (
            <span className={dueClass(task.due_date)}>
              {new Date(task.due_date).toLocaleDateString()}
            </span>
          )}
        </div>
      </div>
      <button
        onClick={(e) => {
          e.preventDefault();
          onRemove();
        }}
        className="text-muted transition hover:text-status-error"
        title="Delete"
      >
        <Trash2 size={13} />
      </button>
    </div>
  );

  return (
    <li className="border-b border-border px-4 py-2.5 transition hover:bg-canvas">
      {task.link ? (
        <Link href={task.link} onClick={onClose}>
          {body}
        </Link>
      ) : (
        body
      )}
    </li>
  );
}
