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

// Belt-and-braces for the model's habit of ending a topic bullet with a
// dangling dash before its nested list ("Territory review —<ul>…"). The prompt
// forbids it; this strips it if one slips through, so the notes never show a
// bullet trailing off into nothing.
export function tidyNotesHtml(html: string): string {
  return (html || "")
    // Trailing dash/colon/ellipsis immediately before a nested list.
    .replace(/[\s]*[-–—:]+\s*(?=<(?:ul|ol)\b)/gi, "")
    // Or at the very end of a list item.
    .replace(/[\s]*[-–—:]+\s*(?=<\/li>)/gi, "")
    .trim();
}

// Tidy up a bullet list after hand-editing.
//
// Deleting the text of a bullet that has children leaves an empty <li> that
// still draws its own marker, so you get a stray bullet sitting above the
// indented ones. The fix is to lift the children up a level rather than leave
// an empty parent behind. Runs on blur, not on every keystroke, so it can
// never fight the caret while typing.
export function cleanNotesHtml(html: string): string {
  if (typeof window === "undefined" || !html) return html;
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const root = doc.body.firstElementChild;
  if (!root) return html;

  let changed = true;
  let passes = 0;
  while (changed && passes < 5) {
    changed = false;
    passes += 1;

    for (const li of Array.from(root.querySelectorAll("li"))) {
      const nested = Array.from(li.children).filter(
        (c) => c.tagName === "UL" || c.tagName === "OL",
      );
      // Text of this bullet, ignoring anything in its sub-list.
      const own = Array.from(li.childNodes)
        .filter((n) => !(n instanceof Element && (n.tagName === "UL" || n.tagName === "OL")))
        .map((n) => n.textContent || "")
        .join("")
        .replace(/ /g, " ")
        .trim();

      if (own) continue;

      if (nested.length > 0) {
        // Empty parent: promote its children into the list it sits in.
        const parentList = li.parentElement;
        for (const list of nested) {
          while (list.firstElementChild) {
            parentList?.insertBefore(list.firstElementChild, li);
          }
        }
        li.remove();
        changed = true;
      } else if (!li.querySelector("img")) {
        // Nothing in it at all.
        li.remove();
        changed = true;
      }
    }

    for (const list of Array.from(root.querySelectorAll("ul, ol"))) {
      if (!list.querySelector("li")) {
        list.remove();
        changed = true;
      }
    }
  }

  return root.innerHTML;
}
