"use client";

import { useEffect, useState } from "react";
import { UserPlus, Mail, Check, Copy } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Input";
import { cn } from "@/lib/ui";

interface Member {
  id: string;
  username: string;
  display_name: string | null;
}
interface InviteResult {
  username: string;
  created?: boolean;
  tempPassword?: string | null;
  inviteLink?: string;
  emailSent?: boolean;
}

export function AssignInterviewModal({
  open,
  onClose,
  interviewId,
  currentAssignee,
  onAssigned,
}: {
  open: boolean;
  onClose: () => void;
  interviewId: string;
  currentAssignee: string | null;
  onAssigned: (assigneeId: string) => void;
}) {
  const [tab, setTab] = useState<"existing" | "invite">("existing");
  const [members, setMembers] = useState<Member[]>([]);
  const [assigneeId, setAssigneeId] = useState(currentAssignee || "");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InviteResult | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    fetch("/api/org/members", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : { members: [] }))
      .then((d) => setMembers(d.members || []))
      .catch(() => {});
  }, [open]);

  async function submit(body: object) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/interview/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ interviewId, ...body }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not assign");
      onAssigned(data.assigneeId);
      return data as InviteResult;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function assignExisting() {
    if (!assigneeId) return;
    const data = await submit({ mode: "existing", assigneeId });
    if (data) onClose();
  }

  async function invite() {
    if (!username.trim()) {
      setError("Choose a username for them.");
      return;
    }
    const data = await submit({ mode: "invite", username, email, displayName });
    if (data) setResult(data);
  }

  function reset() {
    setResult(null);
    setError(null);
    setUsername("");
    setEmail("");
    setDisplayName("");
    setCopied(false);
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="Assign this interview"
    >
      {result ? (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm font-medium text-status-complete">
            <Check size={16} /> Invited @{result.username}
          </div>
          <p className="text-sm text-muted">
            They&apos;ll see this interview in their Interviews list
            {result.emailSent ? " and got an email" : ""}. Share these details:
          </p>
          {result.tempPassword && (
            <div className="rounded-lg border border-border bg-canvas p-3 text-sm">
              <p>
                Username: <span className="font-mono font-medium">{result.username}</span>
              </p>
              <p>
                Temp password:{" "}
                <span className="font-mono font-medium">{result.tempPassword}</span>
              </p>
            </div>
          )}
          {result.inviteLink && (
            <button
              onClick={() => {
                navigator.clipboard.writeText(result.inviteLink!);
                setCopied(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-sm transition hover:border-[var(--accent)]"
            >
              <Copy size={14} /> {copied ? "Copied link" : "Copy interview link"}
            </button>
          )}
          {!result.emailSent && (
            <p className="text-xs text-muted">
              Email isn&apos;t configured yet, so nothing was sent automatically —
              share the link/credentials above. (Add a RESEND_API_KEY to enable email.)
            </p>
          )}
          <div className="flex justify-end">
            <Button
              onClick={() => {
                reset();
                onClose();
              }}
            >
              Done
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex gap-1.5">
            {(
              [
                { k: "existing", icon: UserPlus, label: "A teammate" },
                { k: "invite", icon: Mail, label: "Invite someone new" },
              ] as const
            ).map(({ k, icon: Icon, label }) => (
              <button
                key={k}
                onClick={() => {
                  setTab(k);
                  setError(null);
                }}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition",
                  tab === k
                    ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                    : "border-border text-muted hover:text-ink",
                )}
              >
                <Icon size={14} /> {label}
              </button>
            ))}
          </div>

          {tab === "existing" ? (
            <>
              {members.length === 0 ? (
                <p className="text-sm text-muted">
                  No teammates yet — invite someone new instead.
                </p>
              ) : (
                <Select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
                  <option value="">Choose a teammate…</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.display_name || m.username} (@{m.username})
                    </option>
                  ))}
                </Select>
              )}
              {error && <p className="text-sm text-status-error">{error}</p>}
              <div className="flex justify-end">
                <Button onClick={assignExisting} disabled={busy || !assigneeId}>
                  {busy ? "Assigning…" : "Assign"}
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-muted">
                We&apos;ll create their account in your company, assign this interview,
                and (if email is set up) send them a link with sign-in details.
              </p>
              <Input
                label="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. jsmith"
              />
              <Input
                label="Display name (optional)"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Jane Smith"
              />
              <Input
                label="Email (optional — for the invite email)"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="jane@company.com"
              />
              {error && <p className="text-sm text-status-error">{error}</p>}
              <div className="flex justify-end">
                <Button onClick={invite} disabled={busy}>
                  {busy ? "Inviting…" : "Create & assign"}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
