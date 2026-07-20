"use client";

import { useEffect, useState } from "react";
import { Users, Loader2, Check } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useTeam } from "@/lib/dashboard/hooks";

export function TeamManager({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { team, orgRoster, loading, createTeam, setMembers } = useTeam();
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (team) {
      setName(team.name);
      setSelected(new Set(team.members.map((m) => m.id)));
    }
  }, [team]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    setBusy(true);
    setSaved(false);
    try {
      if (!team) await createTeam(name || "My Team");
      await setMembers([...selected]);
      setSaved(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="My team" size="md">
      {loading ? (
        <p className="py-8 text-center text-sm text-muted">Loading…</p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-2.5 rounded-xl border border-border bg-canvas p-3">
            <Users size={16} className="mt-0.5 shrink-0 text-muted" />
            <p className="text-xs text-muted">
              Pick who&apos;s on your team. Once set, you can view KPIs scoped to just these
              people — never anyone outside your company.
            </p>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-ink">Team name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Team"
              className="rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
            />
          </label>

          <div>
            <p className="mb-2 text-sm font-medium text-ink">Members ({selected.size} selected)</p>
            <div className="max-h-72 overflow-y-auto rounded-lg border border-border">
              {orgRoster.length === 0 ? (
                <p className="p-4 text-center text-sm text-muted">No one else in your company yet.</p>
              ) : (
                orgRoster.map((m) => (
                  <label
                    key={m.id}
                    className="flex cursor-pointer items-center gap-3 border-b border-border px-3 py-2.5 last:border-b-0 hover:bg-canvas"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(m.id)}
                      onChange={() => toggle(m.id)}
                      className="h-4 w-4 rounded border-border accent-[var(--accent)]"
                    />
                    <span className="text-sm text-ink">{m.display_name || m.username}</span>
                    <span className="text-xs text-muted">@{m.username}</span>
                  </label>
                ))
              )}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
            {saved && (
              <span className="mr-auto inline-flex items-center gap-1 text-sm text-status-success">
                <Check size={14} /> Saved
              </span>
            )}
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
            <Button onClick={save} disabled={busy}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              Save team
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
