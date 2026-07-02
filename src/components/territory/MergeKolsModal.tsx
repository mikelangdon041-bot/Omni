"use client";

import { useMemo, useState } from "react";
import { Users, Check, ArrowLeft, AlertTriangle } from "lucide-react";
import type { KOL } from "@/lib/territory/types";
import { groupSimilar } from "@/lib/territory/dedupe";
import { kolFullName } from "@/lib/territory/utils";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";

// Fields reviewed when combining. `combinable` fields can keep BOTH values;
// `html` fields hold rich text (combined with a line break, previewed as text).
const MERGE_FIELDS: { key: keyof KOL; label: string; combinable?: boolean; html?: boolean }[] = [
  { key: "first_name", label: "First name" },
  { key: "last_name", label: "Last name" },
  { key: "title_position", label: "Title / position" },
  { key: "specialty", label: "Specialty" },
  { key: "clinician_type", label: "Clinician type" },
  { key: "institution", label: "Institution" },
  { key: "address", label: "Address" },
  { key: "phone", label: "Phone", combinable: true },
  { key: "email", label: "Email", combinable: true },
  { key: "tier", label: "Tier" },
  { key: "list_name", label: "List" },
  { key: "website_office", label: "Office website" },
  { key: "website_pubmed", label: "PubMed" },
  { key: "website_other", label: "Other link" },
  { key: "society_associations", label: "Societies / associations", combinable: true, html: true },
  { key: "leadership_appointments", label: "Leadership appointments", combinable: true, html: true },
  { key: "publications", label: "Publications", combinable: true, html: true },
  { key: "areas_of_interest", label: "Areas of interest", combinable: true, html: true },
  { key: "potential_collaborations", label: "Potential collaborations", combinable: true, html: true },
  { key: "primary_objective", label: "Primary objective", combinable: true, html: true },
  { key: "backup_questions", label: "Backup questions", combinable: true, html: true },
  { key: "other_info", label: "Other info", combinable: true, html: true },
];

const COMBINE = "__combine__";
const stripHtml = (s: string) =>
  (s || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

interface Conflict {
  key: keyof KOL;
  label: string;
  combinable: boolean;
  html: boolean;
  values: string[]; // distinct non-empty values
}

export function MergeKolsModal({
  open,
  onClose,
  kols,
  onMerge,
}: {
  open: boolean;
  onClose: () => void;
  kols: KOL[];
  onMerge: (primaryId: string, duplicateIds: string[], overrides: Partial<KOL>) => Promise<void>;
}) {
  const groups = useMemo(() => groupSimilar(kols, (k) => kolFullName(k)), [kols]);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [doneKeys, setDoneKeys] = useState<Set<string>>(new Set());

  return (
    <Modal open={open} onClose={onClose} title="Combine duplicate profiles" size="lg">
      <p className="mb-4 text-sm text-muted">
        These look like the same person entered more than once. Confirm the ones
        that match, and you&apos;ll get to resolve any conflicting details before
        combining.
      </p>

      {groups.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-surface px-6 py-10 text-center text-sm text-muted">
          No likely duplicates found. 🎉
        </div>
      ) : groups.every((g) => doneKeys.has(g.key)) ? (
        <div className="rounded-xl border border-dashed border-border bg-surface px-6 py-8 text-center text-sm text-muted">
          All set — no more duplicates to combine.
        </div>
      ) : (
        <div className="space-y-4">
          {groups
            .filter((g) => !doneKeys.has(g.key))
            .map((g) => (
              <GroupCard
                key={g.key}
                groupKey={g.key}
                members={g.items}
                busy={busyKey === g.key}
                onCombine={async (primaryId, dupIds, overrides) => {
                  setBusyKey(g.key);
                  await onMerge(primaryId, dupIds, overrides);
                  setBusyKey(null);
                  setDoneKeys((prev) => new Set(prev).add(g.key));
                }}
              />
            ))}
        </div>
      )}

      <div className="mt-5 flex justify-end border-t border-border pt-4">
        <Button variant="secondary" onClick={onClose}>
          Done
        </Button>
      </div>
    </Modal>
  );
}

