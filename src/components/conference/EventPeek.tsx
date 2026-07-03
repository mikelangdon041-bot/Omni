"use client";

// Quick-view "peek" sheet (spec §7.6): a read-only scan of a schedule block.
// Close (top-left) / Edit (top-right); "Open notes" only for types that have
// a detail page; calendar export actions; delete.

import Link from "next/link";
import {
  CalendarPlus,
  Clock,
  ExternalLink,
  Lock,
  MapPin,
  NotebookPen,
  Pencil,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { PriorityPill } from "@/components/conference/Priority";
import { useConferenceCtx } from "@/components/conference/ConferenceContext";
import { buildOutlookInvite } from "@/lib/conference/exports";
import type { EventWithPeople } from "@/lib/conference/hooks";
import {
  EVENT_TYPES,
  SESSION_TYPES,
} from "@/lib/conference/types";
import { buildICS, downloadICS, googleCalendarUrl } from "@/lib/conference/ics";
import { dateKeyInTz, fmtDayKeyLong, fmtTime } from "@/lib/conference/utils";

export function EventPeek({
  event,
  onClose,
  onEdit,
  onDelete,
}: {
  event: EventWithPeople | null;
  onClose: () => void;
  onEdit: (e: EventWithPeople) => void;
  onDelete: (e: EventWithPeople) => void;
}) {
  const { conference, attendees, me, myAttendee, canManage } = useConferenceCtx();
  if (!event) return null;

  const tz = conference.timezone;
  const type = EVENT_TYPES[event.event_type];
  const hasNotes =
    SESSION_TYPES.includes(event.event_type) ||
    (event.event_type === "custom" && event.show_in_sessions) ||
    event.event_type === "contact_meeting";
  const notesHref =
    event.event_type === "contact_meeting"
      ? `/conference-planning/${conference.id}/contacts?event=${event.id}`
      : `/conference-planning/${conference.id}/sessions/${event.id}`;
  const names = event.assignments
    .map((a) => attendees.find((x) => x.id === a.attendee_id)?.name)
    .filter(Boolean) as string[];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 sm:items-center sm:p-8"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-border bg-surface shadow-xl sm:rounded-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted transition hover:bg-canvas hover:text-ink"
            aria-label="Close"
          >
            <X size={18} />
          </button>
          <span
            className="rounded-full px-2.5 py-1 text-[11px] font-semibold text-white"
            style={{ background: type.color }}
          >
            {event.event_type === "custom" && event.custom_label
              ? event.custom_label
              : type.label}
          </span>
          <button
            onClick={() => onEdit(event)}
            className="rounded-lg p-1.5 text-muted transition hover:bg-canvas hover:text-ink"
            title="Edit"
          >
            <Pencil size={17} />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          <h2 className="flex items-start gap-2 text-lg font-semibold tracking-tight">
            {event.is_private && <Lock size={16} className="mt-1 shrink-0 text-muted" />}
            {event.title}
          </h2>
          <PriorityPill
            suspected={event.suspected_priority}
            confirmed={event.confirmed_priority}
          />
          <p className="flex items-center gap-2 text-sm text-muted">
            <Clock size={15} className="shrink-0" />
            {fmtDayKeyLong(dateKeyInTz(event.starts_at, tz))} ·{" "}
            {fmtTime(event.starts_at, tz)} – {fmtTime(event.ends_at, tz)}
          </p>
          {event.location && (
            <p className="flex items-center gap-2 text-sm text-muted">
              <MapPin size={15} className="shrink-0" /> {event.location}
            </p>
          )}
          <p className="flex items-start gap-2 text-sm text-muted">
            <Users size={15} className="mt-0.5 shrink-0" />
            {names.length ? names.join(", ") : "Unassigned"}
          </p>
          {event.description && (
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{event.description}</p>
          )}

          <div className="flex flex-wrap gap-2 pt-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                downloadICS(event.title, buildICS([event], conference))
              }
            >
              <CalendarPlus size={14} /> Export .ics
            </Button>
            <a
              href={googleCalendarUrl(event, conference)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-ink transition hover:bg-canvas"
            >
              <ExternalLink size={13} /> Google Calendar
            </a>
            {canManage && (
              <Button
                size="sm"
                variant="secondary"
                title="Outlook meeting request: assignees with emails become attendees; you're the organizer"
                onClick={() => {
                  const invitees = event.assignments
                    .map((a) => attendees.find((x) => x.id === a.attendee_id))
                    .filter(Boolean)
                    .map((a) => ({ name: a!.name, email: a!.email }));
                  const { ics, count } = buildOutlookInvite(event, conference, invitees, {
                    name: myAttendee?.name || me?.displayName || "Organizer",
                    email: me?.email || myAttendee?.email || "organizer@omni.local",
                  });
                  if (count === 0) {
                    alert("None of the assigned people have an email on the roster — nothing to invite.");
                    return;
                  }
                  downloadICS(`Invite — ${event.title}`, ics);
                  alert(`Meeting request created with ${count} attendee${count === 1 ? "" : "s"}. Open it in Outlook to review and send.`);
                }}
              >
                <CalendarPlus size={13} /> Send invite
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="!text-red-600 hover:!bg-red-50"
              onClick={() => {
                if (confirm(`Delete "${event.title}"? Other assignees will be notified.`)) {
                  onDelete(event);
                }
              }}
            >
              <Trash2 size={14} /> Delete
            </Button>
          </div>
        </div>

        {/* Sticky footer: only for types with a detail page */}
        {hasNotes && (
          <div className="border-t border-border p-3">
            <Link
              href={notesHref}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[var(--accent-hover)]"
            >
              <NotebookPen size={15} /> Open notes
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
