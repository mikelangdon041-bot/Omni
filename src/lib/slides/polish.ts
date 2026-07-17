"use client";

// The "Polish" pass — the deterministic half of fixing the most annoying
// part of PowerPoint: things slightly off, overflowing, or inconsistent.
// Geometry is math, not AI: snap, clamp, align titles, normalize fonts, and
// shrink text that can't fit its box. Returns what it changed so the UI can
// report it (and so the AI trim step knows which slides still overflow).

import { SLIDE_H, SLIDE_W, type Slide, type SlideElement } from "./types";

const MARGIN = 0.3;
const SNAP = 0.05;

export interface PolishReport {
  slides: Slide[];
  fixes: string[];
  stillOverflowing: number[]; // slide indices whose text can't fit even at min font
}

const snap = (v: number) => Math.round(v / SNAP) * SNAP;
const r2 = (v: number) => Math.round(v * 100) / 100;

// Rough but effective text-height estimate (inches) for a box of width w.
export function estimateTextHeight(el: SlideElement): number {
  const fontSize = el.fontSize || 16;
  const charsPerLine = Math.max(8, Math.floor((el.w * 72) / (fontSize * 0.52)));
  const lines =
    el.type === "bullets"
      ? (el.bullets || []).reduce(
          (n, b) => n + Math.max(1, Math.ceil(b.length / charsPerLine)),
          0,
        )
      : Math.max(
          1,
          ...(el.text || "")
            .split("\n")
            .map((l) => Math.max(1, Math.ceil(l.length / charsPerLine))),
        ) + (el.text || "").split("\n").length - 1;
  const lineH = (fontSize * 1.35) / 72;
  const spacing = el.type === "bullets" ? ((el.bullets || []).length * 6) / 72 : 0;
  return lines * lineH + spacing;
}

export function polishSlides(slides: Slide[]): PolishReport {
  const fixes: string[] = [];
  const stillOverflowing: number[] = [];

  const out = slides.map((s, si) => {
    const elements = s.elements.map((e) => ({ ...e }));

    // Identify the title: topmost large text.
    const title = elements
      .filter((e) => e.type === "text" && (e.fontSize || 16) >= 20)
      .sort((a, b) => a.y - b.y)[0];

    for (const el of elements) {
      const before = { x: el.x, y: el.y, w: el.w, h: el.h };

      // Snap to grid.
      el.x = snap(el.x);
      el.y = snap(el.y);
      el.w = snap(el.w);
      el.h = snap(el.h);

      // Clamp inside the slide with margins (full-bleed shapes are allowed).
      const fullBleed = el.type === "shape" && (el.w >= SLIDE_W - 0.2 || el.h >= SLIDE_H - 0.2);
      if (!fullBleed) {
        el.w = Math.min(el.w, SLIDE_W - 2 * MARGIN);
        el.h = Math.min(el.h, SLIDE_H - MARGIN - el.y > 0 ? SLIDE_H - MARGIN - Math.max(el.y, 0) : el.h);
        if (el.x < MARGIN) el.x = MARGIN;
        if (el.y < MARGIN && el !== title) el.y = MARGIN;
        if (el.x + el.w > SLIDE_W - MARGIN) el.x = r2(SLIDE_W - MARGIN - el.w);
        if (el.y + el.h > SLIDE_H - MARGIN) el.y = r2(Math.max(MARGIN, SLIDE_H - MARGIN - el.h));
      }

      if (
        Math.abs(before.x - el.x) > 0.01 ||
        Math.abs(before.y - el.y) > 0.01 ||
        Math.abs(before.w - el.w) > 0.01 ||
        Math.abs(before.h - el.h) > 0.01
      ) {
        fixes.push(`Slide ${si + 1}: aligned/clamped a ${el.type} block`);
      }

      // Fit text: shrink font until the estimate fits, floor 10pt.
      if ((el.type === "text" || el.type === "bullets") && el.h > 0) {
        let size = el.fontSize || 16;
        let shrunk = false;
        while (size > 10 && estimateTextHeight({ ...el, fontSize: size }) > el.h + 0.05) {
          size -= 1;
          shrunk = true;
        }
        if (shrunk) {
          el.fontSize = size;
          fixes.push(`Slide ${si + 1}: shrank text to ${size}pt to fit its box`);
        }
        if (estimateTextHeight({ ...el, fontSize: size }) > el.h + 0.05) {
          if (!stillOverflowing.includes(si)) stillOverflowing.push(si);
        }
      }
    }

    // Consistent title position across slides (skip near-fullscreen title slides).
    if (title && elements.filter((e) => e.type !== "shape").length > 1 && title.y < 1.5) {
      if (Math.abs(title.x - 0.5) > 0.01 || Math.abs(title.y - MARGIN) > 0.01) {
        title.x = 0.5;
        title.y = MARGIN;
        title.w = Math.max(title.w, 9);
        fixes.push(`Slide ${si + 1}: standardized the title position`);
      }
    }

    return { ...s, elements };
  });

  return { slides: out, fixes: [...new Set(fixes)], stillOverflowing };
}
