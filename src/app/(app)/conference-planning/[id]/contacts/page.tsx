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
            placeholder="Search contacts…"
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
          <Plus size={16} /> Add contact
        </Button>
      </div>

      {loading ? (
        <p className="py-12 text-center text-sm text-muted">Loading…</p>
      ) : filtered.length === 0 ? (
        <EmptyState
          title={
            showArchived
              ? "No removed contacts"
              : contacts.length === 0
                ? "No key contacts yet"
                : "No contacts match"
          }
          hint="Track the external stakeholders your team wants to meet at this conference."
          action={
            !showArchived ? (
              <Button onClick={() => setShowAdd(true)}>
                <Plus size={16} /> Add contact
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

function AddContactModal({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (partial: Partial<Contact>) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [tier, setTier] = useState<Tier>("medium");
  const [institution, setInstitution] = useState("");
  const [title, setTitle] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);

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

  return (
    <Modal open={open} onClose={onClose} title="Add key contact">
      <div className="space-y-4">
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
            {saving ? "Adding…" : "Add contact"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
