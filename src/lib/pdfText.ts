// pdf.js polyfills DOMMatrix / ImageData / Path2D from the optional
// `@napi-rs/canvas` native package when it loads under Node, but that package
// is platform-specific and its Linux binary doesn't make it into a Vercel
// function's traced bundle. Left unpolyfilled, pdf.js's own module-level
// `new DOMMatrix()` throws at import time — "DOMMatrix is not defined" —
// before any of our code runs, which took down every PDF read in production
// while working every time in local dev (where the Windows binary IS
// installed). None of these ever run for plain text extraction: they only
// matter for rendering a page to a canvas, which nothing here does. Stand-ins
// that satisfy pdf.js's import-time construction are enough, and let this run
// without ever pulling in the native package at all.
let polyfilled = false;
function ensurePdfPolyfills() {
  if (polyfilled) return;
  polyfilled = true;
  const g = globalThis as unknown as Record<string, unknown>;
  if (!g.DOMMatrix) {
    class DOMMatrixStub {
      multiplySelf() {
        return this;
      }
      preMultiplySelf() {
        return this;
      }
      invertSelf() {
        return this;
      }
      translate() {
        return this;
      }
      scale() {
        return this;
      }
    }
    g.DOMMatrix = DOMMatrixStub;
  }
  if (!g.Path2D) {
    class Path2DStub {
      addPath() {}
    }
    g.Path2D = Path2DStub;
  }
  if (!g.ImageData) g.ImageData = class {};
}

/** Extract the text of a PDF, or "" if it has none (a scan, an image-only export). */
export async function extractPdfText(buffer: Buffer): Promise<string> {
  ensurePdfPolyfills();
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: buffer });
  try {
    return (await parser.getText()).text || "";
  } finally {
    await parser.destroy();
  }
}
