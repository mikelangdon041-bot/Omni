"use client";

// Excel export with scope selection: everyone, specific lists, or
// hand-picked KOLs. Rich-text fields are flattened to plain text.

import { useMemo, useState } from "react";
import { Download, Search } from "lucide-react";
import * as XLSX from "xlsx";
import type { KOL } from "@/lib/territory/types";
import { Modal } from "@/components/territory/ui/Modal";
import { Button } from "@/components/territory/ui/Button";
import {
  HOW_MET_LABELS,
  RELATIONSHIP_LABELS,
  cn,
  kolFullName,
  stripHtml,
} from "@/lib/territory/utils";

const NO_LIST = "__none__";

const COLUMNS: { header: string; value: (k: KOL) => string | number }[] = [
  { header: "First Name", value: (k) => k.first_name },
  { header: "Last Name", value: (k) => k.last_name },
  { header: "Title / Position", value: (k) => k.title_position || "" },
  { header: "Specialty", value: (k) => k.specialty || "" },
  { header: "Clinician Type", value: (k) => k.clinician_type || "" },
  { header: "Institution", value: (k) => k.institution || "" },
  { header: "Email", value: (k) => k.email || "" },
  { header: "Phone", value: (k) => k.phone || "" },
  { header: "Address", value: (k) => k.address || "" },
  { header: "Tier", value: (k) => k.tier || "" },
  { header: "List", value: (k) => k.list_name || "" },
  {
    header: "Relationship",
    value: (k) => RELATIONSHIP_LABELS[k.relationship_level] || k.relationship_level || "",
  },
  {
    header: "How Met",
    value: (k) =>
      k.how_met === "other" && k.how_met_other
        ? `Other — ${k.how_met_other}`
        : HOW_MET_LABELS[k.how_met] || "",
  },
  { header: "Engagement Score", value: (k) => k.engagement_score ?? 0 },
  { header: "Priority", value: (k) => k.priority ?? 0 },
  { header: "Product A User", value: (k) => (k.is_product_a_user ? "Yes" : "No") },
  { header: "Product B User", value: (k) => (k.is_product_b_user ? "Yes" : "No") },
  { header: "Areas of Interest", value: (k) => stripHtml(k.areas_of_interest) },
  { header: "Potential Collaborations", value: (k) => stripHtml(k.potential_collaborations) },
  { header: "Primary Objective", value: (k) => stripHtml(k.primary_objective) },
  { header: "Backup Questions", value: (k) => stripHtml(k.backup_questions) },
  { header: "Other Info", value: (k) => stripHtml(k.other_info) },
  {
    header: "Interest in Clinical Trials",
    value: (k) => (k.interested_in_trials ? "Yes" : "No"),
  },
  { header: "Clinical Trials Notes", value: (k) => stripHtml(k.trials_interest_notes) },
  { header: "Societies / Associations", value: (k) => stripHtml(k.society_associations) },
  { header: "Leadership Appointments", value: (k) => stripHtml(k.leadership_appointments) },
  { header: "Publications", value: (k) => stripHtml(k.publications) },
  { header: "Office Website", value: (k) => k.website_office || "" },
  { header: "PubMed", value: (k) => k.website_pubmed || "" },
  { header: "Other Website", value: (k) => k.website_other || "" },
];

type Scope = "all" | "lists" | "kols";

