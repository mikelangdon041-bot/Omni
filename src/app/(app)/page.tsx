import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { ModuleHero } from "@/components/ui/ModuleHero";
import { MODULES } from "@/lib/modules";

export default function DashboardPage() {
  const modules = MODULES.filter((m) => m.slug !== "");

  return (
    <>
      <ModuleHero
        eyebrow="Omni"
        title="Medical Affairs, all in one place"
        subtitle="One workspace for everything an MSL does in the field — capture, prepare, plan, and engage."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {modules.map((m) => {
          const Icon = m.icon;
          const card = (
            <div
              className={`group flex h-full flex-col rounded-2xl border border-border bg-surface p-5 shadow-sm transition ${
                m.ready ? "hover:-translate-y-0.5 hover:shadow-md" : "opacity-70"
              }`}
            >
              <div className="mb-3 flex items-center gap-3">
                <span
                  className="grid h-11 w-11 place-items-center rounded-xl text-white shadow-sm"
                  style={{ backgroundColor: m.theme.accent }}
                >
                  <Icon size={20} />
                </span>
                <h2 className="font-semibold">{m.label}</h2>
                {!m.ready && (
                  <span className="ml-auto rounded-full bg-canvas px-2 py-0.5 text-[11px] font-medium text-muted">
                    Coming soon
                  </span>
                )}
              </div>
              <p className="flex-1 text-sm text-muted">{m.blurb}</p>
              {m.ready && (
                <span
                  className="mt-4 inline-flex items-center gap-1 text-sm font-medium"
                  style={{ color: m.theme.accent }}
                >
                  Open
                  <ArrowRight
                    size={15}
                    className="transition-transform group-hover:translate-x-0.5"
                  />
                </span>
              )}
            </div>
          );

          return m.ready ? (
            <Link key={m.href} href={m.href} className="block">
              {card}
            </Link>
          ) : (
            <div key={m.href}>{card}</div>
          );
        })}
      </div>
    </>
  );
}
