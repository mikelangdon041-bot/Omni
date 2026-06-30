"use client";

import { useCallback, useEffect, useState } from "react";
import { Users, Trash2, Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Input";

const LEVELS = [
  { key: "full", label: "Full access", hint: "Sees everything about this candidate." },
  { key: "limited", label: "Limited", hint: "Won't see other people's notes/comments." },
  {
    key: "post_interview",
    label: "After their interview",
    hint: "Sees others' input only once they've recorded their own interview (avoids bias).",
  },
];
const LEVEL_LABEL: Record<string, string> = Object.fromEntries(
  LEVELS.map((l) => [l.key, l.label]),
);

interface Member {
  id: string;
  username: string;
  display_name: string | null;
}
interface Access {
  id: string;
  username: string;
  scope: { level?: string; all?: boolean };
}

export function AccessTab({ candidateId }: { candidateId: string }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [shares, setShares] = useState<Access[]>([]);
  const [username, setUsername] = useState("");
  const [level, setLevel] = useState("full");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [m, s] = await Promise.all([
      fetch("/api/org/members", { credentials: "same-origin" }),
      fetch(`/api/interview/share?candidateId=${candidateId}`, { credentials: "same-origin" }),
    ]);
    if (m.ok) setMembers((await m.json()).members || []);
    if (s.ok) setShares((await s.json()).shares || []);
  }, [candidateId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function grant() {
    setError(null);
    if (!username) {
      setError("Pick a teammate.");
      return;
    }
    setBusy(true);
    const res = await fetch("/api/interview/share", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ candidateId, username, scope: { level } }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error || "Could not add");
      return;
    }
    setUsername("");
    await load();
  }

  async function remove(id: string) {
    setShares((prev) => prev.filter((s) => s.id !== id));
    await fetch(`/api/interview/share?id=${id}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
  }

  // members not already granted
  const sharedNames = new Set(shares.map((s) => s.username));
  const available = members.filter((m) => !sharedNames.has(m.username));

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-border bg-surface p-5 shadow-sm">
        <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted">
          <Users size={15} /> Who can see this candidate
        </h3>
        <p className="mb-4 text-sm text-muted">
          Add people from your company and decide how much each can see — set this
          before interviews so perspectives stay unbiased.
        </p>

        {members.length === 0 ? (
          <p className="text-sm text-muted">
            No teammates yet. Add members in Admin to build your interview panel.
          </p>
        ) : (
          <>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Select
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="flex-1"
              >
                <option value="">Choose a teammate…</option>
                {available.map((m) => (
                  <option key={m.id} value={m.username}>
                    {m.display_name || m.username} (@{m.username})
                  </option>
                ))}
              </Select>
              <Select value={level} onChange={(e) => setLevel(e.target.value)}>
                {LEVELS.map((l) => (
                  <option key={l.key} value={l.key}>
                    {l.label}
                  </option>
                ))}
              </Select>
              <Button onClick={grant} disabled={busy}>
                <Plus size={15} /> Add
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted">
              {LEVELS.find((l) => l.key === level)?.hint}
            </p>
          </>
        )}
        {error && <p className="mt-3 text-sm text-status-error">{error}</p>}
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold text-muted">On this candidate</h3>
        {shares.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-surface px-6 py-10 text-center text-sm text-muted">
            Only you can see this candidate so far.
          </div>
        ) : (
          <ul className="space-y-2">
            {shares.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between gap-4 rounded-xl border border-border bg-surface px-4 py-3 shadow-sm"
              >
                <div>
                  <p className="font-medium">@{s.username}</p>
                  <p className="text-xs text-muted">
                    {s.scope.all ? "Full access" : LEVEL_LABEL[s.scope.level || ""] || "Custom"}
                  </p>
                </div>
                <button
                  onClick={() => remove(s.id)}
                  className="text-muted transition hover:text-status-error"
                  title="Remove"
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
