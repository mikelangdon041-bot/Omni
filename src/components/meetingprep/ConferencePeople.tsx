"use client";

// Pull attendees straight from Conference Planning: searches the org's
// conference contacts (external VIPs) and team rosters, and adds the pick as
// a meeting attendee with their role/org/background prefilled.

import { useEffect, useMemo, useState } from "react";
import { Presentation, Search, UserPlus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import type { Attendee } from "@/lib/meetingprep/types";

const supabase = createClient();

interface ConfPerson {
  id: string;
  name: string;
  role: string;
  org: string;
  notes: string;
  conference: string;
  kind: "contact" | "team";
}

export function ConferencePeopleButton({
  existingNames,
  onAdd,
}: {
  existingNames: string[];
  onAdd: (a: Attendee) => void;
}) {
  const [open, setOpen] = useState(false);
  const [people, setPeople] = useState<ConfPerson[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open || loaded) return;
    void (async () => {
      const out: ConfPerson[] = [];
      const { data: contacts } = await supabase
        .from("conf_contacts")
        .select("id, name, title, institution, background, interests, conferences(name)")
        .eq("archived", false)
        .order("name")
        .limit(400);
      for (const c of (contacts as unknown as {
        id: string;
        name: string;
        title: string;
        institution: string;
        background: string;
        interests: string[];
        conferences: { name: string } | { name: string }[] | null;
      }[]) || []) {
        const conf = Array.isArray(c.conferences) ? c.conferences[0] : c.conferences;
        out.push({
          id: `c_${c.id}`,
          name: c.name,
          role: c.title || "",
          org: c.institution || "",
          notes: [
            (c.interests || []).length ? `Interests: ${(c.interests || []).join(", ")}` : "",
            (c.background || "").slice(0, 400),
          ]
            .filter(Boolean)
            .join(" — "),
          conference: conf?.name || "",
          kind: "contact",
        });
      }
      const { data: team } = await supabase
        .from("conference_attendees")
        .select("id, name, role, department, conferences(name)")
        .eq("active", true)
        .order("name")
        .limit(400);
      for (const t of (team as unknown as {
        id: string;
        name: string;
        role: string;
        department: string;
        conferences: { name: string } | { name: string }[] | null;
      }[]) || []) {
        const conf = Array.isArray(t.conferences) ? t.conferences[0] : t.conferences;
        out.push({
          id: `t_${t.id}`,
          name: t.name,
          role: t.role || "",
          org: t.department || "",
          notes: "",
          conference: conf?.name || "",
          kind: "team",
        });
      }
      setPeople(out);
      setLoaded(true);
    })();
  }, [open, loaded]);

  const taken = useMemo(
    () => new Set(existingNames.map((n) => n.trim().toLowerCase()).filter(Boolean)),
    [existingNames],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = q
      ? people.filter((p) =>
          `${p.name} ${p.role} ${p.org} ${p.conference}`.toLowerCase().includes(q),
        )
      : people;
    return pool.slice(0, 40);
  }, [people, query]);

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Presentation size={14} /> Add from Conference
      </Button>

      <Modal open={open} onClose={() => setOpen(false)} title="Add from Conference Planning">
        <p className="mb-3 text-sm text-muted">
          Anyone saved in your conferences — key contacts and team members —
          can be dropped straight into this meeting.
        </p>
        <div className="relative mb-3">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, role, institution, conference…"
            className="pl-9"
          />
        </div>
        {!loaded ? (
          <p className="py-6 text-center text-sm text-muted">Loading people…</p>
        ) : filtered.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">
            {people.length === 0
              ? "No contacts or team members found in Conference Planning yet."
              : "No matches."}
          </p>
        ) : (
          <ul className="max-h-80 space-y-1 overflow-y-auto">
            {filtered.map((p) => {
              const added = taken.has(p.name.trim().toLowerCase());
              return (
                <li key={p.id}>
                  <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {p.name}
                        <span
                          className={`ml-2 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${
                            p.kind === "contact"
                              ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                              : "bg-canvas text-muted"
                          }`}
                        >
                          {p.kind === "contact" ? "Contact" : "Team"}
                        </span>
                      </p>
                      <p className="truncate text-xs text-muted">
                        {[p.role, p.org, p.conference].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant={added ? "ghost" : "secondary"}
                      disabled={added}
                      onClick={() =>
                        onAdd({ name: p.name, role: p.role, org: p.org, notes: p.notes })
                      }
                    >
                      <UserPlus size={13} /> {added ? "Added" : "Add"}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Modal>
    </>
  );
}
