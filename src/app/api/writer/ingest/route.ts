import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { anthropic, WRITER_MODEL } from "@/lib/anthropic";

export const runtime = "nodejs";
export const maxDuration = 120;

// Turn an uploaded file into HTML the Writing Studio can drop straight into the
// draft box. Word and text files are read directly; PDFs are parsed for text and
// fall back to Claude when they turn out to be scans; screenshots go to Claude's
// vision — which is how "I saved the email as a PDF / took a screenshot" works.

const MAX_BYTES = 15 * 1024 * 1024;

const IMAGE_TYPES: Record<string, "image/png" | "image/jpeg" | "image/gif" | "image/webp"> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
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
        { error: "That file is over 15 MB — try a smaller one." },
        { status: 413 },
      );

    const buffer = Buffer.from(await file.arrayBuffer());
    const name = file.name.toLowerCase();
    const ext = name.split(".").pop() || "";

    // Screenshots and photos — read them with Claude's vision.
    if (IMAGE_TYPES[ext]) {
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
                  media_type: IMAGE_TYPES[ext],
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

    if (ext === "docx" || ext === "doc") {
      const mammoth = (await import("mammoth")).default;
      const html = (await mammoth.convertToHtml({ buffer })).value || "";
      if (!html.trim())
        return NextResponse.json(
          { error: "That document appears to be empty." },
          { status: 422 },
        );
      return NextResponse.json({ html });
    }

    if (ext === "pdf") {
      let text = "";
      try {
        const { PDFParse } = await import("pdf-parse");
        const parser = new PDFParse({ data: buffer });
        text = (await parser.getText()).text || "";
        await parser.destroy();
      } catch {
        text = "";
      }

      // Enough extractable text means it's a real text PDF — use it as-is.
      if (text.trim().length >= 40) return NextResponse.json({ html: textToHtml(text) });

      // Otherwise it's a scan or an image-only export — let Claude read it.
      const res = await anthropic().messages.create({
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
      });
      const html = cleanModelHtml(firstText(res));
      if (!html || html === "<p></p>")
        return NextResponse.json(
          { error: "I couldn't find any text in that PDF." },
          { status: 422 },
        );
      return NextResponse.json({ html });
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
    const message = err instanceof Error ? err.message : "Could not read that file";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
