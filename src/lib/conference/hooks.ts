"use client";

// Data hooks for Conference Planning. All conference data is org-shared;
// list hooks subscribe to realtime changes so teammates' edits appear without
// refresh (refetch-on-change keeps dedupe against optimistic updates simple).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  DEFAULT_CATEGORIES,
  type Announcement,
  type Attendee,
  type BoothLog,
  type Category,
  type ConfEvent,
  type Conference,
  type Contact,
  type ContactMeeting,
  type DailySummary,
  type EventAssignment,
  type EventShift,
  type FoodAssignment,
  type FoodItem,
  type FoodMessage,
  type FoodOrder,
  type Insight,
  type Poster,
  type PosterNote,
  type PosterRep,
  type SessionNote,
  type VenuePin,
} from "./types";

const supabase = createClient();

// ------------------------------------------------------------------
// Identity
// ------------------------------------------------------------------
export interface Me {
  id: string;
  displayName: string;
  email: string;
  isOrgAdmin: boolean;
}

export function useMe() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        if (active) setLoading(false);
        return;
      }
      const { data: profile } = await supabase
        .from("profiles")
        .select("display_name, username, role")
        .eq("id", user.id)
        .single();
      if (!active) return;
      setMe({
        id: user.id,
        displayName: profile?.display_name || profile?.username || "Me",
        email: user.email || "",
        isOrgAdmin: profile?.role === "admin" || profile?.role === "owner",
      });
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);
  return { me, loading };
}

// ------------------------------------------------------------------
// Realtime: refetch (debounced) when any of the given tables change for
// this conference.
// ------------------------------------------------------------------
export function useRealtime(
  conferenceId: string | null | undefined,
  tables: string[],
  onChange: () => void,
) {
  const cb = useRef(onChange);
  useEffect(() => {
    cb.current = onChange;
  });
  // Unique topic per hook instance — supabase allows one subscription per
  // topic, and two components may watch the same tables on the same page.
  const [uid] = useState(() => Math.random().toString(36).slice(2, 9));
  const key = tables.join(",");
  useEffect(() => {
    if (!conferenceId) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const fire = () => {
      if (t) clearTimeout(t);
      t = setTimeout(() => cb.current(), 250);
    };
    const channel = supabase.channel(`conf-${conferenceId}-${key}-${uid}`);
    for (const table of key.split(",")) {
      channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table,
          filter: `conference_id=eq.${conferenceId}`,
        },
        fire,
      );
    }
    channel.subscribe();
    return () => {
      if (t) clearTimeout(t);
      void supabase.removeChannel(channel);
    };
  }, [conferenceId, key, uid]);
}

// ------------------------------------------------------------------
// Conferences
// ------------------------------------------------------------------
export function useConferences() {
  const [conferences, setConferences] = useState<Conference[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const { data } = await supabase
      .from("conferences")
      .select("*")
      .eq("active", true)
      .order("start_date", { ascending: false });
    setConferences((data as Conference[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const add = useCallback(async (partial: Partial<Conference>) => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data: profile } = await supabase
      .from("profiles")
      .select("org_id")
      .eq("id", user?.id || "")
      .single();
    if (!profile?.org_id) return null;
    const { data, error } = await supabase
      .from("conferences")
      .insert({ ...partial, org_id: profile.org_id, created_by: user?.id })
      .select("*")
      .single();
    if (error || !data) return null;
    setConferences((prev) => [data as Conference, ...prev]);
    return data as Conference;
  }, []);

  const update = useCallback(async (id: string, partial: Partial<Conference>) => {
    setConferences((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...partial } : c)),
    );
    await supabase.from("conferences").update(partial).eq("id", id);
  }, []);

  return { conferences, loading, refresh, add, update };
}

export function useConference(id: string) {
  const [conference, setConference] = useState<Conference | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const { data } = await supabase
      .from("conferences")
      .select("*")
      .eq("id", id)
      .single();
    setConference((data as Conference) || null);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const update = useCallback(
    async (partial: Partial<Conference>) => {
      setConference((prev) => (prev ? { ...prev, ...partial } : prev));
      await supabase.from("conferences").update(partial).eq("id", id);
    },
    [id],
  );

  return { conference, loading, refresh, update };
}

