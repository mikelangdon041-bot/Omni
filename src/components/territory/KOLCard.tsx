import Link from "next/link";
import { MapPin, Building2 } from "lucide-react";
import type { KOL } from "@/lib/territory/types";
import {
  RELATIONSHIP_COLORS,
  RELATIONSHIP_LABELS,
  kolFullName,
  kolInitials,
} from "@/lib/territory/utils";
import { Badge } from "@/components/territory/ui/Badge";
import { EngagementRing } from "@/components/territory/ui/EngagementRing";

export function KOLCard({ kol }: { kol: KOL }) {
  return (
    <Link
      href={`/territory-planning/kol/${kol.id}`}
      className="flex flex-col rounded-xl border border-border bg-surface p-2.5 shadow-sm transition hover:border-[var(--accent)]/40 hover:shadow sm:p-4"
    >
      <div className="flex items-start gap-2 sm:gap-3">
        {kol.photo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={kol.photo_url}
            alt={kolFullName(kol)}
            className="h-9 w-9 shrink-0 rounded-full object-cover sm:h-12 sm:w-12"
          />
        ) : (
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--accent-soft)] text-xs font-semibold text-[var(--accent)] sm:h-12 sm:w-12 sm:text-sm">
            {kolInitials(kol) || "?"}
          </span>
        )}

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold sm:text-base">{kolFullName(kol)}</p>
          {kol.title_position && (
            <p className="truncate text-xs text-muted">{kol.title_position}</p>
          )}
          {kol.specialty && (
            <p className="hidden truncate text-xs text-muted sm:block">{kol.specialty}</p>
          )}
        </div>

        <EngagementRing score={kol.engagement_score} size={32} className="sm:hidden" />
        <EngagementRing score={kol.engagement_score} size={44} className="hidden sm:block" />
      </div>

      <div className="mt-2 space-y-1 text-xs text-muted sm:mt-3">
        {kol.institution && (
          <p className="flex items-center gap-1.5 truncate">
            <Building2 size={12} className="shrink-0" />
            <span className="truncate">{kol.institution}</span>
          </p>
        )}
        {kol.address && (
          <p className="hidden items-center gap-1.5 truncate sm:flex">
            <MapPin size={12} className="shrink-0" />
            <span className="truncate">{kol.address}</span>
          </p>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1 sm:mt-3 sm:gap-1.5">
        <Badge className={RELATIONSHIP_COLORS[kol.relationship_level]}>
          {RELATIONSHIP_LABELS[kol.relationship_level]}
        </Badge>
        {kol.is_product_a_user && (
          <Badge className="hidden bg-indigo-100 text-indigo-700 sm:inline-flex">Product A</Badge>
        )}
        {kol.is_product_b_user && (
          <Badge className="hidden bg-purple-100 text-purple-700 sm:inline-flex">Product B</Badge>
        )}
        {kol.priority > 0 && (
          <Badge className="bg-accent-soft text-accent">P{kol.priority}</Badge>
        )}
        {kol.list_name && (
          <Badge className="hidden bg-slate-100 text-slate-600 sm:inline-flex">{kol.list_name}</Badge>
        )}
      </div>
    </Link>
  );
}
