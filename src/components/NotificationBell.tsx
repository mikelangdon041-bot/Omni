"use client";

import { useState } from "react";
import Link from "next/link";
import { Bell, Check } from "lucide-react";
import { useNotifications, useUserId } from "@/lib/interview/hooks";

export function NotificationBell() {
  const { userId } = useUserId();
  const { items, unread, markRead, markAll } = useNotifications(userId);
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative grid h-9 w-9 place-items-center rounded-lg text-muted transition hover:bg-canvas hover:text-ink"
        aria-label="Notifications"
        title="Notifications"
      >
        <Bell size={18} />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-[var(--accent,#4f46e5)] px-1 text-[10px] font-semibold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-11 z-50 w-80 overflow-hidden rounded-xl border border-border bg-surface shadow-lg">
            <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
              <p className="text-sm font-semibold">Notifications</p>
              {unread > 0 && (
                <button
                  onClick={markAll}
                  className="inline-flex items-center gap-1 text-xs text-muted transition hover:text-ink"
                >
                  <Check size={13} /> Mark all read
                </button>
              )}
            </div>
            {items.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted">
                You&apos;re all caught up.
              </p>
            ) : (
              <ul className="max-h-96 overflow-y-auto">
                {items.map((n) => (
                  <li key={n.id}>
                    <Link
                      href={n.link || "#"}
                      onClick={() => {
                        markRead(n.id);
                        setOpen(false);
                      }}
                      className={`block border-b border-border px-4 py-3 transition hover:bg-canvas ${
                        n.read ? "" : "bg-[var(--accent-soft,#eef2ff)]/40"
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        {!n.read && (
                          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[var(--accent,#4f46e5)]" />
                        )}
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-ink">{n.title}</p>
                          {n.body && <p className="truncate text-xs text-muted">{n.body}</p>}
                          <p className="mt-0.5 text-[11px] text-muted">
                            {new Date(n.created_at).toLocaleString()}
                          </p>
                        </div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
