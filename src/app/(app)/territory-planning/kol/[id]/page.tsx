"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Mail, Phone, Building2, MapPin, Pencil, Check } from "lucide-react";
import { BackButton } from "@/components/BackButton";
import { AddTaskButton } from "@/components/AddTaskButton";
import { KolPhoto } from "@/components/territory/KolPhoto";
import { useKOL, useUserId, useFieldSuggestions } from "@/lib/territory/hooks";
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
import { Input } from "@/components/territory/ui/Input";
import { EngagementRing } from "@/components/territory/ui/EngagementRing";
import { Sparkles } from "lucide-react";
import { ProfileSection } from "@/components/territory/ProfileSection";
import { ActivityTimeline } from "@/components/territory/ActivityTimeline";
import { MeetingsSection } from "@/components/territory/MeetingsSection";
import { StrategySection } from "@/components/territory/StrategySection";

const TABS = ["Profile", "Activity", "Meetings", "Strategy"] as const;
type Tab = (typeof TABS)[number];

export default function KOLDetailPage() {
  const params = useParams<{ id: string }>();
  const { userId } = useUserId();
  const { kol, loading, update } = useKOL(params.id);
  const suggestions = useFieldSuggestions(userId);
  const [tab, setTab] = useState<Tab>("Profile");
  const [profileEditing, setProfileEditing] = useState(false);

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
      <BackButton />

      <Header kol={kol} update={update} suggestions={suggestions} />

      {/* Tabs + contextual Edit on the same line */}
      <div className="mb-6 flex items-center justify-between border-b border-border">
        <div className="flex gap-1">
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
        {tab === "Profile" && !profileEditing && (
          <Button variant="secondary" size="sm" onClick={() => setProfileEditing(true)}>
            <Pencil size={14} /> Edit
          </Button>
        )}
      </div>

      {tab === "Profile" && (
        <ProfileSection
          kol={kol}
          update={update}
          editing={profileEditing}
          onEditingChange={setProfileEditing}
        />
      )}
      {tab === "Activity" && (
        <ActivityTimeline
          kolId={kol.id}
          userId={userId}
          engagementScore={kol.engagement_score}
          onEngagement={(score) => update({ engagement_score: score })}
        />
      )}
      {tab === "Meetings" && <MeetingsSection kolId={kol.id} userId={userId} />}
      {tab === "Strategy" && <StrategySection kol={kol} update={update} />}
    </>
  );
}

// Autocomplete datalist populated from the rep's existing KOL values.
function FieldSuggestions({ id, options }: { id: string; options?: string[] }) {
  if (!options || options.length === 0) return null;
  return (
    <datalist id={id}>
      {options.map((o) => (
        <option key={o} value={o} />
      ))}
    </datalist>
  );
}

function Header({
  kol,
  update,
  suggestions,
}: {
  kol: KOL;
  update: (partial: Partial<KOL>) => Promise<string | null | void>;
  suggestions: Record<string, string[]>;
}) {
  const [editContact, setEditContact] = useState(false);
  const [draft, setDraft] = useState<Partial<KOL>>({});
  const [saving, setSaving] = useState(false);
  const v = (k: keyof KOL) => (draft[k] ?? kol[k] ?? "") as string;
  const set = (k: keyof KOL, val: string) => setDraft((d) => ({ ...d, [k]: val }));

  async function saveContact() {
    setSaving(true);
    await update(draft);
    setSaving(false);
    setEditContact(false);
    setDraft({});
  }

  return (
    <div className="mb-6 rounded-xl border border-border bg-surface p-5 shadow-sm">
      <div className="flex items-start gap-4">
        <KolPhoto
          kolId={kol.id}
          photoUrl={kol.photo_url}
          initials={kolInitials(kol)}
          onChange={(url) => update({ photo_url: url })}
          size={64}
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-xl font-semibold tracking-tight">{kolFullName(kol)}</h1>
              {kol.title_position && <p className="text-sm text-muted">{kol.title_position}</p>}
              {kol.specialty && <p className="text-sm text-muted">{kol.specialty}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-3">
              {/* Meeting prep — deliberately set apart and accented so it stands out. */}
              <Link
                href={`/territory-planning/kol/${kol.id}/prep`}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
              >
                <Sparkles size={15} /> AI Meeting prep
              </Link>
              <AddTaskButton
                app="territory"
                link={`/territory-planning/kol/${kol.id}`}
                entityLabel={kolFullName(kol)}
              />
              <EngagementRing score={kol.engagement_score} size={56} />
            </div>
          </div>

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
        </div>
      </div>

      {/* Contact block — on the top card (no separate section below). */}
      <div className="mt-4 border-t border-border pt-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
            Contact
          </h3>
          {editContact ? (
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setEditContact(false);
                  setDraft({});
                }}
              >
                Cancel
              </Button>
              <Button size="sm" onClick={saveContact} disabled={saving}>
                <Check size={14} /> {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          ) : (
            <button
              onClick={() => setEditContact(true)}
              className="inline-flex items-center gap-1 text-xs font-medium text-muted transition hover:text-[var(--accent)]"
            >
              <Pencil size={12} /> Edit
            </button>
          )}
        </div>

        {editContact ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input label="Title / position" value={v("title_position")} onChange={(e) => set("title_position", e.target.value)} list="ac-title" />
            <Input label="Specialty" value={v("specialty")} onChange={(e) => set("specialty", e.target.value)} list="ac-specialty" />
            <Input label="Clinician type" value={v("clinician_type")} onChange={(e) => set("clinician_type", e.target.value)} list="ac-clinician" />
            <Input label="Institution" value={v("institution")} onChange={(e) => set("institution", e.target.value)} list="ac-institution" />
            <Input label="Phone" value={v("phone")} onChange={(e) => set("phone", e.target.value)} />
            <Input label="Email" value={v("email")} onChange={(e) => set("email", e.target.value)} />
            <Input label="Address" value={v("address")} onChange={(e) => set("address", e.target.value)} list="ac-address" />
            <FieldSuggestions id="ac-title" options={suggestions.title_position} />
            <FieldSuggestions id="ac-specialty" options={suggestions.specialty} />
            <FieldSuggestions id="ac-clinician" options={suggestions.clinician_type} />
            <FieldSuggestions id="ac-institution" options={suggestions.institution} />
            <FieldSuggestions id="ac-address" options={suggestions.address} />
          </div>
        ) : (
          <div className="flex flex-wrap gap-x-6 gap-y-1.5 text-sm">
            {kol.institution && (
              <span className="inline-flex items-center gap-1.5 text-ink/90">
                <Building2 size={14} className="text-muted" /> {kol.institution}
              </span>
            )}
            {kol.address && (
              <span className="inline-flex items-center gap-1.5 text-ink/90">
                <MapPin size={14} className="text-muted" /> {kol.address}
              </span>
            )}
            {kol.phone && (
              <a href={`tel:${kol.phone}`} className="inline-flex items-center gap-1.5 text-ink/90 hover:text-[var(--accent)]">
                <Phone size={14} className="text-muted" /> {kol.phone}
              </a>
            )}
            {kol.email && (
              <a href={`mailto:${kol.email}`} className="inline-flex items-center gap-1.5 text-ink/90 hover:text-[var(--accent)]">
                <Mail size={14} className="text-muted" /> {kol.email}
              </a>
            )}
            {!kol.institution && !kol.address && !kol.phone && !kol.email && (
              <span className="text-muted">No contact info yet.</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
