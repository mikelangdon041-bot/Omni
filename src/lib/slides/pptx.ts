"use client";

// Deck JSON → .pptx via pptxgenjs. Because the editor's model uses inches on
// a 10 × 5.625 canvas (pptxgenjs's LAYOUT_16x9), export is a direct mapping —
// created-from-scratch decks and templates come out exactly as designed.

import PptxGenJS from "pptxgenjs";
import { SLIDE_H, SLIDE_W, type Slide, type SlideElement, type SlideTheme } from "./types";

function addElement(
  pptx: PptxGenJS,
  slide: PptxGenJS.Slide,
  el: SlideElement,
  theme: SlideTheme,
) {
  const pos = { x: el.x, y: el.y, w: el.w, h: el.h };
  if (el.type === "text" && (el.text || "").trim()) {
    slide.addText(el.text || "", {
      ...pos,
      fontSize: el.fontSize || 16,
      bold: !!el.bold,
      italic: !!el.italic,
      align: el.align || "left",
      color: el.color || theme.text,
      fontFace: (el.fontSize || 16) >= 20 ? theme.headFont : theme.bodyFont,
      fill: el.fill ? { color: el.fill } : undefined,
      valign: "top",
    });
  } else if (el.type === "bullets" && (el.bullets || []).length) {
    slide.addText(
      (el.bullets || []).map((b) => ({
        text: b,
        options: { bullet: { code: "2022" }, breakLine: true },
      })),
      {
        ...pos,
        fontSize: el.fontSize || 16,
        color: el.color || theme.text,
        fontFace: theme.bodyFont,
        align: el.align || "left",
        valign: "top",
        paraSpaceAfter: 6,
      },
    );
  } else if (el.type === "image" && el.src) {
    if (el.src.startsWith("data:")) slide.addImage({ ...pos, data: el.src });
    else slide.addImage({ ...pos, path: el.src });
  } else if (el.type === "chart" && (el.series || []).length) {
    const chartType =
      el.chartType === "line"
        ? pptx.ChartType.line
        : el.chartType === "pie"
          ? pptx.ChartType.pie
          : pptx.ChartType.bar;
    slide.addChart(
      chartType,
      (el.series || []).map((s) => ({
        name: s.name,
        labels: el.labels || [],
        values: s.values,
      })),
      {
        ...pos,
        chartColors: [theme.primary, theme.secondary, "94A3B8", "F59E0B", "10B981"],
        showLegend: (el.series || []).length > 1 || el.chartType === "pie",
        legendPos: "b",
        dataLabelColor: theme.text,
        catAxisLabelColor: theme.text,
        valAxisLabelColor: theme.text,
      },
    );
  } else if (el.type === "shape") {
    const shapeType =
      el.shape === "ellipse"
        ? pptx.ShapeType.ellipse
        : el.shape === "line"
          ? pptx.ShapeType.line
          : pptx.ShapeType.rect;
    slide.addShape(shapeType, {
      ...pos,
      fill: el.shape === "line" ? undefined : { color: el.fill || theme.primary },
      line:
        el.shape === "line"
          ? { color: el.fill || theme.primary, width: 2 }
          : { color: el.fill || theme.primary, width: 0 },
    });
  }
}

export async function exportDeckPptx(
  title: string,
  slides: Slide[],
  theme: SlideTheme,
): Promise<void> {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "OMNI_16x9", width: SLIDE_W, height: SLIDE_H });
  pptx.layout = "OMNI_16x9";
  pptx.title = title;

  for (const s of slides) {
    const slide = pptx.addSlide();
    slide.background = { color: s.bg || theme.bg };
    for (const el of s.elements) addElement(pptx, slide, el, theme);
    if (s.notes) slide.addNotes(s.notes);
  }

  await pptx.writeFile({
    fileName: `${(title || "deck").replace(/[^\w\- ]+/g, "").trim() || "deck"}.pptx`,
  });
}
