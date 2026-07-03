"use client";

// Post-Con Deck (spec §16.1, §24). Generic pipeline: compile the conference
// (title → booth days → KOL meetings → sessions by day → posters by day) into
// a .pptx via pptxgenjs. A branded template can be uploaded: we unzip the
// .pptx, extract its real theme (colors, fonts, biggest image ≈ logo) and
// slide text, ask the AI how the deck should adopt it, and let the user
// correct the proposal before generating.

import PptxGenJS from "pptxgenjs";
import JSZip from "jszip";
import { fmtDayKeyLong } from "./utils";

export interface DeckTheme {
  primary: string; // hex without '#'
  secondary: string;
  text: string;
  bg: string;
  headFont: string;
  bodyFont: string;
  logoDataUrl?: string;
}

export const DEFAULT_THEME: DeckTheme = {
  primary: "E11D48",
  secondary: "7C3AED",
  text: "1F2937",
  bg: "FFFFFF",
  headFont: "Calibri",
  bodyFont: "Calibri",
};

export interface DeckItem {
  id: string;
  title: string;
  day: string; // YYYY-MM-DD or ""
  meta: string; // time · location · people
  body: string; // summary/notes text (plain, "- " bullets)
  images: string[]; // selected image URLs
  checked: boolean;
  includeBody: boolean;
}

export interface DeckData {
  conferenceName: string;
  dateRange: string;
  location: string;
  boothByDay: { day: string; text: string }[];
  meetingLines: string[]; // "Dr X — Jun 12 · Room 4"
  sessions: DeckItem[];
  posters: DeckItem[];
}

// ------------------------------------------------------------------
// Template parsing (.pptx = zip of XML)
// ------------------------------------------------------------------
export interface ParsedTemplate {
  theme: DeckTheme;
  slidesText: string[];
  slideCount: number;
}

export async function parseTemplate(file: File): Promise<ParsedTemplate> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());

  // Theme colors + fonts from ppt/theme/theme1.xml.
  const theme: DeckTheme = { ...DEFAULT_THEME };
  const themeXml = await zip.file("ppt/theme/theme1.xml")?.async("string");
  if (themeXml) {
    const color = (tag: string): string | null => {
      const seg = themeXml.match(new RegExp(`<a:${tag}>([\\s\\S]*?)</a:${tag}>`))?.[1];
      if (!seg) return null;
      return (
        seg.match(/<a:srgbClr val="([0-9A-Fa-f]{6})"/)?.[1] ||
        seg.match(/lastClr="([0-9A-Fa-f]{6})"/)?.[1] ||
        null
      );
    };
    theme.primary = color("accent1") || theme.primary;
    theme.secondary = color("accent2") || theme.secondary;
    theme.text = color("dk1") || theme.text;
    theme.bg = color("lt1") || theme.bg;
    const major = themeXml.match(/<a:majorFont>[\s\S]*?<a:latin typeface="([^"]+)"/)?.[1];
    const minor = themeXml.match(/<a:minorFont>[\s\S]*?<a:latin typeface="([^"]+)"/)?.[1];
    if (major && !/^\+/.test(major)) theme.headFont = major;
    if (minor && !/^\+/.test(minor)) theme.bodyFont = minor;
  }

  // Biggest embedded image ≈ the logo / brand art (capped at 1.5 MB).
  const media = zip.filter((p) => /^ppt\/media\/.*\.(png|jpe?g)$/i.test(p));
  let biggest: { size: number; file: JSZip.JSZipObject } | null = null;
  for (const f of media) {
    const data = await f.async("uint8array");
    if (!biggest || data.length > biggest.size) biggest = { size: data.length, file: f };
  }
  if (biggest && biggest.size < 1.5 * 1024 * 1024) {
    const b64 = await biggest.file.async("base64");
    const ext = biggest.file.name.toLowerCase().endsWith("png") ? "png" : "jpeg";
    theme.logoDataUrl = `data:image/${ext};base64,${b64}`;
  }

  // Slide text (for the AI to understand the template's structure).
  const slideFiles = zip
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    .sort((a, b) => slideNum(a.name) - slideNum(b.name));
  const slidesText: string[] = [];
  for (const f of slideFiles.slice(0, 15)) {
    const xml = await f.async("string");
    const texts = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).filter(Boolean);
    slidesText.push(texts.join(" · ").slice(0, 500));
  }

  return { theme, slidesText, slideCount: slideFiles.length };
}

