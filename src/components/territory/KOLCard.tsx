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
      className="flex flex-col rounded-xl border border-border bg-surface p-4 shadow-sm transition hover:border-[var(--accent)]/40 hover:shadow"
    >
      <div className="flex items-start gap-3">
        {kol.photo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={kol.photo_url}
            alt={kolFullName(kol)}
            className="h-12 w-12 shrink-0 rounded-full object-cover"
          />
        ) : (
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[var(--accent-soft)] text-sm font-semibold text-[var(--accent)]">
            {kolInitials(kol) || "?"}
          </span>
        )}

        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{kolFullName(kol)}</p>
          {kol.title_position && (
            <p className="truncate text-xs text-muted">{kol.title_position}</p>
          )}
          {kol.specialty && (
            <p className="truncate text-xs text-muted">{kol.specialty}</p>
          )}
        </div>

        <EngagementRing score={kol.engagement_score} size={44} />
      </div>

      <div className="mt-3 space-y-1 text-xs text-muted">
        {kol.institution && (
          <p className="flex items-center gap-1.5 truncate">
            <Building2 size={12} className="shrink-0" />
            <span className="truncate">{kol.institution}</span>
          </p>
        )}
        {kol.address && (
          <p className="flex items-center gap-1.5 truncate">
            <MapPin size={12} className="shrink-0" />
            <span className="truncate">{kol.address}</span>
          </p>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Badge className={RELATIONSHIP_COLORS[kol.relationship_level]}>
          {RELATIONSHIP_LABELS[kol.relationship_level]}
        </Badge>
        {kol.is_product_a_user && (
          <Badge className="bg-indigo-100 text-indigo-700">Product A</Badge>
        )}
        {kol.is_product_b_user && (
          <Badge className="bg-purple-100 text-purple-700">Product B</Badge>
        )}
        {kol.priority > 0 && (
          <Badge className="bg-accent-soft text-accent">P{kol.priority}</Badge>
        )}
        {kol.list_name && (
          <Badge className="bg-slate-100 text-slate-600">{kol.list_name}</Badge>
        )}
      </div>
    </Link>
  );
}
