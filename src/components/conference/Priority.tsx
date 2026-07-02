"use client";

// Two-layer priority control (spec §13): suspected (organizer, ahead of time)
// vs confirmed (rep, afterward, may be "Not relevant"). Resolved = confirmed
// else suspected. When they differ, show the delta (struck suspected → confirmed).

import { useState } from "react";
import { Flag } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { cn } from "@/lib/ui";
import {
  PRIORITIES,
  resolvePriority,
  type ConfirmedPriority,
  type Priority,
} from "@/lib/conference/types";

export function PriorityPill({
  suspected,
  confirmed,
  onClick,
  className,
}: {
  suspected: Priority | null;
  confirmed: ConfirmedPriority | null;
  onClick?: () => void;
  className?: string;
}) {
  const resolved = resolvePriority(suspected, confirmed);
  if (!resolved) {
    if (!onClick) return null;
    return (
      <button
        onClick={onClick}
        className={cn(
          "rounded-full border border-dashed border-amber-400 px-2 py-0.5 text-[11px] font-medium text-amber-600 hover:bg-amber-50",
          className,
        )}
      >
        Set priority
      </button>
    );
  }
  const p = PRIORITIES[resolved];
  const delta = confirmed && suspected && confirmed !== suspected;
  const Tag = onClick ? "button" : "span";
  return (
    <Tag
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
        onClick && "cursor-pointer hover:opacity-80",
        className,
      )}
      style={{ background: p.soft, color: p.color }}
    >
      <Flag size={10} />
      {delta ? (
        <>
          <span className="line-through opacity-60">{PRIORITIES[suspected!].label}</span>
          <span>→ {p.label}</span>
        </>
      ) : (
        p.label
      )}
    </Tag>
  );
}

// Detail-page banner: loudness scales with priority; tap to edit; empty state
// is a "Set priority" CTA for managers only.
export function PriorityBanner({
  suspected,
  confirmed,
  canManage,
  onChange,
}: {
  suspected: Priority | null;
  confirmed: ConfirmedPriority | null;
  canManage: boolean;
  onChange: (field: "suspected_priority" | "confirmed_priority", value: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const resolved = resolvePriority(suspected, confirmed);

  let body: React.ReactNode;
  let style: React.CSSProperties = {};
  let cls = "border border-dashed border-amber-300 bg-amber-50/50 text-amber-700";
  if (resolved) {
    const p = PRIORITIES[resolved];
    const delta = confirmed && suspected && confirmed !== suspected;
    if (resolved === "high") {
      cls = "text-white font-semibold";
      style = { background: p.color };
    } else if (resolved === "medium") {
      cls = "font-medium";
      style = { background: p.soft, color: p.color };
    } else {
      cls = "border border-border bg-surface text-muted";
    }
    body = (
      <span className="inline-flex items-center gap-1.5">
        <Flag size={14} />
        {delta ? (
          <>
            <span className="line-through opacity-60">
              {PRIORITIES[suspected!].label}
            </span>
            <span>→ {p.label} priority</span>
          </>
        ) : (
          <span>{p.label} priority</span>
        )}
        {confirmed ? (
          <span className="text-xs opacity-75">(confirmed)</span>
        ) : (
          <span className="text-xs opacity-75">(suspected)</span>
        )}
      </span>
    );
  } else {
    body = canManage ? (
      <span className="inline-flex items-center gap-1.5">
        <Flag size={14} /> Set priority
      </span>
    ) : (
      <span>Priority not set yet</span>
    );
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={cn(
          "w-full rounded-xl px-4 py-2.5 text-left text-sm transition hover:opacity-90",
          cls,
        )}
        style={style}
      >
        {body}
      </button>
      <PriorityEditorModal
        open={open}
        onClose={() => setOpen(false)}
        suspected={suspected}
        confirmed={confirmed}
        canManage={canManage}
        onChange={onChange}
      />
    </>
  );
}

export function PriorityEditorModal({
  open,
  onClose,
  suspected,
  confirmed,
  canManage,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  suspected: Priority | null;
  confirmed: ConfirmedPriority | null;
  canManage: boolean;
  onChange: (field: "suspected_priority" | "confirmed_priority", value: string | null) => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Priority" size="sm">
      <div className="space-y-5">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            Confirm priority (after the item)
          </p>
          <div className="flex flex-wrap gap-1.5">
            {(["high", "medium", "low", "not_relevant"] as ConfirmedPriority[]).map((v) => (
              <PriorityChoice
                key={v}
                value={v}
                active={confirmed === v}
                onClick={() => {
                  onChange("confirmed_priority", confirmed === v ? null : v);
                }}
              />
            ))}
          </div>
          <p className="mt-1.5 text-xs text-muted">
            “Not relevant” items are excluded from AI daily summaries.
          </p>
        </div>
        {canManage && (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
              Suspected (organizer, ahead of time)
            </p>
            <div className="flex flex-wrap gap-1.5">
              {(["high", "medium", "low"] as Priority[]).map((v) => (
                <PriorityChoice
                  key={v}
                  value={v}
                  active={suspected === v}
                  onClick={() => {
                    onChange("suspected_priority", suspected === v ? null : v);
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function PriorityChoice({
  value,
  active,
  onClick,
}: {
  value: ConfirmedPriority;
  active: boolean;
  onClick: () => void;
}) {
  const p = PRIORITIES[value];
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1.5 text-xs font-semibold transition",
        active ? "border-transparent text-white" : "border-border bg-surface hover:bg-canvas",
      )}
      style={active ? { background: p.color } : { color: p.color }}
    >
      {p.label}
    </button>
  );
}

// Left color stripe for cards (wider/louder for High).
export function priorityStripe(
  suspected: Priority | null,
  confirmed: ConfirmedPriority | null,
): React.CSSProperties {
  const resolved = resolvePriority(suspected, confirmed);
  if (!resolved) return { borderLeft: "3px solid transparent" };
  const p = PRIORITIES[resolved];
  return {
    borderLeft: `${resolved === "high" ? 5 : 3}px solid ${p.color}`,
  };
}
