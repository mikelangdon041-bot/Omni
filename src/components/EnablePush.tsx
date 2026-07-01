"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff, Check } from "lucide-react";

const VAPID = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// Enable browser push for tasks/reminders. Registers the service worker and
// subscribes this device. No-op UI if the browser can't or VAPID isn't set.
export function EnablePush() {
  const [supported, setSupported] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ok = "serviceWorker" in navigator && "PushManager" in window;
    setSupported(ok);
    if (!ok) return;
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setEnabled(!!sub))
      .catch(() => {});
  }, []);

  async function enable() {
    setBusy(true);
    setError(null);
    try {
      if (!VAPID) throw new Error("Push isn't configured yet (missing VAPID key).");
      const perm = await Notification.requestPermission();
      if (perm !== "granted") throw new Error("Notifications were blocked.");
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID) as BufferSource,
      });
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ subscription: sub }),
      });
      if (!res.ok) throw new Error("Could not save your subscription.");
      setEnabled(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not enable notifications.");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setEnabled(false);
    } finally {
      setBusy(false);
    }
  }

  if (!supported) {
    return <p className="text-sm text-muted">This browser doesn&apos;t support push notifications.</p>;
  }

  return (
    <div>
      <p className="mb-3 text-sm text-muted">
        Get a push notification on this device when a task is due or an interview
        is assigned to you.
      </p>
      {enabled ? (
        <button
          onClick={disable}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-2.5 text-sm font-medium text-ink transition hover:border-status-error hover:text-status-error disabled:opacity-60"
        >
          <BellOff size={16} /> {busy ? "…" : "Turn off notifications"}
          <Check size={14} className="text-status-complete" />
        </button>
      ) : (
        <button
          onClick={enable}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-lg bg-[var(--accent,#4f46e5)] px-4 py-2.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-60"
        >
          <Bell size={16} /> {busy ? "Enabling…" : "Enable notifications"}
        </button>
      )}
      {error && <p className="mt-2 text-sm text-status-error">{error}</p>}
    </div>
  );
}
