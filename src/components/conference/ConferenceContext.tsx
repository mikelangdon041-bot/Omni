"use client";

// Per-conference shell: loads the conference + roster + identity once,
// provides them via context, and renders the sticky header (name, LIVE badge,
// dates, announce) plus the tab bar shared by every conference page.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  ClipboardList,
  Landmark,
  Map as MapIcon,
  MapPin,
  Megaphone,
  Mic2,
  NotebookPen,
  Sparkles,
  Users,
  UtensilsCrossed,
} from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";
import { cn } from "@/lib/ui";
import {
  useAttendees,
  useConference,
  useEnsureAttendee,
  useMe,
  useRealtime,
  type Me,
} from "@/lib/conference/hooks";
import type { Attendee, Conference } from "@/lib/conference/types";
import { conferenceStatus, daysAway, fmtDateRange } from "@/lib/conference/utils";
import { setConfHeader } from "@/lib/conference/headerStore";

interface ConferenceCtx {
  conference: Conference;
  updateConference: (partial: Partial<Conference>) => Promise<void>;
  attendees: Attendee[];
  attendeesLoading: boolean;
  refreshAttendees: () => void;
  addAttendee: (partial: Partial<Attendee>) => Promise<Attendee | null>;
  updateAttendee: (id: string, partial: Partial<Attendee>) => Promise<void>;
  removeAttendee: (id: string) => Promise<void>;
  me: Me | null;
  myAttendee: Attendee | null;
  canManage: boolean;
}

const Ctx = createContext<ConferenceCtx | null>(null);

export function useConferenceCtx(): ConferenceCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useConferenceCtx outside ConferenceProvider");
  return ctx;
}

// No Overview tab — tapping the conference name in the header opens it.
const TABS = [
  { seg: "team", label: "Team", icon: Users },
  { seg: "schedule", label: "Schedule", icon: CalendarDays },
  { seg: "sessions", label: "Sessions", icon: Mic2 },
  { seg: "contacts", label: "KOLs", icon: Landmark },
  { seg: "posters", label: "Posters", icon: ClipboardList },
  { seg: "insights", label: "Insights", icon: Sparkles },
  { seg: "food", label: "Food", icon: UtensilsCrossed },
  { seg: "map", label: "Map", icon: MapIcon },
  { seg: "recap", label: "Recap", icon: NotebookPen },
];

