"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutGrid, Settings, LogOut, X, Shield } from "lucide-react";
import { MODULES, moduleForPath } from "@/lib/modules";

export function AppHeader({
  username,
  isAdmin,
}: {
  username: string;
  isAdmin?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [launcher, setLauncher] = useState(false);
  const [menu, setMenu] = useState(false);

  // Close overlays on navigation.
  useEffect(() => {
    setLauncher(false);
    setMenu(false);
  }, [pathname]);

  useEffect(() => {
    if (!launcher) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setLauncher(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [launcher]);

  async function handleLogout() {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "same-origin",
    });
    router.push("/login");
    router.refresh();
  }

  const active = moduleForPath(pathname);

  return (
    <>
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-surface/90 px-4 backdrop-blur">
        {/* Left: just the app you're in (click → its home). Switch apps via the
            launcher on the right. */}
        {active.slug !== "" ? (
          <Link href={active.href} className="flex items-center gap-2.5">
            <span
              className="grid h-8 w-8 place-items-center rounded-lg text-white shadow-sm"
              style={{
                backgroundImage: `linear-gradient(135deg, ${active.theme.gradFrom}, ${active.theme.gradTo})`,
              }}
            >
              <active.icon size={17} />
            </span>
            <span className="font-semibold tracking-tight">{active.label}</span>
          </Link>
        ) : (
          <Link href="/" className="font-semibold tracking-tight">
            Omni
          </Link>
        )}

        {/* Right: switch-app launcher + account menu */}
        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={() => setLauncher(true)}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm text-muted transition hover:bg-canvas hover:text-ink"
            title="Switch app"
          >
            <LayoutGrid size={18} />
            <span className="hidden sm:inline">Switch app</span>
          </button>

          <div className="relative">
            <button
              onClick={() => setMenu((v) => !v)}
              className="grid h-8 w-8 place-items-center rounded-full bg-accent-soft text-sm font-semibold text-accent transition hover:opacity-90"
              aria-label="Account menu"
            >
              {username.slice(0, 1).toUpperCase()}
            </button>
            {menu && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setMenu(false)}
                />
                <div className="absolute right-0 top-10 z-50 w-52 overflow-hidden rounded-xl border border-border bg-surface shadow-lg">
                  <div className="border-b border-border px-4 py-3">
                    <p className="text-xs text-muted">Signed in as</p>
                    <p className="truncate text-sm font-medium">{username}</p>
                  </div>
                  {isAdmin && (
                    <Link
                      href="/admin"
                      className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-ink transition hover:bg-canvas"
                    >
                      <Shield size={16} /> Admin
                    </Link>
                  )}
                  <Link
                    href="/settings"
                    className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-ink transition hover:bg-canvas"
                  >
                    <Settings size={16} /> Settings
                  </Link>
                  <button
                    onClick={handleLogout}
                    className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-ink transition hover:bg-canvas hover:text-status-error"
                  >
                    <LogOut size={16} /> Sign out
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* App launcher — centered grid (Google/Office style) */}
      {launcher && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/50 p-4 backdrop-blur-sm sm:items-center"
          onMouseDown={(e) => e.target === e.currentTarget && setLauncher(false)}
        >
          <div className="w-full max-w-lg rounded-2xl border border-border bg-surface p-6 shadow-2xl">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-muted">
                  Omni
                </p>
                <h2 className="text-lg font-semibold tracking-tight">
                  Switch app
                </h2>
              </div>
              <button
                onClick={() => setLauncher(false)}
                className="rounded-lg p-1.5 text-muted transition hover:bg-canvas hover:text-ink"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-3">
              {MODULES.filter((m) => m.slug !== "").map((m) => {
                const Icon = m.icon;
                const isActive = m.href === active.href;
                const tile = (
                  <div
                    className={`flex flex-col items-center gap-2 rounded-xl border p-3 text-center transition ${
                      m.ready
                        ? "border-border hover:-translate-y-0.5 hover:border-[var(--c)] hover:shadow-md"
                        : "border-transparent opacity-60"
                    } ${isActive ? "bg-canvas" : ""}`}
                    style={{ ["--c" as string]: m.theme.accent }}
                  >
                    <span
                      className="grid h-12 w-12 place-items-center rounded-2xl text-white shadow-sm"
                      style={{
                        backgroundImage: `linear-gradient(135deg, ${m.theme.gradFrom}, ${m.theme.gradTo})`,
                      }}
                    >
                      <Icon size={22} />
                    </span>
                    <span className="text-xs font-medium leading-tight">
                      {m.label}
                    </span>
                    {!m.ready && (
                      <span className="text-[10px] font-medium text-muted">
                        Soon
                      </span>
                    )}
                  </div>
                );
                return m.ready ? (
                  <Link key={m.href} href={m.href}>
                    {tile}
                  </Link>
                ) : (
                  <div key={m.href}>{tile}</div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
