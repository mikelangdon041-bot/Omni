import type { LucideIcon } from "lucide-react";

export interface HeroStat {
  label: string;
  value: string | number;
}

// Bold-editorial module header: full-bleed gradient (driven by the module's
// --grad-* vars), big type, optional inline stats and action.
export function ModuleHero({
  eyebrow,
  title,
  subtitle,
  icon: Icon,
  stats,
  action,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  stats?: HeroStat[];
  action?: React.ReactNode;
}) {
  return (
    <div className="omni-hero relative mb-8 overflow-hidden rounded-2xl px-6 py-7 text-white shadow-sm sm:px-8 sm:py-8">
      {/* decorative glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-white/15 blur-2xl"
      />
      <div className="relative flex flex-col gap-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            {eyebrow && (
              <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-white/75">
                {Icon && <Icon size={14} />}
                {eyebrow}
              </p>
            )}
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
              {title}
            </h1>
            {subtitle && (
              <p className="mt-2 max-w-xl text-sm text-white/80">{subtitle}</p>
            )}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>

        {stats && stats.length > 0 && (
          <div className="flex flex-wrap gap-2.5">
            {stats.map((s) => (
              <div
                key={s.label}
                className="rounded-xl bg-white/15 px-4 py-2.5 backdrop-blur-sm"
              >
                <p className="text-xl font-bold leading-none">{s.value}</p>
                <p className="mt-1 text-[11px] font-medium uppercase tracking-wide text-white/75">
                  {s.label}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
