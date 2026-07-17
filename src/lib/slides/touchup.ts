"use client";

// Touch-up mode: edit the words inside an existing .pptx without touching
// ANYTHING else. We list every text run (<a:t>) per slide, let the user edit
// them, then splice the new strings back into the original XML and re-zip.
// Design, layouts, SmartArt, animations, media — all byte-identical.

import JSZip from "jszip";

export interface TouchupRun {
  slideIndex: number; // 1-based
  runIndex: number; // index among <a:t> occurrences within that slide file
  original: string;
  edited: string;
}

export interface TouchupDoc {
  fileName: string;
  zip: JSZip;
  slideFiles: string[]; // sorted slide XML paths
  runs: TouchupRun[];
}

const decode = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");

const encode = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

export async function loadTouchup(file: File): Promise<TouchupDoc> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const slideFiles = zip
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    .map((f) => f.name)
    .sort((a, b) => {
      const na = Number(a.match(/slide(\d+)\.xml/)?.[1] || 0);
      const nb = Number(b.match(/slide(\d+)\.xml/)?.[1] || 0);
      return na - nb;
    });

  const runs: TouchupRun[] = [];
  for (let i = 0; i < slideFiles.length; i++) {
    const xml = (await zip.file(slideFiles[i])?.async("string")) || "";
    let idx = 0;
    for (const m of xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)) {
      const text = decode(m[1]);
      if (text.trim()) {
        runs.push({ slideIndex: i + 1, runIndex: idx, original: text, edited: text });
      }
      idx++;
    }
  }
  return { fileName: file.name, zip, slideFiles, runs };
}

export async function exportTouchup(doc: TouchupDoc): Promise<Blob> {
  // Group edits per slide, then replace run-by-run in order.
  const bySlide = new Map<number, TouchupRun[]>();
  for (const r of doc.runs) {
    if (r.edited !== r.original) {
      bySlide.set(r.slideIndex, [...(bySlide.get(r.slideIndex) || []), r]);
    }
  }

  for (const [slideIndex, edits] of bySlide) {
    const path = doc.slideFiles[slideIndex - 1];
    const xml = (await doc.zip.file(path)?.async("string")) || "";
    const editByRun = new Map(edits.map((e) => [e.runIndex, e.edited]));
    let idx = -1;
    const next = xml.replace(/<a:t>([\s\S]*?)<\/a:t>/g, (full) => {
      idx++;
      const edited = editByRun.get(idx);
      return edited === undefined ? full : `<a:t>${encode(edited)}</a:t>`;
    });
    doc.zip.file(path, next);
  }

  return doc.zip.generateAsync({
    type: "blob",
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  });
}
