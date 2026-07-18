// Slide Studio model. A deck is JSON: slides of absolutely-positioned
// elements measured in inches on a 10 × 5.625 in (16:9) canvas — the same
// units pptxgenjs takes, so export is a straight mapping.

export const SLIDE_W = 10;
export const SLIDE_H = 5.625;

export type SlideTransition = "none" | "fade" | "push" | "wipe" | "cover" | "dissolve";

export const TRANSITIONS: { value: SlideTransition; label: string }[] = [
  { value: "none", label: "None" },
  { value: "fade", label: "Fade" },
  { value: "push", label: "Push" },
  { value: "wipe", label: "Wipe" },
  { value: "cover", label: "Cover" },
  { value: "dissolve", label: "Dissolve" },
];

// Same shape as the conference DeckTheme so Slide Studio templates plug
// straight into the Post-Con Deck. `transition` rides along in the theme
// jsonb so no schema change is needed.
export interface SlideTheme {
  primary: string; // hex without '#'
  secondary: string;
  text: string;
  bg: string;
  headFont: string;
  bodyFont: string;
  logoDataUrl?: string;
  transition?: SlideTransition;
}

export const DEFAULT_SLIDE_THEME: SlideTheme = {
  primary: "C026D3",
  secondary: "9333EA",
  text: "1F2937",
  bg: "FFFFFF",
  headFont: "Calibri",
  bodyFont: "Calibri",
  transition: "fade",
};

// Curated presets — picked to look good with the tint/band system below.
export const THEME_PRESETS: { name: string; theme: SlideTheme }[] = [
  { name: "Orchid", theme: { ...DEFAULT_SLIDE_THEME } },
  { name: "Ocean", theme: { ...DEFAULT_SLIDE_THEME, primary: "0369A1", secondary: "0891B2", text: "0F172A" } },
  { name: "Forest", theme: { ...DEFAULT_SLIDE_THEME, primary: "15803D", secondary: "65A30D", text: "14261A" } },
  { name: "Sunset", theme: { ...DEFAULT_SLIDE_THEME, primary: "EA580C", secondary: "DC2626", text: "292018" } },
  { name: "Royal", theme: { ...DEFAULT_SLIDE_THEME, primary: "4338CA", secondary: "7C3AED", text: "1E1B4B" } },
  { name: "Ruby", theme: { ...DEFAULT_SLIDE_THEME, primary: "BE123C", secondary: "E11D48", text: "27141B" } },
  { name: "Slate", theme: { ...DEFAULT_SLIDE_THEME, primary: "334155", secondary: "64748B", text: "0F172A" } },
  { name: "Teal", theme: { ...DEFAULT_SLIDE_THEME, primary: "0F766E", secondary: "0D9488", text: "134E4A" } },
  { name: "Amber", theme: { ...DEFAULT_SLIDE_THEME, primary: "B45309", secondary: "D97706", text: "3B2A10" } },
  {
    name: "Midnight",
    theme: { ...DEFAULT_SLIDE_THEME, primary: "38BDF8", secondary: "818CF8", text: "E2E8F0", bg: "0F172A" },
  },
  {
    name: "Charcoal",
    theme: { ...DEFAULT_SLIDE_THEME, primary: "F472B6", secondary: "A78BFA", text: "F1F5F9", bg: "18181B" },
  },
  {
    name: "Deep Forest",
    theme: { ...DEFAULT_SLIDE_THEME, primary: "4ADE80", secondary: "2DD4BF", text: "ECFDF5", bg: "052E16" },
  },
];

export type ElementType = "text" | "bullets" | "image" | "chart" | "shape";

export type ShapeKind =
  | "rect"
  | "roundRect"
  | "ellipse"
  | "triangle"
  | "diamond"
  | "rightArrow"
  | "leftArrow"
  | "upArrow"
  | "downArrow"
  | "chevron"
  | "pentagon"
  | "star"
  | "line";

export interface ChartSeries {
  name: string;
  values: number[];
}

