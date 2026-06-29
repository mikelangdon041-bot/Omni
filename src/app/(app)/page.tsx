import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { NAV_ITEMS } from "@/lib/nav";

export default function DashboardPage() {
  const features = NAV_ITEMS.filter((i) => i.href !== "/");

  return (
    <>
      <PageHeader
        title="Welcome to Omni"
        subtitle="One workspace for everything an MSL does in the field."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {features.map((item) => {
          const card = (
            <div
              className={`flex h-full flex-col rounded-xl border border-border bg-surface p-5 shadow-sm transition ${
                item.ready
                  ? "hover:border-primary/40 hover:shadow"
                  : "opacity-70"
              }`}
            >
              <div className="mb-3 flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-lg bg-primary-soft text-lg text-primary">
                  {item.icon}
                </span>
                <h2 className="font-semibold">{item.label}</h2>
                {!item.ready && (
                  <span className="ml-auto rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">
                    Coming soon
                  </span>
                )}
              </div>
              <p className="text-sm text-muted">{item.blurb}</p>
              {item.ready && (
                <span className="mt-4 text-sm font-medium text-primary">
                  Open →
                </span>
              )}
            </div>
          );

          return item.ready ? (
            <Link key={item.href} href={item.href} className="block">
              {card}
            </Link>
          ) : (
            <div key={item.href}>{card}</div>
          );
        })}
      </div>
    </>
  );
}
