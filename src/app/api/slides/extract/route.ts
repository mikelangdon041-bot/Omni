import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

// Extract plain text from an uploaded DOCX / PDF / text file so Slide Studio
// can build a deck from a document. (Same parsing stack as insights import.)
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const name = file.name.toLowerCase();
    let text = "";
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
    text = text.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
    if (!text) {
      return NextResponse.json({ error: "No text found in that document." }, { status: 400 });
    }
    return NextResponse.json({ text });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not read file";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
