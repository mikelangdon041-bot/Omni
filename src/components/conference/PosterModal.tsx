"use client";

// Poster create/edit modal: free-text date/time by design (spec — poster
// dates come from programs like "April 22, WEDNESDAY"), coverage reps,
// authors, abstract.

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { useConferenceCtx } from "@/components/conference/ConferenceContext";
import type { PosterWithReps } from "@/lib/conference/hooks";
import type { Poster } from "@/lib/conference/types";

export function PosterModal({
  open,
  onClose,
  poster,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  poster: PosterWithReps | null;
  onSave: (
    posterId: string | null,
    partial: Partial<Poster>,
    repIds?: string[],
  ) => Promise<Poster | null>;
}) {
  const { attendees } = useConferenceCtx();
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [location, setLocation] = useState("");
  const [authors, setAuthors] = useState("");
  const [abstract, setAbstract] = useState("");
  const [sessionLabel, setSessionLabel] = useState("");
  const [reps, setReps] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(poster?.title || "");
    setDate(poster?.date || "");
    setTime(poster?.time || "");
    setLocation(poster?.location || "");
    setAuthors(poster?.authors || "");
    setAbstract(poster?.abstract || "");
    setSessionLabel(poster?.session_label || "");
    setReps(poster?.reps.map((r) => r.attendee_id) || []);
  }, [open, poster]);

  async function save() {
    if (!title.trim()) return;
    setSaving(true);
    await onSave(
      poster?.id || null,
      {
        title: title.trim(),
        date: date.trim(),
        time: time.trim(),
        location: location.trim(),
        authors: authors.trim(),
        abstract,
        session_label: sessionLabel.trim(),
      },
      reps,
    );
    setSaving(false);
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title={poster ? "Edit poster" : "Add poster"} size="lg">
      <div className="space-y-4">
        <Input label="Title *" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Date (as printed in the program)"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            placeholder='e.g. "April 22, WEDNESDAY"'
          />
          <Input
            label="Time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            placeholder='e.g. "10:30 AM"'
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Location" value={location} onChange={(e) => setLocation(e.target.value)} />
          <Input
            label="Session label"
            value={sessionLabel}
            onChange={(e) => setSessionLabel(e.target.value)}
          />
        </div>
        <Input
          label="Authors / presenter"
          value={authors}
          onChange={(e) => setAuthors(e.target.value)}
        />
        <Textarea label="Abstract" value={abstract} onChange={(e) => setAbstract(e.target.value)} />
        <div>
          <p className="mb-1.5 text-sm font-medium">Covering rep(s)</p>
          <div className="flex flex-wrap gap-1.5">
            {attendees.map((a) => {
              const on = reps.includes(a.id);
              return (
                <button
                  key={a.id}
                  onClick={() =>
                    setReps((prev) => (on ? prev.filter((x) => x !== a.id) : [...prev, a.id]))
                  }
                  className={
                    on
                      ? "rounded-full bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white"
                      : "rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-muted hover:text-ink"
                  }
                >
                  {a.name}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || !title.trim()}>
            {saving ? "Saving…" : poster ? "Save" : "Add poster"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
