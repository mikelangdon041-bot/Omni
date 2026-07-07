"use client";

// Event create/edit sheet (spec §7.8): grouped sections — Details (type-aware
// extras incl. poster-creation mode), When & Where (day chips, smart AM/PM
// nudge, maps link), People (attendee multi-select + inline create; key-contact
// select for contact meetings), and the booth Shift Editor (spec §7.9).

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ExternalLink, Plus, Trash2, TriangleAlert } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { cn } from "@/lib/ui";
import { useConferenceCtx } from "@/components/conference/ConferenceContext";
import { useContacts, type EventWithPeople, type ShiftInput } from "@/lib/conference/hooks";
import {
  EVENT_TYPES,
  EVENT_TYPE_ORDER,
  PRIORITIES,
  type EventType,
  type ConfEvent,
  type Priority,
} from "@/lib/conference/types";
import {
  dateKeyInTz,
  fmtDayKey,
  listDays,
  localToUtcISO,
  mapsUrl,
  timeInputValue,
} from "@/lib/conference/utils";

const supabase = createClient();

interface ShiftRow {
  key: string;
  attendeeId: string | null;
  start: string; // HH:MM
  end: string;
}

export function EventFormModal({
  open,
  onClose,
  event,
  initialDay,
  initialMinutes,
  initialEndMinutes,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  event: EventWithPeople | null; // null = create
  initialDay?: string;
  initialMinutes?: number;
  initialEndMinutes?: number; // from long-press drag
  onSave: (
    eventId: string | null,
    partial: Partial<ConfEvent>,
    assigneeIds?: string[],
    shifts?: ShiftInput[],
  ) => Promise<ConfEvent | null>;
}) {
  const { conference, attendees, addAttendee, canManage, me } = useConferenceCtx();
  const { contacts, add: addContact } = useContacts(open ? conference.id : null);
  const tz = conference.timezone;
  const days = useMemo(
    () => listDays(conference.start_date, conference.end_date),
    [conference.start_date, conference.end_date],
  );

  const [title, setTitle] = useState("");
  const [type, setType] = useState<EventType>("session");
  const [customLabel, setCustomLabel] = useState("");
  const [showInSessions, setShowInSessions] = useState(false);
  const [suspected, setSuspected] = useState<Priority | null>(null);
  const [date, setDate] = useState("");
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("10:00");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [assignees, setAssignees] = useState<string[]>([]);
  const [personSearch, setPersonSearch] = useState("");
  const [contactIds, setContactIds] = useState<string[]>([]);
  const [contactSearch, setContactSearch] = useState("");
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [splitMinutes, setSplitMinutes] = useState(60);
  // Poster-creation extras (create only).
  const [posterAuthors, setPosterAuthors] = useState("");
  const [posterAbstract, setPosterAbstract] = useState("");
  const [posterCount, setPosterCount] = useState(1);
  const [posterLabel, setPosterLabel] = useState("");
  const [saving, setSaving] = useState(false);

  // Initialize when opened.
  useEffect(() => {
    if (!open) return;
    if (event) {
      setTitle(event.title);
      setType(event.event_type);
      setCustomLabel(event.custom_label);
      setShowInSessions(event.show_in_sessions);
      setSuspected(event.suspected_priority);
      setDate(dateKeyInTz(event.starts_at, tz));
      setStart(timeInputValue(event.starts_at, tz));
      setEnd(timeInputValue(event.ends_at, tz));
      setLocation(event.location);
      setDescription(event.description);
      setIsPrivate(event.is_private);
      setAssignees(event.assignments.map((a) => a.attendee_id));
      setShifts(
        event.shifts.map((s, i) => ({
          key: `${s.id}-${i}`,
          attendeeId: s.attendee_id,
          start: timeInputValue(s.starts_at, tz),
          end: timeInputValue(s.ends_at, tz),
        })),
      );
      // Existing linked contact meetings.
      supabase
        .from("conf_contact_meetings")
        .select("contact_id")
        .eq("event_id", event.id)
        .then(({ data }) => setContactIds((data || []).map((r) => r.contact_id)));
    } else {
      const today = dateKeyInTz(new Date(), tz);
      setTitle("");
      setType("session");
      setCustomLabel("");
      setShowInSessions(false);
      setSuspected(null);
      setDate(initialDay || (days.includes(today) ? today : days[0]) || today);
      const m = initialMinutes ?? 9 * 60;
      setStart(minToInput(m));
      const endM = initialEndMinutes && initialEndMinutes > m ? initialEndMinutes : m + 60;
      setEnd(minToInput(Math.min(endM, 23 * 60 + 59)));
      setLocation("");
      setDescription("");
      setIsPrivate(false);
      setAssignees([]);
      setContactIds([]);
      setShifts([]);
      setPosterAuthors("");
      setPosterAbstract("");
      setPosterCount(1);
      setPosterLabel("");
    }
    setPersonSearch("");
    setContactSearch("");
  }, [open, event, initialDay, initialMinutes, initialEndMinutes, tz, days]);

  // Smart nudge: a PM start with an earlier end bumps the end (spec §7.8).
  function onStartChange(v: string) {
    setStart(v);
    if (v && end && end <= v) {
      const [h, m] = v.split(":").map(Number);
      setEnd(minToInput(Math.min(h * 60 + m + 60, 23 * 60 + 59)));
    }
  }

  // ---- Shift editor helpers -------------------------------------------
  const shiftWarnings = useMemo(() => {
    // Per-person overlap detection: same attendee in two overlapping rows.
    const bad = new Set<string>();
    for (let i = 0; i < shifts.length; i++) {
      for (let j = i + 1; j < shifts.length; j++) {
        const a = shifts[i];
        const b = shifts[j];
        if (!a.attendeeId || a.attendeeId !== b.attendeeId) continue;
        if (a.start < b.end && b.start < a.end) {
          bad.add(a.key);
          bad.add(b.key);
        }
      }
    }
    return bad;
  }, [shifts]);

  function addShiftPerson() {
    setShifts((prev) => [
      ...prev,
      { key: crypto.randomUUID(), attendeeId: null, start, end },
    ]);
  }

  function autoSplit() {
    const s = toMin(start);
    const e = toMin(end);
    if (e <= s) return;
    const rows: ShiftRow[] = [];
    for (let t = s; t < e; t += splitMinutes) {
      rows.push({
        key: crypto.randomUUID(),
        attendeeId: null,
        start: minToInput(t),
        end: minToInput(Math.min(t + splitMinutes, e)),
      });
    }
    setShifts(rows);
  }

  const shiftSummary = useMemo(() => {
    const assigned = shifts.filter((s) => s.attendeeId).length;
    const full = shifts.filter(
      (s) => s.attendeeId && s.start === start && s.end === end,
    ).length;
    return { assigned, full, partial: assigned - full, open: shifts.length - assigned };
  }, [shifts, start, end]);

  // ---- People helpers --------------------------------------------------
  const filteredAttendees = useMemo(() => {
    const q = personSearch.trim().toLowerCase();
    return q ? attendees.filter((a) => a.name.toLowerCase().includes(q)) : attendees;
  }, [attendees, personSearch]);

  const filteredContacts = useMemo(() => {
    const q = contactSearch.trim().toLowerCase();
    const active = contacts.filter((c) => !c.archived);
    return q ? active.filter((c) => c.name.toLowerCase().includes(q)) : active;
  }, [contacts, contactSearch]);

  async function createAttendeeInline() {
    const name = personSearch.trim();
    if (!name) return;
    const created = await addAttendee({ name });
    if (created) {
      setAssignees((prev) => [...prev, created.id]);
      setPersonSearch("");
    }
  }

  async function createContactInline() {
    const name = contactSearch.trim();
    if (!name) return;
    const created = await addContact({ name });
    if (created) {
      setContactIds((prev) => [...prev, created.id]);
      setContactSearch("");
    }
  }

  // ---- Save ------------------------------------------------------------
  const isPosterCreate = type === "poster" && !event;

  async function save() {
    if (!title.trim() || !date || saving) return;
    setSaving(true);
    try {
      if (isPosterCreate) {
        await savePosters();
        onClose();
        return;
      }

      const starts_at = localToUtcISO(date, start, tz);
      const ends_at = localToUtcISO(date, end > start ? end : start, tz);
      const partial: Partial<ConfEvent> = {
        title: title.trim(),
        event_type: type === "poster" ? event!.event_type : type,
        custom_label: type === "custom" ? customLabel.trim() : "",
        show_in_sessions: type === "custom" ? showInSessions : false,
        description,
        location: location.trim(),
        starts_at,
        ends_at,
        is_private: isPrivate,
      };

      // Priority provenance: stamp only when the value actually changes.
      const prevSuspected = event?.suspected_priority ?? null;
      if (suspected !== prevSuspected) {
        partial.suspected_priority = suspected;
        partial.priority_set_by = me?.id || null;
        partial.priority_set_at = new Date().toISOString();
      }

      const shiftInputs: ShiftInput[] | undefined =
        type === "booth"
          ? shifts.map((s, i) => ({
              attendee_id: s.attendeeId,
              starts_at: localToUtcISO(date, s.start, tz),
              ends_at: localToUtcISO(date, s.end, tz),
              sort_order: i,
            }))
          : undefined;

      const saved = await onSave(event?.id || null, partial, assignees, shiftInputs);
      if (saved && suspected !== prevSuspected) {
        void supabase.from("conf_priority_history").insert({
          conference_id: conference.id,
          item_type: "event",
          item_id: saved.id,
          field: "suspected",
          value: suspected,
          set_by: me?.id,
        });
      }

      // Contact meetings stay in sync with the schedule (spec §7.8 save).
      if (saved && type === "contact_meeting") {
        const { data: existing } = await supabase
          .from("conf_contact_meetings")
          .select("id, contact_id")
          .eq("event_id", saved.id);
        const rows = existing || [];
        const gone = rows.filter((r) => !contactIds.includes(r.contact_id));
        if (gone.length) {
          await supabase
            .from("conf_contact_meetings")
            .delete()
            .in("id", gone.map((r) => r.id));
        }
        const kept = rows.filter((r) => contactIds.includes(r.contact_id));
        if (kept.length) {
          await supabase
            .from("conf_contact_meetings")
            .update({ meeting_date: date, meeting_time: start, location: location.trim() })
            .in("id", kept.map((r) => r.id));
        }
        const newIds = contactIds.filter((id) => !rows.some((r) => r.contact_id === id));
        if (newIds.length) {
          await supabase.from("conf_contact_meetings").insert(
            newIds.map((contact_id) => ({
              conference_id: conference.id,
              contact_id,
              event_id: saved.id,
              meeting_date: date,
              meeting_time: start,
              location: location.trim(),
            })),
          );
        }
      }

      // Fire-and-forget change notifications to other assigned people.
      if (saved) {
        const assignedUserIds = attendees
          .filter((a) => assignees.includes(a.id) && a.user_id && a.user_id !== me?.id)
          .map((a) => a.user_id as string);
        if (assignedUserIds.length) {
          fetch("/api/conference/announce", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify({
              conferenceId: conference.id,
              silent: true,
              userIds: assignedUserIds,
              title: event ? "Schedule updated" : "You've been assigned",
              message: `${title.trim()} · ${fmtDayKey(date)} ${start}${location ? ` · ${location}` : ""}`,
              link: `/conference-planning/${conference.id}/schedule`,
            }),
          }).catch(() => {});
        }
      }
      onClose();
    } finally {
      setSaving(false);
    }
  }

  // Poster type on create writes poster rows instead of a calendar event.
  async function savePosters() {
    const label = posterLabel.trim() || title.trim();
    const base = {
      conference_id: conference.id,
      date: fmtDayKey(date, { weekday: true }),
      time: start,
      location: location.trim(),
      authors: posterAuthors.trim(),
      abstract: posterAbstract,
      session_label: label,
      suspected_priority: suspected,
    };
    if (posterCount <= 1) {
      await supabase.from("conf_posters").insert({ ...base, title: title.trim() });
      return;
    }
    const { data: parent } = await supabase
      .from("conf_posters")
      .insert({ ...base, title: title.trim(), is_session: true })
      .select("id")
      .single();
    if (parent) {
      await supabase.from("conf_posters").insert(
        Array.from({ length: posterCount }, (_, i) => ({
          ...base,
          title: `${title.trim()} — Poster ${i + 1}`,
          parent_id: parent.id,
          sub_index: i + 1,
        })),
      );
    }
  }

  const showPriority = type !== "booth" && type !== "contact_meeting" && canManage;
  const dateOutside = date && (date < conference.start_date || date > conference.end_date);
  const shiftsBlocked = type === "booth" && shiftWarnings.size > 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={event ? "Edit event" : "New event"}
      size="lg"
    >
      <div className="space-y-6">
        {/* ---- Details ---- */}
        <section className="space-y-3">
          <SectionLabel>Details</SectionLabel>
          <Input
            label="Title *"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
          <div>
            <p className="mb-1.5 text-sm font-medium">Type</p>
            <div className="flex flex-wrap gap-1.5">
              {EVENT_TYPE_ORDER.map((t) => (
                <button
                  key={t}
                  onClick={() => setType(t)}
                  disabled={!!event && t === "poster"}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition disabled:opacity-40",
                    type === t
                      ? "border-transparent text-white"
                      : "border-border bg-surface text-ink hover:bg-canvas",
                  )}
                  style={type === t ? { background: EVENT_TYPES[t].color } : undefined}
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: type === t ? "#fff" : EVENT_TYPES[t].color }}
                  />
                  {EVENT_TYPES[t].label}
                </button>
              ))}
            </div>
          </div>

          {type === "custom" && (
            <div className="space-y-2 rounded-lg bg-canvas p-3">
              <Input
                label="Custom type label"
                value={customLabel}
                onChange={(e) => setCustomLabel(e.target.value)}
                placeholder="e.g. Advisory board"
              />
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={showInSessions}
                  onChange={(e) => setShowInSessions(e.target.checked)}
                />
                Include in Sessions tab (note-taking page)
              </label>
            </div>
          )}

          {isPosterCreate && (
            <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-xs text-amber-800">
                Poster entries are created in the <b>Posters</b> tab (not as a
                calendar event). Choosing more than one poster creates a poster
                session with that many sub-posters.
              </p>
              <Input
                label="Session label"
                value={posterLabel}
                onChange={(e) => setPosterLabel(e.target.value)}
                placeholder="Defaults to the title"
              />
              <Input
                label="Authors"
                value={posterAuthors}
                onChange={(e) => setPosterAuthors(e.target.value)}
              />
              <Textarea
                label="Abstract"
                value={posterAbstract}
                onChange={(e) => setPosterAbstract(e.target.value)}
              />
              <Input
                label="Number of posters in the session (1–20)"
                type="number"
                min={1}
                max={20}
                value={posterCount}
                onChange={(e) =>
                  setPosterCount(Math.max(1, Math.min(20, Number(e.target.value) || 1)))
                }
              />
            </div>
          )}

          {showPriority && (
            <div>
              <p className="mb-1.5 text-sm font-medium">Suspected priority</p>
              <div className="flex flex-wrap gap-1.5">
                {(["high", "medium", "low"] as Priority[]).map((p) => (
                  <button
                    key={p}
                    onClick={() => setSuspected(suspected === p ? null : p)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                      suspected === p
                        ? "border-transparent text-white"
                        : "border-border bg-surface hover:bg-canvas",
                    )}
                    style={
                      suspected === p
                        ? { background: PRIORITIES[p].color }
                        : { color: PRIORITIES[p].color }
                    }
                  >
                    {PRIORITIES[p].label}
                  </button>
                ))}
                {suspected && (
                  <button
                    onClick={() => setSuspected(null)}
                    className="rounded-full px-3 py-1.5 text-xs text-muted hover:bg-canvas"
                  >
                    Clear
                  </button>
                )}
              </div>
              <p className="mt-1 text-xs text-muted">
                Helps reps anticipate effort and rank insights afterward.
              </p>
            </div>
          )}
        </section>

        {/* ---- When & Where ---- */}
        <section className="space-y-3">
          <SectionLabel>When &amp; where</SectionLabel>
          <div>
            <p className="mb-1.5 text-sm font-medium">Date</p>
            <div className="flex flex-wrap items-center gap-1.5">
              {days.map((d) => (
                <button
                  key={d}
                  onClick={() => setDate(d)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs font-medium transition",
                    date === d
                      ? "border-transparent bg-[var(--accent)] text-white"
                      : "border-border bg-surface hover:bg-canvas",
                  )}
                >
                  {fmtDayKey(d)}
                </button>
              ))}
              <input
                type="date"
                value={days.includes(date) ? "" : date}
                onChange={(e) => e.target.value && setDate(e.target.value)}
                className="rounded-lg border border-border bg-surface px-2 py-1 text-xs outline-none focus:border-[var(--accent)]"
                title="Other date"
              />
            </div>
            {dateOutside && (
              <p className="mt-1.5 flex items-center gap-1 text-xs font-medium text-amber-600">
                <TriangleAlert size={12} /> This date is outside the official
                conference range ({conference.start_date} – {conference.end_date}).
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Start"
              type="time"
              value={start}
              onChange={(e) => onStartChange(e.target.value)}
            />
            <Input label="End" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Input
                label="Location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Room / hall / address"
              />
            </div>
            {location.trim() && (
              <a
                href={mapsUrl(location)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-muted transition hover:text-ink"
              >
                <ExternalLink size={14} /> Map
              </a>
            )}
          </div>
          <Textarea
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isPrivate}
              onChange={(e) => setIsPrivate(e.target.checked)}
            />
            Private — only visible to me
          </label>
        </section>

        {/* ---- People ---- */}
        {!isPosterCreate && (
          <section className="space-y-3">
            <SectionLabel>People</SectionLabel>
            {assignees.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {assignees.map((id) => {
                  const a = attendees.find((x) => x.id === id);
                  return (
                    <button
                      key={id}
                      onClick={() => setAssignees((prev) => prev.filter((x) => x !== id))}
                      className="inline-flex items-center gap-1 rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-xs font-medium text-[var(--accent)] hover:opacity-75"
                      title="Remove"
                    >
                      {a?.name || "?"} ×
                    </button>
                  );
                })}
              </div>
            )}
            <div className="flex gap-2">
              <input
                value={personSearch}
                onChange={(e) => setPersonSearch(e.target.value)}
                placeholder="Search attendees…"
                className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
              />
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  setAssignees(
                    assignees.length === attendees.length ? [] : attendees.map((a) => a.id),
                  )
                }
              >
                {assignees.length === attendees.length ? "None" : "All"}
              </Button>
            </div>
            <div className="max-h-36 space-y-0.5 overflow-y-auto rounded-lg border border-border p-1.5">
              {filteredAttendees.map((a) => (
                <label
                  key={a.id}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-canvas"
                >
                  <input
                    type="checkbox"
                    checked={assignees.includes(a.id)}
                    onChange={(e) =>
                      setAssignees((prev) =>
                        e.target.checked ? [...prev, a.id] : prev.filter((x) => x !== a.id),
                      )
                    }
                  />
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ background: a.color }}
                  />
                  {a.name}
                </label>
              ))}
              {personSearch.trim() &&
                !attendees.some(
                  (a) =>
                    a.name.trim().toLowerCase() ===
                    personSearch.trim().toLowerCase(),
                ) && (
                  <button
                    onClick={createAttendeeInline}
                    className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-[var(--accent)] hover:bg-canvas"
                  >
                    <Plus size={14} /> Create attendee “{personSearch.trim()}”
                  </button>
                )}
            </div>

            {type === "contact_meeting" && (
              <div className="space-y-2 rounded-lg bg-canvas p-3">
                <p className="text-sm font-medium">KOLs</p>
                {contactIds.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {contactIds.map((id) => {
                      const c = contacts.find((x) => x.id === id);
                      return (
                        <button
                          key={id}
                          onClick={() =>
                            setContactIds((prev) => prev.filter((x) => x !== id))
                          }
                          className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2.5 py-1 text-xs font-medium text-violet-700 hover:opacity-75"
                        >
                          {c?.name || "?"} ×
                        </button>
                      );
                    })}
                  </div>
                )}
                <input
                  value={contactSearch}
                  onChange={(e) => setContactSearch(e.target.value)}
                  placeholder="Search KOLs…"
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
                />
                <div className="max-h-32 space-y-0.5 overflow-y-auto">
                  {filteredContacts.map((c) => (
                    <label
                      key={c.id}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-surface"
                    >
                      <input
                        type="checkbox"
                        checked={contactIds.includes(c.id)}
                        onChange={(e) =>
                          setContactIds((prev) =>
                            e.target.checked
                              ? [...prev, c.id]
                              : prev.filter((x) => x !== c.id),
                          )
                        }
                      />
                      {c.name}
                      {c.institution && (
                        <span className="text-xs text-muted">· {c.institution}</span>
                      )}
                    </label>
                  ))}
                  {contactSearch.trim() &&
                    !contacts.some(
                      (c) =>
                        !c.archived &&
                        c.name.trim().toLowerCase() ===
                          contactSearch.trim().toLowerCase(),
                    ) && (
                      <button
                        onClick={createContactInline}
                        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-[var(--accent)] hover:bg-surface"
                      >
                        <Plus size={14} /> Create KOL “{contactSearch.trim()}”
                      </button>
                    )}
                </div>
              </div>
            )}
          </section>
        )}

        {/* ---- Booth coverage (shift editor) ---- */}
        {type === "booth" && (
          <section className="space-y-3">
            <SectionLabel>Booth coverage</SectionLabel>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="secondary" onClick={addShiftPerson}>
                <Plus size={14} /> Add slot
              </Button>
              <span className="text-xs text-muted">or</span>
              <Select
                value={String(splitMinutes)}
                onChange={(e) => setSplitMinutes(Number(e.target.value))}
                className="!w-auto !py-1.5 text-xs"
              >
                <option value="30">30 min</option>
                <option value="60">1 hour</option>
                <option value="120">2 hours</option>
                <option value="240">4 hours</option>
              </Select>
              <Button size="sm" variant="secondary" onClick={autoSplit}>
                Auto-split
              </Button>
            </div>
            {shifts.length > 0 && (
              <div className="space-y-1.5">
                {shifts.map((s) => (
                  <div
                    key={s.key}
                    className={cn(
                      "flex flex-wrap items-center gap-2 rounded-lg border p-2",
                      shiftWarnings.has(s.key)
                        ? "border-red-300 bg-red-50"
                        : s.attendeeId
                          ? "border-border bg-surface"
                          : "border-dashed border-amber-300 bg-amber-50/50",
                    )}
                  >
                    <select
                      value={s.attendeeId || ""}
                      onChange={(e) =>
                        setShifts((prev) =>
                          prev.map((x) =>
                            x.key === s.key
                              ? { ...x, attendeeId: e.target.value || null }
                              : x,
                          ),
                        )
                      }
                      className="min-w-32 flex-1 rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none"
                    >
                      <option value="">Open slot</option>
                      {attendees.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                    <input
                      type="time"
                      value={s.start}
                      onChange={(e) =>
                        setShifts((prev) =>
                          prev.map((x) =>
                            x.key === s.key ? { ...x, start: e.target.value } : x,
                          ),
                        )
                      }
                      className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none"
                    />
                    <span className="text-xs text-muted">–</span>
                    <input
                      type="time"
                      value={s.end}
                      onChange={(e) =>
                        setShifts((prev) =>
                          prev.map((x) =>
                            x.key === s.key ? { ...x, end: e.target.value } : x,
                          ),
                        )
                      }
                      className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm outline-none"
                    />
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                        s.start === start && s.end === end
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-amber-100 text-amber-700",
                      )}
                    >
                      {s.start === start && s.end === end ? "full" : "partial"}
                    </span>
                    <button
                      onClick={() =>
                        setShifts((prev) => prev.filter((x) => x.key !== s.key))
                      }
                      className="rounded p-1 text-muted hover:text-red-600"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
                <p className="text-xs text-muted">
                  {shiftSummary.assigned} assigned · {shiftSummary.full} full ·{" "}
                  {shiftSummary.partial} partial
                  {shiftSummary.open > 0 && ` · ${shiftSummary.open} open`}
                </p>
                {shiftsBlocked && (
                  <p className="flex items-center gap-1 text-xs font-medium text-red-600">
                    <TriangleAlert size={12} /> Someone is in two overlapping
                    slots — fix before saving.
                  </p>
                )}
              </div>
            )}
          </section>
        )}

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={save}
            disabled={saving || !title.trim() || !date || shiftsBlocked}
          >
            {saving ? "Saving…" : event ? "Save changes" : isPosterCreate ? "Create posters" : "Create event"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-wide text-muted">
      {children}
    </p>
  );
}

function toMin(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function minToInput(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}
