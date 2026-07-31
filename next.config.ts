import type { NextConfig } from "next";

// pdf.js loads its worker with a fully dynamic `await import(workerSrc)` that
// the file tracer cannot see, so pdf.worker.mjs never shipped and every PDF
// read threw ERR_MODULE_NOT_FOUND on Vercel — silently, because each caller
// falls back to reading the pages with the AI. That fallback is ~90s a file and
// gets refused outright on long documents, which is what "PDF upload is frozen"
// actually was. Everything pdf.js resolves by path at runtime goes in.
const PDF_ASSETS = [
  "./node_modules/pdfjs-dist/package.json",
  "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
  "./node_modules/pdfjs-dist/standard_fonts/**",
  "./node_modules/pdfjs-dist/cmaps/**",
  "./node_modules/pdfjs-dist/wasm/**",
];

// Every route that reads a PDF with pdf-parse.
const PDF_ROUTES = [
  "/api/writer/ingest",
  "/api/insights/import-doc",
  "/api/interview/parse-resume",
  "/api/meeting/extract",
  "/api/slides/extract",
];

const nextConfig: NextConfig = {
  transpilePackages: ["leaflet", "react-leaflet", "@react-leaflet/core"],
  // ffmpeg-static resolves its binary path from its own __dirname. If Next
  // bundles it, that path breaks at runtime (spawn ENOENT on Vercel). Keep it
  // external so the require resolves the real node_modules path...
  serverExternalPackages: ["ffmpeg-static", "pdf-parse", "mammoth"],
  // ...and make sure the binary actually ships in the function bundle.
  outputFileTracingIncludes: {
    "/api/recordings/[id]/uploaded": ["./node_modules/ffmpeg-static/**"],
    "/api/conference/transcribe": ["./node_modules/ffmpeg-static/**"],
    "/api/meeting/transcribe-upload": ["./node_modules/ffmpeg-static/**"],
    ...Object.fromEntries(PDF_ROUTES.map((route) => [route, PDF_ASSETS])),
  },
};

export default nextConfig;
