import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 60;

// Extract text from an uploaded resume (PDF / DOCX / text) so AI can read it.
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const candidateId = String(body.candidateId || "");
  const path = String(body.path || "");
  if (!candidateId || !path) {
    return NextResponse.json({ error: "candidateId and path required" }, { status: 400 });
  }

  // Only the candidate owner can extract into the candidate record.
  const { data: candidate } = await supabase
    .from("candidates")
    .select("id")
    .eq("id", candidateId)
    .eq("user_id", user.id)
    .single();
  if (!candidate) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const admin = createAdminClient();
  const { data: blob, error: dlErr } = await admin.storage.from("resumes").download(path);
  if (dlErr || !blob) {
    return NextResponse.json({ error: "Could not read file" }, { status: 500 });
  }
  const buffer = Buffer.from(await blob.arrayBuffer());
  const lower = path.toLowerCase();

  let text = "";
  // Formatted HTML for an in-app preview that keeps the document's structure
  // (headings, bold, lists). PDFs/images are previewed from the file itself,
  // so they don't need HTML here.
  let html = "";
  try {
    if (lower.endsWith(".pdf")) {
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: buffer });
      const result = await parser.getText();
      text = result.text || "";
      await parser.destroy();
    } else if (lower.endsWith(".docx") || lower.endsWith(".doc")) {
      const mammoth = (await import("mammoth")).default;
      const [raw, rich] = await Promise.all([
        mammoth.extractRawText({ buffer }),
        mammoth.convertToHtml({ buffer }),
      ]);
      text = raw.value || "";
      html = rich.value || "";
    } else {
      text = buffer.toString("utf-8");
      html = `<pre style="white-space:pre-wrap;font-family:inherit;margin:0">${text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")}</pre>`;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not parse file";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  text = text.replace(/\n{3,}/g, "\n\n").trim();
  if (text) {
    await admin.from("candidates").update({ resume_text: text }).eq("id", candidateId);
  }
  return NextResponse.json({ text, html });
}
