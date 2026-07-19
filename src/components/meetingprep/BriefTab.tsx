"use client";

// Meeting Prep — Brief: the generated brief in a two-column magazine layout.
// Every section is editable; redo any section with optional guidance; refine
// the whole brief; brainstorm extra ideas & angles; export Word / Outlook
// invite; push the checklist to the to-do list. Generation itself lives at
// the page level so it keeps running while you switch tabs.

import { useState } from "react";
import {
  AlertTriangle,
  CalendarPlus,
  CheckSquare,
  FileDown,
  FileText,
  HelpCircle,
  Lightbulb,
  ListOrdered,
  ListTodo,
  MessageSquare,
  MessagesSquare,
  Plus,
  RefreshCw,
  Send,
  ShieldAlert,
  Sparkles,
  Target,
  Users,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { RichText } from "@/components/ui/RichText";
import { useToast } from "@/components/ui/Feedback";
import { htmlToPlain } from "@/lib/writer/types";
import type { GenerateOpts } from "@/lib/meetingprep/useBriefGenerator";
import {
  meetingContextText,
  type BriefSection,
  type CustomSection,
  type IdeaSuggestion,
  type MpMeeting,
} from "@/lib/meetingprep/types";
import { exportBriefDocx, downloadMeetingInvite } from "@/lib/meetingprep/exports";

const supabase = createClient();

const IDEAS_SECTION_KEY = "ideas_angles";

const SECTION_ICONS: Record<string, React.ComponentType<{ size?: number | string; className?: string }>> = {
  objective: Target,
  attendees: Users,
  agenda: ListOrdered,
  talking_points: MessageSquare,
  questions_theyll_ask: HelpCircle,
  questions_to_ask: MessagesSquare,
  objections: ShieldAlert,
  checklist: CheckSquare,
  follow_up: Send,
  [IDEAS_SECTION_KEY]: Lightbulb,
};

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function BriefTab({
  m,
  save,
  userId,
  busy,
  briefStale,
  generate,
  goSetup,
  customSections,
  saveCustomSections,
}: {
  m: MpMeeting;
  save: (p: Partial<MpMeeting>) => void;
  userId: string | null;
  busy: string | null;
  briefStale: boolean;
  generate: (opts?: GenerateOpts) => Promise<boolean>;
  goSetup: () => void;
  customSections: CustomSection[];
  saveCustomSections: (s: CustomSection[]) => void;
}) {
  const toast = useToast();
  const [showAdd, setShowAdd] = useState(false);
  const [showIdeas, setShowIdeas] = useState(false);
  const [redoSection, setRedoSection] = useState<BriefSection | null>(null);
  const [guidance, setGuidance] = useState("");
  const [pushedTasks, setPushedTasks] = useState(false);

  const sections = m.brief?.sections || [];
  const hasBrief = sections.length > 0;

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

  // Append a brainstormed idea into the "More angles & ideas" section
  // (creating the section on first use).
  function addIdeaToBrief(idea: IdeaSuggestion) {
    const html = `<p><b>${esc(idea.title)}.</b> ${esc(idea.detail)}</p>`;
    const existing = sections.find((s) => s.key === IDEAS_SECTION_KEY);
    const nextSections = existing
      ? sections.map((s) =>
          s.key === IDEAS_SECTION_KEY ? { ...s, content: s.content + html } : s,
        )
      : [
          ...sections,
          { key: IDEAS_SECTION_KEY, title: "More angles & ideas", content: html },
        ];
    save({
      brief: { ...m.brief, sections: nextSections },
      ideas: (m.ideas || []).map((i) => (i.id === idea.id ? { ...i, added: true } : i)),
    });
    toast("success", `Added "${idea.title}" to the brief`);
  }

  // Empty / generating state.
  if (!hasBrief) {
    return (
      <div className="grid place-items-center rounded-xl border border-dashed border-border bg-surface px-6 py-16 text-center">
        {busy === "all" ? (
          <>
            <span className="mb-3 grid h-12 w-12 place-items-center rounded-full bg-[var(--accent-soft)]">
              <RefreshCw size={20} className="animate-spin text-[var(--accent)]" />
            </span>
            <p className="text-sm font-medium text-ink">Building your brief…</p>
            <p className="mt-1 max-w-md text-sm text-muted">
              Reading your setup, attendees, and documents. This takes about half
              a minute — feel free to look around, I&apos;ll keep working in the
              background.
            </p>
          </>
        ) : (
          <>
            <Sparkles size={22} className="mb-2 text-[var(--accent)]" />
            <p className="text-sm font-medium text-ink">No brief yet</p>
            <p className="mt-1 max-w-md text-sm text-muted">
              Fill in the Setup tab (the more you give me, the sharper the
              brief), then generate — from here or straight from Setup.
            </p>
            <div className="mt-4 flex gap-2">
              <Button variant="secondary" onClick={goSetup}>
                Back to Setup
              </Button>
              <Button onClick={() => void generate()}>
                <Sparkles size={16} /> Generate the brief
              </Button>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Stale-setup banner: the plain "regenerate" only appears when the
          setup actually changed since this brief was written. */}
      {briefStale && (
        <div className="flex flex-col gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 sm:flex-row sm:items-center">
          <p className="flex flex-1 items-start gap-2 text-sm text-amber-900">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" />
            Your setup changed since this brief was generated.
          </p>
          <Button
            size="sm"
            className="shrink-0 !bg-amber-600 hover:!bg-amber-700"
            disabled={!!busy}
            onClick={() => void generate()}
          >
            <RefreshCw size={14} className={busy === "all" ? "animate-spin" : ""} />
            {busy === "all" ? "Updating…" : "Update the brief"}
          </Button>
        </div>
      )}

      {/* Action bar */}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={() => setShowIdeas(true)}>
          <Lightbulb size={14} /> Brainstorm ideas
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

      {/* Sections — two-column magazine layout on large screens (item 11). */}
      <div className="gap-4 lg:columns-2">
        {sections.map((s) => {
          const Icon = SECTION_ICONS[s.key] || FileText;
          const sectionBusy = busy === s.key;
          return (
            <section
              key={s.key}
              className="mb-4 break-inside-avoid rounded-xl border border-border bg-surface shadow-sm"
            >
              <div className="flex items-center justify-between gap-2 rounded-t-xl border-b border-border bg-canvas/50 px-4 py-2.5">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <Icon size={15} className="text-[var(--accent)]" />
                  {s.title}
                </h3>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!!busy}
                  onClick={() => {
                    setGuidance("");
                    setRedoSection(s);
                  }}
                >
                  <RefreshCw size={13} className={sectionBusy ? "animate-spin" : ""} />
                  {sectionBusy ? "Redoing…" : "Redo"}
                </Button>
              </div>
              <div className={`p-3 ${sectionBusy ? "opacity-50" : ""}`}>
                <RichText
                  value={s.content}
                  onChange={(html) => setSection(s.key, html)}
                  minHeight="min-h-16"
                />
              </div>
            </section>
          );
        })}
      </div>

      {/* Refine loop */}
      <section className="rounded-xl border border-[var(--accent)]/30 bg-[var(--accent-soft)]/25 p-4">
        <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
          <Sparkles size={13} className="text-[var(--accent)]" />
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
            onClick={async () => {
              const g = guidance.trim();
              const ok = await generate({ refine: true, guidance: g });
              if (ok) setGuidance("");
            }}
          >
            <Sparkles size={14} /> {busy === "all" ? "Refining…" : "Refine brief"}
          </Button>
        </div>
      </section>

      {/* Item 8: redo one section, with optional guidance on what to change. */}
      <RedoSectionModal
        section={redoSection}
        onClose={() => setRedoSection(null)}
        onRedo={(key, g) => {
          setRedoSection(null);
          void generate({ onlyKey: key, guidance: g });
        }}
      />

      {/* Item 9: creative brainstorm — suggestions you can add one by one. */}
      <IdeasModal
        open={showIdeas}
        onClose={() => setShowIdeas(false)}
        m={m}
        save={save}
        onAddToBrief={addIdeaToBrief}
      />

      <AddSectionModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onAdd={(title, prompt, permanent) => {
          const key = `custom_${Date.now()}`;
          if (permanent) saveCustomSections([...customSections, { key, title, prompt }]);
          setShowAdd(false);
          void generate({ extra: { key, title, prompt } });
        }}
      />
    </div>
  );
}

// Ask what should be different before redoing a section — or just redo it.
function RedoSectionModal({
  section,
  onClose,
  onRedo,
}: {
  section: BriefSection | null;
  onClose: () => void;
  onRedo: (key: string, guidance: string) => void;
}) {
  const [guidance, setGuidance] = useState("");
  return (
    <Modal
      open={!!section}
      onClose={() => {
        setGuidance("");
        onClose();
      }}
      title={section ? `Redo "${section.title}"` : ""}
      size="sm"
    >
      <div className="space-y-3">
        <Textarea
          label="What should be different? (optional)"
          value={guidance}
          onChange={(e) => setGuidance(e.target.value)}
          placeholder='e.g. "shorter and punchier", "focus on the budget angle", "less formal"'
          className="min-h-20"
          autoFocus
        />
        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            onClick={() => {
              setGuidance("");
              onClose();
            }}
          >
            Cancel
          </Button>
          <Button
            onClick={() => {
              if (section) onRedo(section.key, guidance.trim());
              setGuidance("");
            }}
          >
            <RefreshCw size={14} /> Redo section
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// Brainstorm: the AI suggests what else to bring up / showcase — the things
// sharp people in the same seat would do. Each suggestion can be added to the
// brief individually. Suggestions persist on the meeting.
function IdeasModal({
  open,
  onClose,
  m,
  save,
  onAddToBrief,
}: {
  open: boolean;
  onClose: () => void;
  m: MpMeeting;
  save: (p: Partial<MpMeeting>) => void;
  onAddToBrief: (idea: IdeaSuggestion) => void;
}) {
  const toast = useToast();
  const [focus, setFocus] = useState("");
  const [busy, setBusy] = useState(false);

  const ideas = m.ideas || [];

  async function brainstorm() {
    setBusy(true);
    try {
      const briefText = (m.brief?.sections || [])
        .map((s) => `${s.title}:\n${htmlToPlain(s.content)}`)
        .join("\n\n")
        .slice(0, 12000);
      const res = await fetch("/api/meeting/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          action: "ideas",
          context: `${meetingContextText(m)}${briefText ? `\n\nThe current brief:\n${briefText}` : ""}`,
          focus,
          count: 8,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Brainstorm failed");
      const fresh: IdeaSuggestion[] = (json.ideas || [])
        .filter((i: { title?: string }) => (i.title || "").trim())
        .map((i: { title: string; detail: string }, n: number) => ({
          id: `i${Date.now()}_${n}`,
          title: i.title,
          detail: i.detail,
          added: false,
        }));
      save({ ideas: fresh });
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Brainstorm ideas & angles" size="lg">
      <p className="mb-3 text-sm text-muted">
        I&apos;ll suggest what else you could bring up or showcase — the things
        the sharpest people walking into this kind of meeting would prepare.
        Add the ones you like straight into the brief.
      </p>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <Input
          value={focus}
          onChange={(e) => setFocus(e.target.value)}
          placeholder={`Optional focus — e.g. "KPIs and new things we're doing to showcase my team"`}
          className="flex-1"
        />
        <Button disabled={busy} onClick={() => void brainstorm()} className="shrink-0">
          <Lightbulb size={15} />
          {busy ? "Thinking…" : ideas.length ? "Brainstorm again" : "Brainstorm"}
        </Button>
      </div>

      {busy && ideas.length === 0 && (
        <p className="py-8 text-center text-sm text-muted">
          Coming up with ideas tailored to this meeting…
        </p>
      )}

      {ideas.length > 0 && (
        <ul className="space-y-2">
          {ideas.map((idea) => (
            <li
              key={idea.id}
              className={`flex items-start gap-3 rounded-lg border p-3 transition ${
                idea.added
                  ? "border-emerald-200 bg-emerald-50/60"
                  : "border-border bg-surface"
              }`}
            >
              <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]">
                <Lightbulb size={14} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{idea.title}</p>
                <p className="mt-0.5 text-sm text-muted">{idea.detail}</p>
              </div>
              <Button
                size="sm"
                variant={idea.added ? "ghost" : "secondary"}
                disabled={idea.added}
                className="shrink-0"
                onClick={() => onAddToBrief(idea)}
              >
                {idea.added ? "In the brief" : <><Plus size={13} /> Add</>}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
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
