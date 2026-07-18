"use client";

// The deck editor: full-width workspace — thumbnails · canvas · collapsible
// side rail — with AI refine loops (slide + deck-wide proposals with optional
// attached documents), the Polish pass, script generation, versions, practice
// mode with coaching, a design panel (presets, fonts, transitions, personal
// defaults), rich-text speaker notes, and .pptx export with transitions.

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Copy,
  Download,
  FileText,
  History,
  LayoutTemplate,
  Mic,
  MousePointerClick,
  NotebookPen,
  Palette,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  ScrollText,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import { BackButton } from "@/components/BackButton";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { RichText } from "@/components/ui/RichText";
import { useConfirm, useToast } from "@/components/ui/Feedback";
import { SlideCanvas } from "@/components/slides/SlideCanvas";
import { AddElementBar, ColorInput, Inspector } from "@/components/slides/Inspector";
import { ChartDataModal, type ChartData } from "@/components/slides/ChartDataModal";
import { PracticeMode } from "@/components/slides/PracticeMode";
import { useDeck, usePracticeRuns, useUserId } from "@/lib/slides/hooks";
import { saveSlidePrefs } from "@/lib/slides/prefs";
import { polishSlides } from "@/lib/slides/polish";
import { exportDeckPptx } from "@/lib/slides/pptx";
import {
  THEME_PRESETS,
  TRANSITIONS,
  blankSlide,
  buildSlideFromSpec,
  contentSlide,
  notesToText,
  uid,
  type DeckVersion,
  type Slide,
  type SlideElement,
  type SlideSpec,
  type SlideTheme,
  type SlideTransition,
} from "@/lib/slides/types";

interface AIShape {
  title: string;
  bullets: string[];
  notes: string;
}

interface ProposalEntry {
  basedOn: number;
  change: string;
  spec: SlideSpec;
}

interface Proposal {
  summary: string;
  slides: ProposalEntry[];
}

function slideToAI(s: Slide): AIShape {
  const titleEl =
    s.elements.find((e) => e.type === "text" && (e.fontSize || 16) >= 20) ||
    s.elements.find((e) => e.type === "text");
  const bulletsEl = s.elements.find((e) => e.type === "bullets");
  return {
    title: titleEl?.text || "",
    bullets: bulletsEl?.bullets || [],
    notes: notesToText(s.notes),
  };
}

function applyAI(s: Slide, shape: AIShape, theme: SlideTheme): Slide {
  let elements = [...s.elements];
  const titleIdx = elements.findIndex(
    (e) => e.type === "text" && (e.fontSize || 16) >= 20,
  );
  const anyTextIdx = elements.findIndex((e) => e.type === "text");
  const ti = titleIdx >= 0 ? titleIdx : anyTextIdx;
  if (shape.title) {
    if (ti >= 0) elements[ti] = { ...elements[ti], text: shape.title };
    else
      elements = [
        {
          id: uid(),
          type: "text",
          text: shape.title,
          x: 0.5,
          y: 0.3,
          w: 9,
          h: 0.7,
          fontSize: 24,
          bold: true,
          color: theme.text,
        },
        ...elements,
      ];
  }
  const bi = elements.findIndex((e) => e.type === "bullets");
  if (shape.bullets.length) {
    if (bi >= 0) elements[bi] = { ...elements[bi], bullets: shape.bullets };
    else
      elements = [
        ...elements,
        {
          id: uid(),
          type: "bullets",
          bullets: shape.bullets,
          x: 0.5,
          y: 1.35,
          w: 9,
          h: 3.9,
          fontSize: 16,
          color: theme.text,
        },
      ];
  }
  return { ...s, elements, notes: shape.notes || s.notes };
}

