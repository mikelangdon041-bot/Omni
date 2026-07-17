"use client";

// Meeting Prep — Brief: generate the structured brief, refine it (whole or
// per section), add sections (optionally saved to the profile forever),
// export Word / Outlook invite, and push the checklist to the to-do list.

import { useState } from "react";
import {
  CalendarPlus,
  FileDown,
  ListTodo,
  Plus,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { RichText } from "@/components/ui/RichText";
import { useToast } from "@/components/ui/Feedback";
import { htmlToPlain } from "@/lib/writer/types";
import {
  DEFAULT_BRIEF_SECTIONS,
  meetingTypeLabel,
  type BriefSection,
  type CustomSection,
  type MpMeeting,
} from "@/lib/meetingprep/types";
import { exportBriefDocx, downloadMeetingInvite } from "@/lib/meetingprep/exports";

const supabase = createClient();

export function BriefTab({
  m,
  save,
  flush,
  userId,
  customSections,
  saveCustomSections,
}: {
  m: MpMeeting;
  save: (p: Partial<MpMeeting>) => void;
  flush: () => Promise<void>;
  userId: string | null;
  customSections: CustomSection[];
  saveCustomSections: (s: CustomSection[]) => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null); // null | 'all' | sectionKey
  const [guidance, setGuidance] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [pushedTasks, setPushedTasks] = useState(false);

  const sections = m.brief?.sections || [];
  const hasBrief = sections.length > 0;

  function blueprint(): { key: string; title: string; prompt: string }[] {
    // Standard sections + the user's saved profile sections + any one-off
    // sections already present in this brief.
    const base = [...DEFAULT_BRIEF_SECTIONS, ...customSections];
    const known = new Set(base.map((s) => s.key));
    for (const s of sections) {
      if (!known.has(s.key)) {
        base.push({ key: s.key, title: s.title, prompt: `Section "${s.title}" as before.` });
      }
    }
    return base;
  }

  async function generate(opts: { onlyKey?: string; refine?: boolean } = {}) {
    setBusy(opts.onlyKey || "all");
    try {
      await flush();
      const res = await fetch("/api/meeting/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          action: "brief",
          meeting: {
            title: m.title,
            meetingType: meetingTypeLabel(m.meeting_type),
            date: m.date,
            durationMin: m.duration_min,
            format: m.format,
            location: m.location,
            attendees: m.attendees,
            objectives: m.objectives,
            background: m.background,
            concerns: m.concerns,
            priorTranscript: m.prior_transcript,
          },
          sections: blueprint(),
          kolId: m.kol_id || "",
          guidance: opts.refine ? guidance : "",
          previousSections: opts.refine || opts.onlyKey ? sections : undefined,
          onlyKey: opts.onlyKey || "",
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Brief generation failed");
      const incoming: BriefSection[] = json.sections || [];
      let next: BriefSection[];
      if (opts.onlyKey) {
        next = sections.map((s) => incoming.find((n) => n.key === s.key) || s);
      } else {
        next = incoming;
      }
      save({ brief: { sections: next, generatedAt: new Date().toISOString() } });
      if (opts.refine) setGuidance("");
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function pushChecklist() {
    if (!userId) return;
    const checklist = sections.find((s) => s.key === "checklist");
    if (!checklist) return;
    const items = htmlToPlain(checklist.content)
      .split("\n")
      .map((l) => l.replace(/^[•\-\d.\s]+/, "").trim())
      .filter((l) => l.length > 2);
    if (!items.length) {
      toast("info", "No checklist items found.");
      return;
    }
    for (const title of items) {
      await supabase.from("tasks").insert({
        user_id: userId,
        title,
        app: "meeting-prep",
        link: `/meeting-prep/${m.id}`,
        entity_label: m.title || "Meeting",
        due_date: m.date,
      });
    }
    setPushedTasks(true);
    toast("success", `${items.length} item${items.length === 1 ? "" : "s"} added to your to-do list`);
  }

  const setSection = (key: string, content: string) =>
    save({
      brief: {
        ...m.brief,
        sections: sections.map((s) => (s.key === key ? { ...s, content } : s)),
      },
    });

  if (!hasBrief) {
    return (
      <div className="grid place-items-center rounded-xl border border-dashed border-border bg-surface px-6 py-16 text-center">
        <p className="text-sm font-medium text-ink">No brief yet</p>
        <p className="mt-1 max-w-md text-sm text-muted">
          Fill in the Setup tab (the more you give me, the sharper the brief),
          then generate. Every section stays editable and refinable.
        </p>
        <Button className="mt-4" disabled={busy === "all"} onClick={() => generate()}>
          <Sparkles size={16} /> {busy === "all" ? "Building your brief…" : "Generate the brief"}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Action bar */}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => generate()}>
          <RefreshCw size={14} /> {busy === "all" ? "Regenerating…" : "Regenerate all"}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setShowAdd(true)}>
          <Plus size={14} /> Add section
        </Button>
        <span className="flex-1" />
        <Button size="sm" variant="secondary" onClick={() => void exportBriefDocx(m)}>
          <FileDown size={14} /> Word
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={!m.date}
          title={m.date ? "Download an Outlook invite" : "Set a date in Setup first"}
          onClick={() => downloadMeetingInvite(m)}
        >
          <CalendarPlus size={14} /> Outlook invite
        </Button>
        <Button size="sm" variant="secondary" disabled={pushedTasks} onClick={pushChecklist}>
          <ListTodo size={14} /> {pushedTasks ? "Added to to-dos" : "Checklist → to-dos"}
        </Button>
      </div>

      {/* Sections */}
      {sections.map((s) => (
        <section key={s.key} className="rounded-xl border border-border bg-surface p-4 shadow-sm">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">{s.title}</h3>
            <Button
              size="sm"
              variant="ghost"
              disabled={!!busy}
              onClick={() => generate({ onlyKey: s.key })}
            >
              <RefreshCw size={13} />
              {busy === s.key ? "Redoing…" : "Redo section"}
            </Button>
          </div>
          <RichText
            value={s.content}
            onChange={(html) => setSection(s.key, html)}
            minHeight="min-h-16"
          />
        </section>
      ))}

      {/* Refine loop */}
      <section className="rounded-xl border border-[var(--accent)]/30 bg-[var(--accent-soft)]/25 p-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
          Refine the whole brief with new guidance
        </p>
        <Textarea
          value={guidance}
          onChange={(e) => setGuidance(e.target.value)}
          placeholder='e.g. "They just published a negative trial — factor that in" or "make the agenda 20 minutes, not 45"'
          className="min-h-16 bg-surface"
        />
        <div className="mt-2 flex justify-end">
          <Button
            size="sm"
            disabled={!!busy || !guidance.trim()}
            onClick={() => generate({ refine: true })}
          >
            <Sparkles size={14} /> {busy === "all" ? "Refining…" : "Refine brief"}
          </Button>
        </div>
      </section>

      <AddSectionModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onAdd={async (title, prompt, permanent) => {
          const key = `custom_${Date.now()}`;
          if (permanent) saveCustomSections([...customSections, { key, title, prompt }]);
          // Generate just this section and append it.
          setShowAdd(false);
          setBusy(key);
          try {
            await flush();
            const res = await fetch("/api/meeting/ai", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "same-origin",
              body: JSON.stringify({
                action: "brief",
                meeting: {
                  title: m.title,
                  meetingType: meetingTypeLabel(m.meeting_type),
                  date: m.date,
                  durationMin: m.duration_min,
                  format: m.format,
                  location: m.location,
                  attendees: m.attendees,
                  objectives: m.objectives,
                  background: m.background,
                  concerns: m.concerns,
                  priorTranscript: m.prior_transcript,
                },
                sections: [{ key, title, prompt }],
                kolId: m.kol_id || "",
              }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error || "Section generation failed");
            const sec: BriefSection | undefined = (json.sections || [])[0];
            if (sec)
              save({
                brief: { ...m.brief, sections: [...sections, sec] },
              });
          } catch (e) {
            toast("error", (e as Error).message);
          } finally {
            setBusy(null);
          }
        }}
      />
    </div>
  );
}

function AddSectionModal({
  open,
  onClose,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (title: string, prompt: string, permanent: boolean) => void;
}) {
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [permanent, setPermanent] = useState(false);

  return (
    <Modal open={open} onClose={onClose} title="Add a section">
      <div className="space-y-3">
        <Input
          label="Section title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder='e.g. "Recent publications to mention"'
        />
        <Textarea
          label="What should it contain?"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Tell the AI what to write here…"
          className="min-h-20"
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={permanent}
            onChange={(e) => setPermanent(e.target.checked)}
            className="h-4 w-4 accent-[var(--accent)]"
          />
          Save to my profile — include in every future brief
        </label>
        <div className="flex justify-end">
          <Button
            disabled={!title.trim() || !prompt.trim()}
            onClick={() => {
              onAdd(title.trim(), prompt.trim(), permanent);
              setTitle("");
              setPrompt("");
              setPermanent(false);
            }}
          >
            <Plus size={14} /> Add & generate
          </Button>
        </div>
      </div>
    </Modal>
  );
}
