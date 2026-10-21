// Plain text out of whatever the writer hands Meeting Prep as material: a
// file, a photo or screenshot (read by the model), or a web link. Lives here
// rather than in the route so a check script can run the same code.

import { anthropic, RESEARCH_MODEL } from "@/lib/anthropic";
import { extractPdfText } from "@/lib/pdfText";

// The platform refuses a body over 4.5 MB before it reaches the function.
export const MAX_BYTES = 4 * 1024 * 1024;
const MAX_TEXT = 200_000;

export type ImageMime = "image/png" | "image/jpeg" | "image/gif" | "image/webp";
export const IMAGE_TYPES: Record<string, ImageMime> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  "image/png": "image/png",
  "image/jpeg": "image/jpeg",
  "image/jpg": "image/jpeg",
  "image/gif": "image/gif",
  "image/webp": "image/webp",
};

export function tidy(text: string): string {
  return text
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_TEXT);
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

// Readable text from a page: the chrome around it (scripts, menus, footers)
// dropped, block elements kept as line breaks so an agenda stays a list.
export function htmlToText(html: string): { text: string; title: string } {
  const title = decodeEntities((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").trim());
  const body = html
    .replace(/<(script|style|noscript|svg|nav|footer|header|form|iframe)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article)[^>]*>/gi, "\n")
    .replace(/<(td|th)[^>]*>/gi, "\t")
    .replace(/<[^>]+>/g, " ");
  return {
    title,
    text: tidy(
      decodeEntities(body)
        .split("\n")
        .map((l) => l.replace(/\s+/g, " ").trim())
        .join("\n"),
    ),
  };
}

// The server fetches the link, so it must not be pointed back at itself or
// at anything else that is only reachable from inside.
function isPublicHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return false;
  if (/^\[?::1\]?$/.test(h) || h.startsWith("[fc") || h.startsWith("[fd") || h.startsWith("[fe80"))
    return false;
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10 || a === 127 || a === 0) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
  }
  return true;
}

export async function readImage(buffer: Buffer, type: ImageMime): Promise<string> {
  const res = await anthropic().messages.create({
    model: RESEARCH_MODEL,
    max_tokens: 8000,
    system:
      "Transcribe everything readable in this image as plain text, faithfully, in reading order. Keep the layout's structure with line breaks: an agenda keeps one line per slot with its time, a slide keeps its bullets, a table keeps one row per line with cells separated by \" | \". No commentary, no markdown, nothing that is not in the image. If there is no readable text, return nothing.",
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: type, data: buffer.toString("base64") } },
          { type: "text", text: "Transcribe it." },
        ],
      },
    ],
  });
  const block = res.content.find((b) => b.type === "text");
  return tidy(block && "text" in block ? block.text : "");
}

export async function readUrl(raw: string): Promise<{ text: string; name: string }> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("That isn't a link I can open.");
  }
  if (!/^https?:$/.test(url.protocol) || !isPublicHost(url.hostname))
    throw new Error("That isn't a public web page.");
  const res = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(20_000),
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8",
    },
  });
  if (!res.ok)
    throw new Error(
      res.status === 403 || res.status === 401
        ? "That page won't let me in (it needs a login, or blocks readers). Save it as a PDF, or paste the text."
        : `That page didn't load (${res.status}).`,
    );
  const type = (res.headers.get("content-type") || "").toLowerCase();
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > 15 * 1024 * 1024) throw new Error("That page is too large to read.");
  const fallbackName = url.hostname.replace(/^www\./, "") + url.pathname.replace(/\/$/, "");
  if (type.includes("application/pdf") || url.pathname.toLowerCase().endsWith(".pdf")) {
    return { text: tidy(await extractPdfText(buffer)), name: decodeURIComponent(url.pathname.split("/").pop() || fallbackName) };
  }
  if (type.startsWith("image/")) {
    const it = IMAGE_TYPES[type.split(";")[0]];
    if (!it) throw new Error("That image type can't be read.");
    return { text: await readImage(buffer, it), name: fallbackName };
  }
  const { text, title } = type.includes("html") || !type
    ? htmlToText(buffer.toString("utf-8"))
    : { text: tidy(buffer.toString("utf-8")), title: "" };
  return { text, name: title || fallbackName };
}
