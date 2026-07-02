"use client";

// Food coordination (spec §11): day selector across the conference, orders
// grouped by meal, per-day coordinator assignment (managers) with an explicit
// "skip" state, and a two-step create-order flow.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Plus, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input, Select } from "@/components/ui/Input";
import { EmptyState } from "@/components/ui/EmptyState";
import { cn } from "@/lib/ui";
import { useConferenceCtx } from "@/components/conference/ConferenceContext";
import { useFood } from "@/lib/conference/hooks";
import {
  FOOD_STATUSES,
  MEALS,
  type FoodOrder,
  type Meal,
} from "@/lib/conference/types";
import { fmtDayKey, listDays, localToUtcISO, todayKey } from "@/lib/conference/utils";

export default function FoodPage() {
  const { conference, attendees, myAttendee, canManage } = useConferenceCtx();
  const { orders, items, assignments, loading, addOrder, upsertAssignment } =
    useFood(conference.id);
  const tz = conference.timezone;

  const days = listDays(conference.start_date, conference.end_date);
  const today = todayKey(tz);
  const [day, setDay] = useState(days.includes(today) ? today : days[0] || today);
  const [showCreate, setShowCreate] = useState(false);
  const [showAssign, setShowAssign] = useState(false);

  const dayOrders = useMemo(
    () => orders.filter((o) => o.order_date === day),
    [orders, day],
  );
  const assignment = assignments.find((a) => a.date === day) || null;
  const coordinators = (assignment?.attendee_ids || [])
    .map((id) => attendees.find((a) => a.id === id))
    .filter(Boolean);
  const iAmCoordinator = !!(
    myAttendee && assignment?.attendee_ids.includes(myAttendee.id)
  );

  const byMeal = useMemo(() => {
    const map = new Map<Meal, FoodOrder[]>();
    for (const o of dayOrders) map.set(o.meal, [...(map.get(o.meal) || []), o]);
    return map;
  }, [dayOrders]);

  const itemCount = (orderId: string) =>
    items.filter((i) => i.order_id === orderId).length;

  return (
    <div>
      {/* Day selector */}
      <div className="mb-4 flex gap-1.5 overflow-x-auto pb-1">
        {days.map((d) => (
          <button
            key={d}
            onClick={() => setDay(d)}
            className={cn(
              "shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-medium transition",
              day === d
                ? "border-transparent bg-[var(--accent)] text-white"
                : "border-border bg-surface text-muted hover:text-ink",
            )}
          >
            {fmtDayKey(d)}
            {d === today && " · today"}
          </button>
        ))}
      </div>

      {/* Coordinator strip */}
      <div className="mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface px-4 py-3">
        <UserCheck size={16} className="text-muted" />
        {assignment?.skipped ? (
          <p className="text-sm text-muted">No food coordinator today (skipped).</p>
        ) : coordinators.length ? (
          <p className="text-sm">
            <span className="text-muted">Coordinator{coordinators.length > 1 ? "s" : ""}:</span>{" "}
            <span className="font-medium">
              {coordinators.map((c) => c!.name).join(", ")}
            </span>
          </p>
        ) : (
          <p className="text-sm font-medium text-amber-600">
            This day needs a food coordinator.
          </p>
        )}
        <span className="flex-1" />
        {canManage && (
          <Button size="sm" variant="secondary" onClick={() => setShowAssign(true)}>
            Assign
          </Button>
        )}
        {(iAmCoordinator || dayOrders.length === 0) && (
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus size={14} /> Start order
          </Button>
        )}
      </div>

      {loading ? (
        <p className="py-12 text-center text-sm text-muted">Loading…</p>
      ) : dayOrders.length === 0 ? (
        <EmptyState
          title="No orders for this day"
          hint="The coordinator starts a group order; everyone adds their item; the app tracks who's in."
          action={
            <Button onClick={() => setShowCreate(true)}>
              <Plus size={16} /> Start order
            </Button>
          }
        />
      ) : (
        <div className="space-y-6">
          {(Object.keys(MEALS) as Meal[]).map((meal) => {
            const list = byMeal.get(meal);
            if (!list?.length) return null;
            const m = MEALS[meal];
            return (
              <section key={meal}>
                <h3
                  className="mb-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold text-white"
                  style={{ background: m.color }}
                >
                  {m.emoji} {m.label}
                </h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {list.map((o) => {
                    const st = FOOD_STATUSES[o.status];
                    return (
                      <Link
                        key={o.id}
                        href={`/conference-planning/${conference.id}/food/${o.id}`}
                        className="rounded-xl border border-border bg-surface p-4 transition hover:shadow-md"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-semibold">{o.restaurant || "Group order"}</p>
                          <span
                            className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold text-white"
                            style={{ background: st.color }}
                          >
                            {st.label}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-muted">
                          {itemCount(o.id)} item{itemCount(o.id) === 1 ? "" : "s"}
                          {o.deadline && (
                            <> · <Deadline deadline={o.deadline} status={o.status} /></>
                          )}
                        </p>
                      </Link>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <CreateOrderModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        day={day}
        tz={tz}
        defaultOrderer={myAttendee?.id || null}
        onCreate={addOrder}
      />

      {/* Coordinator assignment */}
      <Modal
        open={showAssign}
        onClose={() => setShowAssign(false)}
        title={`Food coordinator — ${fmtDayKey(day)}`}
        size="sm"
      >
        <div className="space-y-3">
          <div className="max-h-56 space-y-0.5 overflow-y-auto">
            {attendees.map((a) => {
              const on = assignment?.attendee_ids.includes(a.id) || false;
              return (
                <label
                  key={a.id}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-canvas"
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(e) => {
                      const ids = new Set(assignment?.attendee_ids || []);
                      if (e.target.checked) ids.add(a.id);
                      else ids.delete(a.id);
                      void upsertAssignment(day, [...ids], false);
                    }}
                  />
                  {a.name}
                </label>
              );
            })}
          </div>
          <div className="flex justify-between">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => upsertAssignment(day, [], !assignment?.skipped)}
            >
              {assignment?.skipped ? "Un-skip this day" : "Skip this day"}
            </Button>
            <Button size="sm" onClick={() => setShowAssign(false)}>
              Done
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function Deadline({ deadline, status }: { deadline: string; status: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const min = Math.round((new Date(deadline).getTime() - now) / 60000);
  if (status !== "open" || min <= 0)
    return <span className="font-medium text-red-600">deadline passed</span>;
  const cls = min > 60 ? "text-emerald-600" : min > 15 ? "text-amber-600" : "text-red-600";
  const label =
    min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m left` : `${min}m left`;
  return <span className={cn("font-medium", cls)}>{label}</span>;
}

function CreateOrderModal({
  open,
  onClose,
  day,
  tz,
  defaultOrderer,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  day: string;
  tz: string;
  defaultOrderer: string | null;
  onCreate: (partial: Partial<FoodOrder>) => Promise<FoodOrder | null>;
}) {
  const { attendees } = useConferenceCtx();
  const [step, setStep] = useState<1 | 2>(1);
  const [meal, setMeal] = useState<Meal>("lunch");
  const [restaurant, setRestaurant] = useState("");
  const [menuUrl, setMenuUrl] = useState("");
  const [groupUrl, setGroupUrl] = useState("");
  const [deadline, setDeadline] = useState("11:00");
  const [orderer, setOrderer] = useState(defaultOrderer || "");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  function reset() {
    setStep(1);
    setRestaurant("");
    setMenuUrl("");
    setGroupUrl("");
    setNotes("");
  }

  async function save() {
    if (!restaurant.trim()) return;
    setSaving(true);
    await onCreate({
      order_date: day,
      meal,
      restaurant: restaurant.trim(),
      menu_url: menuUrl.trim(),
      group_order_url: groupUrl.trim(),
      deadline: deadline ? localToUtcISO(day, deadline, tz) : null,
      orderer_attendee_id: orderer || null,
      notes,
    });
    setSaving(false);
    reset();
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title={step === 1 ? "What meal is this?" : `New ${MEALS[meal].label.toLowerCase()} order`}
    >
      {step === 1 ? (
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(MEALS) as Meal[]).map((m) => (
            <button
              key={m}
              onClick={() => {
                setMeal(m);
                setStep(2);
              }}
              className="rounded-xl border border-border bg-surface p-4 text-center transition hover:shadow-md"
            >
              <p className="text-2xl">{MEALS[m].emoji}</p>
              <p className="mt-1 text-sm font-semibold" style={{ color: MEALS[m].color }}>
                {MEALS[m].label}
              </p>
            </button>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          <Input
            label="Restaurant *"
            value={restaurant}
            onChange={(e) => setRestaurant(e.target.value)}
            autoFocus
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Menu URL"
              value={menuUrl}
              onChange={(e) => setMenuUrl(e.target.value)}
              placeholder="https://…"
            />
            <Input
              label="Group-order URL"
              value={groupUrl}
              onChange={(e) => setGroupUrl(e.target.value)}
              placeholder="Shared cart link"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Order deadline"
              type="time"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
            />
            <Select
              label="Orderer"
              value={orderer}
              onChange={(e) => setOrderer(e.target.value)}
            >
              <option value="">—</option>
              {attendees.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </div>
          <Input
            label="Notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <div className="flex justify-between gap-2">
            <Button variant="ghost" onClick={() => setStep(1)}>
              ← Meal
            </Button>
            <Button onClick={save} disabled={saving || !restaurant.trim()}>
              {saving ? "Creating…" : "Create order"}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