// ------------------------------------------------------------------
// Attendees
// ------------------------------------------------------------------
export function useAttendees(conferenceId: string | null) {
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!conferenceId) return;
    const { data } = await supabase
      .from("conference_attendees")
      .select("*")
      .eq("conference_id", conferenceId)
      .eq("active", true)
      .order("name");
    setAttendees((data as Attendee[]) || []);
    setLoading(false);
  }, [conferenceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useRealtime(conferenceId, ["conference_attendees"], refresh);

  const add = useCallback(
    async (partial: Partial<Attendee>) => {
      if (!conferenceId) return null;
      const { data } = await supabase
        .from("conference_attendees")
        .insert({ ...partial, conference_id: conferenceId })
        .select("*")
        .single();
      if (data) setAttendees((prev) => [...prev, data as Attendee].sort((a, b) => a.name.localeCompare(b.name)));
      return (data as Attendee) || null;
    },
    [conferenceId],
  );

  const update = useCallback(async (id: string, partial: Partial<Attendee>) => {
    setAttendees((prev) => prev.map((a) => (a.id === id ? { ...a, ...partial } : a)));
    await supabase.from("conference_attendees").update(partial).eq("id", id);
  }, []);

  // "Removal" deactivates rather than hard-deletes (assignments stay intact).
  const remove = useCallback(async (id: string) => {
    setAttendees((prev) => prev.filter((a) => a.id !== id));
    await supabase.from("conference_attendees").update({ active: false }).eq("id", id);
  }, []);

  return { attendees, loading, refresh, add, update, remove };
}

// Auto-add the signed-in user as an attendee of the conference they open,
// linking to a placeholder row (by email, then exact name) when one exists.
// When placeholders exist but none match exactly (e.g. an import created
// "Kristin H." and the user is "Kristin Hoffman"), we don't guess — we return
// the unclaimed placeholders so the UI can ask "which of these are you?".
export function useEnsureAttendee(
  conference: Conference | null,
  me: Me | null,
  attendees: Attendee[],
  loading: boolean,
  refresh: () => void,
) {
  const done = useRef<string | null>(null);
  const [claimable, setClaimable] = useState<Attendee[]>([]);

  useEffect(() => {
    if (!conference || !me || loading) return;
    if (done.current === conference.id) return;
    if (attendees.some((a) => a.user_id === me.id)) {
      done.current = conference.id;
      setClaimable([]);
      return;
    }
    done.current = conference.id;
    (async () => {
      const placeholder = attendees.find(
        (a) =>
          !a.user_id &&
          ((me.email && a.email.toLowerCase() === me.email.toLowerCase()) ||
            a.name.trim().toLowerCase() === me.displayName.trim().toLowerCase()),
      );
      if (placeholder) {
        await supabase
          .from("conference_attendees")
          .update({ user_id: me.id })
          .eq("id", placeholder.id);
        refresh();
        return;
      }
      const unclaimed = attendees.filter((a) => !a.user_id);
      if (unclaimed.length) {
        // Let the user pick themselves (or say "I'm new") via the claim modal.
        setClaimable(unclaimed);
        return;
      }
      await supabase.from("conference_attendees").insert({
        conference_id: conference.id,
        user_id: me.id,
        name: me.displayName,
        email: me.email,
      });
      refresh();
    })();
  }, [conference, me, attendees, loading, refresh]);

  // attendeeId = an unclaimed placeholder to become; null = add me as new.
  const claim = useCallback(
    async (attendeeId: string | null) => {
      if (!conference || !me) return;
      setClaimable([]);
      if (attendeeId) {
        await supabase
          .from("conference_attendees")
          .update({ user_id: me.id, email: me.email })
          .eq("id", attendeeId);
      } else {
        await supabase.from("conference_attendees").insert({
          conference_id: conference.id,
          user_id: me.id,
          name: me.displayName,
          email: me.email,
        });
      }
      refresh();
    },
    [conference, me, refresh],
  );

  return { claimable, claim };
}

// ------------------------------------------------------------------
// Schedule events (+ assignments + shifts)
// ------------------------------------------------------------------
export interface EventWithPeople extends ConfEvent {
  assignments: EventAssignment[];
  shifts: EventShift[];
}

export interface ShiftInput {
  attendee_id: string | null;
  starts_at: string;
  ends_at: string;
  sort_order: number;
}

