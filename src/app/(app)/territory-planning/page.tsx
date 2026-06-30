"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Search, ArrowUpDown, MapPin, List, CalendarDays } from "lucide-react";
import { ModuleHero } from "@/components/ui/ModuleHero";
import { Button } from "@/components/territory/ui/Button";
import { KOLCard } from "@/components/territory/KOLCard";
import { AddKOLModal } from "@/components/territory/AddKOLModal";
import { TerritoryTasks } from "@/components/territory/TerritoryTasks";
import { ImportExport } from "@/components/territory/ImportExport";
import { KolMap } from "@/components/territory/KolMap";
import { TerritoryCalendar } from "@/components/territory/TerritoryCalendar";
import { useKOLs, useReminders, useUserId } from "@/lib/territory/hooks";
import {
  RELATIONSHIP_LABELS,
  cn,
  extractState,
} from "@/lib/territory/utils";
import type { RelationshipLevel } from "@/lib/territory/types";

const ACTIVE_LIST_KEY = "omni_territory_active_list";
const CUSTOM_LISTS_KEY = "omni_territory_custom_lists";
const NONE = "__none__";

type SortKey = "name" | "priority" | "engagement";

export default function TerritoryDashboard() {
  const { userId } = useUserId();
  const { kols, loading, add, addMany, update } = useKOLs(userId);
  const { reminders } = useReminders(userId);

  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState("");
  const [relFilter, setRelFilter] = useState<"all" | RelationshipLevel>("all");
  const [stateFilter, setStateFilter] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [view, setView] = useState<"list" | "map" | "calendar">("list");
  const [activeList, setActiveList] = useState<string>("all");
  const [customLists, setCustomLists] = useState<string[]>([]);

  // Restore persisted list selection.
  useEffect(() => {
    setActiveList(localStorage.getItem(ACTIVE_LIST_KEY) || "all");
    try {
      setCustomLists(JSON.parse(localStorage.getItem(CUSTOM_LISTS_KEY) || "[]"));
    } catch {
      setCustomLists([]);
    }
  }, []);
  useEffect(() => {
    localStorage.setItem(ACTIVE_LIST_KEY, activeList);
  }, [activeList]);

  const lists = useMemo(() => {
    const set = new Set<string>(customLists);
    for (const k of kols) if (k.list_name) set.add(k.list_name);
    return [...set].sort();
  }, [kols, customLists]);

  const states = useMemo(() => {
    const set = new Set<string>();
    for (const k of kols) {
      const s = extractState(k.address);
      if (s) set.add(s);
    }
    return [...set].sort();
  }, [kols]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = kols.filter((k) => {
      if (activeList === NONE && k.list_name) return false;
      if (activeList !== "all" && activeList !== NONE && k.list_name !== activeList)
        return false;
      if (relFilter !== "all" && k.relationship_level !== relFilter) return false;
      if (stateFilter !== "all" && extractState(k.address) !== stateFilter)
        return false;
      if (q) {
        const hay =
          `${k.first_name} ${k.last_name} ${k.specialty} ${k.institution} ${k.address}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    out = [...out].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "name")
        cmp = `${a.last_name}${a.first_name}`.localeCompare(
          `${b.last_name}${b.first_name}`,
        );
      else if (sortKey === "priority") cmp = a.priority - b.priority;
      else cmp = a.engagement_score - b.engagement_score;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return out;
  }, [kols, activeList, relFilter, stateFilter, search, sortKey, sortDir]);

  const stats = useMemo(() => {
    const active = reminders.filter((r) => !r.completed_at);
    const now = Date.now();
    return {
      total: kols.length,
      active: kols.filter((k) => k.kol_status === "active").length,
      advocates: kols.filter((k) => k.relationship_level === "advocate").length,
      tasks: active.length,
      overdue: active.filter((r) => new Date(r.due_date).getTime() < now).length,
    };
  }, [kols, reminders]);

  function addCustomList() {
    const name = window.prompt("New list name")?.trim();
    if (!name) return;
    const next = [...new Set([...customLists, name])];
    setCustomLists(next);
    localStorage.setItem(CUSTOM_LISTS_KEY, JSON.stringify(next));
    setActiveList(name);
  }

  return (
    <>
      <ModuleHero
        eyebrow="Territory Planning"
        icon={MapPin}
        title="Your KOL territory"
        subtitle="Track contacts, outreach cycles, and engagement across your region."
        stats={[
          { label: "KOLs", value: stats.total },
          { label: "Active", value: stats.active },
          { label: "Advocates", value: stats.advocates },
          {
            label: stats.overdue > 0 ? `Tasks · ${stats.overdue} overdue` : "Open tasks",
            value: stats.tasks,
          },
        ]}
        action={
          <div className="flex flex-wrap gap-2">
            <TerritoryTasks userId={userId} />
            <Button
              onClick={() => setShowAdd(true)}
              className="!bg-white !text-ink hover:!bg-white/90"
            >
              <Plus size={16} /> Add KOL
            </Button>
          </div>
        }
      />

      {/* List tabs */}
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        <ListTab label="All" active={activeList === "all"} onClick={() => setActiveList("all")} />
        {lists.map((l) => (
          <ListTab
            key={l}
            label={l}
            active={activeList === l}
            onClick={() => setActiveList(l)}
          />
        ))}
        <ListTab label="No list" active={activeList === NONE} onClick={() => setActiveList(NONE)} />
        <button
          onClick={addCustomList}
          className="rounded-full px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary-soft"
        >
          + New list
        </button>
        <div className="ml-auto">
          <ImportExport
            kols={kols}
            onImport={async (rows) => {
              await addMany(rows);
            }}
          />
        </div>
      </div>

      {/* Search + filters */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, specialty, institution, address…"
            className="w-full rounded-lg border border-border bg-surface py-2.5 pl-9 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <select
          value={relFilter}
          onChange={(e) => setRelFilter(e.target.value as typeof relFilter)}
          className="rounded-lg border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-primary"
        >
          <option value="all">All relationships</option>
          {(Object.keys(RELATIONSHIP_LABELS) as RelationshipLevel[]).map((r) => (
            <option key={r} value={r}>
              {RELATIONSHIP_LABELS[r]}
            </option>
          ))}
        </select>
        {states.length > 0 && (
          <select
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value)}
            className="rounded-lg border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-primary"
          >
            <option value="all">All states</option>
            {states.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}
        <div className="flex items-center gap-1.5">
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="rounded-lg border border-border bg-surface px-3 py-2.5 text-sm outline-none focus:border-primary"
          >
            <option value="name">Name</option>
            <option value="priority">Priority</option>
            <option value="engagement">Engagement</option>
          </select>
          <button
            onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
            className="rounded-lg border border-border bg-surface p-2.5 text-muted transition hover:text-ink"
            title={sortDir === "asc" ? "Ascending" : "Descending"}
          >
            <ArrowUpDown size={16} />
          </button>
          <div className="flex overflow-hidden rounded-lg border border-border">
            <button
              onClick={() => setView("list")}
              className={`px-3 py-2.5 ${view === "list" ? "bg-[var(--accent)] text-white" : "bg-surface text-muted hover:text-ink"}`}
              title="List"
            >
              <List size={16} />
            </button>
            <button
              onClick={() => setView("map")}
              className={`px-3 py-2.5 ${view === "map" ? "bg-[var(--accent)] text-white" : "bg-surface text-muted hover:text-ink"}`}
              title="Map"
            >
              <MapPin size={16} />
            </button>
            <button
              onClick={() => setView("calendar")}
              className={`px-3 py-2.5 ${view === "calendar" ? "bg-[var(--accent)] text-white" : "bg-surface text-muted hover:text-ink"}`}
              title="Calendar"
            >
              <CalendarDays size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Grid / Map / Calendar */}
      {view === "map" ? (
        <KolMap kols={filtered} update={update} />
      ) : view === "calendar" ? (
        <TerritoryCalendar kols={kols} />
      ) : loading ? (
        <p className="py-12 text-center text-sm text-muted">Loading…</p>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-surface px-6 py-16 text-center text-sm text-muted">
          {kols.length === 0
            ? "No KOLs yet. Add your first contact to start building your territory."
            : "No KOLs match these filters."}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((k) => (
            <KOLCard key={k.id} kol={k} />
          ))}
        </div>
      )}

      <AddKOLModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onCreate={add}
        lists={lists}
      />
    </>
  );
}

function ListTab({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-full px-3 py-1 text-xs font-medium transition",
        active
          ? "bg-[var(--accent)] text-[var(--accent-fg)]"
          : "bg-surface text-muted hover:bg-canvas hover:text-ink border border-border",
      )}
    >
      {label}
    </button>
  );
}
