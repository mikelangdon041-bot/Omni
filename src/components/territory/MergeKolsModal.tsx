"use client";

import { useMemo, useState } from "react";
import { Users, Check } from "lucide-react";
import type { KOL } from "@/lib/territory/types";
import { groupSimilar } from "@/lib/territory/dedupe";
import { kolFullName } from "@/lib/territory/utils";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";

// Finds likely duplicate KOLs (similar names) and combines each group into one
// profile — the primary keeps its data, empty fields fill from the others, and
// all history (activities, meetings, goals, tasks) moves over.
export function MergeKolsModal({
  open,
  onClose,
  kols,
  onMerge,
}: {
  open: boolean;
  onClose: () => void;
  kols: KOL[];
  onMerge: (primaryId: string, duplicateIds: string[]) => Promise<void>;
}) {
  const groups = useMemo(
    () => groupSimilar(kols, (k) => kolFullName(k)),
    [kols],
  );
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [doneKeys, setDoneKeys] = useState<Set<string>>(new Set());

  return (
    <Modal open={open} onClose={onClose} title="Combine duplicate profiles" size="lg">
      <p className="mb-4 text-sm text-muted">
        These look like the same person entered more than once. Pick the profile
        to keep, uncheck any that aren&apos;t actually duplicates, then combine.
      </p>

      {groups.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-surface px-6 py-10 text-center text-sm text-muted">
          No likely duplicates found. 🎉
        </div>
      ) : (
        <div className="space-y-4">
          {groups
            .filter((g) => !doneKeys.has(g.key))
            .map((g) => (
              <GroupCard
                key={g.key}
                groupKey={g.key}
                members={g.items}
                busy={busyKey === g.key}
                onCombine={async (primaryId, dupIds) => {
                  setBusyKey(g.key);
                  await onMerge(primaryId, dupIds);
                  setBusyKey(null);
                  setDoneKeys((prev) => new Set(prev).add(g.key));
                }}
              />
            ))}
          {groups.every((g) => doneKeys.has(g.key)) && (
            <div className="rounded-xl border border-dashed border-border bg-surface px-6 py-8 text-center text-sm text-muted">
              All set — no more duplicates to combine.
            </div>
          )}
        </div>
      )}

      <div className="mt-5 flex justify-end border-t border-border pt-4">
        <Button variant="secondary" onClick={onClose}>
          Done
        </Button>
      </div>
    </Modal>
  );
}

function GroupCard({
  groupKey,
  members,
  busy,
  onCombine,
}: {
  groupKey: string;
  members: KOL[];
  busy: boolean;
  onCombine: (primaryId: string, dupIds: string[]) => Promise<void>;
}) {
  const [primary, setPrimary] = useState(members[0].id);
  const [selected, setSelected] = useState<Set<string>>(new Set(members.map((m) => m.id)));

  const toMerge = members.filter((m) => selected.has(m.id) || m.id === primary);

  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
      <div className="mb-2 flex items-center gap-2">
        <Users size={15} className="text-[var(--accent)]" />
        <p className="text-sm font-medium">{groupKey}</p>
        <span className="text-xs text-muted">· {members.length} profiles</span>
      </div>
      <ul className="space-y-1.5">
        {members.map((m) => {
          const isPrimary = m.id === primary;
          const inMerge = selected.has(m.id) || isPrimary;
          return (
            <li
              key={m.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
            >
              <label className="flex min-w-0 items-center gap-2">
                <input
                  type="checkbox"
                  checked={inMerge}
                  disabled={isPrimary}
                  onChange={(e) =>
                    setSelected((prev) => {
                      const n = new Set(prev);
                      if (e.target.checked) n.add(m.id);
                      else n.delete(m.id);
                      return n;
                    })
                  }
                  className="h-4 w-4 accent-[var(--accent)]"
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm">{kolFullName(m)}</span>
                  <span className="block truncate text-xs text-muted">
                    {[m.institution, m.specialty, m.email].filter(Boolean).join(" · ") || "—"}
                  </span>
                </span>
              </label>
              <button
                onClick={() => setPrimary(m.id)}
                className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium transition ${
                  isPrimary
                    ? "bg-[var(--accent)] text-white"
                    : "border border-border text-muted hover:text-ink"
                }`}
              >
                {isPrimary ? "Keep this" : "Keep"}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-3 flex justify-end">
        <Button
          size="sm"
          onClick={() =>
            onCombine(
              primary,
              toMerge.map((m) => m.id).filter((id) => id !== primary),
            )
          }
          disabled={busy || toMerge.length < 2}
        >
          <Check size={14} /> {busy ? "Combining…" : `Combine ${toMerge.length}`}
        </Button>
      </div>
    </div>
  );
}
