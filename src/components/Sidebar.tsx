"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/Logo";
import { logout } from "@/app/(auth)/actions";
import { NAV_ITEMS } from "@/lib/nav";

export function Sidebar({ username }: { username: string }) {
  const pathname = usePathname();

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-surface">
      <div className="px-5 py-5">
        <Logo />
      </div>

      <nav className="flex-1 space-y-1 px-3">
        {NAV_ITEMS.map((item) => {
          const active =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                active
                  ? "bg-primary-soft font-medium text-primary"
                  : "text-muted hover:bg-canvas hover:text-ink"
              }`}
            >
              <span
                className={`text-base ${active ? "text-accent" : "text-muted group-hover:text-ink"}`}
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
        <div className="flex items-center gap-3 rounded-lg px-2 py-2">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-accent-soft text-sm font-semibold text-accent">
            {username.slice(0, 1).toUpperCase()}
          </span>
          <span className="flex-1 truncate text-sm font-medium">{username}</span>
        </div>
        <form action={logout}>
          <button
            type="submit"
            className="mt-1 w-full rounded-lg px-3 py-2 text-left text-sm text-muted transition hover:bg-canvas hover:text-status-error"
          >
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