function RailSection({
  title,
  icon,
  tone = "plain",
  defaultOpen = true,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  tone?: "plain" | "accent";
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section
      className={`overflow-hidden rounded-xl border shadow-sm ${
        tone === "accent"
          ? "border-[var(--accent)]/30 bg-[var(--accent-soft)]/25"
          : "border-border bg-surface"
      }`}
    >
      <button
        className={`flex w-full items-center gap-1.5 px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide ${
          tone === "accent" ? "text-[var(--accent)]" : "text-muted"
        }`}
        onClick={() => setOpen((v) => !v)}
      >
        {icon}
        <span className="flex-1">{title}</span>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </section>
  );
}

export default function DeckEditorPage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const confirm = useConfirm();
  const { userId } = useUserId();
  const { deck, loading, save, flush, snapshot, listVersions, saveState } = useDeck(id);
  const { runs, add: addRun } = usePracticeRuns(id, userId);

  const [current, setCurrent] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [slideGuidance, setSlideGuidance] = useState("");
  const [deckGuidance, setDeckGuidance] = useState("");
  const [aiDoc, setAiDoc] = useState<{ name: string; text: string } | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [showPractice, setShowPractice] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [versions, setVersions] = useState<DeckVersion[]>([]);
  const [showDesign, setShowDesign] = useState(false);
  const [showScript, setShowScript] = useState(false);
  const [showRuns, setShowRuns] = useState(false);
  const [showNotes, setShowNotes] = useState(true);
  const [railOpen, setRailOpen] = useState(true);
  const [scriptMinutes, setScriptMinutes] = useState(10);
  const [scriptGuidance, setScriptGuidance] = useState("");
  const [chartTarget, setChartTarget] = useState<"new" | string | null>(null);
  const [canvasW, setCanvasW] = useState(640);
  const canvasWrapRef = useRef<HTMLDivElement>(null);

  // The canvas fills whatever the grid gives it — observe, don't guess, so
  // it never overlaps the rail while panels open/close or the window resizes.
  useEffect(() => {
    const node = canvasWrapRef.current;
    if (!node) return;
    const measure = () => setCanvasW(Math.max(320, node.clientWidth - 4));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    return () => ro.disconnect();
  }, [loading, railOpen]);

  const slides = deck?.slides || [];
  const theme = deck?.theme;
  const slide = slides[Math.min(current, Math.max(0, slides.length - 1))];

  const setSlides = useCallback(
    (next: Slide[]) => save({ slides: next }),
    [save],
  );

  const updateSlide = (i: number, partial: Partial<Slide>) =>
    setSlides(slides.map((s, j) => (j === i ? { ...s, ...partial } : s)));

  const updateElement = (elId: string, partial: Partial<SlideElement>) =>
    updateSlide(current, {
      elements: slide.elements.map((e) => (e.id === elId ? { ...e, ...partial } : e)),
    });

  if (loading) return <p className="py-16 text-center text-sm text-muted">Loading…</p>;
  if (!deck || !theme)
    return (
      <div className="py-16 text-center">
        <p className="text-sm text-muted">This deck was deleted.</p>
        <div className="mt-3 flex justify-center">
          <BackButton label="Back to Slide Studio" />
        </div>
      </div>
    );

  const selected = slide?.elements.find((e) => e.id === selectedId) || null;
  const chartInitial: ChartData | null =
    chartTarget && chartTarget !== "new"
      ? (() => {
          const el = slide?.elements.find((e) => e.id === chartTarget);
          return el?.type === "chart"
            ? {
                chartType: el.chartType || "bar",
                labels: el.labels || [],
                series: el.series || [],
              }
            : null;
        })()
      : null;

  async function ai(payload: Record<string, unknown>) {
    const res = await fetch("/api/slides/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "AI request failed");
    return json;
  }

  async function aiRefineSlide() {
    if (!slide || !theme) return;
    setBusy("slide");
    try {
      await flush();
      const json = await ai({
        action: "refine_slide",
        slide: slideToAI(slide),
        guidance: slideGuidance,
        deckContext: deck?.title,
      });
      setSlides(
        slides.map((s, i) => (i === current ? applyAI(s, json as AIShape, theme) : s)),
      );
      setSlideGuidance("");
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function proposeDeckRevision() {
    if (!deck || !theme) return;
    setBusy("deck");
    try {
      await flush();
      const json = await ai({
        action: "revise_deck",
        slides: slides.map(slideToAI),
        guidance: deckGuidance,
        docText: aiDoc?.text || "",
      });
      const p = json as Proposal;
      if (!p.slides?.length) throw new Error("The AI returned an empty proposal.");
      setProposal(p);
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function applyProposal() {
    if (!proposal || !theme) return;
    setBusy("apply");
    try {
      await snapshot("Before deck-wide AI edit", slides, theme);
      const next = proposal.slides.map((entry) => {
        const unchanged =
          entry.change.trim().toLowerCase() === "unchanged" &&
          entry.basedOn >= 0 &&
          slides[entry.basedOn];
        if (unchanged) return slides[entry.basedOn];
        const built = buildSlideFromSpec(entry.spec, theme);
        // Preserve existing notes when the AI didn't write new ones.
        if (!entry.spec.notes && entry.basedOn >= 0 && slides[entry.basedOn])
          return { ...built, notes: slides[entry.basedOn].notes };
        return built;
      });
      setSlides(next);
      setProposal(null);
      setDeckGuidance("");
      setAiDoc(null);
      setCurrent(0);
      toast("success", "Deck updated — the previous version is in Versions.");
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function attachAiDoc(file: File | null) {
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
      setAiDoc({ name: file.name, text: json.text });
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function runPolish() {
    if (!deck || !theme) return;
    setBusy("polish");
    try {
      await flush();
      await snapshot("Before Polish", slides, theme);
      const report = polishSlides(slides);
      let next = report.slides;
      let trimmed = 0;
      // Content still too big for its box even at minimum font → AI trim.
      for (const si of report.stillOverflowing) {
        try {
          const json = await ai({
            action: "refine_slide",
            slide: slideToAI(next[si]),
            guidance:
              "This slide has too much text to fit. Shorten the bullets (fewer words, same meaning; drop the least important detail) so it fits comfortably.",
          });
          next = next.map((s, i) => (i === si ? applyAI(s, json as AIShape, theme) : s));
          trimmed++;
        } catch {
          // leave that slide as-is
        }
      }
      if (trimmed) next = polishSlides(next).slides;
      setSlides(next);
      const n = report.fixes.length;
      toast(
        "success",
        n || trimmed
          ? `Polish: ${n} layout fix${n === 1 ? "" : "es"}${trimmed ? `, ${trimmed} slide(s) tightened by AI` : ""}.`
          : "Polish: everything already lines up.",
      );
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function generateScript() {
    if (!deck || !theme) return;
    setBusy("script");
    try {
      await flush();
      await snapshot("Before script generation", slides, theme);
      const json = await ai({
        action: "script",
        slides: slides.map(slideToAI),
        minutes: scriptMinutes,
        guidance: scriptGuidance,
      });
      const notes: string[] = json.notes || [];
      setSlides(slides.map((s, i) => ({ ...s, notes: notes[i] ?? s.notes })));
      setShowScript(false);
      toast("success", "Script written into every slide's speaker notes.");
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setBusy("");
    }
  }

  const removedSlides = proposal
    ? slides
        .map((s, i) => ({ s, i }))
        .filter(({ i }) => !proposal.slides.some((e) => e.basedOn === i))
    : [];

  return (
    // Full-bleed workspace: break out of the app's max-width container.
    <div className="mx-[calc(50%-50vw)] px-3 sm:px-6">
      <div className="mx-auto max-w-[1800px]">
        {/* Top bar */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <BackButton label="Slide Studio" />
          <Input
            value={deck.title}
            onChange={(e) => save({ title: e.target.value })}
            className="!w-64 font-medium"
          />
          <span
            className={`text-xs transition ${
              saveState === "saving" ? "text-muted" : "text-emerald-600"
            }`}
          >
            {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : ""}
          </span>
          <span className="flex-1" />
          <Button size="sm" variant="secondary" disabled={!!busy} onClick={runPolish}>
            <Wand2 size={14} className="text-fuchsia-500" />
            {busy === "polish" ? "Polishing…" : "Polish"}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setShowScript(true)}>
            <ScrollText size={14} className="text-sky-500" /> Script
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setShowPractice(true)}>
            <Mic size={14} className="text-rose-500" /> Practice
            {runs.length > 0 ? ` (${runs.length})` : ""}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setShowDesign(true)}>
            <Palette size={14} className="text-amber-500" /> Design
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={async () => {
              setVersions(await listVersions());
              setShowVersions(true);
            }}
          >
            <History size={14} className="text-violet-500" /> Versions
          </Button>
          <Button
            size="sm"
            variant={deck.is_template ? "primary" : "secondary"}
            title="Templates can seed new decks and Conference Post-Con decks"
            onClick={() => save({ is_template: !deck.is_template })}
          >
            <LayoutTemplate size={14} /> {deck.is_template ? "Template ✓" : "Make template"}
          </Button>
          <Button
            size="sm"
            disabled={!!busy}
            onClick={async () => {
              await flush();
              await exportDeckPptx(deck.title, slides, theme);
            }}
          >
            <Download size={14} /> Export .pptx
          </Button>
        </div>

        <div
          className={`grid gap-4 ${
            railOpen
              ? "lg:grid-cols-[160px_minmax(0,1fr)_300px]"
              : "lg:grid-cols-[160px_minmax(0,1fr)_40px]"
          }`}
        >
          {/* Thumbnails */}
          <div className="flex gap-2 overflow-x-auto pb-1 lg:max-h-[calc(100vh-180px)] lg:flex-col lg:overflow-y-auto lg:overflow-x-hidden lg:pb-0 lg:pr-1">
            {slides.map((s, i) => (
              <button
                key={s.id}
                onClick={() => {
                  setCurrent(i);
                  setSelectedId(null);
                }}
                className={`relative shrink-0 rounded-md border-2 p-0.5 transition ${
                  i === current
                    ? "border-[var(--accent)] shadow-md"
                    : "border-transparent hover:border-border"
                }`}
              >
                <div className="pointer-events-none">
                  <SlideCanvas slide={s} theme={theme} width={140} />
                </div>
                <span className="absolute bottom-1 left-1.5 rounded bg-ink/60 px-1 text-[10px] font-semibold text-white">
                  {i + 1}
                </span>
              </button>
            ))}
            <Button
              size="sm"
              variant="secondary"
              className="shrink-0"
              onClick={() => {
                setSlides([...slides, contentSlide("New slide", ["First point"], theme)]);
                setCurrent(slides.length);
              }}
            >
              <Plus size={14} /> Slide
            </Button>
          </div>

          {/* Canvas + notes */}
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              <AddElementBar
                onAdd={(el) => {
                  updateSlide(current, { elements: [...slide.elements, el] });
                  setSelectedId(el.id);
                }}
                onInsertChart={() => setChartTarget("new")}
              />
              <span className="flex-1" />
              <Button
                size="sm"
                variant="ghost"
                disabled={current === 0}
                title="Move slide up"
                onClick={() => {
                  const next = [...slides];
                  [next[current - 1], next[current]] = [next[current], next[current - 1]];
                  setSlides(next);
                  setCurrent(current - 1);
                }}
              >
                <ChevronUp size={14} />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={current >= slides.length - 1}
                title="Move slide down"
                onClick={() => {
                  const next = [...slides];
                  [next[current + 1], next[current]] = [next[current], next[current + 1]];
                  setSlides(next);
                  setCurrent(current + 1);
                }}
              >
                <ChevronDown size={14} />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                title="Duplicate slide"
                onClick={() => {
                  const copy: Slide = {
                    ...slide,
                    id: uid(),
                    elements: slide.elements.map((e) => ({ ...e, id: uid() })),
                  };
                  const next = [...slides];
                  next.splice(current + 1, 0, copy);
                  setSlides(next);
                  setCurrent(current + 1);
                }}
              >
                <Copy size={14} />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                title="Delete slide"
                onClick={async () => {
                  if (
                    await confirm({
                      title: "Delete this slide?",
                      confirmLabel: "Delete",
                      danger: true,
                    })
                  ) {
                    const next = slides.filter((_, i) => i !== current);
                    setSlides(next.length ? next : [blankSlide()]);
                    setCurrent(Math.max(0, current - 1));
                    setSelectedId(null);
                  }
                }}
              >
                <Trash2 size={14} />
              </Button>
            </div>

            <div ref={canvasWrapRef} className="min-w-0">
              {slide && (
                <SlideCanvas
                  slide={slide}
                  theme={theme}
                  width={canvasW}
                  interactive
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  onChange={(elements) => updateSlide(current, { elements })}
                />
              )}
            </div>

            {/* Speaker notes — optional, rich text, autosaves with the deck */}
            <div className="mt-3">
              <button
                className="mb-1.5 inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted transition hover:text-ink"
                onClick={() => setShowNotes((v) => !v)}
              >
                <NotebookPen size={13} />
                Speaker notes — slide {current + 1}
                {showNotes ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              </button>
              {showNotes && slide && (
                <RichText
                  value={slide.notes || ""}
                  onChange={(html) => updateSlide(current, { notes: html })}
                  placeholder="What you'll say on this slide… (autosaves; exported into PowerPoint's notes)"
                  minHeight="min-h-24"
                />
              )}
            </div>
          </div>

          {/* Side rail */}
          {railOpen ? (
            <div className="space-y-3">
              <div className="flex justify-end">
                <button
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted transition hover:bg-canvas hover:text-ink"
                  onClick={() => setRailOpen(false)}
                  title="Collapse panel"
                >
                  <PanelRightClose size={14} /> Hide
                </button>
              </div>

              <RailSection title="Selected element" icon={<MousePointerClick size={13} />}>
                {selected ? (
                  <Inspector
                    el={selected}
                    theme={theme}
                    onChange={(p) => updateElement(selected.id, p)}
                    onDelete={() => {
                      updateSlide(current, {
                        elements: slide.elements.filter((e) => e.id !== selected.id),
                      });
                      setSelectedId(null);
                    }}
                    onEditChart={() => setChartTarget(selected.id)}
                  />
                ) : (
                  <p className="py-4 text-center text-xs text-muted">
                    Click an element on the slide to edit it — drag to move, corner handle to
                    resize.
                  </p>
                )}
              </RailSection>

              <RailSection title="AI — this slide" icon={<Sparkles size={13} />} tone="accent">
                <Textarea
                  value={slideGuidance}
                  onChange={(e) => setSlideGuidance(e.target.value)}
                  placeholder='"Split into two points", "punchier title", "add the safety caveat"…'
                  className="min-h-14 bg-surface !text-xs"
                />
                <div className="mt-1.5 flex justify-end">
                  <Button
                    size="sm"
                    disabled={!!busy || !slideGuidance.trim()}
                    onClick={aiRefineSlide}
                  >
                    <Sparkles size={13} /> {busy === "slide" ? "Working…" : "Apply"}
                  </Button>
                </div>
              </RailSection>

              <RailSection title="AI — whole deck" icon={<Sparkles size={13} />} tone="accent">
                <Textarea
                  value={deckGuidance}
                  onChange={(e) => setDeckGuidance(e.target.value)}
                  placeholder='"More executive tone", "merge slides 3 and 4", "work the attached study into the efficacy slides"…'
                  className="min-h-14 bg-surface !text-xs"
                />
                <div className="mt-1.5 space-y-1.5">
                  {aiDoc ? (
                    <div className="flex items-center gap-1.5 rounded-lg bg-surface px-2 py-1.5 text-xs">
                      <FileText size={13} className="shrink-0 text-[var(--accent)]" />
                      <span className="min-w-0 flex-1 truncate">{aiDoc.name}</span>
                      <button
                        className="rounded p-0.5 text-muted hover:text-red-600"
                        onClick={() => setAiDoc(null)}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ) : (
                    <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-[var(--accent)] hover:underline">
                      <Plus size={12} />
                      {busy === "doc" ? "Reading…" : "Attach a document for context"}
                      <input
                        type="file"
                        accept=".docx,.doc,.pdf,.txt,.md"
                        className="hidden"
                        disabled={!!busy}
                        onChange={(e) => {
                          void attachAiDoc(e.target.files?.[0] || null);
                          e.target.value = "";
                        }}
                      />
                    </label>
                  )}
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      disabled={!!busy || !deckGuidance.trim()}
                      onClick={proposeDeckRevision}
                    >
                      <Sparkles size={13} />
                      {busy === "deck" ? "Thinking…" : "Propose changes"}
                    </Button>
                  </div>
                  <p className="text-[10px] leading-snug text-muted">
                    You&apos;ll see exactly what would change and approve it before anything is
                    touched.
                  </p>
                </div>
              </RailSection>

              {runs.length > 0 && (
                <button
                  className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-left text-xs text-muted transition hover:border-[var(--accent)]/40 hover:text-ink"
                  onClick={() => setShowRuns(true)}
                >
                  {runs.length} practice run{runs.length === 1 ? "" : "s"} — latest:{" "}
                  {runs[0].metrics?.wpm || "?"} wpm, {runs[0].metrics?.fillerCount ?? "?"}{" "}
                  fillers. View history →
                </button>
              )}
            </div>
          ) : (
            <div className="hidden lg:block">
              <button
                className="grid h-9 w-9 place-items-center rounded-lg border border-border bg-surface text-muted shadow-sm transition hover:text-ink"
                onClick={() => setRailOpen(true)}
                title="Show panel"
              >
                <PanelRightOpen size={15} />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Chart data modal (insert or edit) */}
      {chartTarget && theme && (
        <ChartDataModal
          open
          onClose={() => setChartTarget(null)}
          initial={chartInitial}
          theme={theme}
          onSave={(data) => {
            if (chartTarget === "new") {
              const el: SlideElement = {
                id: uid(),
                type: "chart",
                x: 1,
                y: 1.5,
                w: 4.8,
                h: 3,
                ...data,
              };
              updateSlide(current, { elements: [...slide.elements, el] });
              setSelectedId(el.id);
            } else {
              updateElement(chartTarget, { ...data });
            }
            setChartTarget(null);
          }}
        />
      )}

      {/* AI proposal review */}
      <Modal
        open={!!proposal}
        onClose={() => setProposal(null)}
        title="Proposed changes"
        size="lg"
      >
        {proposal && (
          <div className="space-y-4">
            <p className="rounded-lg bg-[var(--accent-soft)]/40 px-3 py-2.5 text-sm leading-relaxed">
              {proposal.summary || "Here's the revised deck."}
            </p>
            <ul className="max-h-80 space-y-1.5 overflow-y-auto pr-1">
              {proposal.slides.map((entry, i) => {
                const unchanged = entry.change.trim().toLowerCase() === "unchanged";
                const isNew = entry.basedOn < 0;
                return (
                  <li
                    key={i}
                    className={`flex items-start gap-2.5 rounded-lg border px-3 py-2 ${
                      unchanged ? "border-border/60 opacity-70" : "border-border"
                    }`}
                  >
                    <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-ink/10 text-[10px] font-bold">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {unchanged && entry.basedOn >= 0
                          ? slideToAI(slides[entry.basedOn] || blankSlide()).title ||
                            entry.spec.title
                          : entry.spec.title}
                      </p>
                      {!unchanged && (
                        <p className="text-xs text-muted">{entry.change}</p>
                      )}
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        unchanged
                          ? "bg-ink/5 text-muted"
                          : isNew
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-amber-100 text-amber-700"
                      }`}
                    >
                      {unchanged ? "unchanged" : isNew ? "new" : "edited"}
                    </span>
                  </li>
                );
              })}
              {removedSlides.map(({ s, i }) => (
                <li
                  key={`rm-${i}`}
                  className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50/50 px-3 py-2"
                >
                  <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-red-100 text-[10px] font-bold text-red-700">
                    –
                  </span>
                  <p className="min-w-0 flex-1 truncate text-sm text-red-800">
                    {slideToAI(s).title || `Slide ${i + 1}`}
                  </p>
                  <span className="shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">
                    removed
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setProposal(null)}>
                Discard
              </Button>
              <Button disabled={busy === "apply"} onClick={applyProposal}>
                <Sparkles size={14} />
                {busy === "apply" ? "Applying…" : "Apply changes"}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Script modal */}
      <Modal open={showScript} onClose={() => setShowScript(false)} title="Write my script">
        <div className="space-y-3">
          <p className="text-sm text-muted">
            I&apos;ll write natural spoken notes for every slide — they land in the speaker
            notes (and export to PowerPoint). Practice mode will coach you against them.
          </p>
          <Input
            label="Target length (minutes)"
            type="number"
            min={1}
            max={120}
            value={scriptMinutes}
            onChange={(e) => setScriptMinutes(Number(e.target.value) || 10)}
          />
          <Textarea
            label="Guidance (optional)"
            value={scriptGuidance}
            onChange={(e) => setScriptGuidance(e.target.value)}
            placeholder="Tone, audience, jokes or no jokes…"
            className="min-h-16"
          />
          <div className="flex justify-end">
            <Button disabled={busy === "script"} onClick={generateScript}>
              <Sparkles size={14} /> {busy === "script" ? "Writing…" : "Write the script"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Design modal */}
      <Modal open={showDesign} onClose={() => setShowDesign(false)} title="Design" size="lg">
        <div className="space-y-4">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
              Theme presets
            </p>
            <div className="flex flex-wrap gap-2">
              {THEME_PRESETS.map((p) => {
                const active =
                  theme.primary === p.theme.primary && theme.bg === p.theme.bg;
                return (
                  <button
                    key={p.name}
                    onClick={() =>
                      save({
                        theme: {
                          ...p.theme,
                          transition: theme.transition,
                          logoDataUrl: theme.logoDataUrl,
                        },
                      })
                    }
                    className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
                      active
                        ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                        : "border-border hover:border-[var(--accent)]/50"
                    }`}
                  >
                    <span className="flex overflow-hidden rounded-full border border-border">
                      <span className="h-4 w-4" style={{ background: `#${p.theme.primary}` }} />
                      <span className="h-4 w-4" style={{ background: `#${p.theme.bg}` }} />
                    </span>
                    {p.name}
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 text-xs text-muted">
              Presets change colors only — your existing layout and content stay put. Slides
              built with the old colors keep them; new slides use the new theme.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <ColorInput
              label="Primary"
              value={theme.primary}
              onChange={(primary) => save({ theme: { ...theme, primary } })}
            />
            <ColorInput
              label="Secondary"
              value={theme.secondary}
              onChange={(secondary) => save({ theme: { ...theme, secondary } })}
            />
            <ColorInput
              label="Text"
              value={theme.text}
              onChange={(text) => save({ theme: { ...theme, text } })}
            />
            <ColorInput
              label="Background"
              value={theme.bg}
              onChange={(bg) => save({ theme: { ...theme, bg } })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Heading font"
              value={theme.headFont}
              onChange={(e) => save({ theme: { ...theme, headFont: e.target.value } })}
            />
            <Input
              label="Body font"
              value={theme.bodyFont}
              onChange={(e) => save({ theme: { ...theme, bodyFont: e.target.value } })}
            />
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-ink">Slide transition</span>
              <select
                value={theme.transition || "none"}
                onChange={(e) =>
                  save({ theme: { ...theme, transition: e.target.value as SlideTransition } })
                }
                className="rounded-lg border border-border bg-surface px-3 py-2 text-sm"
              >
                {TRANSITIONS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="pb-2 text-xs font-medium text-[var(--accent)] hover:underline"
              onClick={async () => {
                await saveSlidePrefs(userId, { theme, aiImages: true });
                toast("success", "Saved as your default look for new decks.");
              }}
            >
              Set this look as my default for new decks
            </button>
          </div>
          <p className="text-xs text-muted">
            Transitions apply between every slide and export into the .pptx. Mark this deck as
            a <b>template</b> and its theme becomes available to Conference Post-Con decks too.
          </p>
        </div>
      </Modal>

      {/* Versions modal */}
      <Modal open={showVersions} onClose={() => setShowVersions(false)} title="Versions" size="lg">
        <div className="mb-3 flex justify-end">
          <Button
            size="sm"
            variant="secondary"
            onClick={async () => {
              await snapshot("Manual snapshot", slides, theme);
              setVersions(await listVersions());
              toast("success", "Snapshot saved");
            }}
          >
            <Plus size={14} /> Snapshot current state
          </Button>
        </div>
        {versions.length === 0 ? (
          <p className="text-sm text-muted">
            No versions yet — snapshots are taken automatically before big AI edits, or
            manually here.
          </p>
        ) : (
          <ul className="space-y-2">
            {versions.map((v) => (
              <li
                key={v.id}
                className="flex items-center gap-3 rounded-lg border border-border p-3"
              >
                <div className="pointer-events-none shrink-0">
                  {v.slides[0] && <SlideCanvas slide={v.slides[0]} theme={v.theme} width={96} />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{v.label || "Snapshot"}</p>
                  <p className="text-xs text-muted">
                    {v.slides.length} slides ·{" "}
                    {new Date(v.created_at).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={async () => {
                    await snapshot("Before restore", slides, theme);
                    save({ slides: v.slides, theme: v.theme });
                    setCurrent(0);
                    setShowVersions(false);
                    toast("success", "Version restored");
                  }}
                >
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Modal>

      {/* Practice history */}
      <Modal open={showRuns} onClose={() => setShowRuns(false)} title="Practice history" size="lg">
        <ul className="space-y-3">
          {runs.map((r) => (
            <li key={r.id} className="rounded-lg border border-border p-3">
              <p className="mb-1 text-xs text-muted">
                {new Date(r.created_at).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}{" "}
                · {Math.floor((r.metrics?.durationSec || 0) / 60)}:
                {String((r.metrics?.durationSec || 0) % 60).padStart(2, "0")} ·{" "}
                {r.metrics?.wpm || "?"} wpm · {r.metrics?.fillerCount ?? "?"} fillers
              </p>
              <details>
                <summary className="cursor-pointer text-xs font-medium text-[var(--accent)]">
                  Coaching
                </summary>
                <pre className="mt-1 whitespace-pre-wrap font-sans text-sm leading-relaxed">
                  {r.coaching}
                </pre>
              </details>
            </li>
          ))}
        </ul>
      </Modal>

      {showPractice && (
        <PracticeMode
          slides={slides}
          theme={theme}
          onClose={() => setShowPractice(false)}
          onComplete={async (r) => {
            await addRun(r);
          }}
        />
      )}
    </div>
  );
}
