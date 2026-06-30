"use client";

import { useMemo, useState } from "react";
import { CheckSquare, Check, X, Plus } from "lucide-react";
import { useReminders } from "@/lib/territory/hooks";
import { presetToDate, type DueDatePreset, type Reminder } from "@/lib/territory/types";
import { cn } from "@/lib/territory/utils";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input, Select } from "@/components/ui/Input";

type Bucket = "overdue" | "today" | "this_week" | "later";

function bucketOf(due: string): Bucket {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const d = new Date(due);
  if (d < start) return "overdue";
  if (d.toDateString() === now.toDateString()) return "today";
  const week = new Date(start);
  week.setDate(week.getDate() + 7);
  if (d <= week) return "this_week";
  return "later";
}

const BUCKETS: { key: Bucket; label: string; color: string }[] = [
  { key: "overdue", label: "Overdue", color: "text-status-error" },
  { key: "today", label: "Today", color: "text-[var(--accent)]" },
  { key: "this_week", label: "This week", color: "text-ink" },
  { key: "later", label: "Later", color: "text-muted" },
];

export function TerritoryTasks({ userId }: { userId: string | null }) {
  const { reminders, add, complete, uncomplete, dismiss } = useReminders(userId);
  const [open, setOpen] = useState(false);
  const [showDone, setShowDone] = useState(false);

  const active = reminders.filter((r) => !r.completed_at);
  const overdue = active.filter((r) => bucketOf(r.due_date) === "overdue").length;

  const grouped = useMemo(() => {
    const g: Record<Bucket, Reminder[]> = {
      overdue: [],
      today: [],
      this_week: [],
      later: [],
    };
    for (const r of active) g[bucketOf(r.due_date)].push(r);
    return g;
  }, [active]);

  const done = reminders.filter((r) => r.completed_at);

  async function addTask(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const title = String(f.get("title") || "").trim();
    if (!title) return;
    const preset = String(f.get("preset") || "1_week") as DueDatePreset;
    const custom = String(f.get("custom") || "");
    await add({ title, due_date: presetToDate(preset, custom) });
    (e.currentTarget as HTMLFormElement).reset();
  }

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        className="!bg-white/15 !text-white hover:!bg-white/25"
      >
        <CheckSquare size={16} /> Tasks
        {active.length > 0 && (
          <span className="ml-1 rounded-full bg-white/25 px-1.5 text-xs">
            {active.length}
            {overdue > 0 ? ` · ${overdue}!` : ""}
          </span>
        )}
      </Button>

      <Modal open={open} onClose={() => setOpen(false)} title="Tasks" size="lg">
        <form onSubmit={addTask} className="mb-5 flex flex-col gap-2 sm:flex-row">
          <Input name="title" placeholder="New task…" className="flex-1" />
          <Select name="preset" defaultValue="1_week">
            <option value="1_week">In 1 week</option>
            <option value="1_month">In 1 month</option>
            <option value="3_months">In 3 months</option>
          </Select>
          <Button type="submit">
            <Plus size={15} /> Add
          </Button>
        </form>

        {active.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">No open tasks. 🎉</p>
        ) : (
          <div className="space-y-4">
            {BUCKETS.map((b) =>
              grouped[b.key].length === 0 ? null : (
                <div key={b.key}>
                  <p className={cn("mb-1.5 text-xs font-semibold uppercase tracking-wide", b.color)}>
                    {b.label} ({grouped[b.key].length})
                  </p>
                  <ul className="space-y-1.5">
                    {grouped[b.key].map((r) => (
                      <Row key={r.id} r={r} onDone={() => complete(r.id)} onDismiss={() => dismiss(r.id)} />
                    ))}
                  </ul>
                </div>
              ),
            )}
          </div>
        )}

        {done.length > 0 && (
          <div className="mt-5 border-t border-border pt-4">
            <button
              onClick={() => setShowDone((v) => !v)}
              className="text-sm font-medium text-muted hover:text-ink"
            >
              {showDone ? "Hide" : "Show"} completed ({done.length})
            </button>
            {showDone && (
              <ul className="mt-2 space-y-1.5">
                {done.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-muted"
                  >
                    <button
                      onClick={() => uncomplete(r.id)}
                      className="grid h-5 w-5 place-items-center rounded border border-[var(--accent)] bg-[var(--accent)] text-white"
                    >
                      <Check size={13} />
                    </button>
                    <span className="line-through">{r.title}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}

function Row({
  r,
  onDone,
  onDismiss,
}: {
  r: Reminder;
  onDone: () => void;
  onDismiss: () => void;
}) {
  return (
    <li className="group flex items-center gap-2 rounded-lg border border-border px-3 py-2">
      <button
        onClick={onDone}
        className="grid h-5 w-5 shrink-0 place-items-center rounded border border-border transition hover:border-[var(--accent)]"
        title="Complete"
      >
        <Check size={13} className="opacity-0 group-hover:opacity-50" />
      </button>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{r.title}</p>
        <p className="text-xs text-muted">
          {new Date(r.due_date).toLocaleDateString()}
        </p>
      </div>
      <button
        onClick={onDismiss}
        className="text-muted opacity-0 transition hover:text-status-error group-hover:opacity-100"
        title="Dismiss"
      >
        <X size={15} />
      </button>
    </li>
  );
}
