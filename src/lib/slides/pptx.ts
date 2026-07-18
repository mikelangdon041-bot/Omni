"use client";

// Deck JSON → .pptx via pptxgenjs. Because the editor's model uses inches on
// a 10 × 5.625 canvas (pptxgenjs's LAYOUT_16x9), export is a direct mapping —
// created-from-scratch decks and templates come out exactly as designed.
// Slide transitions aren't supported by pptxgenjs, so we inject the
// <p:transition> element into each slide's XML after generation.

import PptxGenJS from "pptxgenjs";
import JSZip from "jszip";
import {
  SLIDE_H,
  SLIDE_W,
  isDarkHex,
  notesToText,
  type ShapeKind,
  type Slide,
  type SlideElement,
  type SlideTheme,
  type SlideTransition,
} from "./types";

// Editor shape → OOXML preset geometry (pptxgenjs ShapeType key).
const SHAPE_MAP: Record<ShapeKind, string> = {
  rect: "rect",
  roundRect: "roundRect",
  ellipse: "ellipse",
  triangle: "triangle",
  diamond: "diamond",
  rightArrow: "rightArrow",
  leftArrow: "leftArrow",
  upArrow: "upArrow",
  downArrow: "downArrow",
  chevron: "chevron",
  pentagon: "pentagon",
  star: "star5",
  line: "line",
};

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
      el.chartType === "line" || el.chartType === "area"
        ? el.chartType === "area"
          ? pptx.ChartType.area
          : pptx.ChartType.line
        : el.chartType === "pie"
          ? pptx.ChartType.pie
          : el.chartType === "doughnut"
            ? pptx.ChartType.doughnut
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
        chartColors: [theme.primary, theme.secondary, "94A3B8", "F59E0B", "10B981", "3B82F6"],
        showLegend:
          (el.series || []).length > 1 ||
          el.chartType === "pie" ||
          el.chartType === "doughnut",
        legendPos: "b",
        dataLabelColor: theme.text,
        catAxisLabelColor: theme.text,
        valAxisLabelColor: theme.text,
      },
    );
  } else if (el.type === "shape") {
    const kind: ShapeKind = el.shape || "rect";
    const shapeType =
      ((pptx.ShapeType as unknown as Record<string, PptxGenJS.SHAPE_NAME>)[
        SHAPE_MAP[kind]
      ] as PptxGenJS.SHAPE_NAME) || pptx.ShapeType.rect;
    const fillColor = el.fill || theme.primary;
    const line =
      kind === "line"
        ? { color: fillColor, width: el.lineWidth || 2 }
        : el.lineColor
          ? { color: el.lineColor, width: el.lineWidth || 1 }
          : { color: fillColor, width: 0 };
    if ((el.text || "").trim() && kind !== "line") {
      // Shapes with a label export as a text box with shape geometry.
      slide.addText(el.text || "", {
        ...pos,
        shape: shapeType,
        fill: { color: fillColor },
        line,
        align: "center",
        valign: "middle",
        fontSize: el.fontSize || 14,
        bold: el.bold ?? true,
        color: el.color || (isDarkHex(fillColor) ? "FFFFFF" : "1F2937"),
        fontFace: theme.bodyFont,
      });
    } else {
      slide.addShape(shapeType, {
        ...pos,
        fill: kind === "line" ? undefined : { color: fillColor },
        line,
      });
    }
  }
}

// OOXML for each transition choice (dur ~ medium speed).
const TRANSITION_XML: Record<Exclude<SlideTransition, "none">, string> = {
  fade: '<p:transition spd="med"><p:fade/></p:transition>',
  push: '<p:transition spd="med"><p:push dir="l"/></p:transition>',
  wipe: '<p:transition spd="med"><p:wipe dir="l"/></p:transition>',
  cover: '<p:transition spd="med"><p:cover dir="l"/></p:transition>',
  dissolve: '<p:transition spd="med"><p:dissolve/></p:transition>',
};

async function injectTransitions(blob: Blob, transition: SlideTransition): Promise<Blob> {
  if (!transition || transition === "none") return blob;
  const xml = TRANSITION_XML[transition];
  if (!xml) return blob;
  const zip = await JSZip.loadAsync(blob);
  const slideFiles = Object.keys(zip.files).filter((f) =>
    /^ppt\/slides\/slide\d+\.xml$/.test(f),
  );
  for (const f of slideFiles) {
    const content = await zip.file(f)!.async("string");
    if (content.includes("<p:transition")) continue;
    // Valid position: after cSld and clrMapOvr, right before </p:sld>.
    zip.file(f, content.replace("</p:sld>", `${xml}</p:sld>`));
  }
  return zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  });
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
    const notes = notesToText(s.notes);
    if (notes) slide.addNotes(notes);
  }

  const raw = (await pptx.write({ outputType: "blob" })) as Blob;
  const finalBlob = await injectTransitions(raw, theme.transition || "none");

  const fileName = `${(title || "deck").replace(/[^\w\- ]+/g, "").trim() || "deck"}.pptx`;
  const url = URL.createObjectURL(finalBlob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