export interface SlideElement {
  id: string;
  type: ElementType;
  x: number; // inches
  y: number;
  w: number;
  h: number;
  // text / bullets (shapes may carry `text` too — rendered centered)
  text?: string;
  bullets?: string[];
  fontSize?: number; // points
  bold?: boolean;
  italic?: boolean;
  align?: "left" | "center" | "right";
  color?: string; // hex without '#'
  fill?: string; // background fill, hex without '#' ('' = none)
  // image
  src?: string; // URL or data URL
  prompt?: string; // suggested AI-image prompt (from generation)
  // chart
  chartType?: "bar" | "line" | "pie" | "doughnut" | "area";
  labels?: string[];
  series?: ChartSeries[];
  // shape
  shape?: ShapeKind;
  lineColor?: string; // border, hex without '#'
  lineWidth?: number; // points
}

export interface Slide {
  id: string;
  elements: SlideElement[];
  notes: string; // rich HTML (older decks: plain text)
  bg?: string; // per-slide background override, hex without '#'
}

export type DeckSource = "scratch" | "topic" | "document" | "import" | "template";

export interface SlideDeck {
  id: string;
  user_id: string;
  title: string;
  theme: SlideTheme;
  slides: Slide[];
  source: DeckSource;
  is_template: boolean;
  created_at: string;
  updated_at: string;
}

export interface DeckVersion {
  id: string;
  deck_id: string;
  slides: Slide[];
  theme: SlideTheme;
  label: string;
  created_at: string;
}

