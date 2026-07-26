"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye } from "lucide-react";
import { useSessionProfile } from "@/lib/session";

export function ImpersonationBanner() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const { profile } = useSessionProfile();
  const username = profile?.username || profile?.displayName || "…";

  async function exit() {
    setBusy(true);
    await fetch("/api/admin/stop-impersonate", {
      method: "POST",
      credentials: "same-origin",
    });
    router.push("/admin");
    router.refresh();
  }

  return (
    <div className="flex items-center justify-center gap-3 bg-ink px-4 py-2 text-sm text-white">
      <Eye size={15} />
      <span>
        Viewing as <span className="font-semibold">{username}</span>
      </span>
      <button
        onClick={exit}
        disabled={busy}
        className="rounded-md bg-white/15 px-2.5 py-0.5 text-xs font-medium transition hover:bg-white/25 disabled:opacity-60"
      >
        {busy ? "Exiting…" : "Exit"}
      </button>
    </div>
  );
}
