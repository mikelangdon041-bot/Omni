"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { clearAllCached } from "@/lib/cache";

export function SignOutButton() {
  const router = useRouter();
  async function logout() {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "same-origin",
    });
    // Wipe the instant-paint cache so a shared device signing in as someone
    // else never flashes the previous person's cached data.
    clearAllCached();
    router.push("/login");
    router.refresh();
  }
  return (
    <button
      onClick={logout}
      className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-2.5 text-sm font-medium text-ink transition hover:text-status-error"
    >
      <LogOut size={16} /> Sign out
    </button>
  );
}
