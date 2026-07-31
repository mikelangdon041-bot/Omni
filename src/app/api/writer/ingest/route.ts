import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { anthropic, WRITER_MODEL } from "@/lib/anthropic";
import { extractPdfText } from "@/lib/pdfText";

export const runtime = "nodejs";
export const maxDuration = 120;

// Turn an uploaded file into HTML the Writing Studio can drop straight into the
// draft box. Word and text files are read directly; PDFs are parsed for text and
// fall back to Claude when they turn out to be scans; screenshots go to Claude's
// vision — which is how "I saved the email as a PDF / took a screenshot" works.

// The platform refuses a request body over 4.5 MB before it ever reaches this
// function, so promising 15 MB only bought an unexplained failure. The client
// checks the same number and says so up front.
const MAX_BYTES = 4 * 1024 * 1024;

// A scan has to be read page-by-page by the model, which is slow and gets
// refused outright on long documents. Hold it to something that can finish
// inside the request, and say so plainly when it can't.
const AI_READ_TIMEOUT_MS = 60_000;

type ImageMime = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

const IMAGE_TYPES: Record<string, ImageMime> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

// A screenshot pasted from the clipboard often arrives as "image.png" — but not
// always, and not on every browser — so fall back to the declared MIME type
// rather than the file name when working out what we were handed.
const IMAGE_MIMES: Record<string, ImageMime> = {
  "image/png": "image/png",
  "image/jpeg": "image/jpeg",
  "image/jpg": "image/jpeg",
  "image/gif": "image/gif",
  "image/webp": "image/webp",
};

const TRANSCRIBE_SYSTEM = `You transcribe a document or screenshot into clean HTML so it can be pasted into a writing tool.

Rules:
- Return ONLY the transcription as simple HTML: <p> for paragraphs, <br> only inside a paragraph, <ul>/<ol>/<li> for lists, <b>/<i> where the original clearly emphasises. No inline styles, no headings unless the original has them, no markdown, no code fences.
- Transcribe faithfully. Do not summarize, improve, translate, or add anything that isn't there.
- If it is an email or message, keep the header lines (From / To / Date / Subject) as a short paragraph at the top, then the body.
- Preserve the paragraph breaks of the original — one <p> per paragraph.
- Ignore pure chrome: browser toolbars, app navigation, scrollbars, unread badges.
- If there is no readable text at all, return exactly: <p></p>`;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Plain text → paragraphs, keeping single newlines as line breaks.
function textToHtml(text: string): string {
  const clean = text.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) return "";
  return clean
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function firstText(res: { content: { type: string; text?: string }[] }): string {
  const block = res.content.find((b) => b.type === "text");
  return (block?.text || "").trim();
}

