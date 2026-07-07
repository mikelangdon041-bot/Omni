"use client";

// Team / attendees: the roster of who's attending this conference.
// Cards with contact quick-actions, department filter bubbles, lead (crown)
// toggle, and a scheduled-events safety check before removal.

import { useEffect, useMemo, useState } from "react";
import { Loading } from "@/components/conference/Bits";
import { createClient } from "@/lib/supabase/client";
import {
  Crown,
  Mail,
  MessageSquare,
  Pencil,
  Phone,
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/Feedback";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { EmptyState } from "@/components/ui/EmptyState";
import { cn } from "@/lib/ui";
import { useConferenceCtx } from "@/components/conference/ConferenceContext";
import { ATTENDEE_COLORS, type Attendee } from "@/lib/conference/types";
import { fmtTime, initials } from "@/lib/conference/utils";

const supabase = createClient();

export default function TeamPage() {
  const confirm = useConfirm();
  const {
    conference,
    attendees,
    attendeesLoading,
    addAttendee,
    updateAttendee,
    removeAttendee,
    me,
    canManage,
  } = useConferenceCtx();

  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<Attendee | null>(null);
  const [dept, setDept] = useState("all");
  const [removeWarning, setRemoveWarning] = useState<{
    attendee: Attendee;
    events: { title: string; starts_at: string }[];
  } | null>(null);

  const departments = useMemo(() => {
    const set = new Set<string>();
    for (const a of attendees) if (a.department.trim()) set.add(a.department.trim());
    return [...set].sort();
  }, [attendees]);

  const filtered = useMemo(
    () =>
      dept === "all"
        ? attendees
        : attendees.filter((a) => a.department.trim() === dept),
    [attendees, dept],
  );

  // Safety check (spec §5.4): warn if the person is scheduled for events.
  async function requestRemove(a: Attendee) {
    const { data: assigns } = await supabase
      .from("conf_event_assignments")
      .select("event_id")
      .eq("attendee_id", a.id);
    const ids = (assigns || []).map((x) => x.event_id);
    if (ids.length) {
      const { data: events } = await supabase
        .from("conf_events")
        .select("title, starts_at")
        .in("id", ids)
        .eq("cancelled", false)
        .order("starts_at");
      if (events && events.length) {
        setRemoveWarning({ attendee: a, events });
        return;
      }
    }
    if (
      await confirm({
        title: `Remove ${a.name} from this conference?`,
        message: "They come off the roster; their past notes and insights stay.",
        confirmLabel: "Remove",
        danger: true,
      })
    ) {
      await removeAttendee(a.id);
    }
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight">
          Team <span className="text-sm font-normal text-muted">({attendees.length})</span>
        </h2>
        <Button onClick={() => setShowAdd(true)}>
          <Plus size={16} /> Add attendee
        </Button>
      </div>

      {departments.length > 0 && (
        <div className="mb-5 flex flex-wrap gap-1.5">
          <DeptBubble
            label={`All (${attendees.length})`}
            active={dept === "all"}
            onClick={() => setDept("all")}
          />
          {departments.map((d) => (
            <DeptBubble
              key={d}
              label={`${d} (${attendees.filter((a) => a.department.trim() === d).length})`}
              active={dept === d}
              onClick={() => setDept(d)}
            />
          ))}
        </div>
      )}

      {attendeesLoading ? (
        <Loading />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No attendees yet"
          hint="Add the people working this conference."
          action={
            <Button onClick={() => setShowAdd(true)}>
              <Plus size={16} /> Add attendee
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((a) => (
            <div
              key={a.id}
              className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm"
            >
              <div className="h-1.5 w-full" style={{ background: a.color }} />
              <div className="p-4">
                <div className="flex items-start gap-3">
                  <span
                    className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-sm font-bold text-white"
                    style={{ background: a.color }}
                  >
                    {initials(a.name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 font-semibold">
                      <span className="truncate">{a.name}</span>
                      {a.is_lead && (
                        <span
                          className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700"
                          title="Conference lead"
                        >
                          <Crown size={10} /> LEAD
                        </span>
                      )}
                      {a.user_id === me?.id && (
                        <span className="rounded-full bg-[var(--accent-soft)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--accent)]">
                          You
                        </span>
                      )}
                    </p>
                    {a.role && <p className="truncate text-sm text-muted">{a.role}</p>}
                    {a.department && (
                      <p className="truncate text-xs text-muted">{a.department}</p>
                    )}
                  </div>
                </div>

                <div className="mt-3 flex items-center gap-1.5">
                  {a.email && (
                    <QuickAction href={`mailto:${a.email}`} title="Email">
                      <Mail size={14} />
                    </QuickAction>
                  )}
                  {a.phone && (
                    <>
                      <QuickAction href={`tel:${a.phone}`} title="Call">
                        <Phone size={14} />
                      </QuickAction>
                      <QuickAction href={`sms:${a.phone}`} title="Text">
                        <MessageSquare size={14} />
                      </QuickAction>
                    </>
                  )}
                  <span className="flex-1" />
                  {canManage && (
                    <button
                      onClick={() => updateAttendee(a.id, { is_lead: !a.is_lead })}
                      className={cn(
                        "rounded-lg p-1.5 transition",
                        a.is_lead
                          ? "text-amber-500 hover:bg-amber-50"
                          : "text-muted hover:bg-canvas hover:text-amber-500",
                      )}
                      title={a.is_lead ? "Remove lead" : "Make conference lead"}
                    >
                      <Crown size={14} />
                    </button>
                  )}
                  <button
                    onClick={() => setEditing(a)}
                    className="rounded-lg p-1.5 text-muted transition hover:bg-canvas hover:text-ink"
                    title="Edit"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => requestRemove(a)}
                    className="rounded-lg p-1.5 text-muted transition hover:bg-red-50 hover:text-red-600"
                    title="Remove"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <AttendeeModal
        open={showAdd || !!editing}
        onClose={() => {
          setShowAdd(false);
          setEditing(null);
        }}
        attendee={editing}
        departments={departments}
        onSave={async (partial) => {
          if (editing) await updateAttendee(editing.id, partial);
          else await addAttendee(partial);
        }}
      />

      {/* Removal safety warning */}
      <Modal
        open={!!removeWarning}
        onClose={() => setRemoveWarning(null)}
        title={`${removeWarning?.attendee.name} is scheduled`}
        size="sm"
      >
        {removeWarning && (
          <div className="space-y-3">
            <p className="text-sm text-muted">
              Removing them from the roster won&apos;t unassign them from these
              events — consider reassigning first:
            </p>
            <ul className="max-h-48 space-y-1 overflow-y-auto text-sm">
              {removeWarning.events.map((e, i) => (
                <li key={i} className="rounded-lg bg-canvas px-3 py-2">
                  <span className="font-medium">{e.title}</span>{" "}
                  <span className="text-muted">
                    · {new Date(e.starts_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}{" "}
                    {fmtTime(e.starts_at, conference.timezone)}
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setRemoveWarning(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={async () => {
                  await removeAttendee(removeWarning.attendee.id);
                  setRemoveWarning(null);
                }}
              >
                Remove anyway
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function DeptBubble({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-full px-3 py-1 text-xs font-medium transition",
        active
          ? "bg-[var(--accent)] text-[var(--accent-fg)]"
          : "border border-border bg-surface text-muted hover:text-ink",
      )}
    >
      {label}
    </button>
  );
}

function QuickAction({
  href,
  title,
  children,
}: {
  href: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      title={title}
      className="rounded-lg border border-border p-1.5 text-muted transition hover:bg-canvas hover:text-ink"
    >
      {children}
    </a>
  );
}

function AttendeeModal({
  open,
  onClose,
  attendee,
  departments,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  attendee: Attendee | null;
  departments: string[];
  onSave: (partial: Partial<Attendee>) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("");
  const [department, setDepartment] = useState("");
  const [color, setColor] = useState(ATTENDEE_COLORS[0]);
  const [saving, setSaving] = useState(false);

  // Reset when opened.
  useEffect(() => {
    if (!open) return;
    setName(attendee?.name || "");
    setEmail(attendee?.email || "");
    setPhone(attendee?.phone || "");
    setRole(attendee?.role || "");
    setDepartment(attendee?.department || "");
    setColor(
      attendee?.color ||
        ATTENDEE_COLORS[Math.floor(Math.random() * ATTENDEE_COLORS.length)],
    );
  }, [open, attendee]);

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    await onSave({
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim(),
      role: role.trim(),
      department: department.trim(),
      color,
    });
    setSaving(false);
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={attendee ? "Edit attendee" : "Add attendee"}
    >
      <div className="space-y-4">
        <Input label="Name *" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Input label="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Role" value={role} onChange={(e) => setRole(e.target.value)} placeholder="e.g. MSL" />
          <div>
            <Input
              label="Department"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              list="conf-departments"
            />
            <datalist id="conf-departments">
              {departments.map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
          </div>
        </div>
        <div>
          <p className="mb-1.5 text-sm font-medium">Color</p>
          <div className="flex flex-wrap gap-2">
            {ATTENDEE_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className={cn(
                  "h-7 w-7 rounded-full transition",
                  color === c && "ring-2 ring-ink ring-offset-2",
                )}
                style={{ background: c }}
                title={c}
              />
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || !name.trim()}>
            {saving ? "Saving…" : attendee ? "Save" : "Add"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
