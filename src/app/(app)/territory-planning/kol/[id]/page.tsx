"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Mail, Phone } from "lucide-react";
import { useKOL } from "@/lib/territory/hooks";
import {
  RELATIONSHIP_COLORS,
  RELATIONSHIP_LABELS,
  cn,
  kolFullName,
  kolInitials,
} from "@/lib/territory/utils";
import type { KOL, RelationshipLevel } from "@/lib/territory/types";
import { Badge } from "@/components/territory/ui/Badge";
import { Button } from "@/components/territory/ui/Button";
import { EngagementRing } from "@/components/territory/ui/EngagementRing";
import { ProfileSection } from "@/components/territory/ProfileSection";

const TABS = ["Profile", "Activity", "Meetings", "Strategy"] as const;
type Tab = (typeof TABS)[number];

export default function KOLDetailPage() {
  const params = useParams<{ id: string }>();
  const { kol, loading, update } = useKOL(params.id);
  const [tab, setTab] = useState<Tab>("Profile");

  if (loading) {
    return <p className="py-12 text-center text-sm text-muted">Loading…</p>;
  }
  if (!kol) {
    return (
      <div className="py-12 text-center">
        <p className="text-sm text-muted">KOL not found.</p>
        <Link href="/territory-planning" className="mt-2 inline-block text-sm text-primary">
          ← Back to Territory Planning
        </Link>
      </div>
    );
  }

  return (
    <>
      <Link
        href="/territory-planning"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink"
      >
        <ArrowLeft size={15} /> Territory Planning
      </Link>

      <Header kol={kol} update={update} />

      {/* Tabs */}
      <div className="mb-6 flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition",
              tab === t
                ? "border-[var(--accent)] text-[var(--accent)]"
                : "border-transparent text-muted hover:text-ink",
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Profile" && <ProfileSection kol={kol} update={update} />}
      {tab !== "Profile" && (
        <div className="rounded-xl border border-dashed border-border bg-surface px-6 py-16 text-center text-sm text-muted">
          The {tab} tab is coming in the next update.
        </div>
      )}
    </>
  );
}

function Header({
  kol,
  update,
}: {
  kol: KOL;
  update: (partial: Partial<KOL>) => Promise<void>;
}) {
  return (
    <div className="mb-6 flex items-start gap-4 rounded-xl border border-border bg-surface p-5 shadow-sm">
      {kol.photo_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={kol.photo_url}
          alt={kolFullName(kol)}
          className="h-16 w-16 shrink-0 rounded-full object-cover"
        />
      ) : (
        <span className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-[var(--accent-soft)] text-lg font-semibold text-[var(--accent)]">
          {kolInitials(kol) || "?"}
        </span>
      )}

      <div className="min-w-0 flex-1">
        <h1 className="text-xl font-semibold tracking-tight">{kolFullName(kol)}</h1>
        {kol.title_position && <p className="text-sm text-muted">{kol.title_position}</p>}
        {kol.specialty && <p className="text-sm text-muted">{kol.specialty}</p>}

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <select
            value={kol.relationship_level}
            onChange={(e) =>
              update({ relationship_level: e.target.value as RelationshipLevel })
            }
            className={cn(
              "rounded-full border-0 px-2.5 py-1 text-xs font-medium outline-none",
              RELATIONSHIP_COLORS[kol.relationship_level],
            )}
          >
            {(Object.keys(RELATIONSHIP_LABELS) as RelationshipLevel[]).map((r) => (
              <option key={r} value={r}>
                {RELATIONSHIP_LABELS[r]}
              </option>
            ))}
          </select>
          {kol.is_product_a_user && (
            <Badge className="bg-indigo-100 text-indigo-700">Product A</Badge>
          )}
          {kol.is_product_b_user && (
            <Badge className="bg-purple-100 text-purple-700">Product B</Badge>
          )}
          {kol.priority > 0 && (
            <Badge className="bg-accent-soft text-accent">Priority {kol.priority}</Badge>
          )}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {kol.email && (
            <a href={`mailto:${kol.email}`}>
              <Button variant="secondary" size="sm">
                <Mail size={14} /> Email
              </Button>
            </a>
          )}
          {kol.phone && (
            <a href={`tel:${kol.phone}`}>
              <Button variant="secondary" size="sm">
                <Phone size={14} /> Call
              </Button>
            </a>
          )}
        </div>
      </div>

      <EngagementRing score={kol.engagement_score} size={60} />
    </div>
  );
}
