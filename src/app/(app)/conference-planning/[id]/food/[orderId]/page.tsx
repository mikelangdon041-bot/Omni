"use client";

// Food order detail (spec §11.4–11.5): links, live deadline countdown, status
// control, per-person items, "who's ordered" readiness, and the order chat
// (broadcast + DMs visible only to sender/recipient).

import { use, useEffect, useMemo, useState } from "react";
import { Loading } from "@/components/conference/Bits";
import Link from "next/link";
import {
  ExternalLink,
  Lock,
  LockOpen,
  Plus,
  Send,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Input";
import { cn } from "@/lib/ui";
import { useConferenceCtx } from "@/components/conference/ConferenceContext";
import { useFoodOrder } from "@/lib/conference/hooks";
import {
  FOOD_STATUSES,
  MEALS,
  type FoodStatus,
} from "@/lib/conference/types";
import { fmtDayKeyLong, fmtTime, initials } from "@/lib/conference/utils";
import { Avatar } from "@/components/ui/Avatar";

export default function FoodOrderPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = use(params);
  const { conference, attendees, myAttendee, me } = useConferenceCtx();
  const { order, items, messages, loading, updateOrder, addItem, removeItem, sendMessage } =
    useFoodOrder(conference.id, orderId);

  const [itemName, setItemName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [itemFor, setItemFor] = useState("");
  const [message, setMessage] = useState("");
  const [dmTo, setDmTo] = useState("");
  const [now, setNow] = useState(() => Date.now());

  // Live countdown tick.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // Default the item to yourself once the roster links up.
  const effectiveItemFor = itemFor || myAttendee?.id || "";

  const byPerson = useMemo(() => {
    const map = new Map<string, typeof items>();
    for (const i of items) {
      const key = i.attendee_id || "unknown";
      map.set(key, [...(map.get(key) || []), i]);
    }
    return map;
  }, [items]);

  // DMs are only visible to sender + recipient.
  const visibleMessages = useMemo(
    () =>
      messages.filter(
        (m) =>
          !m.recipient_id || m.recipient_id === me?.id || m.sender_id === me?.id,
      ),
    [messages, me],
  );

  const nameForUser = (userId: string | null) =>
    attendees.find((a) => a.user_id === userId)?.name || "Someone";
  const nameForAttendee = (id: string | null) =>
    attendees.find((a) => a.id === id)?.name || "Unknown";

  if (loading) return <Loading />;
  if (!order) {
    return (
      <p className="py-12 text-center text-sm text-muted">
        Order not found.{" "}
        <Link
          href={`/conference-planning/${conference.id}/food`}
          className="text-[var(--accent)] hover:underline"
        >
          Back to food
        </Link>
      </p>
    );
  }

  const meal = MEALS[order.meal];
  const st = FOOD_STATUSES[order.status];
  const locked = order.status !== "open";
  const deadlineMin = order.deadline
    ? Math.round((new Date(order.deadline).getTime() - now) / 60000)
    : null;

  async function submitItem() {
    if (!itemName.trim() || !effectiveItemFor) return;
    await addItem({
      attendee_id: effectiveItemFor,
      item: itemName.trim(),
      instructions: instructions.trim(),
    });
    setItemName("");
    setInstructions("");
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      {/* Header */}
      <div className="rounded-xl border border-border bg-surface p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <span
              className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold text-white"
              style={{ background: meal.color }}
            >
              {meal.emoji} {meal.label}
            </span>
            <h1 className="mt-2 text-xl font-bold tracking-tight">
              {order.restaurant || "Group order"}
            </h1>
            <p className="mt-0.5 text-sm text-muted">
              {fmtDayKeyLong(order.order_date)}
              {order.orderer_attendee_id &&
                ` · ordered by ${nameForAttendee(order.orderer_attendee_id)}`}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <Select
              value={order.status}
              onChange={(e) => updateOrder({ status: e.target.value as FoodStatus })}
              className="!w-auto !py-1.5 text-xs font-semibold"
            >
              {(Object.keys(FOOD_STATUSES) as FoodStatus[]).map((s) => (
                <option key={s} value={s}>
                  {FOOD_STATUSES[s].label}
                </option>
              ))}
            </Select>
            <span
              className="inline-flex items-center gap-1 text-xs font-medium"
              style={{ color: st.color }}
            >
              {locked ? <Lock size={12} /> : <LockOpen size={12} />}
              {locked ? "Locked" : "Accepting items"}
            </span>
          </div>
        </div>

        {order.deadline && (
          <p
            className={cn(
              "mt-3 rounded-lg px-3 py-2 text-sm font-semibold",
              deadlineMin === null || deadlineMin <= 0 || order.status !== "open"
                ? "bg-red-50 text-red-600"
                : deadlineMin > 60
                  ? "bg-emerald-50 text-emerald-700"
                  : deadlineMin > 15
                    ? "bg-amber-50 text-amber-700"
                    : "bg-red-50 text-red-600",
            )}
          >
            {order.status !== "open" || (deadlineMin !== null && deadlineMin <= 0)
              ? `Deadline was ${fmtTime(order.deadline, conference.timezone)}`
              : `Order by ${fmtTime(order.deadline, conference.timezone)} — ${
                  deadlineMin! >= 60
                    ? `${Math.floor(deadlineMin! / 60)}h ${deadlineMin! % 60}m`
                    : `${deadlineMin}m`
                } left`}
          </p>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          {order.menu_url && (
            <a
              href={order.menu_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-canvas"
            >
              <ExternalLink size={13} /> Menu
            </a>
          )}
          {order.group_order_url && (
            <a
              href={order.group_order_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white transition hover:bg-[var(--accent-hover)]"
            >
              <ExternalLink size={13} /> Join group order
            </a>
          )}
        </div>
        {order.notes && <p className="mt-3 text-sm text-muted">{order.notes}</p>}
      </div>

      {/* Who's in */}
      <div className="rounded-xl border border-border bg-surface p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
          Who&apos;s ordered
        </h2>
        <div className="flex flex-wrap gap-1.5">
          {attendees.map((a) => {
            const has = items.some((i) => i.attendee_id === a.id);
            return (
              <span
                key={a.id}
                className={cn(
                  "rounded-full px-2.5 py-1 text-xs font-medium",
                  has
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-canvas text-muted",
                )}
              >
                {has ? "✓ " : ""}
                {a.name.split(" ")[0]}
              </span>
            );
          })}
        </div>
      </div>

      {/* Items */}
      <div className="rounded-xl border border-border bg-surface p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
          Items ({items.length})
        </h2>
        {[...byPerson.entries()].map(([attId, list]) => (
          <div key={attId} className="mb-3">
            <p className="mb-1 text-xs font-semibold">{nameForAttendee(attId === "unknown" ? null : attId)}</p>
            <ul className="space-y-1">
              {list.map((i) => (
                <li
                  key={i.id}
                  className="flex items-center gap-2 rounded-lg bg-canvas px-3 py-2 text-sm"
                >
                  <span className="min-w-0 flex-1">
                    {i.item}
                    {i.instructions && (
                      <span className="text-muted"> — {i.instructions}</span>
                    )}
                  </span>
                  {!locked && (
                    <button
                      onClick={() => removeItem(i.id)}
                      className="rounded p-0.5 text-muted hover:text-red-600"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}

        {!locked && (
          <div className="mt-4 space-y-2 border-t border-border pt-4">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Input
                label="Item"
                value={itemName}
                onChange={(e) => setItemName(e.target.value)}
                placeholder="e.g. Turkey club, no mayo"
              />
              <Select
                label="For"
                value={effectiveItemFor}
                onChange={(e) => setItemFor(e.target.value)}
              >
                {attendees.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </div>
            <Input
              label="Special instructions"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
            />
            <div className="flex justify-end">
              <Button size="sm" onClick={submitItem} disabled={!itemName.trim() || !effectiveItemFor}>
                <Plus size={14} /> Add item
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Chat */}
      <div className="rounded-xl border border-border bg-surface p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">
          Order chat
        </h2>
        <div className="max-h-72 space-y-2 overflow-y-auto">
          {visibleMessages.map((m) => {
            const mine = m.sender_id === me?.id;
            return (
              <div key={m.id} className={cn("flex gap-2", mine && "flex-row-reverse")}>
                <Avatar initials={initials(nameForUser(m.sender_id))} size={28} />
                <div
                  className={cn(
                    "max-w-[75%] rounded-xl px-3 py-2 text-sm",
                    mine ? "bg-[var(--accent)] text-white" : "bg-canvas",
                  )}
                >
                  {m.recipient_id && (
                    <p className={cn("text-[10px] font-bold", mine ? "text-white/75" : "text-muted")}>
                      DM {mine ? `to ${nameForUser(m.recipient_id)}` : "to you"}
                    </p>
                  )}
                  <p>{m.message}</p>
                  <p className={cn("mt-0.5 text-[10px]", mine ? "text-white/60" : "text-muted")}>
                    {nameForUser(m.sender_id).split(" ")[0]} ·{" "}
                    {new Date(m.created_at).toLocaleTimeString(undefined, {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
              </div>
            );
          })}
          {visibleMessages.length === 0 && (
            <p className="py-4 text-center text-sm text-muted">No messages yet.</p>
          )}
        </div>
        <div className="mt-3 flex gap-2">
          <select
            value={dmTo}
            onChange={(e) => setDmTo(e.target.value)}
            className="rounded-lg border border-border bg-surface px-2 py-2 text-xs outline-none focus:border-[var(--accent)]"
            title="Send to"
          >
            <option value="">Everyone</option>
            {attendees
              .filter((a) => a.user_id && a.user_id !== me?.id)
              .map((a) => (
                <option key={a.id} value={a.user_id!}>
                  DM {a.name.split(" ")[0]}
                </option>
              ))}
          </select>
          <input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={async (e) => {
              if (e.key === "Enter" && message.trim()) {
                await sendMessage(message.trim(), dmTo || null);
                setMessage("");
              }
            }}
            placeholder="Message the group…"
            className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
          />
          <Button
            size="sm"
            onClick={async () => {
              if (message.trim()) {
                await sendMessage(message.trim(), dmTo || null);
                setMessage("");
              }
            }}
            disabled={!message.trim()}
          >
            <Send size={14} />
          </Button>
        </div>
      </div>
    </div>
  );
}
