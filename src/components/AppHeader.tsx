"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Menu, X, Settings, LogOut } from "lucide-react";
import { Logo } from "@/components/Logo";
import { NAV_ITEMS } from "@/lib/nav";

export function AppHeader({ username }: { username: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  // Close the drawer on navigation.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Lock scroll + Escape-to-close while the drawer is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  async function handleLogout() {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "same-origin",
    });
    router.push("/login");
    router.refresh();
  }

  // The currently active module (for the header title).
  const active =
    NAV_ITEMS.find((i) =>
      i.href === "/" ? pathname === "/" : pathname.startsWith(i.href),
    ) || NAV_ITEMS[0];

  return (
    <>
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-surface/90 px-4 backdrop-blur">
        <button
          onClick={() => setOpen(true)}
          className="-ml-1 rounded-lg p-2 text-ink transition hover:bg-canvas"
          aria-label="Open menu"
        >
          <Menu size={20} />
        </button>
        <Link href="/" className="flex items-center gap-2">
          <Logo />
        </Link>
        <span className="ml-1 hidden text-sm text-muted sm:inline">
          / {active.label}
        </span>
        <div className="ml-auto">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-accent-soft text-sm font-semibold text-accent">
            {username.slice(0, 1).toUpperCase()}
          </span>
        </div>
      </header>

      {/* Drawer */}
      {open && (
        <div className="fixed inset-0 z-40">
          <div
            className="absolute inset-0 bg-ink/40"
            onClick={() => setOpen(false)}
          />
          <aside className="absolute left-0 top-0 flex h-full w-72 flex-col border-r border-border bg-surface shadow-xl">
            <div className="flex items-center justify-between px-5 py-4">
              <Logo />
              <button
                onClick={() => setOpen(false)}
                className="rounded-lg p-1.5 text-muted transition hover:bg-canvas hover:text-ink"
                aria-label="Close menu"
              >
                <X size={18} />
              </button>
            </div>

            <p className="px-5 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted">
              Switch app
            </p>
            <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-1">
              {NAV_ITEMS.map((item) => {
                const isActive =
                  item.href === "/"
                    ? pathname === "/"
                    : pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                      isActive
                        ? "bg-primary-soft font-medium text-primary"
                        : "text-muted hover:bg-canvas hover:text-ink"
                    }`}
                  >
                    <span
                      className={`text-base ${isActive ? "text-accent" : "text-muted group-hover:text-ink"}`}
                    >
                      {item.icon}
                    </span>
                    <span className="flex-1">{item.label}</span>
                    {!item.ready && (
                      <span className="rounded-full bg-canvas px-1.5 py-0.5 text-[10px] font-medium text-muted">
                        soon
                      </span>
                    )}
                  </Link>
                );
              })}
            </nav>

            <div className="border-t border-border p-3">
              <Link
                href="/settings"
                className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted transition hover:bg-canvas hover:text-ink"
              >
                <Settings size={16} /> Settings
              </Link>
              <div className="mt-1 flex items-center gap-3 rounded-lg px-3 py-2">
                <span className="grid h-7 w-7 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent">
                  {username.slice(0, 1).toUpperCase()}
                </span>
                <span className="flex-1 truncate text-sm font-medium">
                  {username}
                </span>
              </div>
              <button
                onClick={handleLogout}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-muted transition hover:bg-canvas hover:text-status-error"
              >
                <LogOut size={16} /> Sign out
              </button>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
