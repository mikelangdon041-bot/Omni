"use client";

// The deck editor: thumbnails · canvas · inspector, with AI refine loops
// (slide + deck), the Polish pass, script generation, versions, practice
// mode with coaching, template flag, and .pptx export.

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import {
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  History,
  LayoutTemplate,
  Mic,
  Palette,
  Plus,
  ScrollText,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";
import { BackButton } from "@/components/BackButton";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { useConfirm, useToast } from "@/components/ui/Feedback";
import { SlideCanvas } from "@/components/slides/SlideCanvas";
import { AddElementBar, ColorInput, Inspector } from "@/components/slides/Inspector";
import { PracticeMode } from "@/components/slides/PracticeMode";
import { useDeck, usePracticeRuns, useUserId } from "@/lib/slides/hooks";
import { polishSlides } from "@/lib/slides/polish";
import { exportDeckPptx } from "@/lib/slides/pptx";
import {
  blankSlide,
  contentSlide,
  uid,
  type DeckVersion,
  type Slide,
  type SlideElement,
  type SlideTheme,
} from "@/lib/slides/types";

interface AIShape {
  title: string;
  bullets: string[];
  notes: string;
}

function slideToAI(s: Slide): AIShape {
  const titleEl =
    s.elements.find((e) => e.type === "text" && (e.fontSize || 16) >= 20) ||
    s.elements.find((e) => e.type === "text");
  const bulletsEl = s.elements.find((e) => e.type === "bullets");
  return {
    title: titleEl?.text || "",
    bullets: bulletsEl?.bullets || [],
    notes: s.notes || "",
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

export default function DeckEditorPage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const confirm = useConfirm();
  const { userId } = useUserId();
  const { deck, loading, save, flush, snapshot, listVersions } = useDeck(id);
  const { runs, add: addRun } = usePracticeRuns(id, userId);

  const [current, setCurrent] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [slideGuidance, setSlideGuidance] = useState("");
  const [deckGuidance, setDeckGuidance] = useState("");
  const [showPractice, setShowPractice] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [versions, setVersions] = useState<DeckVersion[]>([]);
  const [showTheme, setShowTheme] = useState(false);
  const [showScript, setShowScript] = useState(false);
  const [showRuns, setShowRuns] = useState(false);
  const [scriptMinutes, setScriptMinutes] = useState(10);
  const [scriptGuidance, setScriptGuidance] = useState("");
  const [canvasW, setCanvasW] = useState(640);
  const canvasWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const measure = () =>
      setCanvasW(Math.max(320, (canvasWrapRef.current?.clientWidth || 660) - 8));
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

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

  async function aiRefineSlide() {
    if (!slide || !theme) return;
    setBusy("slide");
    try {
      await flush();
      const res = await fetch("/api/slides/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          action: "refine_slide",
          slide: slideToAI(slide),
          guidance: slideGuidance,
          deckContext: deck?.title,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Refine failed");
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

  async function aiRefineDeck() {
    if (!deck || !theme) return;
    setBusy("deck");
    try {
      await flush();
      await snapshot("Before deck-wide AI edit", slides, theme);
      const res = await fetch("/api/slides/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          action: "refine_deck",
          slides: slides.map(slideToAI),
          guidance: deckGuidance,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Refine failed");
      const shapes: AIShape[] = json.slides || [];
      let next: Slide[];
      if (shapes.length === slides.length) {
        next = slides.map((s, i) => applyAI(s, shapes[i], theme));
      } else {
        // Slide count changed on purpose — rebuild with the standard layout.
        next = shapes.map((sh) => contentSlide(sh.title, sh.bullets, theme, sh.notes));
      }
      setSlides(next);
      setDeckGuidance("");
      toast("success", "Deck updated (previous version snapshotted).");
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
        const res = await fetch("/api/slides/ai", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            action: "refine_slide",
            slide: slideToAI(next[si]),
            guidance:
              "This slide has too much text to fit. Shorten the bullets (fewer words, same meaning; drop the least important detail) so it fits comfortably.",
          }),
        });
        const json = await res.json();
        if (res.ok) {
          next = next.map((s, i) => (i === si ? applyAI(s, json as AIShape, theme) : s));
          trimmed++;
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
      const res = await fetch("/api/slides/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          action: "script",
          slides: slides.map(slideToAI),
          minutes: scriptMinutes,
          guidance: scriptGuidance,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Script generation failed");
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

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <BackButton label="Slide Studio" />
        <Input
          value={deck.title}
          onChange={(e) => save({ title: e.target.value })}
          className="!w-64 font-medium"
        />
        <span className="flex-1" />
        <Button size="sm" variant="secondary" disabled={!!busy} onClick={runPolish}>
          <Wand2 size={14} /> {busy === "polish" ? "Polishing…" : "Polish"}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setShowScript(true)}>
          <ScrollText size={14} /> Script
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setShowPractice(true)}>
          <Mic size={14} /> Practice{runs.length > 0 ? ` (${runs.length})` : ""}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setShowTheme(true)}>
          <Palette size={14} /> Theme
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={async () => {
            setVersions(await listVersions());
            setShowVersions(true);
          }}
        >
          <History size={14} /> Versions
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

      <div className="grid gap-4 lg:grid-cols-[150px_minmax(0,1fr)_290px]">
        {/* Thumbnails */}
        <div className="flex gap-2 overflow-x-auto lg:max-h-[75vh] lg:flex-col lg:overflow-y-auto lg:overflow-x-hidden">
          {slides.map((s, i) => (
            <button
              key={s.id}
              onClick={() => {
                setCurrent(i);
                setSelectedId(null);
              }}
              className={`relative shrink-0 rounded-md border-2 p-0.5 transition ${
                i === current ? "border-[var(--accent)]" : "border-transparent hover:border-border"
              }`}
            >
              <div className="pointer-events-none">
                <SlideCanvas slide={s} theme={theme} width={132} />
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

          <div ref={canvasWrapRef}>
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

          <div className="mt-3">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
              Speaker notes / script — slide {current + 1}
            </p>
            <Textarea
              value={slide?.notes || ""}
              onChange={(e) => updateSlide(current, { notes: e.target.value })}
              placeholder="What you'll say on this slide… (exported into PowerPoint's notes)"
              className="min-h-20"
            />
          </div>
        </div>

        {/* Inspector + AI */}
        <div className="space-y-4">
          <section className="rounded-xl border border-border bg-surface p-3 shadow-sm">
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
              />
            ) : (
              <p className="py-6 text-center text-xs text-muted">
                Click an element on the slide to edit it — drag to move, corner
                handle to resize.
              </p>
            )}
          </section>

          <section className="rounded-xl border border-[var(--accent)]/30 bg-[var(--accent-soft)]/25 p-3">
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
              AI — this slide
            </p>
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
          </section>

          <section className="rounded-xl border border-[var(--accent)]/30 bg-[var(--accent-soft)]/25 p-3">
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
              AI — whole deck
            </p>
            <Textarea
              value={deckGuidance}
              onChange={(e) => setDeckGuidance(e.target.value)}
              placeholder='"More executive tone throughout", "merge slides 3 and 4", "end with a call to action"…'
              className="min-h-14 bg-surface !text-xs"
            />
            <div className="mt-1.5 flex justify-end">
              <Button
                size="sm"
                disabled={!!busy || !deckGuidance.trim()}
                onClick={aiRefineDeck}
              >
                <Sparkles size={13} /> {busy === "deck" ? "Working…" : "Apply to deck"}
              </Button>
            </div>
          </section>

          {runs.length > 0 && (
            <button
              className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-left text-xs text-muted transition hover:border-[var(--accent)]/40 hover:text-ink"
              onClick={() => setShowRuns(true)}
            >
              {runs.length} practice run{runs.length === 1 ? "" : "s"} — latest:{" "}
              {runs[0].metrics?.wpm || "?"} wpm, {runs[0].metrics?.fillerCount ?? "?"} fillers.
              View history →
            </button>
          )}
        </div>
      </div>

      {/* Script modal */}
      <Modal open={showScript} onClose={() => setShowScript(false)} title="Write my script">
        <div className="space-y-3">
          <p className="text-sm text-muted">
            I&apos;ll write natural spoken notes for every slide — they land in
            the speaker notes (and export to PowerPoint). Practice mode will
            coach you against them.
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

      {/* Theme modal */}
      <Modal open={showTheme} onClose={() => setShowTheme(false)} title="Deck theme">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
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
          <p className="text-xs text-muted">
            Mark this deck as a <b>template</b> and its theme (colors, fonts)
            becomes available when generating Conference Post-Con decks.
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
            No versions yet — snapshots are taken automatically before big AI
            edits, or manually here.
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
    </>
  );
}