export function useEvents(conferenceId: string | null, userId?: string | null) {
  const [events, setEvents] = useState<EventWithPeople[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!conferenceId) return;
    const [evRes, asRes, shRes] = await Promise.all([
      supabase
        .from("conf_events")
        .select("*")
        .eq("conference_id", conferenceId)
        .eq("cancelled", false)
        .order("starts_at"),
      supabase.from("conf_event_assignments").select("*").eq("conference_id", conferenceId),
      supabase.from("conf_event_shifts").select("*").eq("conference_id", conferenceId).order("sort_order"),
    ]);
    const assignments = (asRes.data as EventAssignment[]) || [];
    const shifts = (shRes.data as EventShift[]) || [];
    const byEventA = new Map<string, EventAssignment[]>();
    for (const a of assignments) {
      byEventA.set(a.event_id, [...(byEventA.get(a.event_id) || []), a]);
    }
    const byEventS = new Map<string, EventShift[]>();
    for (const s of shifts) {
      byEventS.set(s.event_id, [...(byEventS.get(s.event_id) || []), s]);
    }
    const rows = ((evRes.data as ConfEvent[]) || [])
      // Private events are visible only to their creator.
      .filter((e) => !e.is_private || e.created_by === userId)
      .map((e) => ({
        ...e,
        assignments: byEventA.get(e.id) || [],
        shifts: byEventS.get(e.id) || [],
      }));
    setEvents(rows);
    setLoading(false);
  }, [conferenceId, userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useRealtime(
    conferenceId,
    ["conf_events", "conf_event_assignments", "conf_event_shifts"],
    refresh,
  );

  // Create/update an event together with its assignees and (booth) shifts.
  const save = useCallback(
    async (
      eventId: string | null,
      partial: Partial<ConfEvent>,
      assigneeIds?: string[],
      shifts?: ShiftInput[],
    ): Promise<ConfEvent | null> => {
      if (!conferenceId) return null;
      let ev: ConfEvent | null = null;
      if (eventId) {
        const { data } = await supabase
          .from("conf_events")
          .update(partial)
          .eq("id", eventId)
          .select("*")
          .single();
        ev = (data as ConfEvent) || null;
      } else {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        const { data } = await supabase
          .from("conf_events")
          .insert({ ...partial, conference_id: conferenceId, created_by: user?.id })
          .select("*")
          .single();
        ev = (data as ConfEvent) || null;
      }
      if (!ev) return null;

      if (assigneeIds) {
        await supabase.from("conf_event_assignments").delete().eq("event_id", ev.id);
        if (assigneeIds.length) {
          await supabase.from("conf_event_assignments").insert(
            assigneeIds.map((attendee_id) => ({
              conference_id: conferenceId,
              event_id: ev!.id,
              attendee_id,
            })),
          );
        }
      }
      if (shifts) {
        await supabase.from("conf_event_shifts").delete().eq("event_id", ev.id);
        if (shifts.length) {
          await supabase.from("conf_event_shifts").insert(
            shifts.map((s) => ({ ...s, conference_id: conferenceId, event_id: ev!.id })),
          );
        }
      }
      await refresh();
      return ev;
    },
    [conferenceId, refresh],
  );

  // Soft-cancel (spec: deletes mark cancelled, not hard-delete).
  const remove = useCallback(
    async (id: string) => {
      setEvents((prev) => prev.filter((e) => e.id !== id));
      await supabase.from("conf_events").update({ cancelled: true }).eq("id", id);
    },
    [],
  );

  // Bulk variants for multi-select flows — one round-trip for N events.
  // Each verifies the DB write: on failure the optimistic state is rolled
  // back via refetch and the error is thrown for the caller to surface.
  const bulkUpdate = useCallback(
    async (ids: string[], partial: Partial<ConfEvent>) => {
      if (!ids.length) return;
      const set = new Set(ids);
      setEvents((prev) => prev.map((e) => (set.has(e.id) ? { ...e, ...partial } : e)));
      const { error } = await supabase.from("conf_events").update(partial).in("id", ids);
      if (error) {
        await refresh();
        throw new Error(error.message);
      }
    },
    [refresh],
  );

  const bulkRemove = useCallback(
    async (ids: string[]) => {
      if (!ids.length) return;
      const set = new Set(ids);
      setEvents((prev) => prev.filter((e) => !set.has(e.id)));
      const { error } = await supabase
        .from("conf_events")
        .update({ cancelled: true })
        .in("id", ids);
      if (error) {
        await refresh();
        throw new Error(error.message);
      }
    },
    [refresh],
  );

  // Assign one person to many events (skipping events that already have them).
  const bulkAssign = useCallback(
    async (ids: string[], attendeeId: string) => {
      if (!conferenceId || !ids.length) return;
      const missing = ids.filter((id) => {
        const ev = events.find((e) => e.id === id);
        return ev && !ev.assignments.some((a) => a.attendee_id === attendeeId);
      });
      if (!missing.length) return;
      const { error } = await supabase.from("conf_event_assignments").insert(
        missing.map((event_id) => ({
          conference_id: conferenceId,
          event_id,
          attendee_id: attendeeId,
        })),
      );
      await refresh();
      if (error) throw new Error(error.message);
    },
    [conferenceId, events, refresh],
  );

  const bulkUnassign = useCallback(
    async (ids: string[], attendeeId: string) => {
      if (!ids.length) return;
      const { error } = await supabase
        .from("conf_event_assignments")
        .delete()
        .in("event_id", ids)
        .eq("attendee_id", attendeeId);
      await refresh();
      if (error) throw new Error(error.message);
    },
    [refresh],
  );

  const setPriority = useCallback(
    async (
      id: string,
      field: "suspected_priority" | "confirmed_priority",
      value: string | null,
    ) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setEvents((prev) =>
        prev.map((e) => (e.id === id ? { ...e, [field]: value } : e)),
      );
      await supabase
        .from("conf_events")
        .update({ [field]: value, priority_set_by: user?.id, priority_set_at: new Date().toISOString() })
        .eq("id", id);
      if (conferenceId) {
        await supabase.from("conf_priority_history").insert({
          conference_id: conferenceId,
          item_type: "event",
          item_id: id,
          field: field === "suspected_priority" ? "suspected" : "confirmed",
          value,
          set_by: user?.id,
        });
      }
    },
    [conferenceId],
  );

  return {
    events,
    loading,
    refresh,
    save,
    remove,
    bulkUpdate,
    bulkRemove,
    bulkAssign,
    bulkUnassign,
    setPriority,
  };
}

