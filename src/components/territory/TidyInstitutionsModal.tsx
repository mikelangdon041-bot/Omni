"use client";

import { useMemo, useState } from "react";
import { Building2, Check } from "lucide-react";
import type { KOL } from "@/lib/territory/types";
import { groupSimilar } from "@/lib/territory/dedupe";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";

interface Inst {
  value: string;
  count: number;
}

// Finds near-identical institution names and asks whether they're the same,
// so the roster filters cleanly. "University of Arizona" and
// "University of Arizona - Phoenix" surface together — the rep decides.
export function TidyInstitutionsModal({
  open,
  onClose,
  kols,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  kols: KOL[];
  onApply: (values: string[], canonical: string) => Promise<void>;
}) {
  const distinct = useMemo<Inst[]>(() => {
    const counts = new Map<string, number>();
    for (const k of kols) {
      const v = (k.institution || "").trim();
      if (v) counts.set(v, (counts.get(v) || 0) + 1);
    }
    return [...counts.entries()].map(([value, count]) => ({ value, count }));
  }, [kols]);

  const groups = useMemo(
    () => groupSimilar(distinct, (d) => d.value, 0.8),
    [distinct],
  );
  const [doneKeys, setDoneKeys] = useState<Set<string>>(new Set());
  const [busyKey, setBusyKey] = useState<string | null>(null);

  return (
    <Modal open={open} onClose={onClose} title="Tidy up institutions" size="lg">
      <p className="mb-4 text-sm text-muted">
        These institution names look similar. If they&apos;re the same place, pick
        one name to use everywhere. If a branch/campus is genuinely different,
        just skip it.
      </p>

      {groups.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-surface px-6 py-10 text-center text-sm text-muted">
          Institution names look clean. Nothing to merge.
        </div>
      ) : (
        <div className="space-y-4">
          {groups
            .filter((g) => !doneKeys.has(g.key))
            .map((g) => (
              <InstGroup
                key={g.key}
                groupKey={g.key}
                members={g.items}
                busy={busyKey === g.key}
                onApply={async (values, canonical) => {
                  setBusyKey(g.key);
                  await onApply(values, canonical);
                  setBusyKey(null);
                  setDoneKeys((prev) => new Set(prev).add(g.key));
                }}
                onSkip={() => setDoneKeys((prev) => new Set(prev).add(g.key))}
              />
            ))}
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

function InstGroup({
  groupKey,
  members,
  busy,
  onApply,
  onSkip,
}: {
  groupKey: string;
  members: Inst[];
  busy: boolean;
  onApply: (values: string[], canonical: string) => Promise<void>;
  onSkip: () => void;
}) {
  // Default canonical = the most-used spelling.
  const sorted = [...members].sort((a, b) => b.count - a.count);
  const [canonical, setCanonical] = useState(sorted[0].value);

  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
      <div className="mb-2 flex items-center gap-2">
        <Building2 size={15} className="text-[var(--accent)]" />
        <p className="text-sm font-medium">Are these the same institution?</p>
      </div>
      <ul className="mb-3 space-y-1.5">
        {sorted.map((m) => (
          <li key={m.value}>
            <label className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
              <span className="flex items-center gap-2">
                <input
                  type="radio"
                  name={`canon-${groupKey}`}
                  checked={canonical === m.value}
                  onChange={() => setCanonical(m.value)}
                  className="h-4 w-4 accent-[var(--accent)]"
                />
                <span className="text-sm">{m.value}</span>
              </span>
              <span className="text-xs text-muted">{m.count} KOL{m.count === 1 ? "" : "s"}</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between gap-2">
        <input
          value={canonical}
          onChange={(e) => setCanonical(e.target.value)}
          className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
          placeholder="Name to use"
        />
        <Button variant="secondary" size="sm" onClick={onSkip} disabled={busy}>
          Different places
        </Button>
        <Button
          size="sm"
          onClick={() => onApply(members.map((m) => m.value), canonical.trim())}
          disabled={busy || !canonical.trim()}
        >
          <Check size={14} /> {busy ? "Merging…" : "Use this name"}
        </Button>
      </div>
    </div>
  );
}