export interface PracticeRun {
  id: string;
  deck_id: string;
  user_id: string;
  transcript: string;
  slide_timings: { slideIndex: number; startSec: number }[];
  metrics: {
    durationSec?: number;
    wpm?: number;
    fillerCount?: number;
    fillers?: Record<string, number>;
  };
  coaching: string;
  created_at: string;
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

// Strip rich-notes HTML down to readable plain text (for pptx notes + AI).
export function notesToText(html: string): string {
  if (!html) return "";
  if (!/<[a-z][^>]*>/i.test(html)) return html;
  return html
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<\/(p|div|li|ul|ol|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ------------------------------------------------------------------
// Color helpers — mix a theme color toward white/black so layouts get
// soft card fills and bands from just the two theme colors.
// ------------------------------------------------------------------
export function mixHex(hex: string, withHex: string, amount: number): string {
  const h = (hex || "888888").replace(/[^0-9A-Fa-f]/g, "").padEnd(6, "0").slice(0, 6);
  const w = (withHex || "FFFFFF").replace(/[^0-9A-Fa-f]/g, "").padEnd(6, "0").slice(0, 6);
  const c = (i: number) =>
    Math.round(
      parseInt(h.slice(i, i + 2), 16) * (1 - amount) + parseInt(w.slice(i, i + 2), 16) * amount,
    )
      .toString(16)
      .padStart(2, "0");
  return `${c(0)}${c(2)}${c(4)}`.toUpperCase();
}

export function isDarkHex(hex: string): boolean {
  const h = (hex || "FFFFFF").replace(/[^0-9A-Fa-f]/g, "").padEnd(6, "0").slice(0, 6);
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return r * 0.299 + g * 0.587 + b * 0.114 < 140;
}

// Soft tint of a theme color that works on light and dark backgrounds.
export function tintOn(bg: string, color: string, amount = 0.88): string {
  return isDarkHex(bg) ? mixHex(color, "000000", amount * 0.82) : mixHex(color, "FFFFFF", amount);
}

// ------------------------------------------------------------------
// Layout builders. Generation targets these named layouts so decks come
// out designed — bands, cards, accents — not just a title and bullets.
// ------------------------------------------------------------------
export type SlideLayout =
  | "title"
  | "section"
  | "bullets"
  | "twoCol"
  | "stats"
  | "quote"
  | "imageRight"
  | "closing";

export interface SlideSpec {
  layout: SlideLayout;
  title: string;
  subtitle?: string;
  bullets?: string[];
  columns?: { heading: string; bullets: string[] }[];
  stats?: { value: string; label: string }[];
  quote?: { text: string; attribution: string };
  imagePrompt?: string;
  notes?: string;
}

function headerElements(title: string, theme: SlideTheme): SlideElement[] {
  return [
    // Slim brand band down the left edge.
    { id: uid(), type: "shape", shape: "rect", x: 0, y: 0, w: 0.14, h: SLIDE_H, fill: theme.primary },
    {
      id: uid(),
      type: "text",
      text: title,
      x: 0.55,
      y: 0.32,
      w: 9,
      h: 0.75,
      fontSize: 26,
      bold: true,
      color: theme.text,
      align: "left",
    },
    { id: uid(), type: "shape", shape: "rect", x: 0.58, y: 1.12, w: 1.7, h: 0.055, fill: theme.secondary },
  ];
}

export function titleSlide(title: string, subtitle: string, theme: SlideTheme): Slide {
  return {
    id: uid(),
    notes: "",
    elements: [
      // Full-height side panel + floating accents make even the cover feel designed.
      { id: uid(), type: "shape", shape: "rect", x: 6.9, y: 0, w: 3.1, h: SLIDE_H, fill: tintOn(theme.bg, theme.primary) },
      { id: uid(), type: "shape", shape: "ellipse", x: 7.7, y: 0.7, w: 1.5, h: 1.5, fill: theme.primary },
      { id: uid(), type: "shape", shape: "ellipse", x: 8.6, y: 2.5, w: 0.85, h: 0.85, fill: theme.secondary },
      { id: uid(), type: "shape", shape: "ellipse", x: 7.35, y: 3.6, w: 0.55, h: 0.55, fill: mixHex(theme.primary, theme.bg, 0.45) },
      { id: uid(), type: "shape", shape: "rect", x: 0, y: SLIDE_H - 0.14, w: SLIDE_W, h: 0.14, fill: theme.primary },
      {
        id: uid(),
        type: "text",
        text: title,
        x: 0.7,
        y: 1.7,
        w: 5.9,
        h: 1.6,
        fontSize: 34,
        bold: true,
        color: theme.text,
        align: "left",
      },
      {
        id: uid(),
        type: "text",
        text: subtitle,
        x: 0.7,
        y: 3.45,
        w: 5.9,
        h: 0.8,
        fontSize: 15,
        color: theme.secondary,
        align: "left",
      },
    ],
  };
}

export function sectionSlide(title: string, subtitle: string, theme: SlideTheme, notes = ""): Slide {
  const onPrimary = isDarkHex(theme.primary) ? "FFFFFF" : "111827";
  return {
    id: uid(),
    notes,
    bg: theme.primary,
    elements: [
      { id: uid(), type: "shape", shape: "ellipse", x: 8.3, y: -0.9, w: 2.6, h: 2.6, fill: mixHex(theme.primary, "FFFFFF", 0.16) },
      { id: uid(), type: "shape", shape: "ellipse", x: -0.8, y: 4.1, w: 2.2, h: 2.2, fill: mixHex(theme.primary, "000000", 0.18) },
      { id: uid(), type: "shape", shape: "rect", x: 0.75, y: 2.1, w: 0.9, h: 0.07, fill: onPrimary },
      {
        id: uid(),
        type: "text",
        text: title,
        x: 0.75,
        y: 2.3,
        w: 8.5,
        h: 1.1,
        fontSize: 32,
        bold: true,
        color: onPrimary,
        align: "left",
      },
      ...(subtitle
        ? [
            {
              id: uid(),
              type: "text" as const,
              text: subtitle,
              x: 0.75,
              y: 3.45,
              w: 8.5,
              h: 0.7,
              fontSize: 15,
              color: onPrimary,
              align: "left" as const,
            },
          ]
        : []),
    ],
  };
}

export function contentSlide(title: string, bullets: string[], theme: SlideTheme, notes = ""): Slide {
  return {
    id: uid(),
    notes,
    elements: [
      ...headerElements(title, theme),
      {
        id: uid(),
        type: "bullets",
        bullets,
        x: 0.58,
        y: 1.5,
        w: 8.9,
        h: 3.7,
        fontSize: 16,
        color: theme.text,
        align: "left",
      },
    ],
  };
}

export function twoColSlide(
  title: string,
  columns: { heading: string; bullets: string[] }[],
  theme: SlideTheme,
  notes = "",
): Slide {
  const cols = columns.slice(0, 3);
  const n = Math.max(1, cols.length);
  const gap = 0.3;
  const left = 0.58;
  const width = (SLIDE_W - left - 0.5 - gap * (n - 1)) / n;
  const card = tintOn(theme.bg, theme.primary);
  const elements: SlideElement[] = [...headerElements(title, theme)];
  cols.forEach((c, i) => {
    const x = left + i * (width + gap);
    elements.push(
      { id: uid(), type: "shape", shape: "roundRect", x, y: 1.45, w: width, h: 3.75, fill: card },
      { id: uid(), type: "shape", shape: "rect", x: x + 0.25, y: 1.75, w: 0.55, h: 0.06, fill: i % 2 ? theme.secondary : theme.primary },
      {
        id: uid(),
        type: "text",
        text: c.heading,
        x: x + 0.25,
        y: 1.9,
        w: width - 0.5,
        h: 0.5,
        fontSize: 16,
        bold: true,
        color: theme.text,
      },
      {
        id: uid(),
        type: "bullets",
        bullets: c.bullets,
        x: x + 0.25,
        y: 2.45,
        w: width - 0.5,
        h: 2.6,
        fontSize: 12.5,
        color: theme.text,
      },
    );
  });
  return { id: uid(), notes, elements };
}

export function statsSlide(
  title: string,
  stats: { value: string; label: string }[],
  bullets: string[],
  theme: SlideTheme,
  notes = "",
): Slide {
  const cards = stats.slice(0, 4);
  const n = Math.max(1, cards.length);
  const gap = 0.3;
  const left = 0.58;
  const width = (SLIDE_W - left - 0.5 - gap * (n - 1)) / n;
  const elements: SlideElement[] = [...headerElements(title, theme)];
  cards.forEach((s, i) => {
    const x = left + i * (width + gap);
    const accent = i % 2 ? theme.secondary : theme.primary;
    elements.push(
      { id: uid(), type: "shape", shape: "roundRect", x, y: 1.5, w: width, h: 1.75, fill: tintOn(theme.bg, accent) },
      {
        id: uid(),
        type: "text",
        text: s.value,
        x: x + 0.1,
        y: 1.7,
        w: width - 0.2,
        h: 0.75,
        fontSize: 30,
        bold: true,
        color: accent,
        align: "center",
      },
      {
        id: uid(),
        type: "text",
        text: s.label,
        x: x + 0.15,
        y: 2.5,
        w: width - 0.3,
        h: 0.65,
        fontSize: 11.5,
        color: theme.text,
        align: "center",
      },
    );
  });
  if (bullets.length) {
    elements.push({
      id: uid(),
      type: "bullets",
      bullets,
      x: left,
      y: 3.55,
      w: 8.9,
      h: 1.7,
      fontSize: 14,
      color: theme.text,
    });
  }
  return { id: uid(), notes, elements };
}

export function quoteSlide(
  title: string,
  quote: { text: string; attribution: string },
  theme: SlideTheme,
  notes = "",
): Slide {
  return {
    id: uid(),
    notes,
    elements: [
      { id: uid(), type: "shape", shape: "rect", x: 0, y: 0, w: 0.14, h: SLIDE_H, fill: theme.primary },
      { id: uid(), type: "shape", shape: "roundRect", x: 0.9, y: 1.15, w: 8.2, h: 3.35, fill: tintOn(theme.bg, theme.primary) },
      {
        id: uid(),
        type: "text",
        text: "“",
        x: 1.15,
        y: 0.7,
        w: 1.2,
        h: 1.2,
        fontSize: 88,
        bold: true,
        color: theme.primary,
      },
      {
        id: uid(),
        type: "text",
        text: quote.text,
        x: 1.5,
        y: 1.85,
        w: 7,
        h: 1.7,
        fontSize: 19,
        italic: true,
        color: theme.text,
      },
      {
        id: uid(),
        type: "text",
        text: quote.attribution ? `— ${quote.attribution}` : "",
        x: 1.5,
        y: 3.75,
        w: 7,
        h: 0.5,
        fontSize: 13,
        bold: true,
        color: theme.secondary,
      },
      ...(title
        ? [
            {
              id: uid(),
              type: "text" as const,
              text: title,
              x: 0.58,
              y: 5,
              w: 9,
              h: 0.45,
              fontSize: 12,
              color: theme.secondary,
            },
          ]
        : []),
    ],
  };
}

export function imageRightSlide(
  title: string,
  bullets: string[],
  imagePrompt: string,
  theme: SlideTheme,
  notes = "",
): Slide {
  return {
    id: uid(),
    notes,
    elements: [
      ...headerElements(title, theme),
      {
        id: uid(),
        type: "bullets",
        bullets,
        x: 0.58,
        y: 1.5,
        w: 5.1,
        h: 3.7,
        fontSize: 15,
        color: theme.text,
      },
      { id: uid(), type: "shape", shape: "roundRect", x: 5.95, y: 1.62, w: 3.62, h: 3.42, fill: tintOn(theme.bg, theme.secondary) },
      {
        id: uid(),
        type: "image",
        src: "",
        prompt: imagePrompt,
        x: 6.05,
        y: 1.72,
        w: 3.42,
        h: 3.22,
      },
    ],
  };
}

export function closingSlide(title: string, bullets: string[], theme: SlideTheme, notes = ""): Slide {
  const onPrimary = isDarkHex(theme.primary) ? "FFFFFF" : "111827";
  return {
    id: uid(),
    notes,
    bg: theme.primary,
    elements: [
      { id: uid(), type: "shape", shape: "ellipse", x: 8.5, y: 3.9, w: 2.4, h: 2.4, fill: mixHex(theme.primary, "FFFFFF", 0.16) },
      { id: uid(), type: "shape", shape: "ellipse", x: -0.7, y: -0.9, w: 2, h: 2, fill: mixHex(theme.primary, "000000", 0.18) },
      {
        id: uid(),
        type: "text",
        text: title,
        x: 0.75,
        y: 1.15,
        w: 8.5,
        h: 1,
        fontSize: 30,
        bold: true,
        color: onPrimary,
      },
      {
        id: uid(),
        type: "bullets",
        bullets,
        x: 0.78,
        y: 2.35,
        w: 8.4,
        h: 2.6,
        fontSize: 16,
        color: onPrimary,
      },
    ],
  };
}

// One entry point: a generated spec → a designed slide.
export function buildSlideFromSpec(spec: SlideSpec, theme: SlideTheme, deckSubtitle = ""): Slide {
  const notes = spec.notes || "";
  switch (spec.layout) {
    case "title":
      return { ...titleSlide(spec.title, spec.subtitle || deckSubtitle, theme), notes };
    case "section":
      return sectionSlide(spec.title, spec.subtitle || "", theme, notes);
    case "twoCol":
      if (spec.columns?.length) return twoColSlide(spec.title, spec.columns, theme, notes);
      return contentSlide(spec.title, spec.bullets || [], theme, notes);
    case "stats":
      if (spec.stats?.length)
        return statsSlide(spec.title, spec.stats, spec.bullets || [], theme, notes);
      return contentSlide(spec.title, spec.bullets || [], theme, notes);
    case "quote":
      if (spec.quote?.text) return quoteSlide(spec.title, spec.quote, theme, notes);
      return contentSlide(spec.title, spec.bullets || [], theme, notes);
    case "imageRight":
      return imageRightSlide(spec.title, spec.bullets || [], spec.imagePrompt || "", theme, notes);
    case "closing":
      return closingSlide(spec.title, spec.bullets || [], theme, notes);
    default:
      return contentSlide(spec.title, spec.bullets || [], theme, notes);
  }
}

export function blankSlide(): Slide {
  return { id: uid(), elements: [], notes: "" };
}

// Plain-text digest of a deck for AI prompts.
export function deckText(slides: Slide[]): string {
  return slides
    .map((s, i) => {
      const texts = s.elements
        .filter((e) => e.type === "text" || e.type === "bullets")
        .map((e) =>
          e.type === "text" ? e.text || "" : (e.bullets || []).map((b) => `• ${b}`).join("\n"),
        )
        .filter(Boolean)
        .join("\n");
      const notes = notesToText(s.notes);
      return `--- Slide ${i + 1} ---\n${texts}${notes ? `\n[Speaker notes: ${notes}]` : ""}`;
    })
    .join("\n\n");
}
