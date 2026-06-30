"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, Eye, ShieldCheck, Ban, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Feedback";

interface OrgUser {
  id: string;
  username: string;
  display_name: string | null;
  role: "member" | "admin" | "owner";
  is_active: boolean;
  created_at: string;
}

export function AdminUsers() {
  const router = useRouter();
  const toast = useToast();
  const [users, setUsers] = useState<OrgUser[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [created, setCreated] = useState<{ username: string; tempPassword: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/users", { credentials: "same-origin" });
    if (res.ok) {
      const data = await res.json();
      setUsers(data.users || []);
      setMe(data.me || null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function addMember(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const f = new FormData(e.currentTarget);
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        username: f.get("username"),
        displayName: f.get("displayName"),
        role: f.get("role"),
      }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error || "Could not add user");
      return;
    }
    setAddOpen(false);
    setCreated({ username: data.username, tempPassword: data.tempPassword });
    await load();
  }

  async function patch(userId: string, body: Record<string, unknown>) {
    await fetch("/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ userId, ...body }),
    });
    await load();
  }

  async function impersonate(userId: string) {
    const res = await fetch("/api/admin/impersonate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ userId }),
    });
    if (res.ok) {
      router.push("/");
      router.refresh();
    } else {
      const d = await res.json().catch(() => ({}));
      toast("error", d.error || "Could not impersonate");
    }
  }

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setAddOpen(true)}>
          <UserPlus size={16} /> Add member
        </Button>
      </div>

      {loading ? (
        <p className="py-12 text-center text-sm text-muted">Loading…</p>
      ) : (
        <ul className="space-y-2">
          {users.map((u) => (
            <li
              key={u.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 shadow-sm"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  {u.display_name || u.username}
                  {u.id === me && <span className="text-muted"> (you)</span>}
                </p>
                <p className="text-xs text-muted">@{u.username}</p>
              </div>
              <Badge
                className={
                  u.role === "owner"
                    ? "bg-violet-100 text-violet-700"
                    : u.role === "admin"
                      ? "bg-indigo-100 text-indigo-700"
                      : "bg-slate-100 text-slate-600"
                }
              >
                {u.role}
              </Badge>
              {!u.is_active && (
                <Badge className="bg-rose-100 text-rose-700">inactive</Badge>
              )}

              {u.role !== "owner" && u.id !== me && (
                <div className="flex items-center gap-1.5">
                  {u.role === "member" && u.is_active && (
                    <Button variant="secondary" size="sm" onClick={() => impersonate(u.id)}>
                      <Eye size={14} /> View as
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      patch(u.id, { role: u.role === "admin" ? "member" : "admin" })
                    }
                  >
                    <ShieldCheck size={14} />
                    {u.role === "admin" ? "Make member" : "Make admin"}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => patch(u.id, { is_active: !u.is_active })}
                  >
                    {u.is_active ? <Ban size={14} /> : <RotateCcw size={14} />}
                    {u.is_active ? "Deactivate" : "Reactivate"}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add member">
        <form onSubmit={addMember} className="space-y-4">
          <Input label="Username" name="username" required placeholder="jsmith" />
          <Input label="Display name (optional)" name="displayName" placeholder="Dr. Jane Smith" />
          <Select label="Role" name="role" defaultValue="member">
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </Select>
          {error && <p className="text-sm text-status-error">{error}</p>}
          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button type="button" variant="secondary" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Adding…" : "Add member"}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={!!created}
        onClose={() => setCreated(null)}
        title="Member added"
        size="sm"
      >
        <p className="text-sm text-muted">
          Share these credentials with{" "}
          <span className="font-medium text-ink">@{created?.username}</span>. The
          temporary password is shown once.
        </p>
        <div className="mt-3 rounded-lg border border-border bg-canvas p-3 font-mono text-sm">
          <div>username: {created?.username}</div>
          <div>password: {created?.tempPassword}</div>
        </div>
        <div className="mt-4 flex justify-end">
          <Button onClick={() => setCreated(null)}>Done</Button>
        </div>
      </Modal>
    </>
  );
}