export function useEvent(eventId: string) {
  const [event, setEvent] = useState<EventWithPeople | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const [evRes, asRes, shRes] = await Promise.all([
      supabase.from("conf_events").select("*").eq("id", eventId).single(),
      supabase.from("conf_event_assignments").select("*").eq("event_id", eventId),
      supabase.from("conf_event_shifts").select("*").eq("event_id", eventId).order("sort_order"),
    ]);
    if (evRes.data) {
      setEvent({
        ...(evRes.data as ConfEvent),
        assignments: (asRes.data as EventAssignment[]) || [],
        shifts: (shRes.data as EventShift[]) || [],
      });
    } else setEvent(null);
    setLoading(false);
  }, [eventId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const update = useCallback(
    async (partial: Partial<ConfEvent>) => {
      setEvent((prev) => (prev ? { ...prev, ...partial } : prev));
      await supabase.from("conf_events").update(partial).eq("id", eventId);
    },
    [eventId],
  );

  return { event, loading, refresh, update };
}

// ------------------------------------------------------------------
// Session notes (per person per event)
// ------------------------------------------------------------------
export function useSessionNotes(conferenceId: string | null, eventId: string) {
  const [notes, setNotes] = useState<SessionNote[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const { data } = await supabase
      .from("conf_session_notes")
      .select("*")
      .eq("event_id", eventId);
    setNotes((data as SessionNote[]) || []);
    setLoading(false);
  }, [eventId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useRealtime(conferenceId, ["conf_session_notes"], refresh);

  const upsertMine = useCallback(
    async (userId: string, partial: Partial<SessionNote>) => {
      if (!conferenceId) return;
      await supabase.from("conf_session_notes").upsert(
        {
          conference_id: conferenceId,
          event_id: eventId,
          user_id: userId,
          ...partial,
        },
        { onConflict: "event_id,user_id" },
      );
      await refresh();
    },
    [conferenceId, eventId, refresh],
  );

  return { notes, loading, refresh, upsertMine };
}

// ------------------------------------------------------------------
// Contacts
// ------------------------------------------------------------------
export function useContacts(conferenceId: string | null) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!conferenceId) return;
    const { data } = await supabase
      .from("conf_contacts")
      .select("*")
      .eq("conference_id", conferenceId)
      .order("name");
    setContacts((data as Contact[]) || []);
    setLoading(false);
  }, [conferenceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useRealtime(conferenceId, ["conf_contacts"], refresh);

  const add = useCallback(
    async (partial: Partial<Contact>) => {
      if (!conferenceId) return null;
      const { data } = await supabase
        .from("conf_contacts")
        .insert({ ...partial, conference_id: conferenceId })
        .select("*")
        .single();
      if (data) setContacts((prev) => [...prev, data as Contact].sort((a, b) => a.name.localeCompare(b.name)));
      return (data as Contact) || null;
    },
    [conferenceId],
  );

  const update = useCallback(async (id: string, partial: Partial<Contact>) => {
    setContacts((prev) => prev.map((c) => (c.id === id ? { ...c, ...partial } : c)));
    await supabase.from("conf_contacts").update(partial).eq("id", id);
  }, []);

  return { contacts, loading, refresh, add, update };
}

export function useContact(id: string) {
  const [contact, setContact] = useState<Contact | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const { data } = await supabase.from("conf_contacts").select("*").eq("id", id).single();
    setContact((data as Contact) || null);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const update = useCallback(
    async (partial: Partial<Contact>) => {
      setContact((prev) => (prev ? { ...prev, ...partial } : prev));
      await supabase.from("conf_contacts").update(partial).eq("id", id);
    },
    [id],
  );

  return { contact, loading, refresh, update };
}

