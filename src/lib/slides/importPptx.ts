"use client";

// .pptx → deck JSON ("Remix" import). Best-effort by design: simple decks
// (text boxes, bullets, images, tables-as-text) come across with position
// and theme; SmartArt/charts/animations are simplified to their text. The
// Touch-up mode (touchup.ts) is the zero-loss alternative for text edits.

import JSZip from "jszip";
import {
  DEFAULT_SLIDE_THEME,
  SLIDE_H,
  SLIDE_W,
  uid,
  type Slide,
  type SlideElement,
  type SlideTheme,
} from "./types";

const EMU_PER_IN = 914400;

export interface ImportResult {
  theme: SlideTheme;
  slides: Slide[];
  slideCount: number;
  simplified: number; // diagrams/charts flattened to text
  hasAnimations: boolean;
}

function extractTheme(themeXml: string | null): SlideTheme {
  const theme: SlideTheme = { ...DEFAULT_SLIDE_THEME };
  if (!themeXml) return theme;
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
  return theme;
}

function paragraphTexts(xml: string): string[] {
  // One entry per <a:p>, runs joined.
  const paras: string[] = [];
  for (const p of xml.split(/<a:p[ >]/).slice(1)) {
    const runs = [...p.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) =>
      m[1]
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'"),
    );
    const text = runs.join("").trim();
    if (text) paras.push(text);
  }
  return paras;
}

function shapeGeometry(xml: string): { x: number; y: number; w: number; h: number } | null {
  const off = xml.match(/<a:off x="(-?\d+)" y="(-?\d+)"/);
  const ext = xml.match(/<a:ext cx="(\d+)" cy="(\d+)"/);
  if (!off || !ext) return null;
  return {
    x: Number(off[1]) / EMU_PER_IN,
    y: Number(off[2]) / EMU_PER_IN,
    w: Number(ext[1]) / EMU_PER_IN,
    h: Number(ext[2]) / EMU_PER_IN,
  };
}

// Scale from the source deck's slide size onto our 10 × 5.625 canvas.
function scaler(presXml: string | null): (g: { x: number; y: number; w: number; h: number }) => {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  let sw = 12192000 / EMU_PER_IN; // default 16:9 (13.33in)
  let sh = 6858000 / EMU_PER_IN;
  const m = presXml?.match(/<p:sldSz cx="(\d+)" cy="(\d+)"/);
  if (m) {
    sw = Number(m[1]) / EMU_PER_IN;
    sh = Number(m[2]) / EMU_PER_IN;
  }
  const fx = SLIDE_W / sw;
  const fy = SLIDE_H / sh;
  return (g) => ({
    x: Math.round(g.x * fx * 100) / 100,
    y: Math.round(g.y * fy * 100) / 100,
    w: Math.max(0.3, Math.round(g.w * fx * 100) / 100),
    h: Math.max(0.2, Math.round(g.h * fy * 100) / 100),
  });
}

export async function importPptx(file: File): Promise<ImportResult> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const theme = extractTheme(
    (await zip.file("ppt/theme/theme1.xml")?.async("string")) || null,
  );
  const scale = scaler(
    (await zip.file("ppt/presentation.xml")?.async("string")) || null,
  );

  const slideFiles = zip
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    .sort((a, b) => {
      const na = Number(a.name.match(/slide(\d+)\.xml/)?.[1] || 0);
      const nb = Number(b.name.match(/slide(\d+)\.xml/)?.[1] || 0);
      return na - nb;
    });

  const slides: Slide[] = [];
  let simplified = 0;
  let hasAnimations = false;

  for (const sf of slideFiles) {
    const xml = await sf.async("string");
    if (/<p:timing>/.test(xml)) hasAnimations = true;
    const elements: SlideElement[] = [];

    // Relationships for this slide (images).
    const relPath = sf.name.replace("slides/", "slides/_rels/") + ".rels";
    const relXml = (await zip.file(relPath)?.async("string")) || "";
    const rels = new Map<string, string>();
    for (const m of relXml.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
      rels.set(m[1], m[2].replace(/^\.\.\//, "ppt/"));
    }

    // Text shapes.
    for (const sp of xml.split(/<p:sp>/).slice(1)) {
      const body = sp.split("</p:sp>")[0];
      const geo = shapeGeometry(body);
      const paras = paragraphTexts(body);
      if (!paras.length) continue;
      const g = geo
        ? scale(geo)
        : { x: 0.5, y: 0.5 + elements.length * 0.8, w: 9, h: 0.8 };
      const looksTitle =
        paras.length === 1 &&
        (/<p:ph type="(title|ctrTitle)"/.test(body) || g.y < 1.2);
      const sizeMatch = body.match(/<a:rPr[^>]*sz="(\d+)"/);
      const fontSize = sizeMatch ? Math.round(Number(sizeMatch[1]) / 100) : looksTitle ? 24 : 16;
      if (paras.length === 1) {
        elements.push({
          id: uid(),
          type: "text",
          text: paras[0],
          ...g,
          fontSize,
          bold: looksTitle || /<a:rPr[^>]*b="1"/.test(body),
          color: theme.text,
          align: /algn="ctr"/.test(body) ? "center" : "left",
        });
      } else {
        elements.push({
          id: uid(),
          type: "bullets",
          bullets: paras,
          ...g,
          fontSize,
          color: theme.text,
          align: "left",
        });
      }
    }

    // Images.
    for (const pic of xml.split(/<p:pic>/).slice(1)) {
      const body = pic.split("</p:pic>")[0];
      const embed = body.match(/r:embed="([^"]+)"/)?.[1];
      const target = embed ? rels.get(embed) : null;
      const geo = shapeGeometry(body);
      if (!target || !geo) continue;
      const media = zip.file(target);
      if (!media) continue;
      const data = await media.async("uint8array");
      if (data.length > 2 * 1024 * 1024) continue; // keep the JSON sane
      const ext = target.toLowerCase().endsWith("png") ? "png" : "jpeg";
      const b64 = await media.async("base64");
      elements.push({
        id: uid(),
        type: "image",
        src: `data:image/${ext};base64,${b64}`,
        ...scale(geo),
      });
    }

    // SmartArt / charts → flatten any text we can find, count as simplified.
    for (const gf of xml.split(/<p:graphicFrame>/).slice(1)) {
      const body = gf.split("</p:graphicFrame>")[0];
      const isDiagramOrChart = /relIds|<c:chart|chart\.xml/.test(body);
      const paras = paragraphTexts(body); // tables carry a:t too
      const geo = shapeGeometry(body);
      if (paras.length) {
        const g = geo ? scale(geo) : { x: 0.5, y: 1.5, w: 9, h: 3 };
        elements.push({
          id: uid(),
          type: "bullets",
          bullets: paras.slice(0, 20),
          ...g,
          fontSize: 14,
          color: theme.text,
          align: "left",
        });
      }
      if (isDiagramOrChart) simplified++;
    }

    slides.push({ id: uid(), elements, notes: "" });
  }

  // Speaker notes.
  for (let i = 0; i < slides.length; i++) {
    const notesXml = await zip
      .file(`ppt/notesSlides/notesSlide${i + 1}.xml`)
      ?.async("string");
    if (notesXml) {
      const paras = paragraphTexts(notesXml).filter((p) => !/^\d+$/.test(p));
      slides[i].notes = paras.join("\n");
    }
  }

  return { theme, slides, slideCount: slides.length, simplified, hasAnimations };
}
