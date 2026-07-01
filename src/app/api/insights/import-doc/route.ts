import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseSurveyDoc } from "@/lib/insights/ai";

export const runtime = "nodejs";
export const maxDuration = 60;

// Parse an uploaded survey worksheet (DOCX / PDF / text) — or pasted text —
// into a structured, branching draft the admin can review before importing.
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let text = "";
  const contentType = req.headers.get("content-type") || "";

  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const pasted = String(form.get("text") || "").trim();
      const file = form.get("file");
      if (pasted) {
        text = pasted;
      } else if (file && file instanceof File) {
        const buffer = Buffer.from(await file.arrayBuffer());
        const name = file.name.toLowerCase();
        if (name.endsWith(".docx") || name.endsWith(".doc")) {
          const mammoth = (await import("mammoth")).default;
          text = (await mammoth.extractRawText({ buffer })).value || "";
        } else if (name.endsWith(".pdf")) {
          const { PDFParse } = await import("pdf-parse");
          const parser = new PDFParse({ data: buffer });
          text = (await parser.getText()).text || "";
          await parser.destroy();
        } else {
          text = buffer.toString("utf-8");
        }
      }
    } else {
      const body = await req.json().catch(() => ({}));
      text = String(body.text || "").trim();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not read file";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  text = text.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) {
    return NextResponse.json(
      { error: "No text found in the document." },
      { status: 400 },
    );
  }

  try {
    const draft = await parseSurveyDoc(text);
    if (!draft.questions.length) {
      return NextResponse.json(
        { error: "Couldn't detect any questions in that document." },
        { status: 422 },
      );
    }
    return NextResponse.json({ draft });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not parse survey";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
