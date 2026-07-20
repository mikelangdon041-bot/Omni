"use client";

// Key Contacts list (spec §6, §21.2): search + tier filter (mirrored to the
// URL), inline add, archived list with restore, and a `?event=` deep link that
// resolves a schedule contact-meeting to its contact page.

import { useEffect, useMemo, useState } from "react";
import { Loading } from "@/components/conference/Bits";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Archive, ArchiveRestore, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input, Select } from "@/components/ui/Input";
import { EmptyState } from "@/components/ui/EmptyState";
import { Avatar } from "@/components/ui/Avatar";
import { cn } from "@/lib/ui";
import { useConferenceCtx } from "@/components/conference/ConferenceContext";
import { useContacts } from "@/lib/conference/hooks";
import { TIERS, type Contact, type Tier } from "@/lib/conference/types";
import { initials } from "@/lib/conference/utils";

const supabase = createClient();

export default function ContactsPage() {
  const router = useRouter();
  const { conference } = useConferenceCtx();
  const { contacts, loading, add, update } = useContacts(conference.id);

  const [search, setSearch] = useState(() =>
    typeof window === "undefined"
      ? ""
      : new URLSearchParams(window.location.search).get("q") || "",
  );
  const [tier, setTier] = useState<"all" | Tier>(() =>
    typeof window === "undefined"
      ? "all"
      : ((new URLSearchParams(window.location.search).get("tier") as Tier) || "all"),
  );
  const [showArchived, setShowArchived] = useState(false);
  const [showAdd, setShowAdd] = useState(false);

  // Deep link from a schedule contact-meeting block (?event=<id>).
  useEffect(() => {
    const eventId = new URLSearchParams(window.location.search).get("event");
    if (!eventId) return;
    supabase
      .from("conf_contact_meetings")
      .select("contact_id, id")
      .eq("event_id", eventId)
      .limit(1)
      .then(({ data }) => {
        if (data?.[0]) {
          router.replace(
            `/conference-planning/${conference.id}/contacts/${data[0].contact_id}?meeting=${data[0].id}`,
          );
        }
      });
  }, [conference.id, router]);

  function syncUrl(q: string, t: string) {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (t !== "all") params.set("tier", t);
    const qs = params.toString();
    window.history.replaceState(
      null,
      "",
      `/conference-planning/${conference.id}/contacts${qs ? `?${qs}` : ""}`,
    );
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return contacts.filter((c) => {
      if (c.archived !== showArchived) return false;
      if (tier !== "all" && c.tier !== tier) return false;
      if (
        q &&
        !`${c.name} ${c.institution} ${c.title} ${c.email}`.toLowerCase().includes(q)
      )
        return false;
      return true;
    });
  }, [contacts, search, tier, showArchived]);

  const archivedCount = contacts.filter((c) => c.archived).length;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
          />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              syncUrl(e.target.value, tier);
            }}
            placeholder="Search KOLs…"
            className="w-full rounded-lg border border-border bg-surface py-2.5 pl-9 pr-3 text-sm outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20"
          />
        </div>
        <div className="flex gap-1">
          {(["all", "high", "medium", "low"] as const).map((t) => (
            <button
              key={t}
              onClick={() => {
                setTier(t);
                syncUrl(search, t);
              }}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs font-medium capitalize transition",
                tier === t
                  ? "border-transparent bg-[var(--accent)] text-white"
                  : "border-border bg-surface text-muted hover:text-ink",
              )}
            >
              {t === "all" ? "All tiers" : TIERS[t].label}
            </button>
          ))}
        </div>
        {archivedCount > 0 && (
          <button
            onClick={() => setShowArchived((v) => !v)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition",
              showArchived
                ? "border-transparent bg-ink text-white"
                : "border-border bg-surface text-muted hover:text-ink",
            )}
          >
            <Archive size={13} /> Removed ({archivedCount})
          </button>
        )}
        <Button onClick={() => setShowAdd(true)}>
          <Plus size={16} /> Add KOL
        </Button>
      </div>

      {loading ? (
        <Loading />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={
            showArchived
              ? "No removed KOLs"
              : contacts.length === 0
                ? "No KOLs yet"
                : "No KOLs match"
          }
          hint="Track the KOLs your team wants to meet at this conference."
          action={
            !showArchived ? (
              <Button onClick={() => setShowAdd(true)}>
                <Plus size={16} /> Add KOL
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-3">
          {filtered.map((c) => (
            <div
              key={c.id}
              className="group relative overflow-hidden rounded-xl border border-border bg-surface shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <div className="h-1.5 w-full" style={{ background: TIERS[c.tier].color }} />
              <Link
                href={`/conference-planning/${conference.id}/contacts/${c.id}`}
                className="flex items-start gap-2 p-2.5 sm:gap-3 sm:p-4"
              >
                <Avatar src={c.photo_url || null} initials={initials(c.name)} size={36} className="sm:hidden" />
                <Avatar src={c.photo_url || null} initials={initials(c.name)} size={44} className="hidden sm:block" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold sm:text-base">{c.name}</p>
                  {c.title && <p className="truncate text-xs text-muted sm:text-sm">{c.title}</p>}
                  {c.institution && (
                    <p className="hidden truncate text-xs text-muted sm:block">{c.institution}</p>
                  )}
                </div>
                <span
                  className="shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold sm:px-2 sm:text-[10px]"
                  style={{ background: TIERS[c.tier].soft, color: TIERS[c.tier].color }}
                >
                  {TIERS[c.tier].label}
                </span>
              </Link>
              <button
                onClick={() => update(c.id, { archived: !c.archived })}
                className="absolute bottom-2.5 right-2.5 rounded-lg p-1.5 text-muted opacity-0 transition hover:bg-canvas hover:text-ink group-hover:opacity-100"
                title={c.archived ? "Restore" : "Remove (archive)"}
              >
                {c.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
              </button>
            </div>
          ))}
        </div>
      )}

      <AddContactModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        existing={contacts}
        onCreate={add}
        onCreated={(created) =>
          router.push(`/conference-planning/${conference.id}/contacts/${created.id}`)
        }
      />
    </div>
  );
}

interface TerritoryKol {
  id: string;
  user_id: string;
  first_name: string;
  last_name: string;
  institution: string;
  email: string;
  phone: string;
  title_position: string;
  photo_url: string;
  address: string;
  list_name: string;
}

// Best-effort US state from a free-text address ("… Chicago, IL 60601").
function stateFromAddress(address: string): string {
  const m = /,\s*([A-Z]{2})(?:\s+\d{5}(?:-\d{4})?)?\s*(?:,\s*USA?)?\s*$/.exec(
    (address || "").trim(),
  );
  return m ? m[1] : "";
}

function AddContactModal({
  open,
  onClose,
  existing,
  onCreate,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  existing: Contact[];
  onCreate: (partial: Partial<Contact>) => Promise<Contact | null>;
  onCreated: (created: Contact) => void; // navigate — used for single adds only
}) {
  const { conference, me } = useConferenceCtx();
  const [tab, setTab] = useState<"new" | "territory" | "past">("new");
  const [name, setName] = useState("");
  const [tier, setTier] = useState<Tier>("medium");
  const [institution, setInstitution] = useState("");
  const [title, setTitle] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [territoryKols, setTerritoryKols] = useState<TerritoryKol[]>([]);
  const [owners, setOwners] = useState<Record<string, string>>({}); // user_id → MSL name
  const [pastContacts, setPastContacts] = useState<Contact[]>([]);
  const [importSearch, setImportSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mslFilter, setMslFilter] = useState("all");
  const [stateFilter, setStateFilter] = useState("all");
  const [instFilter, setInstFilter] = useState("all");
  const [listFilter, setListFilter] = useState("all");

  // Load import sources when the modal opens: the org's shared-KOL directory
  // (everyone's territory KOLs — falls back to just mine until the org-read
  // policy from migration 0018 is applied) and this org's KOLs from past
  // conferences (deduped by name, best-populated record wins).
  useEffect(() => {
    if (!open || !me) return;
    setSelected(new Set());
    supabase
      .from("kols")
      .select(
        "id, user_id, first_name, last_name, institution, email, phone, title_position, photo_url, address, list_name",
      )
      .order("last_name")
      .then(({ data }) => setTerritoryKols((data as TerritoryKol[]) || []));
    supabase
      .from("profiles")
      .select("id, display_name, username")
      .then(({ data }) => {
        const map: Record<string, string> = {};
        for (const p of data || []) map[p.id] = p.display_name || p.username || "Teammate";
        setOwners(map);
      });
    supabase
      .from("conf_contacts")
      .select("*")
      .neq("conference_id", conference.id)
      .eq("archived", false)
      .then(({ data }) => {
        const byName = new Map<string, Contact>();
        for (const c of (data as Contact[]) || []) {
          const key = c.name.trim().toLowerCase();
          const existing = byName.get(key);
          const filled = (x: Contact) =>
            [x.institution, x.title, x.email, x.phone, x.background].filter(Boolean).length;
          if (!existing || filled(c) > filled(existing)) byName.set(key, c);
        }
        setPastContacts([...byName.values()].sort((a, b) => a.name.localeCompare(b.name)));
      });
  }, [open, me, conference.id]);

  const alreadyIn = useMemo(() => {
    const kolIds = new Set(existing.filter((c) => c.kol_id).map((c) => c.kol_id));
    const names = new Set(existing.map((c) => c.name.trim().toLowerCase()));
    return { kolIds, names };
  }, [existing]);

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    const created = await onCreate({
      name: name.trim(),
      tier,
      institution: institution.trim(),
      title: title.trim(),
      email: email.trim(),
      phone: phone.trim(),
    });
    setSaving(false);
    setName("");
    setInstitution("");
    setTitle("");
    setEmail("");
    setPhone("");
    onClose();
    if (created) onCreated(created);
  }

  function territoryPartial(k: TerritoryKol): Partial<Contact> {
    return {
      kol_id: k.id,
      name: `${k.first_name} ${k.last_name}`.trim(),
      institution: k.institution || "",
      title: k.title_position || "",
      email: k.email || "",
      phone: k.phone || "",
      photo_url: k.photo_url || "",
    };
  }

  // Multi-import: add every selected KOL, stay on the list.
  async function importSelected() {
    const picked = territoryKols.filter((k) => selected.has(k.id));
    if (!picked.length) return;
    setSaving(true);
    for (const k of picked) await onCreate(territoryPartial(k));
    setSaving(false);
    setSelected(new Set());
    onClose();
  }

  async function importPast(c: Contact) {
    setSaving(true);
    await onCreate({
      kol_id: c.kol_id,
      name: c.name,
      tier: c.tier,
      institution: c.institution,
      title: c.title,
      email: c.email,
      phone: c.phone,
      photo_url: c.photo_url,
      interests: c.interests,
      background: c.background,
      engagement_activities: c.engagement_activities,
      meeting_objectives: c.meeting_objectives,
      links: c.links,
      custom_fields: c.custom_fields,
    });
    setSaving(false);
    onClose();
  }

  // Filter option lists (from the loaded directory).
  const mslOptions = useMemo(
    () => [...new Set(territoryKols.map((k) => k.user_id))],
    [territoryKols],
  );
  const stateOptions = useMemo(
    () =>
      [...new Set(territoryKols.map((k) => stateFromAddress(k.address)).filter(Boolean))].sort(),
    [territoryKols],
  );
  const instOptions = useMemo(
    () => [...new Set(territoryKols.map((k) => k.institution.trim()).filter(Boolean))].sort(),
    [territoryKols],
  );
  const listOptions = useMemo(
    () => [...new Set(territoryKols.map((k) => k.list_name.trim()).filter(Boolean))].sort(),
    [territoryKols],
  );

  const q = importSearch.trim().toLowerCase();
  const filteredTerritory = territoryKols.filter((k) => {
    if (mslFilter !== "all" && k.user_id !== mslFilter) return false;
    if (stateFilter !== "all" && stateFromAddress(k.address) !== stateFilter) return false;
    if (instFilter !== "all" && k.institution.trim() !== instFilter) return false;
    if (listFilter !== "all" && k.list_name.trim() !== listFilter) return false;
    if (q && !`${k.first_name} ${k.last_name} ${k.institution}`.toLowerCase().includes(q))
      return false;
    return true;
  });
  const filteredPast = q
    ? pastContacts.filter((c) => `${c.name} ${c.institution}`.toLowerCase().includes(q))
    : pastContacts;

  const selectableFiltered = filteredTerritory.filter(
    (k) =>
      !alreadyIn.kolIds.has(k.id) &&
      !alreadyIn.names.has(`${k.first_name} ${k.last_name}`.trim().toLowerCase()),
  );

  const filterSelect = (
    value: string,
    onChange: (v: string) => void,
    allLabel: string,
    options: { value: string; label: string }[],
  ) => (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="max-w-40 truncate rounded-full border border-border bg-surface px-2.5 py-1.5 text-xs font-medium outline-none focus:border-[var(--accent)]"
    >
      <option value="all">{allLabel}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );

  return (
    <Modal open={open} onClose={onClose} title="Add KOL" size="lg">
      <div className="space-y-4">
        <div className="flex gap-1 border-b border-border">
          {(
            [
              ["new", "New"],
              ["territory", `Territory KOLs (${territoryKols.length})`],
              ["past", `Past conferences (${pastContacts.length})`],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={cn(
                "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition",
                tab === key
                  ? "border-[var(--accent)] text-[var(--accent)]"
                  : "border-transparent text-muted hover:text-ink",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "new" ? (
          <>
            <Input label="Name *" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            <div className="grid grid-cols-2 gap-3">
              <Select
                label="Engagement tier"
                value={tier}
                onChange={(e) => setTier(e.target.value as Tier)}
              >
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </Select>
              <Input label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <Input
              label="Institution / affiliation"
              value={institution}
              onChange={(e) => setInstitution(e.target.value)}
            />
            <div className="grid grid-cols-2 gap-3">
              <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              <Input label="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={save} disabled={saving || !name.trim()}>
                {saving ? "Adding…" : "Add KOL"}
              </Button>
            </div>
          </>
        ) : tab === "territory" ? (
          <>
            <Input
              value={importSearch}
              onChange={(e) => setImportSearch(e.target.value)}
              placeholder="Search name or institution…"
            />
            <div className="flex flex-wrap gap-1.5">
              {mslOptions.length > 1 &&
                filterSelect(mslFilter, setMslFilter, "All Reps",
                  mslOptions.map((id) => ({
                    value: id,
                    label: id === me?.id ? "My KOLs" : owners[id] || "Teammate",
                  })),
                )}
              {stateOptions.length > 0 &&
                filterSelect(stateFilter, setStateFilter, "All states",
                  stateOptions.map((s) => ({ value: s, label: s })),
                )}
              {instOptions.length > 0 &&
                filterSelect(instFilter, setInstFilter, "All institutions",
                  instOptions.map((s) => ({ value: s, label: s })),
                )}
              {listOptions.length > 0 &&
                filterSelect(listFilter, setListFilter, "All lists",
                  listOptions.map((s) => ({ value: s, label: s })),
                )}
            </div>
            <div className="flex items-center justify-between">
              <label className="inline-flex items-center gap-2 text-xs font-medium text-muted">
                <input
                  type="checkbox"
                  checked={
                    selectableFiltered.length > 0 &&
                    selectableFiltered.every((k) => selected.has(k.id))
                  }
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? new Set([...selected, ...selectableFiltered.map((k) => k.id)])
                        : new Set(
                            [...selected].filter(
                              (id) => !selectableFiltered.some((k) => k.id === id),
                            ),
                          ),
                    )
                  }
                />
                Select all shown ({selectableFiltered.length})
              </label>
              <Button size="sm" onClick={importSelected} disabled={saving || selected.size === 0}>
                <Plus size={13} /> {saving ? "Adding…" : `Add selected (${selected.size})`}
              </Button>
            </div>
            <div className="max-h-72 space-y-1 overflow-y-auto">
              {filteredTerritory.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted">
                  No Territory Planning KOLs match — they import here automatically once added there.
                </p>
              ) : (
                filteredTerritory.map((k) => {
                  const dup =
                    alreadyIn.kolIds.has(k.id) ||
                    alreadyIn.names.has(`${k.first_name} ${k.last_name}`.trim().toLowerCase());
                  const st = stateFromAddress(k.address);
                  return (
                    <label
                      key={k.id}
                      className={cn(
                        "flex w-full cursor-pointer items-center gap-3 rounded-lg border border-border px-3 py-2 text-left text-sm transition",
                        dup ? "opacity-50" : "hover:border-[var(--accent)]",
                      )}
                    >
                      <input
                        type="checkbox"
                        disabled={dup || saving}
                        checked={selected.has(k.id)}
                        onChange={(e) =>
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(k.id);
                            else next.delete(k.id);
                            return next;
                          })
                        }
                      />
                      <Avatar
                        src={k.photo_url || null}
                        initials={initials(`${k.first_name} ${k.last_name}`)}
                        size={32}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">
                          {k.first_name} {k.last_name}
                        </span>
                        <span className="block truncate text-xs text-muted">
                          {[k.institution, st, owners[k.user_id]].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                      {dup && (
                        <span className="shrink-0 rounded-full bg-canvas px-2 py-0.5 text-[10px] font-semibold text-muted">
                          Added
                        </span>
                      )}
                    </label>
                  );
                })
              )}
            </div>
          </>
        ) : (
          <>
            <Input
              value={importSearch}
              onChange={(e) => setImportSearch(e.target.value)}
              placeholder="Search…"
            />
            <div className="max-h-72 space-y-1 overflow-y-auto">
              {filteredPast.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted">
                  No KOLs from previous conferences yet.
                </p>
              ) : (
                filteredPast.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => importPast(c)}
                    disabled={saving}
                    className="flex w-full items-center gap-3 rounded-lg border border-border px-3 py-2 text-left text-sm transition hover:border-[var(--accent)]"
                  >
                    <Avatar src={c.photo_url || null} initials={initials(c.name)} size={32} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{c.name}</span>
                      {c.institution && (
                        <span className="block truncate text-xs text-muted">{c.institution}</span>
                      )}
                    </span>
                    <span
                      className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold"
                      style={{ background: TIERS[c.tier].soft, color: TIERS[c.tier].color }}
                    >
                      {TIERS[c.tier].label}
                    </span>
                  </button>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
