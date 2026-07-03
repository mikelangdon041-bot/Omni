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
      {/* Header banner */}
      <div className="omni-hero relative mb-4 overflow-hidden rounded-2xl px-5 py-4 text-white shadow-sm sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <Link href={base} className="block">
              <h1 className="flex items-center gap-2 truncate text-lg font-bold tracking-tight sm:text-xl">
                {conference.name}
                {status === "live" ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/25 px-2 py-0.5 text-[11px] font-bold text-emerald-100">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-300" />
                    LIVE
                  </span>
                ) : status === "upcoming" ? (
                  <span className="rounded-full bg-white/20 px-2 py-0.5 text-[11px] font-semibold">
                    {daysAway(conference)}d away
                  </span>
                ) : null}
              </h1>
            </Link>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-white/80">
              <span className="inline-flex items-center gap-1">
                <CalendarDays size={12} /> {fmtDateRange(conference)}
              </span>
              {conference.location && (
                <span className="inline-flex items-center gap-1">
                  <MapPin size={12} /> {conference.location}
                </span>
              )}
              <span className="text-white/60">{conference.timezone.replace(/_/g, " ")}</span>
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setShowAnnounce(true)}
              className="rounded-lg bg-white/15 p-2 backdrop-blur-sm transition hover:bg-white/25"
              title="Announce to the team"
            >
              <Megaphone size={16} />
            </button>
            <Link
              href="/conference-planning"
              className="inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-2.5 py-2 text-xs font-medium backdrop-blur-sm transition hover:bg-white/25"
              title="Switch conference"
            >
              <ArrowLeftRight size={14} />
              <span className="hidden sm:inline">Switch</span>
            </Link>
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div className="mb-6 flex gap-1 overflow-x-auto border-b border-border pb-px">
        {TABS.map((t) => {
          const href = t.seg ? `${base}/${t.seg}` : base;
          const active = activeSeg === t.seg;
          return (
            <Link
              key={t.seg}
              href={href}
              className={cn(
                "-mb-px inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition",
                active
                  ? "border-[var(--accent)] text-[var(--accent)]"
                  : "border-transparent text-muted hover:text-ink",
              )}
            >
              <t.icon size={15} />
              {t.label}
              {t.seg === "food" && foodUnread > 0 && (
                <span className="grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white">
                  {foodUnread > 99 ? "99+" : foodUnread}
                </span>
              )}
            </Link>
          );
        })}
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