export function useContactMeetings(conferenceId: string | null, contactId: string) {
  const [meetings, setMeetings] = useState<ContactMeeting[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const { data } = await supabase
      .from("conf_contact_meetings")
      .select("*")
      .eq("contact_id", contactId)
      .order("meeting_date", { ascending: false });
    setMeetings((data as ContactMeeting[]) || []);
    setLoading(false);
  }, [contactId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useRealtime(conferenceId, ["conf_contact_meetings"], refresh);

  const add = useCallback(
    async (partial: Partial<ContactMeeting>) => {
      if (!conferenceId) return null;
      const { data } = await supabase
        .from("conf_contact_meetings")
        .insert({ ...partial, conference_id: conferenceId, contact_id: contactId })
        .select("*")
        .single();
      if (data) setMeetings((prev) => [data as ContactMeeting, ...prev]);
      return (data as ContactMeeting) || null;
    },
    [conferenceId, contactId],
  );

  const update = useCallback(async (id: string, partial: Partial<ContactMeeting>) => {
    setMeetings((prev) => prev.map((m) => (m.id === id ? { ...m, ...partial } : m)));
    await supabase.from("conf_contact_meetings").update(partial).eq("id", id);
  }, []);

  const remove = useCallback(async (id: string) => {
    setMeetings((prev) => prev.filter((m) => m.id !== id));
    await supabase.from("conf_contact_meetings").delete().eq("id", id);
  }, []);

  return { meetings, loading, refresh, add, update, remove };
}

// ------------------------------------------------------------------
// Posters
// ------------------------------------------------------------------
export interface PosterWithReps extends Poster {
  reps: PosterRep[];
}

export function usePosters(conferenceId: string | null) {
  const [posters, setPosters] = useState<PosterWithReps[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!conferenceId) return;
    const [pRes, rRes] = await Promise.all([
      supabase.from("conf_posters").select("*").eq("conference_id", conferenceId).order("created_at"),
      supabase.from("conf_poster_reps").select("*").eq("conference_id", conferenceId),
    ]);
    const reps = (rRes.data as PosterRep[]) || [];
    const byPoster = new Map<string, PosterRep[]>();
    for (const r of reps) byPoster.set(r.poster_id, [...(byPoster.get(r.poster_id) || []), r]);
    setPosters(
      (((pRes.data as Poster[]) || []).map((p) => ({
        ...p,
        reps: byPoster.get(p.id) || [],
      })) as PosterWithReps[]),
    );
    setLoading(false);
  }, [conferenceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useRealtime(conferenceId, ["conf_posters", "conf_poster_reps"], refresh);

  const save = useCallback(
    async (posterId: string | null, partial: Partial<Poster>, repIds?: string[]) => {
      if (!conferenceId) return null;
      let poster: Poster | null = null;
      if (posterId) {
        const { data } = await supabase
          .from("conf_posters")
          .update(partial)
          .eq("id", posterId)
          .select("*")
          .single();
        poster = (data as Poster) || null;
      } else {
        const { data } = await supabase
          .from("conf_posters")
          .insert({ ...partial, conference_id: conferenceId })
          .select("*")
          .single();
        poster = (data as Poster) || null;
      }
      if (!poster) return null;
      if (repIds) {
        await supabase.from("conf_poster_reps").delete().eq("poster_id", poster.id);
        if (repIds.length) {
          await supabase.from("conf_poster_reps").insert(
            repIds.map((attendee_id) => ({
              conference_id: conferenceId,
              poster_id: poster!.id,
              attendee_id,
            })),
          );
        }
      }
      await refresh();
      return poster;
    },
    [conferenceId, refresh],
  );

  const remove = useCallback(async (id: string) => {
    setPosters((prev) => prev.filter((p) => p.id !== id && p.parent_id !== id));
    await supabase.from("conf_posters").delete().eq("id", id);
  }, []);

  return { posters, loading, refresh, save, remove };
}

export function usePosterNotes(conferenceId: string | null, posterId: string) {
  const [notes, setNotes] = useState<PosterNote[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const { data } = await supabase
      .from("conf_poster_notes")
      .select("*")
      .eq("poster_id", posterId);
    setNotes((data as PosterNote[]) || []);
    setLoading(false);
  }, [posterId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useRealtime(conferenceId, ["conf_poster_notes"], refresh);

  const upsertMine = useCallback(
    async (userId: string, partial: Partial<PosterNote>) => {
      if (!conferenceId) return;
      await supabase.from("conf_poster_notes").upsert(
        { conference_id: conferenceId, poster_id: posterId, user_id: userId, ...partial },
        { onConflict: "poster_id,user_id" },
      );
      await refresh();
    },
    [conferenceId, posterId, refresh],
  );

  return { notes, loading, refresh, upsertMine };
}

// ------------------------------------------------------------------
// Insights
// ------------------------------------------------------------------
export function useInsights(conferenceId: string | null) {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!conferenceId) return;
    const { data } = await supabase
      .from("conf_insights")
      .select("*")
      .eq("conference_id", conferenceId)
      .order("created_at", { ascending: false });
    setInsights((data as Insight[]) || []);
    setLoading(false);
  }, [conferenceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useRealtime(conferenceId, ["conf_insights"], refresh);

  const add = useCallback(
    async (partial: Partial<Insight>) => {
      if (!conferenceId) return null;
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { data } = await supabase
        .from("conf_insights")
        .insert({ ...partial, conference_id: conferenceId, user_id: user?.id })
        .select("*")
        .single();
      if (data) setInsights((prev) => [data as Insight, ...prev]);
      return (data as Insight) || null;
    },
    [conferenceId],
  );

  // Insert a parent + its child bullets in one call (AI extraction confirm).
  const addWithChildren = useCallback(
    async (parent: Partial<Insight>, children: Partial<Insight>[]) => {
      const p = await add(parent);
      if (!p) return null;
      if (children.length) {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        await supabase.from("conf_insights").insert(
          children.map((c, i) => ({
            ...c,
            conference_id: conferenceId,
            user_id: user?.id,
            parent_id: p.id,
            sort_order: i,
          })),
        );
        await refresh();
      }
      return p;
    },
    [add, conferenceId, refresh],
  );

  const update = useCallback(async (id: string, partial: Partial<Insight>) => {
    setInsights((prev) => prev.map((x) => (x.id === id ? { ...x, ...partial } : x)));
    await supabase.from("conf_insights").update(partial).eq("id", id);
  }, []);

  const remove = useCallback(async (id: string) => {
    setInsights((prev) => prev.filter((x) => x.id !== id && x.parent_id !== id));
    await supabase.from("conf_insights").delete().eq("id", id);
  }, []);

  const parents = useMemo(() => insights.filter((i) => !i.parent_id), [insights]);
  const childrenOf = useCallback(
    (parentId: string) =>
      insights
        .filter((i) => i.parent_id === parentId)
        .sort((a, b) => a.sort_order - b.sort_order),
    [insights],
  );

  return { insights, parents, childrenOf, loading, refresh, add, addWithChildren, update, remove };
}

// Categories taxonomy — seeds the defaults on first load of a conference.
export function useCategories(conferenceId: string | null) {
  const [categories, setCategories] = useState<Category[]>([]);
  const seeded = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    if (!conferenceId) return;
    const { data } = await supabase
      .from("conf_categories")
      .select("*")
      .eq("conference_id", conferenceId)
      .order("sort_order");
    let rows = (data as Category[]) || [];
    if (rows.length === 0 && seeded.current !== conferenceId) {
      seeded.current = conferenceId;
      await supabase.from("conf_categories").insert(
        DEFAULT_CATEGORIES.map((c, i) => ({
          conference_id: conferenceId,
          name: c.name,
          color: c.color,
          sort_order: c.name === "Other" ? 999 : i,
        })),
      );
      const again = await supabase
        .from("conf_categories")
        .select("*")
        .eq("conference_id", conferenceId)
        .order("sort_order");
      rows = (again.data as Category[]) || [];
    }
    setCategories(rows);
  }, [conferenceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { categories, refresh };
}

export function useDailyRow<T extends { date: string }>(
  table: "conf_daily_summaries" | "conf_booth_logs",
  conferenceId: string | null,
  date: string,
) {
  const [row, setRow] = useState<T | null>(null);

  const refresh = useCallback(async () => {
    if (!conferenceId || !date) return;
    const { data } = await supabase
      .from(table)
      .select("*")
      .eq("conference_id", conferenceId)
      .eq("date", date)
      .maybeSingle();
    setRow((data as T) || null);
  }, [table, conferenceId, date]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const upsert = useCallback(
    async (partial: Record<string, unknown>) => {
      if (!conferenceId || !date) return;
      const { data } = await supabase
        .from(table)
        .upsert(
          { conference_id: conferenceId, date, ...partial },
          { onConflict: "conference_id,date" },
        )
        .select("*")
        .single();
      if (data) setRow(data as T);
    },
    [table, conferenceId, date],
  );

  return { row, refresh, upsert };
}

export type { DailySummary, BoothLog };

// ------------------------------------------------------------------
// Food
// ------------------------------------------------------------------
export function useFood(conferenceId: string | null) {
  const [orders, setOrders] = useState<FoodOrder[]>([]);
  const [items, setItems] = useState<FoodItem[]>([]);
  const [assignments, setAssignments] = useState<FoodAssignment[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!conferenceId) return;
    const [oRes, iRes, aRes] = await Promise.all([
      supabase.from("conf_food_orders").select("*").eq("conference_id", conferenceId).order("created_at"),
      supabase.from("conf_food_items").select("*").eq("conference_id", conferenceId),
      supabase.from("conf_food_assignments").select("*").eq("conference_id", conferenceId),
    ]);
    setOrders((oRes.data as FoodOrder[]) || []);
    setItems((iRes.data as FoodItem[]) || []);
    setAssignments((aRes.data as FoodAssignment[]) || []);
    setLoading(false);
  }, [conferenceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useRealtime(
    conferenceId,
    ["conf_food_orders", "conf_food_items", "conf_food_assignments"],
    refresh,
  );

  const addOrder = useCallback(
    async (partial: Partial<FoodOrder>) => {
      if (!conferenceId) return null;
      const { data } = await supabase
        .from("conf_food_orders")
        .insert({ ...partial, conference_id: conferenceId })
        .select("*")
        .single();
      if (data) setOrders((prev) => [...prev, data as FoodOrder]);
      // Fire-and-forget team notification (never blocks the action).
      fetch("/api/conference/announce", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          conferenceId,
          silent: true,
          title: "Food order started",
          message: `${(data as FoodOrder)?.restaurant || "A food order"} is open — add your item!`,
          link: `/conference-planning/${conferenceId}/food/${(data as FoodOrder)?.id}`,
        }),
      }).catch(() => {});
      return (data as FoodOrder) || null;
    },
    [conferenceId],
  );

  const updateOrder = useCallback(async (id: string, partial: Partial<FoodOrder>) => {
    setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, ...partial } : o)));
    await supabase.from("conf_food_orders").update(partial).eq("id", id);
  }, []);

  const removeOrder = useCallback(async (id: string) => {
    setOrders((prev) => prev.filter((o) => o.id !== id));
    await supabase.from("conf_food_orders").delete().eq("id", id);
  }, []);

  const upsertAssignment = useCallback(
    async (date: string, attendee_ids: string[], skipped: boolean) => {
      if (!conferenceId) return;
      await supabase.from("conf_food_assignments").upsert(
        { conference_id: conferenceId, date, attendee_ids, skipped },
        { onConflict: "conference_id,date" },
      );
      await refresh();
    },
    [conferenceId, refresh],
  );

  return {
    orders,
    items,
    assignments,
    loading,
    refresh,
    addOrder,
    updateOrder,
    removeOrder,
    upsertAssignment,
  };
}

