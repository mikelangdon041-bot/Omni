"use client";

import { Trash2, CalendarDays } from "lucide-react";
import { useMeetings } from "@/lib/territory/hooks";
import { METHOD_LABELS } from "@/lib/territory/utils";

export function MeetingsSection({ kolId }: { kolId: string }) {
  const { meetings, loading, remove } = useMeetings(kolId);

  if (loading) {
    return <p className="py-8 text-center text-sm text-muted">Loading…</p>;
  }
  if (meetings.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-surface px-6 py-12 text-center text-sm text-muted">
        No meetings yet. Use “Complete meeting” on the Activity tab to record one.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {meetings.map((m) => (
        <div
          key={m.id}
          className="rounded-xl border border-border bg-surface p-5 shadow-sm"
        >
          <div className="mb-2 flex items-center justify-between">
            <h3 className="flex items-center gap-2 font-semibold">
              <CalendarDays size={16} className="text-[var(--accent)]" />
              Meeting #{m.meeting_number}
            </h3>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted">
                {new Date(m.date).toLocaleDateString()}
                {m.meeting_method && ` · ${METHOD_LABELS[m.meeting_method] || m.meeting_method}`}
              </span>
              <button
                onClick={() => remove(m.id)}
                className="text-muted transition hover:text-status-error"
                title="Delete meeting"
              >
                <Trash2 size={15} />
              </button>
            </div>
          </div>

          {m.topics_discussed && (
            <Field label="Discussed" value={m.topics_discussed} />
          )}
          {m.topics_missed && (
            <Field label="To revisit" value={m.topics_missed} />
          )}
          {m.follow_up_actions && (
            <Field label="Follow-up actions" value={m.follow_up_actions} />
          )}
        </div>
      ))}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">
        {label}
      </p>
      <p className="whitespace-pre-wrap text-sm text-ink/90">{value}</p>
    </div>
  );
}
