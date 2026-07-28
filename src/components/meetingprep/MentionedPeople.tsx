"use client";

// Names in the notes that match someone you already have a record for — a KOL
// in Territory Planning, or a teammate in your organisation.
//
// The point is the jump: a meeting mentions Dr. Luna, and Dr. Luna already has
// a profile with history, goals and prior meetings. Retyping the name into
// search to get there is friction that stops people bothering.
//
// Matching is on whole words against names the user already has, so it cannot
// invent a person; a name that matches nothing simply doesn't appear.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Link2, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const supabase = createClient();

interface Person {
  id: string;
  label: string;
  detail: string;
  href?: string;
}

function mentions(haystack: string, name: string): boolean {
  const n = name.trim();
  if (n.length < 3) return false;
  return new RegExp(`(?<![A-Za-z0-9])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9])`, "i").test(
    haystack,
  );
}

export function MentionedPeople({
  notesHtml,
  userId,
  linkedKolId,
  onLinkKol,
}: {
  notesHtml: string;
  userId: string | null;
  linkedKolId: string | null;
  onLinkKol: (kolId: string) => void;
}) {
  const [kols, setKols] = useState<Person[]>([]);
  const [team, setTeam] = useState<Person[]>([]);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    void (async () => {
      const [{ data: kolRows }, { data: profile }] = await Promise.all([
        supabase
          .from("kols")
          .select("id, first_name, last_name, specialty, institution")
          .eq("user_id", userId),
        supabase.from("profiles").select("org_id").eq("id", userId).single(),
      ]);
      if (!active) return;
      setKols(
        (kolRows || []).map((k) => ({
          id: k.id as string,
          label: `${k.first_name ?? ""} ${k.last_name ?? ""}`.trim(),
          detail: [k.specialty, k.institution].filter(Boolean).join(" · "),
          href: `/territory-planning/kol/${k.id}`,
        })),
      );

      const orgId = (profile?.org_id as string) || null;
      if (!orgId) return;
      const { data: mates } = await supabase
        .from("profiles")
        .select("id, display_name, username, role")
        .eq("org_id", orgId);
      if (!active) return;
      setTeam(
        (mates || [])
          .filter((p) => p.id !== userId)
          .map((p) => ({
            id: p.id as string,
            label: (p.display_name || p.username || "").trim(),
            detail: (p.role as string) || "teammate",
          })),
      );
    })();
    return () => {
      active = false;
    };
  }, [userId]);

  // Match against the notes' text, never the markup.
  const text = useMemo(
    () => notesHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "),
    [notesHtml],
  );

  const foundKols = useMemo(
    () =>
      kols.filter(
        (k) =>
          k.label &&
          (mentions(text, k.label) ||
            // Surnames carry most mentions ("Dr. Luna", "Wong").
            mentions(text, k.label.split(" ").slice(-1)[0])),
      ),
    [kols, text],
  );
  const foundTeam = useMemo(
    () => team.filter((p) => p.label && mentions(text, p.label)),
    [team, text],
  );

  if (foundKols.length === 0 && foundTeam.length === 0) return null;

  return (
    <section className="rounded-xl border border-border bg-surface p-4 shadow-sm">
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted">
        <Users size={15} /> People mentioned
      </h2>
      <ul className="flex flex-wrap gap-2">
        {foundKols.map((k) => (
          <li key={k.id} className="flex items-center gap-1">
            <Link
              href={k.href!}
              className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
              title={k.detail}
            >
              {k.label}
              <span className="text-[10px] text-muted">KOL</span>
            </Link>
            {linkedKolId !== k.id && (
              <button
                onClick={() => onLinkKol(k.id)}
                className="rounded-md p-1 text-muted transition hover:text-[var(--accent)]"
                title={`Link this meeting to ${k.label}`}
              >
                <Link2 size={13} />
              </button>
            )}
          </li>
        ))}
        {foundTeam.map((p) => (
          <li
            key={p.id}
            className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-muted"
            title={p.detail}
          >
            {p.label}
            <span className="text-[10px]">team</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-muted">
        Matched against people you already have. Link icon attaches this meeting
        to that KOL, so the debrief can be logged against them.
      </p>
    </section>
  );
}