function slideNum(path: string): number {
  return Number(path.match(/slide(\d+)\.xml/)?.[1] || 0);
}

// ------------------------------------------------------------------
// Generation
// ------------------------------------------------------------------
async function urlToDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

const W = 10; // 16:9 inches
const H = 5.625;

export async function generateDeck(
  data: DeckData,
  theme: DeckTheme,
  onProgress: (label: string, percent?: number) => void,
  cancelled: () => boolean,
): Promise<boolean> {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "WIDE", width: W, height: H });
  pptx.layout = "WIDE";

  // Rough slide total for the progress percentage.
  const totalSlides =
    1 +
    data.boothByDay.filter((b) => b.text.trim()).length +
    (data.meetingLines.length ? 1 : 0) +
    data.sessions.filter((s) => s.checked).length +
    data.posters.filter((p) => p.checked).length +
    2;
  let doneSlides = 0;
  const tick = (label: string) => onProgress(label, (++doneSlides / totalSlides) * 95);

  const head = { fontFace: theme.headFont, color: theme.text };
  const body = { fontFace: theme.bodyFont, color: theme.text };

  const addLogo = (slide: PptxGenJS.Slide) => {
    if (theme.logoDataUrl) {
      slide.addImage({ data: theme.logoDataUrl, x: W - 1.45, y: 0.18, w: 1.2, h: 0.5, sizing: { type: "contain", w: 1.2, h: 0.5 } });
    }
  };

  // Title slide.
  tick("Title slide…");
  {
    const s = pptx.addSlide();
    s.background = { color: theme.bg };
    s.addShape("rect", { x: 0, y: 0, w: W, h: 1.9, fill: { color: theme.primary } });
    s.addText(data.conferenceName, {
      x: 0.6, y: 0.35, w: W - 2.2, h: 1.2,
      fontSize: 30, bold: true, color: "FFFFFF", fontFace: theme.headFont,
    });
    s.addText("Post-Conference Report", {
      x: 0.6, y: 2.3, w: W - 1.2, h: 0.5, fontSize: 20, ...head, bold: true,
    });
    s.addText([data.dateRange, data.location].filter(Boolean).join("  ·  "), {
      x: 0.6, y: 2.9, w: W - 1.2, h: 0.4, fontSize: 14, ...body, color: "666666",
    });
    addLogo(s);
  }

  // Booth activity (one per day).
  for (const b of data.boothByDay) {
    if (cancelled()) return false;
    if (!b.text.trim()) continue;
    tick(`Booth — ${fmtDayKeyLong(b.day)}…`);
    const s = pptx.addSlide();
    s.background = { color: theme.bg };
    header(s, `Booth activity — ${fmtDayKeyLong(b.day)}`, theme);
    s.addText(bulletsOf(b.text), {
      x: 0.6, y: 1.2, w: W - 1.2, h: H - 1.8, fontSize: 14, ...body, valign: "top",
    });
    addLogo(s);
  }

  // KOL meetings — a single names-list slide.
  if (data.meetingLines.length) {
    if (cancelled()) return false;
    tick("KOL meetings…");
    const s = pptx.addSlide();
    s.background = { color: theme.bg };
    header(s, "KOL meetings", theme);
    s.addText(
      data.meetingLines.map((t) => ({ text: t, options: { bullet: true, breakLine: true } })),
      { x: 0.6, y: 1.2, w: W - 1.2, h: H - 1.8, fontSize: data.meetingLines.length > 14 ? 11 : 14, ...body, valign: "top" },
    );
    addLogo(s);
  }

  // Sessions grouped by day with divider slides; then posters by day.
  const groups: { label: string; items: DeckItem[] }[] = [
    ...groupByDay(data.sessions, "Sessions"),
    ...groupByDay(data.posters, "Posters"),
  ];
  for (const g of groups) {
    if (cancelled()) return false;
    // Day divider.
    const divider = pptx.addSlide();
    divider.background = { color: theme.primary };
    divider.addText(g.label, {
      x: 0.6, y: H / 2 - 0.6, w: W - 1.2, h: 1.2,
      fontSize: 26, bold: true, color: "FFFFFF", fontFace: theme.headFont,
    });

    for (const item of g.items) {
      if (cancelled()) return false;
      tick(`${item.title.slice(0, 40)}…`);
      const s = pptx.addSlide();
      s.background = { color: theme.bg };
      header(s, item.title, theme);
      if (item.meta) {
        s.addText(item.meta, {
          x: 0.6, y: 0.95, w: W - 1.2, h: 0.3, fontSize: 11, ...body, color: "888888",
        });
      }

      // Images sit right in an aspect-fit grid; text narrows to make room.
      const imgs: string[] = [];
      for (const url of item.images.slice(0, 4)) {
        const dataUrl = await urlToDataUrl(url);
        if (dataUrl) imgs.push(dataUrl);
      }
      const textW = imgs.length ? W / 2 - 0.8 : W - 1.2;
      if (item.includeBody && item.body.trim()) {
        const text = item.body.trim();
        const fontSize = text.length > 1600 ? 9 : text.length > 800 ? 11 : 13;
        s.addText(bulletsOf(text), {
          x: 0.6, y: 1.35, w: textW, h: H - 1.9, fontSize, ...body, valign: "top",
        });
      }
      if (imgs.length) {
        const grid = imgs.length === 1 ? 1 : 2;
        const cell = (W / 2 - 0.7) / grid;
        imgs.forEach((dataUrl, i) => {
          s.addImage({
            data: dataUrl,
            x: W / 2 + 0.1 + (i % grid) * (cell + 0.1),
            y: 1.35 + Math.floor(i / grid) * (cell * 0.75 + 0.1),
            w: cell,
            h: cell * 0.75,
            sizing: { type: "contain", w: cell, h: cell * 0.75 },
          });
        });
      }
      addLogo(s);
    }
  }

  if (cancelled()) return false;
  onProgress("Saving file…", 97);
  await pptx.writeFile({ fileName: `${data.conferenceName} — Post-Con.pptx` });
  return true;
}