export function useFoodOrder(conferenceId: string | null, orderId: string) {
  const [order, setOrder] = useState<FoodOrder | null>(null);
  const [items, setItems] = useState<FoodItem[]>([]);
  const [messages, setMessages] = useState<FoodMessage[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const [oRes, iRes, mRes] = await Promise.all([
      supabase.from("conf_food_orders").select("*").eq("id", orderId).single(),
      supabase.from("conf_food_items").select("*").eq("order_id", orderId).order("created_at"),
      supabase.from("conf_food_messages").select("*").eq("order_id", orderId).order("created_at"),
    ]);
    setOrder((oRes.data as FoodOrder) || null);
    setItems((iRes.data as FoodItem[]) || []);
    setMessages((mRes.data as FoodMessage[]) || []);
    setLoading(false);
  }, [orderId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useRealtime(
    conferenceId,
    ["conf_food_orders", "conf_food_items", "conf_food_messages"],
    refresh,
  );

  const updateOrder = useCallback(
    async (partial: Partial<FoodOrder>) => {
      setOrder((prev) => (prev ? { ...prev, ...partial } : prev));
      await supabase.from("conf_food_orders").update(partial).eq("id", orderId);
    },
    [orderId],
  );

  const addItem = useCallback(
    async (partial: Partial<FoodItem>) => {
      if (!conferenceId) return;
      const { data } = await supabase
        .from("conf_food_items")
        .insert({ ...partial, conference_id: conferenceId, order_id: orderId })
        .select("*")
        .single();
      if (data) setItems((prev) => [...prev, data as FoodItem]);
    },
    [conferenceId, orderId],
  );

  const removeItem = useCallback(async (id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
    await supabase.from("conf_food_items").delete().eq("id", id);
  }, []);

  const sendMessage = useCallback(
    async (message: string, recipientId: string | null) => {
      if (!conferenceId) return;
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { data } = await supabase
        .from("conf_food_messages")
        .insert({
          conference_id: conferenceId,
          order_id: orderId,
          sender_id: user?.id,
          recipient_id: recipientId,
          message,
        })
        .select("*")
        .single();
      if (data) setMessages((prev) => [...prev, data as FoodMessage]);
    },
    [conferenceId, orderId],
  );

  return { order, items, messages, loading, refresh, updateOrder, addItem, removeItem, sendMessage };
}

// ------------------------------------------------------------------
// Recordings (session lectures / KOL meetings → transcript → summary)
// ------------------------------------------------------------------
export interface ConfRecording {
  id: string;
  conference_id: string;
  event_id: string | null;
  contact_id: string | null;
  user_id: string | null;
  title: string;
  status: "recording" | "transcribing" | "summarizing" | "complete" | "error";
  transcript: string;
  summary: string;
  error: string;
  created_at: string;
  updated_at: string;
}

export function useRecordings(
  conferenceId: string | null,
  filter: { eventId?: string; contactId?: string },
) {
  const [recordings, setRecordings] = useState<ConfRecording[]>([]);
  const { eventId, contactId } = filter;

  const refresh = useCallback(async () => {
    if (!conferenceId) return;
    let q = supabase
      .from("conf_recordings")
      .select("*")
      .eq("conference_id", conferenceId)
      .order("created_at", { ascending: false });
    if (eventId) q = q.eq("event_id", eventId);
    if (contactId) q = q.eq("contact_id", contactId);
    const { data } = await q;
    setRecordings((data as ConfRecording[]) || []);
  }, [conferenceId, eventId, contactId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useRealtime(conferenceId, ["conf_recordings"], refresh);

  const add = useCallback(
    async (partial: Partial<ConfRecording>) => {
      if (!conferenceId) return null;
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { data } = await supabase
        .from("conf_recordings")
        .insert({
          ...partial,
          conference_id: conferenceId,
          event_id: eventId || null,
          contact_id: contactId || null,
          user_id: user?.id,
        })
        .select("*")
        .single();
      if (data) setRecordings((prev) => [data as ConfRecording, ...prev]);
      return (data as ConfRecording) || null;
    },
    [conferenceId, eventId, contactId],
  );

  const update = useCallback(async (id: string, partial: Partial<ConfRecording>) => {
    setRecordings((prev) => prev.map((r) => (r.id === id ? { ...r, ...partial } : r)));
    await supabase.from("conf_recordings").update(partial).eq("id", id);
  }, []);

  const remove = useCallback(async (id: string) => {
    setRecordings((prev) => prev.filter((r) => r.id !== id));
    await supabase.from("conf_recordings").delete().eq("id", id);
  }, []);

  return { recordings, refresh, add, update, remove };
}

// ------------------------------------------------------------------
// Presence: who else is viewing this surface right now.
// ------------------------------------------------------------------
export function usePresence(
  channelKey: string | null,
  me: { id: string; name: string } | null,
) {
  const [viewers, setViewers] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    // Only announce once the full identity is known.
    if (!channelKey || !me) return;
    const channel = supabase.channel(`presence-${channelKey}`, {
      config: { presence: { key: me.id } },
    });
    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<{ id: string; name: string }>();
        const others: { id: string; name: string }[] = [];
        for (const key of Object.keys(state)) {
          if (key === me.id) continue;
          const first = state[key][0];
          if (first) others.push({ id: first.id, name: first.name });
        }
        setViewers(others);
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({ id: me.id, name: me.name });
        }
      });
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [channelKey, me]);

  return viewers;
}

