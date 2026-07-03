"use client";

// TRUE template cloning for the Post-Con Deck (spec §24): the output file IS
// the uploaded .pptx — same theme, masters, layouts, fonts, backgrounds and
// branding shapes. We clone the template's own slides as models (title /
// divider / content), replace their text placeholders with our content,
// inject photos, and rebuild the presentation manifest so only the generated
// slides remain.

import JSZip from "jszip";
import type { DeckData, DeckItem } from "./deck";
import { fmtDayKeyLong } from "./utils";

const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const CT = "http://schemas.openxmlformats.org/package/2006/content-types";
const REL_SLIDE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide";
const REL_NOTES =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide";
const REL_IMAGE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";

export interface CloneMapping {
  titleSlideIndex?: number; // 1-based, in the template's slide order
  dividerSlideIndex?: number;
  contentSlideIndex?: number;
}

interface SlideSpec {
  model: "title" | "divider" | "content";
  title: string;
  meta?: string;
  body?: string; // "- " bullet lines, 2-space indents
  images?: string[]; // URLs
}

interface Ctx {
  zip: JSZip;
  parser: DOMParser;
  serializer: XMLSerializer;
  sldW: number; // EMU
  sldH: number;
  imgCounter: number;
}

export async function generateClonedDeck(
  templateBytes: ArrayBuffer,
  data: DeckData,
  mapping: CloneMapping,
  onProgress: (label: string) => void,
  cancelled: () => boolean,
): Promise<Blob | null> {
  const zip = await JSZip.loadAsync(templateBytes);
  const parser = new DOMParser();
  const serializer = new XMLSerializer();

  // ---- Resolve the template's slide order → file paths -------------------
  const presXml = await zip.file("ppt/presentation.xml")?.async("string");
  const presRelsXml = await zip.file("ppt/_rels/presentation.xml.rels")?.async("string");
  const ctXml = await zip.file("[Content_Types].xml")?.async("string");
  if (!presXml || !presRelsXml || !ctXml) throw new Error("Not a valid .pptx template.");

  const presDoc = parser.parseFromString(presXml, "application/xml");
  const presRelsDoc = parser.parseFromString(presRelsXml, "application/xml");
  const ctDoc = parser.parseFromString(ctXml, "application/xml");

  const sldSz = presDoc.getElementsByTagNameNS(P, "sldSz")[0];
  const ctx: Ctx = {
    zip,
    parser,
    serializer,
    sldW: Number(sldSz?.getAttribute("cx") || 12192000),
    sldH: Number(sldSz?.getAttribute("cy") || 6858000),
    imgCounter: 0,
  };

  const relTarget = new Map<string, string>();
  for (const rel of [...presRelsDoc.getElementsByTagNameNS(REL, "Relationship")]) {
    relTarget.set(rel.getAttribute("Id") || "", rel.getAttribute("Target") || "");
  }
  const slidePaths: string[] = [];
  const sldIdLst = presDoc.getElementsByTagNameNS(P, "sldIdLst")[0];
  if (!sldIdLst) throw new Error("Template has no slides.");
  for (const sldId of [...sldIdLst.getElementsByTagNameNS(P, "sldId")]) {
    const rid = sldId.getAttributeNS(R, "id") || sldId.getAttribute("r:id") || "";
    const target = relTarget.get(rid);
    if (target) slidePaths.push(`ppt/${target.replace(/^\.?\//, "")}`);
  }
  if (slidePaths.length === 0) throw new Error("Template has no slides.");

  const modelPath = (index1: number | undefined, fallback: number): string => {
    const i = (index1 && index1 >= 1 && index1 <= slidePaths.length ? index1 : fallback) - 1;
    return slidePaths[Math.max(0, Math.min(i, slidePaths.length - 1))];
  };
  const models = {
    title: modelPath(mapping.titleSlideIndex, 1),
    divider: modelPath(mapping.dividerSlideIndex, Math.min(2, slidePaths.length)),
    content: modelPath(mapping.contentSlideIndex, slidePaths.length),
  };

  // Cache model XML + rels before we delete the originals.
  const modelSrc = new Map<string, { xml: string; rels: string }>();
  for (const path of new Set(Object.values(models))) {
    const xml = await zip.file(path)?.async("string");
    const rels =
      (await zip
        .file(path.replace(/slides\//, "slides/_rels/").concat(".rels"))
        ?.async("string")) ||
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${REL}"/>`;
    if (!xml) throw new Error("Could not read a model slide from the template.");
    modelSrc.set(path, { xml, rels });
  }

  // ---- Build the slide specs from the deck data ---------------------------
  const specs: SlideSpec[] = [
    {
      model: "title",
      title: data.conferenceName,
      body: `Post-Conference Report\n${[data.dateRange, data.location].filter(Boolean).join("  ·  ")}`,
    },
  ];
  for (const b of data.boothByDay) {
    if (b.text.trim()) {
      specs.push({
        model: "content",
        title: `Booth activity — ${fmtDayKeyLong(b.day)}`,
        body: b.text,
      });
    }
  }
  if (data.meetingLines.length) {
    specs.push({
      model: "content",
      title: "KOL meetings",
      body: data.meetingLines.map((l) => `- ${l}`).join("\n"),
    });
  }
  const addGroup = (items: DeckItem[], prefix: string) => {
    const byDay = new Map<string, DeckItem[]>();
    for (const it of items) {
      if (!it.checked) continue;
      byDay.set(it.day || "", [...(byDay.get(it.day || "") || []), it]);
    }
    for (const [day, list] of [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      specs.push({
        model: "divider",
        title: day ? `${prefix} — ${fmtDayKeyLong(day)}` : prefix,
      });
      for (const it of list) {
        specs.push({
          model: "content",
          title: it.title,
          meta: it.meta,
          body: it.includeBody ? it.body : "",
          images: it.images,
        });
      }
    }
  };
  addGroup(data.sessions, "Sessions");
  addGroup(data.posters, "Posters");

  // ---- Generate each slide by cloning its model ---------------------------
  const newSlides: { path: string; relId: string }[] = [];
  for (let i = 0; i < specs.length; i++) {
    if (cancelled()) return null;
    const spec = specs[i];
    onProgress(`Slide ${i + 1}/${specs.length}: ${spec.title.slice(0, 40)}…`);
    const src = modelSrc.get(models[spec.model])!;
    const path = `ppt/slides/slideOmni${i + 1}.xml`;
    await cloneSlide(ctx, src, path, spec);
    newSlides.push({ path, relId: `rIdOmni${i + 1}` });
  }

  // ---- Rebuild the manifest: only generated slides remain -----------------
  // 1. presentation.xml.rels: drop old slide rels, add ours.
  const relsRoot = presRelsDoc.getElementsByTagNameNS(REL, "Relationships")[0];
  for (const rel of [...presRelsDoc.getElementsByTagNameNS(REL, "Relationship")]) {
    if (rel.getAttribute("Type") === REL_SLIDE) rel.remove();
  }
  for (const s of newSlides) {
    const rel = presRelsDoc.createElementNS(REL, "Relationship");
    rel.setAttribute("Id", s.relId);
    rel.setAttribute("Type", REL_SLIDE);
    rel.setAttribute("Target", s.path.replace("ppt/", ""));
    relsRoot.appendChild(rel);
  }

  // 2. presentation.xml: new sldIdLst.
  while (sldIdLst.firstChild) sldIdLst.removeChild(sldIdLst.firstChild);
  newSlides.forEach((s, i) => {
    const sldId = presDoc.createElementNS(P, "p:sldId");
    sldId.setAttribute("id", String(256 + i));
    sldId.setAttributeNS(R, "r:id", s.relId);
    sldIdLst.appendChild(sldId);
  });

  // 3. [Content_Types].xml: overrides for new slides; drop old slide/notes
  //    overrides; make sure png/jpeg defaults exist for injected photos.
  const ctRoot = ctDoc.getElementsByTagNameNS(CT, "Types")[0];
  for (const ov of [...ctDoc.getElementsByTagNameNS(CT, "Override")]) {
    const part = ov.getAttribute("PartName") || "";
    if (/^\/ppt\/(slides|notesSlides)\//.test(part)) ov.remove();
  }
  for (const s of newSlides) {
    const ov = ctDoc.createElementNS(CT, "Override");
    ov.setAttribute("PartName", `/${s.path}`);
    ov.setAttribute(
      "ContentType",
      "application/vnd.openxmlformats-officedocument.presentationml.slide+xml",
    );
    ctRoot.appendChild(ov);
  }
  for (const [ext, type] of [
    ["png", "image/png"],
    ["jpeg", "image/jpeg"],
    ["jpg", "image/jpeg"],
  ]) {
    const has = [...ctDoc.getElementsByTagNameNS(CT, "Default")].some(
      (d) => (d.getAttribute("Extension") || "").toLowerCase() === ext,
    );
    if (!has) {
      const def = ctDoc.createElementNS(CT, "Default");
      def.setAttribute("Extension", ext);
      def.setAttribute("ContentType", type);
      ctRoot.appendChild(def);
    }
  }

  // 4. Delete the original slide parts (and notes slides referencing them).
  for (const path of slidePaths) {
    zip.remove(path);
    zip.remove(path.replace(/slides\//, "slides/_rels/").concat(".rels"));
  }
  zip.folder("ppt/notesSlides")?.forEach((rel, f) => zip.remove(f.name));

  zip.file("ppt/presentation.xml", serializer.serializeToString(presDoc));
  zip.file("ppt/_rels/presentation.xml.rels", serializer.serializeToString(presRelsDoc));
  zip.file("[Content_Types].xml", serializer.serializeToString(ctDoc));

  onProgress("Packaging…");
  return await zip.generateAsync({
    type: "blob",
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  });
}

// ------------------------------------------------------------------
// Clone one model slide, replace its text, inject images.
// ------------------------------------------------------------------
async function cloneSlide(ctx: Ctx, src: { xml: string; rels: string }, path: string, spec: SlideSpec) {
  const doc = ctx.parser.parseFromString(src.xml, "application/xml");
  const relsDoc = ctx.parser.parseFromString(src.rels, "application/xml");

  // Strip notes references (the notes parts get deleted).
  for (const rel of [...relsDoc.getElementsByTagNameNS(REL, "Relationship")]) {
    if (rel.getAttribute("Type") === REL_NOTES) rel.remove();
  }

  const { title, body, others } = classifyShapes(doc);
  if (title) setShapeText(doc, title, [{ text: spec.title }]);

  const bodyLines: { text: string; lvl: number }[] = [];
  if (spec.meta) bodyLines.push({ text: spec.meta, lvl: 0 });
  for (const line of (spec.body || "").split(/\n+/)) {
    if (!line.trim()) continue;
    const lvl = Math.min(Math.floor((line.match(/^\s*/)?.[0].length || 0) / 2), 4);
    bodyLines.push({ text: line.replace(/^\s*-\s*/, "").trim(), lvl });
  }
  if (body) {
    if (bodyLines.length) setShapeText(doc, body, bodyLines);
    else clearShapeText(doc, body);
  }
  // Wipe leftover sample copy in other long text shapes (keep short branding
  // strings like footers and page numbers).
  for (const sp of others) {
    const text = shapeText(sp);
    if (text.split(/\s+/).length > 8) clearShapeText(doc, sp);
  }

  // Inject photos on the right half.
  if (spec.images?.length) {
    await injectImages(ctx, doc, relsDoc, spec.images.slice(0, 4), path);
  }

  ctx.zip.file(path, ctx.serializer.serializeToString(doc));
  ctx.zip.file(
    path.replace(/slides\//, "slides/_rels/").concat(".rels"),
    ctx.serializer.serializeToString(relsDoc),
  );
}

function shapesWithText(doc: Document): Element[] {
  return [...doc.getElementsByTagNameNS(P, "sp")].filter(
    (sp) => sp.getElementsByTagNameNS(P, "txBody").length > 0,
  );
}

function phType(sp: Element): string | null {
  const ph = sp.getElementsByTagNameNS(P, "ph")[0];
  if (!ph) return null;
  return ph.getAttribute("type") || "body"; // ph with only idx = body placeholder
}

function shapeText(sp: Element): string {
  return [...sp.getElementsByTagNameNS(A, "t")].map((t) => t.textContent || "").join(" ");
}

function classifyShapes(doc: Document): {
  title: Element | null;
  body: Element | null;
  others: Element[];
} {
  const shapes = shapesWithText(doc);
  let title =
    shapes.find((s) => ["title", "ctrTitle"].includes(phType(s) || "")) || null;
  let body =
    shapes.find((s) => s !== title && ["body", "subTitle"].includes(phType(s) || "")) || null;
  // No placeholders? Fall back to the two longest text shapes: the shorter
  // one is likely the heading, the longer one the body.
  if (!title && !body) {
    const sorted = [...shapes].sort((a, b) => shapeText(b).length - shapeText(a).length);
    body = sorted[0] || null;
    title = sorted[1] || sorted[0] || null;
    if (title === body) body = null;
  } else if (!body) {
    body = shapes.find((s) => s !== title && phType(s) !== null) || null;
  }
  const others = shapes.filter((s) => s !== title && s !== body);
  return { title, body, others };
}

// Replace a shape's paragraphs with new lines, inheriting the first
// paragraph's run/paragraph formatting from the template.
function setShapeText(doc: Document, sp: Element, lines: { text: string; lvl?: number }[]) {
  const txBody = sp.getElementsByTagNameNS(P, "txBody")[0];
  if (!txBody) return;
  const paras = [...txBody.getElementsByTagNameNS(A, "p")];
  if (paras.length === 0) return;
  const model = paras[0];

  const built = lines.map((line) => {
    const p = model.cloneNode(true) as Element;
    for (const fld of [...p.getElementsByTagNameNS(A, "fld")]) fld.remove();
    for (const br of [...p.getElementsByTagNameNS(A, "br")]) br.remove();
    const runs = [...p.getElementsByTagNameNS(A, "r")];
    let first = runs[0];
    if (!first) {
      first = doc.createElementNS(A, "a:r");
      first.appendChild(doc.createElementNS(A, "a:t"));
      const endPr = p.getElementsByTagNameNS(A, "endParaRPr")[0] || null;
      p.insertBefore(first, endPr);
    }
    for (const r of runs.slice(1)) r.remove();
    let t = first.getElementsByTagNameNS(A, "t")[0];
    if (!t) {
      t = doc.createElementNS(A, "a:t");
      first.appendChild(t);
    }
    t.textContent = line.text;
    if (line.lvl !== undefined) {
      let pPr = p.getElementsByTagNameNS(A, "pPr")[0];
      if (!pPr) {
        pPr = doc.createElementNS(A, "a:pPr");
        p.insertBefore(pPr, p.firstChild);
      }
      if (line.lvl > 0) pPr.setAttribute("lvl", String(Math.min(line.lvl, 8)));
      else pPr.removeAttribute("lvl");
    }
    return p;
  });

  for (const p of paras) p.remove();
  for (const p of built) txBody.appendChild(p);
}

function clearShapeText(doc: Document, sp: Element) {
  for (const t of [...sp.getElementsByTagNameNS(A, "t")]) t.textContent = "";
}

// Fetch photos and place them in an aspect-fit grid on the right half.
async function injectImages(
  ctx: Ctx,
  doc: Document,
  relsDoc: Document,
  urls: string[],
  slidePath: string,
) {
  const spTree = doc.getElementsByTagNameNS(P, "spTree")[0];
  const relsRoot = relsDoc.getElementsByTagNameNS(REL, "Relationships")[0];
  if (!spTree || !relsRoot) return;

  const grid = urls.length === 1 ? 1 : 2;
  const cellW = Math.floor((ctx.sldW / 2 - 400000) / grid);
  const cellH = Math.floor(cellW * 0.72);

  let placed = 0;
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const buf = await res.arrayBuffer();
      const type = res.headers.get("content-type") || "image/jpeg";
      const ext = type.includes("png") ? "png" : "jpeg";
      ctx.imgCounter++;
      const mediaPath = `ppt/media/omniPhoto${ctx.imgCounter}.${ext}`;
      ctx.zip.file(mediaPath, buf);

      const relId = `rIdOmniImg${ctx.imgCounter}`;
      const rel = relsDoc.createElementNS(REL, "Relationship");
      rel.setAttribute("Id", relId);
      rel.setAttribute("Type", REL_IMAGE);
      rel.setAttribute("Target", `../media/omniPhoto${ctx.imgCounter}.${ext}`);
      relsRoot.appendChild(rel);

      const x = Math.floor(ctx.sldW / 2 + 150000 + (placed % grid) * (cellW + 120000));
      const y = Math.floor(ctx.sldH * 0.24 + Math.floor(placed / grid) * (cellH + 120000));
      const picXml = `<p:pic xmlns:p="${P}" xmlns:a="${A}" xmlns:r="${R}">
<p:nvPicPr><p:cNvPr id="${9000 + ctx.imgCounter}" name="omniPhoto${ctx.imgCounter}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>
<p:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
<p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cellW}" cy="${cellH}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
</p:pic>`;
      const picDoc = ctx.parser.parseFromString(picXml, "application/xml");
      spTree.appendChild(doc.importNode(picDoc.documentElement, true));
      placed++;
    } catch {
      // skip unfetchable photos
    }
  }
  void slidePath;
}
