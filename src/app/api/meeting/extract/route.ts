import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { extractPdfText } from "@/lib/pdfText";
import { IMAGE_TYPES, MAX_BYTES, openUrl, readImage, tidy } from "@/lib/meetingprep/extractText";

export const runtime = "nodejs";
export const maxDuration = 60;

// Plain text out of whatever the writer hands Meeting Prep as material:
//   multipart { file }   a DOCX / PDF / text file, or a photo or screenshot
//                        (a printed agenda, a slide), read by the model
//   json { url }         a web page (the conference's session page), or a PDF
//                        behind a link
// Returns { text, name }.

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    if ((req.headers.get("content-type") || "").includes("application/json")) {
      const body = await req.json().catch(() => ({}));
      const { text, name } = await openUrl(String(body?.url || ""));
      if (text.length < 40)
        return NextResponse.json(
          {
            error:
              "I couldn't find readable text on that page. It may build itself in the browser; paste the text or save it as a PDF instead.",
          },
          { status: 422 },
        );
      return NextResponse.json({ text, name });
    }

    const form = await req.formData();
    const file = form.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (file.size > MAX_BYTES)
      return NextResponse.json({ error: "That file is over 4 MB. Try a smaller one." }, { status: 413 });
    const buffer = Buffer.from(await file.arrayBuffer());
    const name = file.name.toLowerCase();
    const ext = name.includes(".") ? name.split(".").pop() || "" : "";
    const imageType = IMAGE_TYPES[ext] || IMAGE_TYPES[(file.type || "").toLowerCase()];
    let text = "";
    if (imageType) {
      text = await readImage(buffer, imageType);
    } else if (ext === "docx" || ext === "doc") {
      const mammoth = (await import("mammoth")).default;
      text = (await mammoth.extractRawText({ buffer })).value || "";
    } else if (ext === "pdf") {
      text = await extractPdfText(buffer);
    } else {
      text = buffer.toString("utf-8");
    }
    text = tidy(text);
    if (!text) {
      return NextResponse.json(
        {
          error: imageType
            ? "I couldn't read any text in that image."
            : "No text found in that document. If it's a scan, take a photo or screenshot of it instead.",
        },
        { status: 400 },
      );
    }
    return NextResponse.json({ text, name: file.name });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not read that";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
