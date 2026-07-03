"use client";

// Key Contacts list (spec §6, §21.2): search + tier filter (mirrored to the
// URL), inline add, archived list with restore, and a `?event=` deep link that
// resolves a schedule contact-meeting to its contact page.

import { useEffect, useMemo, useState } from "react";
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
        <p className="py-12 text-center text-sm text-muted">Loading…</p>
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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((c) => (
            <div
              key={c.id}
              className="group relative rounded-xl border border-border bg-surface p-4 shadow-sm transition hover:shadow-md"
            >
              <Link
                href={`/conference-planning/${conference.id}/contacts/${c.id}`}
                className="flex items-start gap-3"
              >
                <Avatar src={c.photo_url || null} initials={initials(c.name)} size={44} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{c.name}</p>
                  {c.title && <p className="truncate text-sm text-muted">{c.title}</p>}
                  {c.institution && (
                    <p className="truncate text-xs text-muted">{c.institution}</p>
                  )}
                </div>
                <span
                  className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold"
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
        onCreate={async (partial) => {
          const created = await add(partial);
          if (created) {
            router.push(`/conference-planning/${conference.id}/contacts/${created.id}`);
          }
        }}
      />
    </div>
  );
}

interface TerritoryKol {
  id: string;
  first_name: string;
  last_name: string;
  institution: string;
  email: string;
  phone: string;
  title_position: string;
  photo_url: string;
}

function AddContactModal({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (partial: Partial<Contact>) => Promise<void>;
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
  const [pastContacts, setPastContacts] = useState<Contact[]>([]);
  const [importSearch, setImportSearch] = useState("");

  // Load import sources when the modal opens: my shared-KOL directory
  // (territory) and this org's KOLs from past conferences (deduped by name,
  // best-populated record wins).
  useEffect(() => {
    if (!open || !me) return;
    supabase
      .from("kols")
      .select("id, first_name, last_name, institution, email, phone, title_position, photo_url")
      .eq("user_id", me.id)
      .order("last_name")
      .then(({ data }) => setTerritoryKols((data as TerritoryKol[]) || []));
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

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    await onCreate({
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
  }

  async function importTerritory(k: TerritoryKol) {
    setSaving(true);
    await onCreate({
      kol_id: k.id,
      name: `${k.first_name} ${k.last_name}`.trim(),
      institution: k.institution || "",
      title: k.title_position || "",
      email: k.email || "",
      phone: k.phone || "",
      photo_url: k.photo_url || "",
    });
    setSaving(false);
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

  const q = importSearch.trim().toLowerCase();
  const filteredTerritory = q
    ? territoryKols.filter((k) =>
        `${k.first_name} ${k.last_name} ${k.institution}`.toLowerCase().includes(q),
      )
    : territoryKols;
  const filteredPast = q
    ? pastContacts.filter((c) => `${c.name} ${c.institution}`.toLowerCase().includes(q))
    : pastContacts;

  return (
    <Modal open={open} onClose={onClose} title="Add KOL">
      <div className="space-y-4">
        <div className="flex gap-1 border-b border-border">
          {(
            [
              ["new", "New"],
              ["territory", `My Territory KOLs (${territoryKols.length})`],
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
        ) : (
          <>
            <Input
              value={importSearch}
              onChange={(e) => setImportSearch(e.target.value)}
              placeholder="Search…"
            />
            <div className="max-h-72 space-y-1 overflow-y-auto">
              {tab === "territory" &&
                (filteredTerritory.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted">
                    No Territory Planning KOLs yet — they import here automatically once you add them there.
                  </p>
                ) : (
                  filteredTerritory.map((k) => (
                    <button
                      key={k.id}
                      onClick={() => importTerritory(k)}
                      disabled={saving}
                      className="flex w-full items-center gap-3 rounded-lg border border-border px-3 py-2 text-left text-sm transition hover:border-[var(--accent)]"
                    >
                      <Avatar
                        src={k.photo_url || null}
                        initials={initials(`${k.first_name} ${k.last_name}`)}
                        size={32}
                      />
                      <span className="min-w-0">
                        <span className="block truncate font-medium">
                          {k.first_name} {k.last_name}
                        </span>
                        {k.institution && (
                          <span className="block truncate text-xs text-muted">{k.institution}</span>
                        )}
                      </span>
                    </button>
                  ))
                ))}
              {tab === "past" &&
                (filteredPast.length === 0 ? (
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
                ))}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