// ------------------------------------------------------------------
// Venue pins
// ------------------------------------------------------------------
export function usePins(conferenceId: string | null) {
  const [pins, setPins] = useState<VenuePin[]>([]);

  const refresh = useCallback(async () => {
    if (!conferenceId) return;
    const { data } = await supabase
      .from("conf_venue_pins")
      .select("*")
      .eq("conference_id", conferenceId)
      .eq("active", true);
    setPins((data as VenuePin[]) || []);
  }, [conferenceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useRealtime(conferenceId, ["conf_venue_pins"], refresh);

  const add = useCallback(
    async (partial: Partial<VenuePin>) => {
      if (!conferenceId) return;
      const { data } = await supabase
        .from("conf_venue_pins")
        .insert({ ...partial, conference_id: conferenceId })
        .select("*")
        .single();
      if (data) setPins((prev) => [...prev, data as VenuePin]);
    },
    [conferenceId],
  );

  const update = useCallback(async (id: string, partial: Partial<VenuePin>) => {
    setPins((prev) => prev.map((p) => (p.id === id ? { ...p, ...partial } : p)));
    await supabase.from("conf_venue_pins").update(partial).eq("id", id);
  }, []);

  const remove = useCallback(async (id: string) => {
    setPins((prev) => prev.filter((p) => p.id !== id));
    await supabase.from("conf_venue_pins").update({ active: false }).eq("id", id);
  }, []);

  return { pins, refresh, add, update, remove };
}

// ------------------------------------------------------------------
// Announcements
// ------------------------------------------------------------------
export function useAnnouncements(conferenceId: string | null) {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);

  const refresh = useCallback(async () => {
    if (!conferenceId) return;
    const { data } = await supabase
      .from("conf_announcements")
      .select("*")
      .eq("conference_id", conferenceId)
      .order("created_at", { ascending: false })
      .limit(10);
    setAnnouncements((data as Announcement[]) || []);
  }, [conferenceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useRealtime(conferenceId, ["conf_announcements"], refresh);

  return { announcements, refresh };
}

// ------------------------------------------------------------------
// Storage helper: upload a file to the public "conference" bucket.
// ------------------------------------------------------------------
export async function uploadConferenceFile(
  conferenceId: string,
  folder: string,
  file: File,
): Promise<string | null> {
  const ext = file.name.split(".").pop() || "bin";
  const path = `${conferenceId}/${folder}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from("conference").upload(path, file, {
    cacheControl: "3600",
    upsert: false,
  });
  if (error) return null;
  const { data } = supabase.storage.from("conference").getPublicUrl(path);
  return data.publicUrl || null;
}