export function ExportModal({
  open,
  onClose,
  kols,
}: {
  open: boolean;
  onClose: () => void;
  kols: KOL[];
}) {
  const [scope, setScope] = useState<Scope>("all");
  const [selectedLists, setSelectedLists] = useState<Set<string>>(new Set());
  const [selectedKols, setSelectedKols] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  const lists = useMemo(() => {
    const set = new Set<string>();
    let hasNone = false;
    for (const k of kols) {
      if (k.list_name) set.add(k.list_name);
      else hasNone = true;
    }
    const out = [...set].sort();
    if (hasNone) out.push(NO_LIST);
    return out;
  }, [kols]);

  const visibleKols = useMemo(() => {
    const q = search.trim().toLowerCase();
    const sorted = [...kols].sort((a, b) =>
      `${a.last_name}${a.first_name}`.localeCompare(`${b.last_name}${b.first_name}`),
    );
    if (!q) return sorted;
    return sorted.filter((k) =>
      `${k.first_name} ${k.last_name} ${k.institution} ${k.list_name}`
        .toLowerCase()
        .includes(q),
    );
  }, [kols, search]);

  const exportRows = useMemo(() => {
    if (scope === "lists") {
      return kols.filter((k) =>
        selectedLists.has(k.list_name ? k.list_name : NO_LIST),
      );
    }
    if (scope === "kols") return kols.filter((k) => selectedKols.has(k.id));
    return kols;
  }, [kols, scope, selectedLists, selectedKols]);

  function toggle<T>(set: Set<T>, value: T, apply: (next: Set<T>) => void) {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    apply(next);
  }

  function exportXlsx() {
    const rows = exportRows.map((k) =>
      Object.fromEntries(COLUMNS.map((c) => [c.header, c.value(k)])),
    );
    const ws = XLSX.utils.json_to_sheet(rows, {
      header: COLUMNS.map((c) => c.header),
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "KOLs");
    const stamp = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `territory-kols-${stamp}.xlsx`);
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="Export to Excel">
      <div className="space-y-4">
        <div className="space-y-2">
          <ScopeOption
            checked={scope === "all"}
            onSelect={() => setScope("all")}
            label={`All KOLs (${kols.length})`}
          />
          <ScopeOption
            checked={scope === "lists"}
            onSelect={() => setScope("lists")}
            label="Specific lists"
          />
          {scope === "lists" && (
            <div className="ml-6 flex flex-wrap gap-1.5">
              {lists.length === 0 && (
                <p className="text-sm text-muted">No lists yet.</p>
              )}
              {lists.map((l) => (
                <button
                  key={l}
                  onClick={() =>
                    toggle(selectedLists, l, setSelectedLists)
                  }
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-medium transition",
                    selectedLists.has(l)
                      ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)]"
                      : "border-border bg-surface text-muted hover:text-ink",
                  )}
                >
                  {l === NO_LIST ? "No list" : l}
                </button>
              ))}
            </div>
          )}
          <ScopeOption
            checked={scope === "kols"}
            onSelect={() => setScope("kols")}
            label="Select KOLs"
          />
          {scope === "kols" && (
            <div className="ml-6 space-y-2">
              <div className="relative">
                <Search
                  size={14}
                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
                />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search KOLs…"
                  className="w-full rounded-lg border border-border bg-surface py-2 pl-8 pr-3 text-sm outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20"
                />
              </div>
              <div className="flex gap-3 text-xs">
                <button
                  onClick={() => setSelectedKols(new Set(kols.map((k) => k.id)))}
                  className="font-medium text-[var(--accent)] hover:underline"
                >
                  Select all
                </button>
                <button
                  onClick={() => setSelectedKols(new Set())}
                  className="font-medium text-muted hover:underline"
                >
                  Clear
                </button>
              </div>
              <div className="max-h-56 space-y-0.5 overflow-y-auto rounded-lg border border-border p-1.5">
                {visibleKols.map((k) => (
                  <label
                    key={k.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-canvas"
                  >
                    <input
                      type="checkbox"
                      checked={selectedKols.has(k.id)}
                      onChange={() => toggle(selectedKols, k.id, setSelectedKols)}
                      className="h-4 w-4 accent-[var(--accent)]"
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {kolFullName(k)}
                      {k.institution && (
                        <span className="text-muted"> · {k.institution}</span>
                      )}
                    </span>
                  </label>
                ))}
                {visibleKols.length === 0 && (
                  <p className="px-2 py-3 text-center text-sm text-muted">
                    No matches.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border pt-4">
          <p className="text-xs text-muted">
            {exportRows.length} KOL{exportRows.length === 1 ? "" : "s"} will be exported
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={exportXlsx} disabled={exportRows.length === 0}>
              <Download size={14} /> Export
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function ScopeOption({
  checked,
  onSelect,
  label,
}: {
  checked: boolean;
  onSelect: () => void;
  label: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
      <input
        type="radio"
        checked={checked}
        onChange={onSelect}
        className="h-4 w-4 accent-[var(--accent)]"
      />
      {label}
    </label>
  );
}
