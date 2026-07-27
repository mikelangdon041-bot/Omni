import { parseOutline } from "@/lib/summaryTree";
import type { Debrief } from "./types";

// The notes are one HTML document now. Meetings saved under the two earlier
// shapes — `sections` (separate cards) and `summary` (an indented "- "
// outline) — are folded into the same shape on read, so nothing already
// captured is lost and there is no migration to run.
export function debriefNotesHtml(debrief: Debrief): string {
  if (debrief.notesHtml?.trim()) return debrief.notesHtml;

  const sections = debrief.sections || [];
  if (sections.length > 0) {
    // Each old section becomes a top-level bullet with its content nested.
    return `<ul>${sections
      .map((s) => {
        const body = s.content?.trim() || "";
        const nested = /^<ul|^<ol/i.test(body) ? body : body ? `<ul><li>${body}</li></ul>` : "";
        return `<li>${escapeHtml(s.title)}${nested}</li>`;
      })
      .join("")}</ul>`;
  }

  const flat = parseOutline(debrief.summary || "");
  if (flat.length === 0) return "";
  let html = "";
  let depth = 0;
  for (const bullet of flat) {
    while (depth < bullet.depth) {
      html += "<ul>";
      depth += 1;
    }
    while (depth > bullet.depth) {
      html += "</ul></li>";
      depth -= 1;
    }
    html += `${html.endsWith("<ul>") ? "" : ""}<li>${escapeHtml(bullet.content)}`;
    html += "</li>";
  }
  while (depth > 0) {
    html += "</ul>";
    depth -= 1;
  }
  return `<ul>${html}</ul>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
