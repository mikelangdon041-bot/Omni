"use client";

// Full-page deck creation. Replaces the old cramped modal: pick a source,
// review a structured outline you can read at a glance (numbered cards with
// layout badges, expandable, editable point-by-point, per-slide or whole-
// outline AI adjustments, full-screen mode), pick the look, then build.
// The draft autosaves locally so a refresh never loses the outline.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  FileText,
  FileUp,
  ImageIcon,
  LayoutTemplate,
  Maximize2,
  Minimize2,
  Plus,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Feedback";
import { importPptx } from "@/lib/slides/importPptx";
import { createDeck, useDecks, useUserId } from "@/lib/slides/hooks";
import { loadSlidePrefs, saveSlidePrefs, type SlidePrefs } from "@/lib/slides/prefs";
import {
  DEFAULT_SLIDE_THEME,
  THEME_PRESETS,
  TRANSITIONS,
  blankSlide,
  buildSlideFromSpec,
  titleSlide,
  uid,
  type Slide,
  type SlideLayout,
  type SlideSpec,
  type SlideTheme,
  type SlideTransition,
} from "@/lib/slides/types";

type Step = "menu" | "topic" | "document" | "outline";

interface OutlineSlide {
  title: string;
  points: string[];
  layout: SlideLayout;
}

const LAYOUT_META: Record<SlideLayout, { label: string; badge: string }> = {
  title: { label: "Cover", badge: "bg-fuchsia-100 text-fuchsia-700" },
  section: { label: "Section", badge: "bg-purple-100 text-purple-700" },
  bullets: { label: "Bullets", badge: "bg-sky-100 text-sky-700" },
  twoCol: { label: "Columns", badge: "bg-emerald-100 text-emerald-700" },
  stats: { label: "Big numbers", badge: "bg-amber-100 text-amber-700" },
  quote: { label: "Quote", badge: "bg-rose-100 text-rose-700" },
  imageRight: { label: "Image + text", badge: "bg-indigo-100 text-indigo-700" },
  closing: { label: "Closing", badge: "bg-teal-100 text-teal-700" },
};

const DRAFT_KEY = "omni-slides-new-draft";

interface Draft {
  step: Step;
  topic: string;
  docText: string;
  docName: string;
  deckTitle: string;
  outline: OutlineSlide[];
  autoCount: boolean;
  slideCount: number;
}

