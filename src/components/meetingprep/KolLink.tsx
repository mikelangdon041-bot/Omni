"use client";

// Link the meeting to a Territory Planning KOL — search your territory or
// create a new profile on the spot (it lands in Territory Planning too).

import { useEffect, useMemo, useState } from "react";
import { Link2, Plus, Search, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Feedback";
import { createKolQuick } from "@/lib/meetingprep/territoryLog";

const supabase = createClient();

export interface KolLite {
  id: string;
  first_name: string;
  last_name: string;
  specialty: string;
  institution: string;
  title_position: string;
}

export function useKolLite(kolId: string | null) {
  const [kol, setKol] = useState<KolLite | null>(null);
  useEffect(() => {
    if (!kolId) {
      setKol(null);
      return;
    }
    let active = true;
    void supabase
      .from("kols")
      .select("id, first_name, last_name, specialty, institution, title_position")
      .eq("id", kolId)
      .maybeSingle()
      .then(({ data }) => {
        if (active) setKol((data as KolLite) || null);
      });
    return () => {
      active = false;
    };
  }, [kolId]);
  return kol;
}

export function KolLink({
  userId,
  kolId,
  onLink,
}: {
  userId: string | null;
  kolId: string | null;
  onLink: (id: string | null) => void;
}) {
  const toast = useToast();
  const kol = useKolLite(kolId);
  const [open, setOpen] = useState(false);
  const [kols, setKols] = useState<KolLite[]>([]);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [institution, setInstitution] = useState("");

  useEffect(() => {
    if (!open || !userId) return;
    void supabase
      .from("kols")
      .select("id, first_name, last_name, specialty, institution, title_position")
      .eq("user_id", userId)
      .neq("kol_status", "archived")
      .order("last_name")
      .then(({ data }) => setKols((data as KolLite[]) || []));
  }, [open, userId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return kols.slice(0, 30);
    return kols
      .filter((k) =>
        `${k.first_name} ${k.last_name} ${k.institution} ${k.specialty}`
          .toLowerCase()
          .includes(q),
      )
      .slice(0, 30);
  }, [kols, query]);

  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
        Territory link
      </p>
      {kol ? (
        <div className="flex items-center gap-2 rounded-lg border border-[var(--accent)]/40 bg-[var(--accent-soft)]/40 px-3 py-2.5">
          <Link2 size={14} className="shrink-0 text-[var(--accent)]" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              {kol.first_name} {kol.last_name}
            </p>
            <p className="truncate text-xs text-muted">
              {[kol.title_position, kol.specialty, kol.institution]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <button
            className="rounded p-1 text-muted hover:text-ink"
            title="Unlink"
            onClick={() => onLink(null)}
          >
            <X size={14} />
          </button>
        </div>
      ) : (
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
          <Link2 size={14} /> Link a KOL from Territory
        </Button>
      )}
      <p className="mt-1 text-[11px] leading-snug text-muted">
        Linking pulls their profile, goals, and last-meeting notes into the
        brief — and lets you log this meeting back into Territory when it&apos;s
        done.
      </p>

      <Modal open={open} onClose={() => setOpen(false)} title="Link a KOL">
        <div className="relative mb-3">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your territory…"
            className="pl-9"
          />
        </div>
        <ul className="mb-4 max-h-64 space-y-1 overflow-y-auto">
          {filtered.map((k) => (
            <li key={k.id}>
              <button
                className="w-full rounded-lg border border-border px-3 py-2 text-left transition hover:border-[var(--accent)]/50"
                onClick={() => {
                  onLink(k.id);
                  setOpen(false);
                }}
              >
                <p className="text-sm font-medium">
                  {k.first_name} {k.last_name}
                </p>
                <p className="text-xs text-muted">
                  {[k.specialty, k.institution].filter(Boolean).join(" · ")}
                </p>
              </button>
            </li>
          ))}
          {filtered.length === 0 && (
            <p className="py-4 text-center text-sm text-muted">No matches.</p>
          )}
        </ul>

        <div className="space-y-2 rounded-lg border border-border p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">
            New person? Create their profile
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Input
              label="First name"
              value={first}
              onChange={(e) => setFirst(e.target.value)}
            />
            <Input label="Last name" value={last} onChange={(e) => setLast(e.target.value)} />
            <Input
              label="Specialty"
              value={specialty}
              onChange={(e) => setSpecialty(e.target.value)}
            />
            <Input
              label="Institution"
              value={institution}
              onChange={(e) => setInstitution(e.target.value)}
            />
          </div>
          <div className="flex justify-end">
            <Button
              size="sm"
              disabled={!first.trim() || !last.trim() || creating || !userId}
              onClick={async () => {
                if (!userId) return;
                setCreating(true);
                try {
                  const kol = await createKolQuick({
                    userId,
                    firstName: first.trim(),
                    lastName: last.trim(),
                    specialty: specialty.trim(),
                    institution: institution.trim(),
                  });
                  if (kol) {
                    toast("success", `${kol.first_name} ${kol.last_name} added to Territory Planning`);
                    onLink(kol.id);
                    setOpen(false);
                  }
                } catch (e) {
                  toast("error", (e as Error).message);
                } finally {
                  setCreating(false);
                }
              }}
            >
              <Plus size={14} /> {creating ? "Creating…" : "Create & link"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
