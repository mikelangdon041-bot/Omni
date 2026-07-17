// Slide Studio model. A deck is JSON: slides of absolutely-positioned
// elements measured in inches on a 10 × 5.625 in (16:9) canvas — the same
// units pptxgenjs takes, so export is a straight mapping.

export const SLIDE_W = 10;
export const SLIDE_H = 5.625;

// Same shape as the conference DeckTheme so Slide Studio templates plug
// straight into the Post-Con Deck.
export interface SlideTheme {
  primary: string; // hex without '#'
  secondary: string;
  text: string;
  bg: string;
  headFont: string;
  bodyFont: string;
  logoDataUrl?: string;
}

export const DEFAULT_SLIDE_THEME: SlideTheme = {
  primary: "C026D3",
  secondary: "9333EA",
  text: "1F2937",
  bg: "FFFFFF",
  headFont: "Calibri",
  bodyFont: "Calibri",
};

export type ElementType = "text" | "bullets" | "image" | "chart" | "shape";

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
  // text / bullets
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
  // chart
  chartType?: "bar" | "line" | "pie";
  labels?: string[];
  series?: ChartSeries[];
  // shape
  shape?: "rect" | "ellipse" | "line";
}

export interface Slide {
  id: string;
  elements: SlideElement[];
  notes: string;
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

// ------------------------------------------------------------------
// Standard layouts used when the AI generates content: title slide and a
// title + bullets content slide. Kept here so generation, import fallbacks,
// and "add slide" all produce the same geometry.
// ------------------------------------------------------------------
export function titleSlide(title: string, subtitle: string, theme: SlideTheme): Slide {
  return {
    id: uid(),
    notes: "",
    elements: [
      {
        id: uid(),
        type: "shape",
        shape: "rect",
        x: 0,
        y: 3.4,
        w: SLIDE_W,
        h: 0.12,
        fill: theme.primary,
      },
      {
        id: uid(),
        type: "text",
        text: title,
        x: 0.7,
        y: 1.8,
        w: 8.6,
        h: 1.2,
        fontSize: 36,
        bold: true,
        color: theme.text,
        align: "left",
      },
      {
        id: uid(),
        type: "text",
        text: subtitle,
        x: 0.7,
        y: 3.7,
        w: 8.6,
        h: 0.6,
        fontSize: 16,
        color: theme.secondary,
        align: "left",
      },
    ],
  };
}

export function contentSlide(title: string, bullets: string[], theme: SlideTheme, notes = ""): Slide {
  return {
    id: uid(),
    notes,
    elements: [
      {
        id: uid(),
        type: "text",
        text: title,
        x: 0.5,
        y: 0.3,
        w: 9,
        h: 0.7,
        fontSize: 24,
        bold: true,
        color: theme.text,
        align: "left",
      },
      {
        id: uid(),
        type: "shape",
        shape: "rect",
        x: 0.5,
        y: 1.05,
        w: 2.2,
        h: 0.06,
        fill: theme.primary,
      },
      {
        id: uid(),
        type: "bullets",
        bullets,
        x: 0.5,
        y: 1.35,
        w: 9,
        h: 3.9,
        fontSize: 16,
        color: theme.text,
        align: "left",
      },
    ],
  };
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
      return `--- Slide ${i + 1} ---\n${texts}${s.notes ? `\n[Speaker notes: ${s.notes}]` : ""}`;
    })
    .join("\n\n");
}