function GroupCard({
  groupKey,
  members,
  busy,
  onCombine,
}: {
  groupKey: string;
  members: KOL[];
  busy: boolean;
  onCombine: (primaryId: string, dupIds: string[], overrides: Partial<KOL>) => Promise<void>;
}) {
  const [phase, setPhase] = useState<"select" | "review">("select");
  const [primary, setPrimary] = useState(members[0].id);
  const [selected, setSelected] = useState<Set<string>>(new Set(members.map((m) => m.id)));
  const [resolutions, setResolutions] = useState<Record<string, string>>({});

  const chosen = members.filter((m) => selected.has(m.id) || m.id === primary);
  const primaryKol = members.find((m) => m.id === primary)!;

  // Compute conflicting fields across the chosen profiles.
  const conflicts = useMemo<Conflict[]>(() => {
    if (phase !== "review") return [];
    const out: Conflict[] = [];
    for (const f of MERGE_FIELDS) {
      const seen = new Set<string>();
      const values: string[] = [];
      for (const m of chosen) {
        const raw = String(m[f.key] ?? "").trim();
        if (raw && !seen.has(raw)) {
          seen.add(raw);
          values.push(raw);
        }
      }
      if (values.length > 1) {
        out.push({ key: f.key, label: f.label, combinable: !!f.combinable, html: !!f.html, values });
      }
    }
    return out;
  }, [phase, chosen]);

  function startReview() {
    // Default each conflict to the primary's value if it has one, else the first.
    const init: Record<string, string> = {};
    for (const f of MERGE_FIELDS) {
      const seen = new Set<string>();
      const values: string[] = [];
      for (const m of chosen) {
        const raw = String(m[f.key] ?? "").trim();
        if (raw && !seen.has(raw)) {
          seen.add(raw);
          values.push(raw);
        }
      }
      if (values.length > 1) {
        const pv = String(primaryKol[f.key] ?? "").trim();
        init[f.key as string] = pv && values.includes(pv) ? pv : values[0];
      }
    }
    setResolutions(init);
    setPhase("review");
  }

  async function combine() {
    const overrides: Record<string, unknown> = {};
    for (const c of conflicts) {
      const choice = resolutions[c.key as string];
      if (choice === COMBINE) {
        overrides[c.key as string] = c.html
          ? c.values.join("<br>")
          : c.values.join(" · ");
      } else if (choice != null) {
        overrides[c.key as string] = choice;
      }
    }
    await onCombine(
      primary,
      chosen.map((m) => m.id).filter((id) => id !== primary),
      overrides as Partial<KOL>,
    );
  }

  // ---- Review phase -------------------------------------------------
  if (phase === "review") {
    return (
      <div className="rounded-xl border border-[var(--accent)]/40 bg-surface p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <Users size={15} className="text-[var(--accent)]" />
          <p className="text-sm font-medium">Combining {chosen.length} into “{kolFullName(primaryKol)}”</p>
        </div>

        {conflicts.length === 0 ? (
          <p className="rounded-lg bg-[var(--accent-soft)] px-3 py-2 text-sm text-ink">
            No conflicts — every field either matches or only one profile had a
            value. Ready to combine.
          </p>
        ) : (
          <div className="space-y-3">
            <p className="flex items-center gap-1.5 text-xs font-medium text-amber-600">
              <AlertTriangle size={13} /> {conflicts.length} field
              {conflicts.length === 1 ? "" : "s"} differ — choose what to keep.
            </p>
            {conflicts.map((c) => (
              <div key={c.key as string} className="rounded-lg border border-border p-3">
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">{c.label}</p>
                <div className="space-y-1">
                  {c.values.map((v) => (
                    <label key={v} className="flex items-start gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-canvas">
                      <input
                        type="radio"
                        name={`${groupKey}-${String(c.key)}`}
                        checked={resolutions[c.key as string] === v}
                        onChange={() => setResolutions((p) => ({ ...p, [c.key as string]: v }))}
                        className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
                      />
                      <span className="min-w-0 flex-1">{c.html ? stripHtml(v) : v}</span>
                    </label>
                  ))}
                  {c.combinable && (
                    <label className="flex items-start gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-canvas">
                      <input
                        type="radio"
                        name={`${groupKey}-${String(c.key)}`}
                        checked={resolutions[c.key as string] === COMBINE}
                        onChange={() => setResolutions((p) => ({ ...p, [c.key as string]: COMBINE }))}
                        className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
                      />
                      <span className="font-medium text-[var(--accent)]">Keep both (combine)</span>
                    </label>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 flex justify-between border-t border-border pt-3">
          <Button variant="secondary" size="sm" onClick={() => setPhase("select")} disabled={busy}>
            <ArrowLeft size={14} /> Back
          </Button>
          <Button size="sm" onClick={combine} disabled={busy}>
            <Check size={14} /> {busy ? "Combining…" : "Combine profiles"}
          </Button>
        </div>
      </div>
    );
  }

  // ---- Select phase -------------------------------------------------
  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
      <div className="mb-2 flex items-center gap-2">
        <Users size={15} className="text-[var(--accent)]" />
        <p className="text-sm font-medium">{groupKey}</p>
        <span className="text-xs text-muted">· {members.length} profiles</span>
      </div>
      <ul className="space-y-1.5">
        {members.map((m) => {
          const isPrimary = m.id === primary;
          const inMerge = selected.has(m.id) || isPrimary;
          return (
            <li key={m.id} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
              <label className="flex min-w-0 items-center gap-2">
                <input
                  type="checkbox"
                  checked={inMerge}
                  disabled={isPrimary}
                  onChange={(e) =>
                    setSelected((prev) => {
                      const n = new Set(prev);
                      if (e.target.checked) n.add(m.id);
                      else n.delete(m.id);
                      return n;
                    })
                  }
                  className="h-4 w-4 accent-[var(--accent)]"
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm">{kolFullName(m)}</span>
                  <span className="block truncate text-xs text-muted">
                    {[m.institution, m.specialty, m.email].filter(Boolean).join(" · ") || "—"}
                  </span>
                </span>
              </label>
              <button
                onClick={() => setPrimary(m.id)}
                className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium transition ${
                  isPrimary ? "bg-[var(--accent)] text-white" : "border border-border text-muted hover:text-ink"
                }`}
              >
                {isPrimary ? "Keep this" : "Keep"}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-3 flex justify-end">
        <Button size="sm" onClick={startReview} disabled={chosen.length < 2}>
          Review &amp; combine ({chosen.length})
        </Button>
      </div>
    </div>
  );
}
