"use client";

// New deck flows: topic → outline you approve → full deck; build from an
// uploaded document; import a .pptx (Remix); start from a template; blank.

import { useState } from "react";
import { FileText, FileUp, LayoutTemplate, Plus, Sparkles, Upload } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Feedback";
import { importPptx } from "@/lib/slides/importPptx";
import {
  DEFAULT_SLIDE_THEME,
  blankSlide,
  contentSlide,
  titleSlide,
  uid,
  type DeckSource,
  type Slide,
  type SlideDeck,
  type SlideTheme,
} from "@/lib/slides/types";

type Flow = "menu" | "topic" | "document" | "outline";

interface OutlineSlide {
  title: string;
  points: string[];
}

export function NewDeckModal({
  open,
  onClose,
  templates,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  templates: SlideDeck[];
  onCreate: (deck: {
    title: string;
    slides: Slide[];
    theme: SlideTheme;
    source: DeckSource;
  }) => Promise<void>;
}) {
  const toast = useToast();
  const [flow, setFlow] = useState<Flow>("menu");
  const [busy, setBusy] = useState("");
  const [topic, setTopic] = useState("");
  const [slideCount, setSlideCount] = useState(8);
  const [docText, setDocText] = useState("");
  const [docName, setDocName] = useState("");
  const [outline, setOutline] = useState<OutlineSlide[]>([]);
  const [deckTitle, setDeckTitle] = useState("");

  function reset() {
    setFlow("menu");
    setBusy("");
    setTopic("");
    setDocText("");
    setDocName("");
    setOutline([]);
    setDeckTitle("");
  }

  async function makeOutline() {
    setBusy("outline");
    try {
      const res = await fetch("/api/slides/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ action: "outline", topic, docText, slideCount }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Outline failed");
      setDeckTitle(json.title);
      setOutline(json.slides);
      setFlow("outline");
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function buildDeck() {
    setBusy("build");
    try {
      const res = await fetch("/api/slides/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ action: "content", outline, topic, docText }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Deck generation failed");
      const theme = DEFAULT_SLIDE_THEME;
      const slides: Slide[] = (json.slides as { title: string; bullets: string[]; notes: string }[]).map(
        (s, i) =>
          i === 0
            ? { ...titleSlide(s.title || deckTitle, topic || docName, theme), notes: s.notes }
            : contentSlide(s.title, s.bullets, theme, s.notes),
      );
      await onCreate({
        title: deckTitle || topic || "Untitled deck",
        slides,
        theme,
        source: docText ? "document" : "topic",
      });
      reset();
    } catch (e) {
      toast("error", (e as Error).message);
      setBusy("");
    }
  }

  async function uploadDoc(file: File | null) {
    if (!file) return;
    setBusy("doc");
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/slides/extract", {
        method: "POST",
        credentials: "same-origin",
        body: form,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not read the document");
      setDocText(json.text);
      setDocName(file.name.replace(/\.[^.]+$/, ""));
      setBusy("");
    } catch (e) {
      toast("error", (e as Error).message);
      setBusy("");
    }
  }

  async function importDeck(file: File | null) {
    if (!file) return;
    setBusy("import");
    try {
      const result = await importPptx(file);
      await onCreate({
        title: file.name.replace(/\.pptx?$/i, ""),
        slides: result.slides.length ? result.slides : [blankSlide()],
        theme: result.theme,
        source: "import",
      });
      const notes: string[] = [];
      if (result.simplified)
        notes.push(`${result.simplified} diagram/chart block(s) were simplified to text`);
      if (result.hasAnimations) notes.push("animations don't carry over");
      if (notes.length) toast("info", `Imported with notes: ${notes.join("; ")}.`);
      reset();
    } catch (e) {
      toast("error", (e as Error).message);
      setBusy("");
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="New deck"
      size="lg"
    >
      {flow === "menu" && (
        <div className="grid gap-2 sm:grid-cols-2">
          <FlowCard
            icon={<Sparkles size={18} />}
            title="From a topic"
            blurb="Describe what the deck should say — approve the outline, then I build it."
            onClick={() => setFlow("topic")}
          />
          <FlowCard
            icon={<FileText size={18} />}
            title="From a document"
            blurb="Upload a Word/PDF/text file and I'll turn it into slides."
            onClick={() => setFlow("document")}
          />
          <label className="cursor-pointer rounded-xl border border-border p-4 text-left transition hover:border-[var(--accent)]/50">
            <span className="mb-1 flex items-center gap-2 text-[var(--accent)]">
              <FileUp size={18} />
              <span className="text-sm font-semibold text-ink">
                {busy === "import" ? "Importing…" : "Import a .pptx (Remix)"}
              </span>
            </span>
            <span className="text-xs leading-snug text-muted">
              Fully editable here. Simple decks come across near-identical;
              complex diagrams get simplified. For text-only edits with zero
              design changes, use Touch-up from the home page instead.
            </span>
            <input
              type="file"
              accept=".pptx"
              className="hidden"
              disabled={!!busy}
              onChange={(e) => {
                void importDeck(e.target.files?.[0] || null);
                e.target.value = "";
              }}
            />
          </label>
          <FlowCard
            icon={<Plus size={18} />}
            title="Blank deck"
            blurb="Start empty and build slide by slide."
            onClick={async () => {
              await onCreate({
                title: "Untitled deck",
                slides: [titleSlide("Untitled deck", "", DEFAULT_SLIDE_THEME)],
                theme: DEFAULT_SLIDE_THEME,
                source: "scratch",
              });
              reset();
            }}
          />
          {templates.length > 0 && (
            <div className="sm:col-span-2">
              <p className="mb-1.5 mt-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
                <LayoutTemplate size={13} /> From one of your templates
              </p>
              <div className="flex flex-wrap gap-2">
                {templates.map((t) => (
                  <button
                    key={t.id}
                    className="rounded-lg border border-border px-3 py-2 text-sm transition hover:border-[var(--accent)]/50"
                    onClick={async () => {
                      await onCreate({
                        title: `${t.title} — copy`,
                        slides: t.slides.map((s) => ({
                          ...s,
                          id: uid(),
                          elements: s.elements.map((e) => ({ ...e, id: uid() })),
                        })),
                        theme: t.theme,
                        source: "template",
                      });
                      reset();
                    }}
                  >
                    {t.title}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {flow === "topic" && (
        <div className="space-y-3">
          <Textarea
            label="What's this deck about — and for whom?"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder='e.g. "Quarterly territory review for my regional director: engagement is up, two at-risk accounts, asking for congress budget"'
            className="min-h-24"
          />
          <Input
            label="Rough number of slides"
            type="number"
            min={3}
            max={30}
            value={slideCount}
            onChange={(e) => setSlideCount(Number(e.target.value) || 8)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setFlow("menu")}>
              Back
            </Button>
            <Button disabled={!topic.trim() || busy === "outline"} onClick={makeOutline}>
              <Sparkles size={14} /> {busy === "outline" ? "Outlining…" : "Propose an outline"}
            </Button>
          </div>
        </div>
      )}

      {flow === "document" && (
        <div className="space-y-3">
          {!docText ? (
            <label className="grid cursor-pointer place-items-center rounded-xl border border-dashed border-border px-6 py-10 text-center transition hover:border-[var(--accent)]/50">
              <Upload size={20} className="mb-2 text-muted" />
              <span className="text-sm font-medium">
                {busy === "doc" ? "Reading document…" : "Upload a .docx, .pdf, or .txt"}
              </span>
              <input
                type="file"
                accept=".docx,.doc,.pdf,.txt,.md"
                className="hidden"
                disabled={!!busy}
                onChange={(e) => {
                  void uploadDoc(e.target.files?.[0] || null);
                  e.target.value = "";
                }}
              />
            </label>
          ) : (
            <p className="rounded-lg bg-canvas px-3 py-2 text-sm text-muted">
              <b className="text-ink">{docName}</b> — {docText.length.toLocaleString()} characters
              extracted.
            </p>
          )}
          <Textarea
            label="Anything to emphasize? (optional)"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="Audience, focus, what to leave out…"
            className="min-h-16"
          />
          <Input
            label="Rough number of slides"
            type="number"
            min={3}
            max={30}
            value={slideCount}
            onChange={(e) => setSlideCount(Number(e.target.value) || 8)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setFlow("menu")}>
              Back
            </Button>
            <Button disabled={!docText || busy === "outline"} onClick={makeOutline}>
              <Sparkles size={14} /> {busy === "outline" ? "Outlining…" : "Propose an outline"}
            </Button>
          </div>
        </div>
      )}

      {flow === "outline" && (
        <div className="space-y-3">
          <Input label="Deck title" value={deckTitle} onChange={(e) => setDeckTitle(e.target.value)} />
          <p className="text-xs text-muted">
            Edit the outline before I write the slides — reorder by editing, blank a
            title to drop the slide.
          </p>
          <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
            {outline.map((s, i) => (
              <div key={i} className="rounded-lg border border-border p-2.5">
                <Input
                  value={s.title}
                  onChange={(e) =>
                    setOutline(outline.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))
                  }
                  placeholder={`Slide ${i + 1} title`}
                />
                {s.points.length > 0 && (
                  <Textarea
                    value={s.points.join("\n")}
                    onChange={(e) =>
                      setOutline(
                        outline.map((x, j) =>
                          j === i ? { ...x, points: e.target.value.split("\n") } : x,
                        ),
                      )
                    }
                    className="mt-1.5 min-h-14 !text-xs"
                  />
                )}
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setFlow(docText ? "document" : "topic")}>
              Back
            </Button>
            <Button disabled={busy === "build"} onClick={buildDeck}>
              <Sparkles size={14} />
              {busy === "build" ? "Writing the slides…" : "Build the deck"}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function FlowCard({
  icon,
  title,
  blurb,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  blurb: string;
  onClick: () => void;
}) {
  return (
    <button
      className="rounded-xl border border-border p-4 text-left transition hover:border-[var(--accent)]/50"
      onClick={onClick}
    >
      <span className="mb-1 flex items-center gap-2 text-[var(--accent)]">
        {icon}
        <span className="text-sm font-semibold text-ink">{title}</span>
      </span>
      <span className="text-xs leading-snug text-muted">{blurb}</span>
    </button>
  );
}
