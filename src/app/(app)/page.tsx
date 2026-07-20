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
        title="Your field work, all in one place"
        subtitle="One workspace for everything your team does in the field — capture, prepare, plan, and engage."
      />

      {/* Two columns even on a phone — a single stacked column left half the
          screen empty and made the module list needlessly long to scroll. */}
      <div className="grid grid-cols-2 gap-2.5 sm:gap-4 lg:grid-cols-3">
        {modules.map((m) => {
          const Icon = m.icon;
          const card = (
            <div
              className={`group flex h-full flex-col rounded-xl border border-border bg-surface p-3 shadow-sm transition sm:rounded-2xl sm:p-5 ${
                m.ready ? "hover:-translate-y-0.5 hover:shadow-md" : "opacity-70"
              }`}
            >
              <div className="mb-2 flex items-center gap-2 sm:mb-3 sm:gap-3">
                <span
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white shadow-sm sm:h-11 sm:w-11 sm:rounded-xl"
                  style={{ backgroundColor: m.theme.accent }}
                >
                  <Icon size={16} className="sm:hidden" />
                  <Icon size={20} className="hidden sm:block" />
                </span>
                <h2 className="text-sm font-semibold sm:text-base">{m.label}</h2>
                {!m.ready && (
                  <span className="ml-auto hidden rounded-full bg-canvas px-2 py-0.5 text-[11px] font-medium text-muted sm:inline">
                    Coming soon
                  </span>
                )}
              </div>
              <p className="flex-1 text-xs text-muted sm:text-sm">{m.blurb}</p>
              {m.ready && (
                <span
                  className="mt-3 inline-flex items-center gap-1 text-xs font-medium sm:mt-4 sm:text-sm"
                  style={{ color: m.theme.accent }}
                >
                  Open
                  <ArrowRight
                    size={14}
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
