"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import type { MeetingPrep as Prep } from "@/lib/territory/ai";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";

export function MeetingPrep({ kolId }: { kolId: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prep, setPrep] = useState<Prep | null>(null);

  async function run() {
    setOpen(true);
    if (prep) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/territory/meeting-prep", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ kolId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not generate");
      setPrep(data.prep);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={run}>
        <Sparkles size={14} /> Meeting prep
      </Button>

      <Modal open={open} onClose={() => setOpen(false)} title="AI meeting prep" size="lg">
        {loading ? (
          <p className="py-8 text-center text-sm text-muted">Preparing…</p>
        ) : error ? (
          <p className="text-sm text-status-error">{error}</p>
        ) : prep ? (
          <div className="space-y-5">
            {prep.opener && (
              <Section title="Opening">
                <p className="text-sm text-ink">{prep.opener}</p>
              </Section>
            )}
            {prep.talkingPoints.length > 0 && (
              <Section title="Talking points">
                <List items={prep.talkingPoints} />
              </Section>
            )}
            {prep.reminders.length > 0 && (
              <Section title="Reminders">
                <List items={prep.reminders} />
              </Section>
            )}
            {prep.followUps.length > 0 && (
              <Section title="Follow-ups from last meeting">
                <List items={prep.followUps} />
              </Section>
            )}
            <p className="text-xs text-muted">
              AI-generated from this KOL&apos;s profile, goals, and last meeting.
              Review before using.
            </p>
          </div>
        ) : null}
      </Modal>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
        {title}
      </h4>
      {children}
    </div>
  );
}

function List({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((t, i) => (
        <li key={i} className="flex gap-2 text-sm">
          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
          <span className="text-ink/90">{t}</span>
        </li>
      ))}
    </ul>
  );
}