export function ConferenceProvider({
  conferenceId,
  children,
}: {
  conferenceId: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { conference, loading, update } = useConference(conferenceId);
  const { me } = useMe();
  const {
    attendees,
    loading: attendeesLoading,
    refresh: refreshAttendees,
    add: addAttendee,
    update: updateAttendee,
    remove: removeAttendee,
  } = useAttendees(conferenceId);
  const { claimable, claim } = useEnsureAttendee(
    conference,
    me,
    attendees,
    attendeesLoading,
    refreshAttendees,
  );

  const [showAnnounce, setShowAnnounce] = useState(false);

  // Food-tab unread badge: count messages since this device last opened Food.
  const [foodUnread, setFoodUnread] = useState(0);
  const seenKey = `omni_conf_food_seen_${conferenceId}`;
  const onFoodTab = pathname.includes(`/${conferenceId}/food`);
  const recountFood = useCallback(async () => {
    if (!me) return;
    const since =
      localStorage.getItem(seenKey) || new Date(Date.now() - 86400000).toISOString();
    const { data } = await createClient()
      .from("conf_food_messages")
      .select("sender_id, recipient_id")
      .eq("conference_id", conferenceId)
      .gt("created_at", since)
      .limit(150);
    const count = (data || []).filter(
      (m) =>
        m.sender_id !== me.id &&
        (!m.recipient_id || m.recipient_id === me.id),
    ).length;
    setFoodUnread(count);
  }, [conferenceId, me, seenKey]);
  useEffect(() => {
    if (onFoodTab) {
      localStorage.setItem(seenKey, new Date().toISOString());
      setFoodUnread(0);
    } else {
      void recountFood();
    }
  }, [onFoodTab, seenKey, recountFood]);
  useRealtime(conferenceId, ["conf_food_messages"], () => {
    if (onFoodTab) localStorage.setItem(seenKey, new Date().toISOString());
    else void recountFood();
  });

  // Publish the conference identity to the global AppHeader (it renders the
  // name + status badge in the top bar, so this shell needs no name row).
  useEffect(() => {
    if (!conference) return;
    setConfHeader({
      id: conference.id,
      name: conference.name,
      status: conferenceStatus(conference),
      daysAway: daysAway(conference),
      announce: () => setShowAnnounce(true),
    });
    return () => setConfHeader(null);
  }, [conference]);

  const myAttendee = useMemo(
    () => attendees.find((a) => a.user_id === me?.id) || null,
    [attendees, me],
  );
  const canManage = !!(me?.isOrgAdmin || myAttendee?.is_lead);

  const value = useMemo<ConferenceCtx | null>(
    () =>
      conference
        ? {
            conference,
            updateConference: update,
            attendees,
            attendeesLoading,
            refreshAttendees,
            addAttendee,
            updateAttendee,
            removeAttendee,
            me,
            myAttendee,
            canManage,
          }
        : null,
    [
      conference, update, attendees, attendeesLoading, refreshAttendees,
      addAttendee, updateAttendee, removeAttendee, me, myAttendee, canManage,
    ],
  );

  if (loading) {
    return <p className="py-16 text-center text-sm text-muted">Loading conference…</p>;
  }
  if (!conference || !value) {
    return (
      <div className="py-16 text-center">
        <p className="text-sm text-muted">Conference not found.</p>
        <Link
          href="/conference-planning"
          className="mt-2 inline-block text-sm font-medium text-[var(--accent)] hover:underline"
        >
          ← Back to conferences
        </Link>
      </div>
    );
  }

  const base = `/conference-planning/${conference.id}`;
  const activeSeg = (() => {
    const rest = pathname.slice(base.length).replace(/^\//, "");
    return rest.split("/")[0] || "";
  })();

  return (
    <Ctx.Provider value={value}>
      {/* Single-row conference strip: tabs + meta + actions, full-bleed and
          flush under the app bar (the conference NAME lives in the app bar
          itself via the header store — one merged piece of chrome). */}
      <div className="-mx-3 -mt-5 mb-5 flex items-center gap-1 border-b border-border bg-surface px-3 sm:-mx-8 sm:-mt-8 sm:px-8">
        <div className="flex min-w-0 flex-1 pb-px pt-0.5 md:gap-1">
        {TABS.map((t) => {
          const href = t.seg ? `${base}/${t.seg}` : base;
          const active = activeSeg === t.seg;
          return (
            <Link
              key={t.seg}
              href={href}
              title={t.label}
              className={cn(
                "-mb-px relative inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap border-b-2 px-1 py-2.5 text-sm font-medium transition md:flex-none md:justify-start md:px-3",
                active
                  ? "border-[var(--accent)] text-[var(--accent)]"
                  : "border-transparent text-muted hover:text-ink",
              )}
            >
              <t.icon size={17} className="md:hidden" />
              <t.icon size={15} className="hidden md:block" />
              <span className="hidden md:inline">{t.label}</span>
              {t.seg === "food" && foodUnread > 0 && (
                <span className="absolute -top-0.5 right-0 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white md:static">
                  {foodUnread > 99 ? "99+" : foodUnread}
                </span>
              )}
            </Link>
          );
        })}
        </div>
        <span className="hidden shrink-0 items-center gap-x-3 pl-2 text-xs text-muted lg:flex">
          <span className="inline-flex items-center gap-1">
            <CalendarDays size={12} /> {fmtDateRange(conference)}
          </span>
          {conference.location && (
            <span className="inline-flex items-center gap-1">
              <MapPin size={12} /> {conference.location}
            </span>
          )}
        </span>
      </div>

      {children}

      <AnnounceModal
        open={showAnnounce}
        onClose={() => setShowAnnounce(false)}
        conferenceId={conference.id}
      />

      {/* Roster has placeholder people (e.g. from a schedule import) and this
          user isn't linked yet — let them claim their spot. */}
      <Modal
        open={claimable.length > 0}
        onClose={() => void claim(null)}
        title="Are you on this roster?"
        size="sm"
      >
        <div className="space-y-3">
          <p className="text-sm text-muted">
            This conference&apos;s team list has people who haven&apos;t joined
            the app yet. If one of them is you, pick your name — your
            assignments and shifts come with it.
          </p>
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {claimable.map((a) => (
              <button
                key={a.id}
                onClick={() => void claim(a.id)}
                className="flex w-full items-center gap-2.5 rounded-lg border border-border bg-surface px-3 py-2.5 text-left text-sm font-medium transition hover:border-[var(--accent)] hover:bg-canvas"
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: a.color || "var(--accent)" }}
                />
                {a.name}
                {a.role && <span className="text-xs font-normal text-muted">· {a.role}</span>}
              </button>
            ))}
          </div>
          <Button variant="secondary" onClick={() => void claim(null)} className="w-full">
            I&apos;m not on this list — add me as new
          </Button>
        </div>
      </Modal>
    </Ctx.Provider>
  );
}

function AnnounceModal({
  open,
  onClose,
  conferenceId,
}: {
  open: boolean;
  onClose: () => void;
  conferenceId: string;
}) {
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<number | null>(null);

  async function send() {
    if (!message.trim()) return;
    setSending(true);
    try {
      const res = await fetch("/api/conference/announce", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ conferenceId, message: message.trim() }),
      });
      const json = await res.json().catch(() => ({}));
      setResult(typeof json.reached === "number" ? json.reached : 0);
      setMessage("");
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        setResult(null);
        onClose();
      }}
      title="Announce to the team"
      size="sm"
    >
      <div className="space-y-3">
        <Textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Broadcast a message to everyone on this conference…"
          autoFocus
        />
        {result !== null && (
          <p className="text-sm text-emerald-600">
            Sent — reached {result} {result === 1 ? "person" : "people"}.
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              setResult(null);
              onClose();
            }}
          >
            Close
          </Button>
          <Button onClick={send} disabled={sending || !message.trim()}>
            <Megaphone size={15} /> {sending ? "Sending…" : "Send"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
