"use client";

import { useMemo, useState } from "react";
import { Search, Check } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Avatar";
import { kolFullName, kolInitials } from "@/lib/territory/utils";
import { cn } from "@/lib/ui";
import type { KOL } from "@/lib/territory/types";

// Pick existing Territory KOLs to pull into the Insights survey roster.
export function ImportKolsModal({
  open,
  onClose,
  candidates,
  onImport,
}: {
  open: boolean;
  onClose: () => void;
  candidates: KOL[]; // KOLs not already in the survey roster
  onImport: (kolIds: string[]) => Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter((k) =>
      `${k.first_name} ${k.last_name} ${k.specialty} ${k.institution}`
        .toLowerCase()
        .includes(q),
    );
  }, [candidates, search]);

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allFilteredPicked =
    filtered.length > 0 && filtered.every((k) => picked.has(k.id));

  function toggleAll() {
    setPicked((prev) => {
      const next = new Set(prev);
      if (allFilteredPicked) for (const k of filtered) next.delete(k.id);
      else for (const k of filtered) next.add(k.id);
      return next;
    });
  }

  async function handleImport() {
    if (picked.size === 0) return;
    setBusy(true);
    await onImport([...picked]);
    setBusy(false);
    setPicked(new Set());
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="Import KOLs from Territory" size="lg">
      <div className="flex flex-col gap-3">
        <div className="relative">
          <Search
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search your territory…"
            className="w-full rounded-lg border border-border bg-surface py-2.5 pl-9 pr-3 text-sm outline-none focus:border-[var(--accent)]"
          />
        </div>

        {filtered.length > 0 && (
          <button
            onClick={toggleAll}
            className="flex items-center gap-2 self-start rounded-md px-1 text-xs font-medium text-[var(--accent)] hover:underline"
          >
            <span
              className={cn(
                "grid h-4 w-4 place-items-center rounded border",
                allFilteredPicked
                  ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                  : "border-border",
              )}
            >
              {allFilteredPicked && <Check size={11} />}
            </span>
            {allFilteredPicked ? "Clear all" : `Select all (${filtered.length})`}
          </button>
        )}

        <div className="max-h-80 overflow-y-auto rounded-lg border border-border">
          {filtered.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted">
              {candidates.length === 0
                ? "Every territory KOL is already in your survey roster."
                : "No KOLs match your search."}
            </p>
          ) : (
            filtered.map((k) => {
              const active = picked.has(k.id);
              return (
                <button
                  key={k.id}
                  onClick={() => toggle(k.id)}
                  className={cn(
                    "flex w-full items-center gap-3 border-b border-border px-3 py-2.5 text-left transition last:border-b-0",
                    active ? "bg-accent-soft" : "hover:bg-canvas",
                  )}
                >
                  <span
                    className={cn(
                      "grid h-5 w-5 shrink-0 place-items-center rounded border",
                      active
                        ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                        : "border-border",
                    )}
                  >
                    {active && <Check size={13} />}
                  </span>
                  <Avatar src={k.photo_url} initials={kolInitials(k)} size={34} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{kolFullName(k)}</p>
                    <p className="truncate text-xs text-muted">
                      {[k.specialty, k.institution].filter(Boolean).join(" · ") ||
                        "—"}
                    </p>
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between pt-1">
          <span className="text-sm text-muted">{picked.size} selected</span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={handleImport} disabled={busy || picked.size === 0}>
              {busy ? "Importing…" : `Import ${picked.size || ""}`.trim()}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
