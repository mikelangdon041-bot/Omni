"use client";

import { useCallback, useEffect, useState } from "react";
import { Share2, Trash2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/Button";

const SECTIONS = [
  { key: "overview", label: "Overview" },
  { key: "interviews", label: "Interviews" },
  { key: "questions", label: "Questions" },
  { key: "activity", label: "Activity" },
];

interface Share {
  id: string;
  username: string;
  scope: { all?: boolean; sections?: string[] };
}

export function SharingTab({ candidateId }: { candidateId: string }) {
  const [shares, setShares] = useState<Share[]>([]);
  const [username, setUsername] = useState("");
  const [fullAccess, setFullAccess] = useState(true);
  const [sections, setSections] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/interview/share?candidateId=${candidateId}`, {
      credentials: "same-origin",
    });
    if (res.ok) setShares((await res.json()).shares || []);
  }, [candidateId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function share() {
    setError(null);
    if (!username.trim()) return;
    if (!fullAccess && sections.size === 0) {
      setError("Pick at least one section, or choose full access.");
      return;
    }
    setBusy(true);
    const scope = fullAccess ? { all: true } : { sections: [...sections] };
    const res = await fetch("/api/interview/share", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ candidateId, username: username.trim(), scope }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error || "Could not share");
      return;
    }
    setUsername("");
    setSections(new Set());
    setFullAccess(true);
    await load();
  }

  async function remove(id: string) {
    setShares((prev) => prev.filter((s) => s.id !== id));
    await fetch(`/api/interview/share?id=${id}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-border bg-surface p-5 shadow-sm">
        <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted">
          <UserPlus size={15} /> Share with a teammate
        </h3>
        <p className="mb-4 text-sm text-muted">
          Give another Omni user access to this candidate — everything, or only
          the sections you choose.
        </p>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="their Omni username"
            className="flex-1 rounded-lg border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20"
          />
          <Button onClick={share} disabled={busy}>
            <Share2 size={15} /> {busy ? "Sharing…" : "Share"}
          </Button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={fullAccess}
              onChange={(e) => setFullAccess(e.target.checked)}
              className="h-4 w-4 accent-[var(--accent)]"
            />
            Full access
          </label>
          {!fullAccess &&
            SECTIONS.map((s) => (
              <label key={s.key} className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={sections.has(s.key)}
                  onChange={(e) =>
                    setSections((prev) => {
                      const n = new Set(prev);
                      if (e.target.checked) n.add(s.key);
                      else n.delete(s.key);
                      return n;
                    })
                  }
                  className="h-4 w-4 accent-[var(--accent)]"
                />
                {s.label}
              </label>
            ))}
        </div>
        {error && <p className="mt-3 text-sm text-status-error">{error}</p>}
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold text-muted">Shared with</h3>
        {shares.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-surface px-6 py-10 text-center text-sm text-muted">
            Not shared with anyone yet.
          </div>
        ) : (
          <ul className="space-y-2">
            {shares.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between gap-4 rounded-xl border border-border bg-surface px-4 py-3 shadow-sm"
              >
                <div>
                  <p className="font-medium">{s.username}</p>
                  <p className="text-xs text-muted">
                    {s.scope.all
                      ? "Full access"
                      : `Sections: ${(s.scope.sections || []).join(", ") || "none"}`}
                  </p>
                </div>
                <button
                  onClick={() => remove(s.id)}
                  className="text-muted transition hover:text-status-error"
                  title="Remove access"
                >
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