export default function NewDeckPage() {
  const router = useRouter();
  const toast = useToast();
  const { userId } = useUserId();
  const { decks } = useDecks(userId);
  const templates = useMemo(() => decks.filter((d) => d.is_template), [decks]);

  const [step, setStep] = useState<Step>("menu");
  const [busy, setBusy] = useState("");
  const [buildStage, setBuildStage] = useState("");
  const [topic, setTopic] = useState("");
  const [autoCount, setAutoCount] = useState(true);
  const [slideCount, setSlideCount] = useState(8);
  const [docText, setDocText] = useState("");
  const [docName, setDocName] = useState("");
  const [outline, setOutline] = useState<OutlineSlide[]>([]);
  const [deckTitle, setDeckTitle] = useState("");
  const [deckSubtitle, setDeckSubtitle] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const [outlineGuidance, setOutlineGuidance] = useState("");
  const [prefs, setPrefs] = useState<SlidePrefs | null>(null);
  const [theme, setTheme] = useState<SlideTheme>(DEFAULT_SLIDE_THEME);
  const [aiImages, setAiImages] = useState(true);
  const restored = useRef(false);

  // Load defaults + any saved draft once.
  useEffect(() => {
    if (!userId || restored.current) return;
    restored.current = true;
    void loadSlidePrefs(userId).then((p) => {
      setPrefs(p);
      setTheme(p.theme);
      setAiImages(p.aiImages);
    });
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const d = JSON.parse(raw) as Draft;
        if (d.outline?.length || d.topic || d.docText) {
          setStep(d.step || "menu");
          setTopic(d.topic || "");
          setDocText(d.docText || "");
          setDocName(d.docName || "");
          setDeckTitle(d.deckTitle || "");
          setOutline(d.outline || []);
          setAutoCount(d.autoCount !== false);
          setSlideCount(d.slideCount || 8);
        }
      }
    } catch {
      // corrupted draft — start fresh
    }
  }, [userId]);

  // Autosave the draft.
  useEffect(() => {
    if (!restored.current) return;
    const t = setTimeout(() => {
      try {
        const d: Draft = { step, topic, docText, docName, deckTitle, outline, autoCount, slideCount };
        localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
      } catch {
        // storage unavailable
      }
    }, 600);
    return () => clearTimeout(t);
  }, [step, topic, docText, docName, deckTitle, outline, autoCount, slideCount]);

  const clearDraft = useCallback(() => {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      // ignore
    }
  }, []);

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

  async function makeOutline() {
    setBusy("outline");
    try {
      const json = await ai({
        action: "outline",
        topic,
        docText,
        slideCount: autoCount ? 0 : slideCount,
      });
      setDeckTitle(json.title);
      setDeckSubtitle(json.subtitle || "");
      setOutline(json.slides);
      setStep("outline");
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function refineOutline(slideIndex: number, guidance: string) {
    if (!guidance.trim()) return;
    setBusy(slideIndex >= 0 ? `refine-${slideIndex}` : "refine-all");
    try {
      const json = await ai({
        action: "refine_outline",
        outline,
        guidance,
        slideIndex,
        topic,
        docText,
      });
      if (json.slides?.length) setOutline(json.slides);
      if (slideIndex < 0 && json.title) setDeckTitle(json.title);
      if (slideIndex < 0) setOutlineGuidance("");
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function finishCreate(slides: Slide[], useTheme: SlideTheme, source: "topic" | "document" | "import" | "scratch" | "template", title: string) {
    if (!userId) return;
    setBuildStage("Opening the studio…");
    const deck = await createDeck(userId, { title, slides, theme: useTheme, source });
    if (deck) {
      clearDraft();
      router.replace(`/slide-studio/${deck.id}`);
    }
  }

  async function buildDeck() {
    if (!userId) return;
    setBusy("build");
    try {
      setBuildStage("Writing the slide content…");
      const json = await ai({ action: "content", outline, topic, docText });
      const specs: SlideSpec[] = json.slides || [];
      const subtitle = json.subtitle || deckSubtitle || topic || docName;
      let slides: Slide[] = specs.map((spec, i) =>
        buildSlideFromSpec(
          i === 0 ? { ...spec, layout: "title", title: spec.title || deckTitle } : spec,
          theme,
          subtitle,
        ),
      );
      if (!slides.length) throw new Error("Deck generation returned nothing");

      if (aiImages) {
        const targets = slides
          .map((s, i) => ({ i, el: s.elements.find((e) => e.type === "image" && !e.src && e.prompt) }))
          .filter((t) => t.el)
          .slice(0, 4);
        if (targets.length) {
          setBuildStage(
            `Creating ${targets.length} image${targets.length === 1 ? "" : "s"}… (~20s)`,
          );
          const results = await Promise.allSettled(
            targets.map((t) => ai({ action: "image", prompt: t.el!.prompt })),
          );
          slides = slides.map((s, i) => {
            const ti = targets.findIndex((t) => t.i === i);
            if (ti < 0) return s;
            const r = results[ti];
            if (r.status !== "fulfilled") return s;
            return {
              ...s,
              elements: s.elements.map((e) =>
                e.id === targets[ti].el!.id ? { ...e, src: r.value.url } : e,
              ),
            };
          });
        }
      }

      await finishCreate(
        slides,
        theme,
        docText ? "document" : "topic",
        deckTitle || topic || "Untitled deck",
      );
    } catch (e) {
      toast("error", (e as Error).message);
      setBusy("");
      setBuildStage("");
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
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function importDeck(file: File | null) {
    if (!file || !userId) return;
    setBusy("import");
    setBuildStage("Importing your file…");
    try {
      const result = await importPptx(file);
      const notes: string[] = [];
      if (result.simplified)
        notes.push(`${result.simplified} diagram/chart block(s) were simplified to text`);
      if (result.hasAnimations) notes.push("animations don't carry over");
      if (notes.length) toast("info", `Imported with notes: ${notes.join("; ")}.`);
      await finishCreate(
        result.slides.length ? result.slides : [blankSlide()],
        result.theme,
        "import",
        file.name.replace(/\.pptx?$/i, ""),
      );
    } catch (e) {
      toast("error", (e as Error).message);
      setBusy("");
      setBuildStage("");
    }
  }

  function updateOutline(i: number, partial: Partial<OutlineSlide>) {
    setOutline((o) => o.map((s, j) => (j === i ? { ...s, ...partial } : s)));
  }

  function moveOutline(i: number, dir: -1 | 1) {
    setOutline((o) => {
      const next = [...o];
      const j = i + dir;
      if (j < 0 || j >= next.length) return o;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  const outlineBody = (
    <>
      {/* Outline header */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {!fullscreen && (
          <Button variant="ghost" size="sm" onClick={() => setStep(docText ? "document" : "topic")}>
            <ArrowLeft size={14} /> Back
          </Button>
        )}
        <Input
          value={deckTitle}
          onChange={(e) => setDeckTitle(e.target.value)}
          className="!w-72 font-semibold"
          placeholder="Deck title"
        />
        <span className="rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-xs font-medium text-[var(--accent)]">
          {outline.length} slides
        </span>
        <span className="flex-1" />
        <Button size="sm" variant="secondary" onClick={() => setFullscreen((v) => !v)}>
          {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          {fullscreen ? "Exit full screen" : "Full screen"}
        </Button>
      </div>

      <p className="mb-4 text-sm text-muted">
        This is the plan for your deck — one card per slide. Edit anything, reorder, change a
        slide&apos;s layout, or ask AI to adjust one slide or the whole outline. Build when it
        reads right.
      </p>

      {/* Slide cards */}
      <div className="space-y-2.5">
        {outline.map((s, i) => (
          <OutlineCard
            key={i}
            index={i}
            slide={s}
            total={outline.length}
            busy={busy}
            onChange={(p) => updateOutline(i, p)}
            onMove={(dir) => moveOutline(i, dir)}
            onDelete={() => setOutline((o) => o.filter((_, j) => j !== i))}
            onRefine={(g) => refineOutline(i, g)}
          />
        ))}
      </div>
      <Button
        size="sm"
        variant="secondary"
        className="mt-3"
        onClick={() =>
          setOutline((o) => [...o, { title: "New slide", points: [""], layout: "bullets" }])
        }
      >
        <Plus size={14} /> Add a slide
      </Button>

      {/* Whole-outline AI */}
      <section className="mt-5 rounded-xl border border-[var(--accent)]/30 bg-[var(--accent-soft)]/25 p-3.5">
        <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--accent)]">
          <Sparkles size={13} /> Adjust the whole outline with AI
        </p>
        <div className="flex gap-2">
          <Input
            value={outlineGuidance}
            onChange={(e) => setOutlineGuidance(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && refineOutline(-1, outlineGuidance)}
            placeholder='"Add a slide on risks", "make it half as long", "more focus on the data"…'
            className="bg-surface"
          />
          <Button
            disabled={!!busy || !outlineGuidance.trim()}
            onClick={() => refineOutline(-1, outlineGuidance)}
          >
            {busy === "refine-all" ? "Working…" : "Apply"}
          </Button>
        </div>
      </section>

      {/* Look & build */}
      <section className="mt-5 rounded-xl border border-border bg-surface p-4 shadow-sm">
        <p className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-muted">
          Look &amp; feel
        </p>
        <div className="flex flex-wrap gap-2">
          {THEME_PRESETS.map((p) => {
            const active =
              theme.primary === p.theme.primary && theme.bg === p.theme.bg;
            return (
              <button
                key={p.name}
                title={p.name}
                onClick={() => setTheme({ ...p.theme, transition: theme.transition })}
                className={`relative flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
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
                {active && <Check size={12} className="text-[var(--accent)]" />}
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted">Transition</span>
            <select
              value={theme.transition || "fade"}
              onChange={(e) =>
                setTheme({ ...theme, transition: e.target.value as SlideTransition })
              }
              className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm"
            >
              {TRANSITIONS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={aiImages}
              onChange={(e) => setAiImages(e.target.checked)}
              className="h-4 w-4 accent-[var(--accent)]"
            />
            <ImageIcon size={14} className="text-muted" />
            Generate images for visual slides
          </label>
          <button
            className="text-xs font-medium text-[var(--accent)] hover:underline"
            onClick={async () => {
              await saveSlidePrefs(userId, { theme, aiImages });
              setPrefs({ theme, aiImages });
              toast("success", "Saved as your default look for new decks.");
            }}
          >
            {prefs && prefs.theme.primary === theme.primary && prefs.aiImages === aiImages
              ? "✓ Your default"
              : "Set as my default"}
          </button>
        </div>
      </section>

      <div className="sticky bottom-3 mt-5 flex justify-end">
        <Button
          disabled={busy === "build" || outline.length === 0}
          onClick={buildDeck}
          className="shadow-lg"
        >
          <Sparkles size={15} />
          {busy === "build" ? "Building…" : "Build the deck"}
        </Button>
      </div>
    </>
  );

  return (
    <>
      {step !== "outline" && (
        <div className="mb-4">
          <Button variant="ghost" size="sm" onClick={() => (step === "menu" ? router.push("/slide-studio") : setStep("menu"))}>
            <ArrowLeft size={14} /> {step === "menu" ? "Slide Studio" : "Back"}
          </Button>
        </div>
      )}

      {step === "menu" && (
        <>
          <h1 className="mb-1 text-2xl font-bold tracking-tight">New deck</h1>
          <p className="mb-5 text-sm text-muted">How do you want to start?</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <SourceCard
              icon={<Sparkles size={20} />}
              tint="bg-fuchsia-50 text-fuchsia-600"
              title="From a topic"
              blurb="Describe what the deck should say — review a structured outline, then I design and build it."
              onClick={() => setStep("topic")}
            />
            <SourceCard
              icon={<FileText size={20} />}
              tint="bg-sky-50 text-sky-600"
              title="From a document"
              blurb="Upload a Word/PDF/text file and I'll turn it into a designed deck."
              onClick={() => setStep("document")}
            />
            <label className="group cursor-pointer rounded-xl border border-border bg-surface p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-[var(--accent)]/50 hover:shadow-md">
              <span className="mb-2 grid h-10 w-10 place-items-center rounded-lg bg-emerald-50 text-emerald-600">
                <FileUp size={20} />
              </span>
              <span className="text-sm font-semibold text-ink">
                {busy === "import" ? "Importing…" : "Import a .pptx (Remix)"}
              </span>
              <span className="mt-0.5 block text-xs leading-snug text-muted">
                Fully editable here. Simple decks come across near-identical; complex diagrams get
                simplified. For text-only edits with zero design changes, use Touch-up.
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
            <SourceCard
              icon={<Plus size={20} />}
              tint="bg-amber-50 text-amber-600"
              title="Blank deck"
              blurb="Start empty and build slide by slide."
              onClick={async () => {
                setBusy("blank");
                setBuildStage("Creating your deck…");
                const t = prefs?.theme || DEFAULT_SLIDE_THEME;
                await finishCreate(
                  [titleSlide("Untitled deck", "", t)],
                  t,
                  "scratch",
                  "Untitled deck",
                );
              }}
            />
          </div>
          {templates.length > 0 && (
            <div className="mt-6">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
                <LayoutTemplate size={13} /> From one of your templates
              </p>
              <div className="flex flex-wrap gap-2">
                {templates.map((t) => (
                  <button
                    key={t.id}
                    className="rounded-lg border border-border bg-surface px-3 py-2 text-sm shadow-sm transition hover:border-[var(--accent)]/50"
                    onClick={async () => {
                      setBusy("template");
                      setBuildStage("Copying the template…");
                      await finishCreate(
                        t.slides.map((s) => ({
                          ...s,
                          id: uid(),
                          elements: s.elements.map((e) => ({ ...e, id: uid() })),
                        })),
                        t.theme,
                        "template",
                        `${t.title} — copy`,
                      );
                    }}
                  >
                    {t.title}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {step === "topic" && (
        <div className="max-w-2xl space-y-4">
          <h1 className="text-2xl font-bold tracking-tight">From a topic</h1>
          <Textarea
            label="What's this deck about — and for whom?"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder='e.g. "Quarterly territory review for my regional director: engagement is up, two at-risk accounts, asking for congress budget"'
            className="min-h-28"
          />
          <SlideCountPicker
            autoCount={autoCount}
            slideCount={slideCount}
            onAuto={setAutoCount}
            onCount={setSlideCount}
          />
          <div className="flex justify-end">
            <Button disabled={!topic.trim() || busy === "outline"} onClick={makeOutline}>
              <Sparkles size={14} /> {busy === "outline" ? "Outlining…" : "Propose an outline"}
            </Button>
          </div>
        </div>
      )}

      {step === "document" && (
        <div className="max-w-2xl space-y-4">
          <h1 className="text-2xl font-bold tracking-tight">From a document</h1>
          {!docText ? (
            <label className="grid cursor-pointer place-items-center rounded-xl border border-dashed border-border bg-surface px-6 py-12 text-center transition hover:border-[var(--accent)]/50">
              <Upload size={22} className="mb-2 text-muted" />
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
            <div className="flex items-center gap-2 rounded-lg bg-canvas px-3 py-2 text-sm text-muted">
              <FileText size={15} className="shrink-0 text-[var(--accent)]" />
              <span className="min-w-0 flex-1 truncate">
                <b className="text-ink">{docName}</b> —{" "}
                {docText.length.toLocaleString()} characters extracted
              </span>
              <button
                className="rounded p-1 text-muted hover:text-red-600"
                onClick={() => {
                  setDocText("");
                  setDocName("");
                }}
              >
                <X size={14} />
              </button>
            </div>
          )}
          <Textarea
            label="Anything to emphasize? (optional)"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="Audience, focus, what to leave out…"
            className="min-h-16"
          />
          <SlideCountPicker
            autoCount={autoCount}
            slideCount={slideCount}
            onAuto={setAutoCount}
            onCount={setSlideCount}
          />
          <div className="flex justify-end">
            <Button disabled={!docText || busy === "outline"} onClick={makeOutline}>
              <Sparkles size={14} /> {busy === "outline" ? "Outlining…" : "Propose an outline"}
            </Button>
          </div>
        </div>
      )}

      {step === "outline" &&
        (fullscreen ? (
          <div className="fixed inset-0 z-40 overflow-y-auto bg-canvas p-4 sm:p-8">
            <div className="mx-auto max-w-4xl">{outlineBody}</div>
          </div>
        ) : (
          <div className="mx-auto max-w-4xl">{outlineBody}</div>
        ))}

      {/* Build overlay */}
      {buildStage && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/50 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-surface px-10 py-8 shadow-xl">
            <div className="h-9 w-9 animate-spin rounded-full border-[3px] border-[var(--accent)] border-t-transparent" />
            <p className="text-sm font-medium">{buildStage}</p>
            <p className="text-xs text-muted">Hang tight — this opens the editor automatically.</p>
          </div>
        </div>
      )}
    </>
  );
}

function SlideCountPicker({
  autoCount,
  slideCount,
  onAuto,
  onCount,
}: {
  autoCount: boolean;
  slideCount: number;
  onAuto: (v: boolean) => void;
  onCount: (v: number) => void;
}) {
  return (
    <div>
      <p className="mb-1.5 text-sm font-medium text-ink">Number of slides</p>
      <div className="flex items-center gap-2">
        <button
          onClick={() => onAuto(true)}
          className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
            autoCount
              ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
              : "border-border text-muted hover:text-ink"
          }`}
        >
          Auto — let AI decide
        </button>
        <button
          onClick={() => onAuto(false)}
          className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
            !autoCount
              ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
              : "border-border text-muted hover:text-ink"
          }`}
        >
          Exactly
        </button>
        {!autoCount && (
          <input
            type="number"
            min={3}
            max={30}
            value={slideCount}
            onChange={(e) => onCount(Number(e.target.value) || 8)}
            className="w-20 rounded-lg border border-border bg-surface px-3 py-2 text-sm"
          />
        )}
      </div>
    </div>
  );
}

function SourceCard({
  icon,
  tint,
  title,
  blurb,
  onClick,
}: {
  icon: React.ReactNode;
  tint: string;
  title: string;
  blurb: string;
  onClick: () => void;
}) {
  return (
    <button
      className="group rounded-xl border border-border bg-surface p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-[var(--accent)]/50 hover:shadow-md"
      onClick={onClick}
    >
      <span className={`mb-2 grid h-10 w-10 place-items-center rounded-lg ${tint}`}>{icon}</span>
      <span className="text-sm font-semibold text-ink">{title}</span>
      <span className="mt-0.5 block text-xs leading-snug text-muted">{blurb}</span>
    </button>
  );
}

function OutlineCard({
  index,
  slide,
  total,
  busy,
  onChange,
  onMove,
  onDelete,
  onRefine,
}: {
  index: number;
  slide: OutlineSlide;
  total: number;
  busy: string;
  onChange: (p: Partial<OutlineSlide>) => void;
  onMove: (dir: -1 | 1) => void;
  onDelete: () => void;
  onRefine: (guidance: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const [showAI, setShowAI] = useState(false);
  const [guidance, setGuidance] = useState("");
  const meta = LAYOUT_META[slide.layout] || LAYOUT_META.bullets;

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm transition hover:border-[var(--accent)]/40">
      {/* Card header */}
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button
          onClick={() => setOpen((v) => !v)}
          className="grid h-6 w-6 shrink-0 place-items-center rounded text-muted hover:text-ink"
        >
          {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </button>
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--accent)] text-[11px] font-bold text-white">
          {index + 1}
        </span>
        {open ? (
          <input
            value={slide.title}
            onChange={(e) => onChange({ title: e.target.value })}
            placeholder="Slide title"
            className="min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none placeholder:text-muted"
          />
        ) : (
          <button
            onClick={() => setOpen(true)}
            className="min-w-0 flex-1 truncate text-left text-sm font-semibold"
          >
            {slide.title || "Untitled slide"}
            <span className="ml-2 text-xs font-normal text-muted">
              {slide.points.filter(Boolean).length} points
            </span>
          </button>
        )}
        <select
          value={slide.layout}
          onChange={(e) => onChange({ layout: e.target.value as SlideLayout })}
          className={`shrink-0 cursor-pointer rounded-full border-0 px-2.5 py-1 text-[11px] font-semibold ${meta.badge}`}
          title="Slide layout"
        >
          {Object.entries(LAYOUT_META).map(([value, m]) => (
            <option key={value} value={value}>
              {m.label}
            </option>
          ))}
        </select>
        <div className="flex shrink-0 items-center">
          <button
            disabled={index === 0}
            onClick={() => onMove(-1)}
            className="rounded p-1 text-muted hover:text-ink disabled:opacity-30"
            title="Move up"
          >
            <ChevronUp size={14} />
          </button>
          <button
            disabled={index >= total - 1}
            onClick={() => onMove(1)}
            className="rounded p-1 text-muted hover:text-ink disabled:opacity-30"
            title="Move down"
          >
            <ChevronDown size={14} />
          </button>
          <button
            onClick={() => setShowAI((v) => !v)}
            className={`rounded p-1 ${showAI ? "text-[var(--accent)]" : "text-muted hover:text-[var(--accent)]"}`}
            title="Adjust this slide with AI"
          >
            <Sparkles size={14} />
          </button>
          <button
            onClick={onDelete}
            className="rounded p-1 text-muted hover:text-red-600"
            title="Remove slide"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Points */}
      {open && (
        <div className="border-t border-border/60 px-4 pb-3 pt-2.5 pl-[52px]">
          {slide.points.length === 0 && slide.layout !== "title" && slide.layout !== "section" && (
            <p className="mb-1 text-xs text-muted">No points yet — add what this slide covers.</p>
          )}
          <ul className="space-y-1">
            {slide.points.map((p, pi) => (
              <li key={pi} className="group flex items-center gap-2">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]/60" />
                <input
                  value={p}
                  onChange={(e) =>
                    onChange({
                      points: slide.points.map((x, j) => (j === pi ? e.target.value : x)),
                    })
                  }
                  placeholder="What this slide covers…"
                  className="min-w-0 flex-1 rounded bg-transparent px-1 py-0.5 text-sm outline-none transition focus:bg-canvas"
                />
                <button
                  onClick={() => onChange({ points: slide.points.filter((_, j) => j !== pi) })}
                  className="rounded p-0.5 text-transparent transition hover:!text-red-600 group-hover:text-muted"
                >
                  <X size={13} />
                </button>
              </li>
            ))}
          </ul>
          <button
            onClick={() => onChange({ points: [...slide.points, ""] })}
            className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-[var(--accent)] hover:underline"
          >
            <Plus size={12} /> Add point
          </button>

          {showAI && (
            <div className="mt-2.5 flex gap-2 rounded-lg bg-[var(--accent-soft)]/40 p-2">
              <input
                value={guidance}
                onChange={(e) => setGuidance(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && guidance.trim()) {
                    onRefine(guidance);
                    setGuidance("");
                  }
                }}
                placeholder='"Split into two slides", "focus on outcomes", "add the budget ask"…'
                className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs outline-none focus:border-[var(--accent)]"
              />
              <Button
                size="sm"
                disabled={!!busy || !guidance.trim()}
                onClick={() => {
                  onRefine(guidance);
                  setGuidance("");
                }}
              >
                <Sparkles size={12} />
                {busy === `refine-${index}` ? "…" : "Apply"}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
