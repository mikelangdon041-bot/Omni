"use client";

// The material on a meeting, on Setup: what each piece is, why the writer
// added it, and (for an agenda) the people and session details it turned up,
// waiting to be added.

import { useState } from "react";
import { FileText, Link2, Loader2, Plus, Trash2, UserPlus, Search } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Working } from "@/components/ui/Progress";
import { useToast } from "@/components/ui/Feedback";
import {
  materialPurposeLabel,
  type MpDocument,
  type MpMeeting,
  type PersonProfile,
} from "@/lib/meetingprep/types";
import {
  applyFindings,
  lookUpPeople,
  removeMaterial,
  type GetMeeting,
  type SaveMeeting,
} from "@/lib/meetingprep/material";

export function MaterialList({
  m,
  save,
  getMeeting,
  onAdd,
}: {
  m: MpMeeting;
  save: SaveMeeting;
  getMeeting: GetMeeting;
  onAdd: () => void;
}) {
  const docs = m.documents || [];
  const setDoc = (id: string, partial: Partial<MpDocument>) =>
    save({ documents: docs.map((d) => (d.id === id ? { ...d, ...partial } : d)) });

  return (
    <div className="space-y-2">
      <Button size="sm" variant="secondary" onClick={onAdd}>
        <Plus size={14} /> Add material
      </Button>
      <p className="text-xs text-muted">
        An agenda, a link to the session page, a photo of the programme, a paper, their email.
        Tell me why you&apos;re adding it and I&apos;ll use it that way.
      </p>
      {docs.length > 0 && (
        <ul className="space-y-2">
          {docs.map((d) => (
            <li key={d.id} className="rounded-lg border border-border bg-canvas/40 p-3">
              <div className="mb-2 flex items-center gap-2">
                {d.url ? (
                  <Link2 size={15} className="shrink-0 text-[var(--accent)]" />
                ) : (
                  <FileText size={15} className="shrink-0 text-[var(--accent)]" />
                )}
                <div className="min-w-0 flex-1">
                  {d.url ? (
                    <a
                      href={d.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block truncate text-sm font-medium hover:text-[var(--accent)]"
                    >
                      {d.name}
                    </a>
                  ) : (
                    <p className="truncate text-sm font-medium">{d.name}</p>
                  )}
                  <p className="text-[11px] text-muted">{materialPurposeLabel(d.purpose)}</p>
                </div>
                <button
                  className="shrink-0 rounded p-1 text-muted hover:text-red-600"
                  aria-label="Remove material"
                  onClick={() => removeMaterial(d.id, getMeeting, save)}
                >
                  <Trash2 size={13} />
                </button>
              </div>
              <Input
                value={d.note}
                onChange={(e) => setDoc(d.id, { note: e.target.value })}
                placeholder="Why it's here, and what you want out of it"
              />
              {d.findings && !d.findings.done && (
                <Findings doc={d} m={m} save={save} getMeeting={getMeeting} />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function fmtDate(iso: string): string {
  const t = new Date(iso);
  return Number.isNaN(t.getTime())
    ? iso
    : t.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function Findings({
  doc,
  m,
  save,
  getMeeting,
}: {
  doc: MpDocument;
  m: MpMeeting;
  save: SaveMeeting;
  getMeeting: GetMeeting;
}) {
  const toast = useToast();
  const f = doc.findings!;
  const [people, setPeople] = useState(() => f.people.map(() => true));
  const s = f.session;
  // Only offer what would actually change something.
  const fields = [
    s.topic && s.topic !== m.topic && { key: "topic", label: "Topic", value: s.topic },
    s.durationMin && s.durationMin !== m.duration_min && { key: "duration_min", label: "Length", value: `${s.durationMin} min` },
    s.date && !m.date && { key: "date", label: "When", value: fmtDate(s.date) },
    s.location && !m.location && { key: "location", label: "Where", value: s.location },
  ].filter(Boolean) as { key: string; label: string; value: string }[];
  const [take, setTake] = useState(() => fields.map(() => true));

  const chosen = f.people.filter((_, i) => people[i]);
  const anything = chosen.length > 0 || take.some(Boolean);

  function apply() {
    const session: Record<string, string | number> = {};
    fields.forEach((x, i) => {
      if (!take[i]) return;
      if (x.key === "topic") session.topic = s.topic;
      if (x.key === "duration_min") session.duration_min = s.durationMin;
      if (x.key === "date") session.date = s.date;
      if (x.key === "location") session.location = s.location;
    });
    const added = applyFindings({ docId: doc.id, people: chosen, session, getMeeting, save });
    if (!added.length) {
      toast("success", "Done.");
      return;
    }
    toast("info", `Added ${added.length}. Looking each of them up…`);
    void lookUpPeople({ names: added, getMeeting, save }).then(() =>
      toast("success", `Looked up ${added.length === 1 ? added[0] : `all ${added.length}`}.`),
    );
  }

  function dismiss() {
    save({
      documents: (getMeeting()?.documents || []).map((d) =>
        d.id === doc.id && d.findings ? { ...d, findings: { ...d.findings, done: true } } : d,
      ),
    });
  }

  return (
    <div className="mt-3 space-y-2 rounded-lg border border-[var(--accent)]/30 bg-[var(--accent-soft)]/30 p-3">
      <p className="text-xs font-semibold text-[var(--accent)]">Found in it</p>
      {f.people.length > 0 && (
        <ul className="space-y-1">
          {f.people.map((p, i) => (
            <li key={i}>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={people[i]}
                  onChange={(e) => setPeople((v) => v.map((x, j) => (j === i ? e.target.checked : x)))}
                  className="mt-1 h-3.5 w-3.5 accent-[var(--accent)]"
                />
                <span className="min-w-0">
                  <span className="font-medium">{p.name}</span>
                  {[p.role, p.org].filter(Boolean).length > 0 && (
                    <span className="text-muted">, {[p.role, p.org].filter(Boolean).join(", ")}</span>
                  )}
                  {p.notes && <span className="block text-xs text-muted">{p.notes}</span>}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {fields.length > 0 && (
        <ul className="space-y-1">
          {fields.map((x, i) => (
            <li key={x.key}>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={take[i]}
                  onChange={(e) => setTake((v) => v.map((t, j) => (j === i ? e.target.checked : t)))}
                  className="mt-1 h-3.5 w-3.5 accent-[var(--accent)]"
                />
                <span>
                  <span className="text-muted">{x.label}:</span> {x.value}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={dismiss}>
          Not needed
        </Button>
        <Button size="sm" onClick={apply} disabled={!anything}>
          <UserPlus size={13} />
          {chosen.length ? `Add ${chosen.length} and look them up` : "Apply"}
        </Button>
      </div>
    </div>
  );
}

/** Under an attendee: who they are, looked up, with a button to do it. */
export function PersonLookup({
  name,
  profile,
  getMeeting,
  save,
}: {
  name: string;
  profile?: PersonProfile;
  getMeeting: GetMeeting;
  save: SaveMeeting;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (!name.trim()) return null;

  async function run() {
    setBusy(true);
    await lookUpPeople({
      names: [name],
      getMeeting,
      save,
      onEach: (_, ok) => !ok && toast("error", `Couldn't find anything solid on ${name}.`),
    });
    setBusy(false);
  }

  return (
    <div className="text-xs">
      {/* Measured: 7s for one person. */}
      <Working active={busy} seconds={10} label={`Looking up ${name}`} className="mb-1" />
      {profile?.text ? (
        <details>
          <summary className="cursor-pointer font-medium text-[var(--accent)]">
            Who they are (looked up {new Date(profile.at).toLocaleDateString()})
          </summary>
          <p className="mt-1 leading-relaxed text-ink">{profile.text}</p>
          {profile.sources.length > 0 && (
            <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
              {profile.sources.map((s) => (
                <a
                  key={s.url}
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="max-w-56 truncate text-muted underline hover:text-ink"
                >
                  {s.title || s.url}
                </a>
              ))}
            </p>
          )}
          <button
            type="button"
            onClick={() => void run()}
            disabled={busy}
            className="mt-1 text-muted hover:text-ink"
          >
            {busy ? "Looking…" : "Look up again"}
          </button>
        </details>
      ) : (
        <button
          type="button"
          onClick={() => void run()}
          disabled={busy}
          className="inline-flex items-center gap-1 text-muted hover:text-ink"
        >
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
          {busy ? "Looking them up…" : "Look them up"}
        </button>
      )}
    </div>
  );
}