function header(slide: PptxGenJS.Slide, title: string, theme: DeckTheme) {
  slide.addShape("rect", { x: 0, y: 0, w: 0.18, h: H, fill: { color: theme.primary } });
  slide.addText(title, {
    x: 0.6, y: 0.3, w: W - 2.2, h: 0.6,
    fontSize: 20, bold: true, color: theme.text, fontFace: theme.headFont,
  });
}

function bulletsOf(text: string): { text: string; options: Record<string, unknown> }[] {
  return text
    .split(/\n+/)
    .filter((l) => l.trim())
    .map((l) => {
      const depth = Math.min(Math.floor((l.match(/^\s*/)?.[0].length || 0) / 2), 3);
      const clean = l.replace(/^\s*-\s*/, "").trim();
      return {
        text: clean,
        options: { bullet: l.trim().startsWith("-"), indentLevel: depth, breakLine: true },
      };
    });
}

function groupByDay(items: DeckItem[], prefix: string): { label: string; items: DeckItem[] }[] {
  const map = new Map<string, DeckItem[]>();
  for (const it of items) {
    if (!it.checked) continue;
    const key = it.day || "";
    map.set(key, [...(map.get(key) || []), it]);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, list]) => ({
      label: day ? `${prefix} — ${fmtDayKeyLong(day)}` : prefix,
      items: list,
    }));
}
