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
  ArrowLeftRight,
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
  useEnsureAttendee(conference, me, attendees, attendeesLoading, refreshAttendees);

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
  const status = conferenceStatus(conference);

  return (
    <Ctx.Provider value={value}>
      {/* Compact conference strip — full-bleed and flush under the app top
          bar so the two read as one piece of chrome (no floating banner). */}
      <div className="-mx-3 -mt-5 mb-5 border-b border-border bg-surface px-3 sm:-mx-8 sm:-mt-8 sm:px-8">
        <div className="flex items-center gap-2 pt-2.5">
          <Link href={base} className="flex min-w-0 items-center gap-2" title="Conference overview">
            <span className="truncate text-[15px] font-bold tracking-tight">
              {conference.name}
            </span>
            {status === "live" ? (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                LIVE
              </span>
            ) : status === "upcoming" ? (
              <span className="shrink-0 rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[10px] font-semibold text-[var(--accent)]">
                {daysAway(conference)}d away
              </span>
            ) : null}
          </Link>
          <span className="hidden min-w-0 flex-wrap items-center gap-x-3 text-xs text-muted sm:flex">
            <span className="inline-flex items-center gap-1">
              <CalendarDays size={12} /> {fmtDateRange(conference)}
            </span>
            {conference.location && (
              <span className="inline-flex items-center gap-1">
                <MapPin size={12} /> {conference.location}
              </span>
            )}
          </span>
          <span className="flex-1" />
          <button
            onClick={() => setShowAnnounce(true)}
            className="rounded-lg p-2 text-muted transition hover:bg-canvas hover:text-ink"
            title="Announce to the team"
          >
            <Megaphone size={16} />
          </button>
          <Link
            href="/conference-planning"
            className="rounded-lg p-2 text-muted transition hover:bg-canvas hover:text-ink"
            title="Switch conference"
          >
            <ArrowLeftRight size={16} />
          </Link>
        </div>

        {/* Tab bar — icons-only on phones (all tabs fit, no scrolling);
            icon + label from md up. */}
        <div className="flex pb-px pt-0.5 md:gap-1">
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
      </div>

      {children}

      <AnnounceModal
        open={showAnnounce}
        onClose={() => setShowAnnounce(false)}
        conferenceId={conference.id}
      />
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