// Strip anything the model wrapped around the HTML despite being told not to.
function cleanModelHtml(raw: string): string {
  return raw
    .replace(/^```(?:html)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const contentType = req.headers.get("content-type") || "";
  if (!contentType.includes("multipart/form-data"))
    return NextResponse.json({ error: "Expected a file upload" }, { status: 400 });

  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File))
      return NextResponse.json({ error: "No file received" }, { status: 400 });
    if (file.size > MAX_BYTES)
      return NextResponse.json(
        { error: "That file is over 4 MB — try a smaller one." },
        { status: 413 },
      );

    const buffer = Buffer.from(await file.arrayBuffer());
    const name = file.name.toLowerCase();
    const ext = name.includes(".") ? name.split(".").pop() || "" : "";
    const mime = (file.type || "").toLowerCase();
    const imageType = IMAGE_TYPES[ext] || IMAGE_MIMES[mime];

    // Screenshots and photos — read them with Claude's vision.
    if (imageType) {
      const res = await anthropic().messages.create({
        model: WRITER_MODEL,
        max_tokens: 8000,
        system: TRANSCRIBE_SYSTEM,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: imageType,
                  data: buffer.toString("base64"),
                },
              },
              { type: "text", text: "Transcribe everything readable in this image." },
            ],
          },
        ],
      });
      const html = cleanModelHtml(firstText(res));
      if (!html || html === "<p></p>")
        return NextResponse.json(
          { error: "I couldn't read any text in that image." },
          { status: 422 },
        );
      return NextResponse.json({ html });
    }

    if (ext === "docx" || ext === "doc" || mime.includes("wordprocessingml")) {
      const mammoth = (await import("mammoth")).default;
      const html = (await mammoth.convertToHtml({ buffer })).value || "";
      if (!html.trim())
        return NextResponse.json(
          { error: "That document appears to be empty." },
          { status: 422 },
        );
      return NextResponse.json({ html });
    }

    if (ext === "pdf" || mime === "application/pdf") {
      let text = "";
      try {
        text = await extractPdfText(buffer);
      } catch (err) {
        // Swallowed silently once, which hid a missing pdf.js worker in the
        // deployed bundle for weeks: every PDF quietly took the slow AI path
        // instead. A broken reader has to be loud.
        console.error("[writer/ingest] pdf text extraction failed", err);
        text = "";
      }

      // Enough extractable text means it's a real text PDF — use it as-is.
      // Deliberately a low bar: reading the text out locally is free, exact, and
      // never refused, so anything usable should go this way rather than to the
      // model.
      if (text.trim().length >= 20) return NextResponse.json({ html: textToHtml(text) });

      // Otherwise it's a scan or an image-only export — let Claude read it.
      try {
        const res = await anthropic().messages.create(
          {
            model: WRITER_MODEL,
            max_tokens: 16000,
            system: TRANSCRIBE_SYSTEM,
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "document",
                    source: {
                      type: "base64",
                      media_type: "application/pdf",
                      data: buffer.toString("base64"),
                    },
                  },
                  { type: "text", text: "Transcribe everything readable in this document." },
                ],
              },
            ],
          },
          // Bounded, and not retried: a scan this size that fails once fails
          // again, and a second attempt only makes the wait longer.
          { timeout: AI_READ_TIMEOUT_MS, maxRetries: 0 },
        );
        const html = cleanModelHtml(firstText(res));
        if (!html || html === "<p></p>")
          return NextResponse.json(
            { error: "I couldn't find any text in that PDF." },
            { status: 422 },
          );
        return NextResponse.json({ html });
      } catch (err) {
        // The transcription can be declined outright (a safety classifier, a
        // malformed PDF). Whatever little text came out locally beats losing the
        // file entirely, so fall back to it before giving up.
        if (text.trim()) return NextResponse.json({ html: textToHtml(text) });
        throw err;
      }
    }

    // .txt / .md / .csv / anything else readable as text.
    const html = textToHtml(buffer.toString("utf-8"));
    if (!html)
      return NextResponse.json(
        { error: "I couldn't read any text out of that file." },
        { status: 422 },
      );
    return NextResponse.json({ html });
  } catch (err) {
    return NextResponse.json({ error: readableError(err) }, { status: 500 });
  }
}

/**
 * A sentence someone can act on, instead of the SDK's message — which is the
 * HTTP status followed by the raw JSON body, and ends up in a toast looking like
 * `400 {"type":"error","error":{...}}`.
 */
function readableError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  // The SDK message starts with the status code; matching it loose would let a
  // digit inside a request id decide the wording.
  const status = Number(raw.match(/^(\d{3})/)?.[1] ?? 0);
  if (/timed out|timeout|aborted/i.test(raw))
    return "That one took too long to read. If it's a scan, try fewer pages — or paste the text in instead.";
  if (/content filtering|blocked by/i.test(raw))
    return "The reader declined that file. If it's a scan, try a clearer copy, or paste the text in instead.";
  if (status === 413 || /request_too_large|too many tokens/i.test(raw))
    return "That file is too big to read in one go — try splitting it.";
  if (status === 429 || /rate_limit_error/.test(raw))
    return "Too many files at once. Give it a moment and try again.";
  if (status >= 500 || /overloaded_error/.test(raw))
    return "The reader is busy right now — try that one again.";
  // Anything unrecognised: keep it short and never leak a JSON body.
  return "I couldn't read that file.";
}
