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
    <div className="omni-hero relative mb-6 overflow-hidden rounded-2xl px-5 py-5 text-white shadow-sm sm:mb-8 sm:px-8 sm:py-8">
      {/* decorative glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-white/15 blur-2xl"
      />
      <div className="relative flex flex-col gap-4 sm:gap-5">
        {/* Phones: title block stacks above the action so the headline gets
            the full width; side-by-side from sm up. */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="min-w-0">
            {eyebrow && (
              <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-white/75">
                {Icon && <Icon size={14} />}
                {eyebrow}
              </p>
            )}
            <h1 className="text-2xl font-bold tracking-tight sm:text-4xl">
              {title}
            </h1>
            {subtitle && (
              <p className="mt-1.5 line-clamp-2 max-w-xl text-sm text-white/80 sm:mt-2 sm:line-clamp-none">
                {subtitle}
              </p>
            )}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>

        {stats && stats.length > 0 && (
          <div className="flex flex-wrap gap-2 sm:gap-2.5">
            {stats.map((s) => (
              <div
                key={s.label}
                className="flex-1 rounded-xl bg-white/15 px-3 py-2 backdrop-blur-sm sm:flex-none sm:px-4 sm:py-2.5"
              >
                <p className="text-lg font-bold leading-none sm:text-xl">{s.value}</p>
                <p className="mt-1 whitespace-nowrap text-[10px] font-medium uppercase tracking-wide text-white/75 sm:text-[11px]">
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
