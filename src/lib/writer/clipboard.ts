// Turning stored draft HTML into something that survives a paste into Outlook,
// Gmail, or Teams.
//
// Two separate things go wrong on the way to a mail client, and both of them
// look to the person pasting like "my line breaks are gone".
//
// The first is structure. The editor spells a line break <br> — Enter runs
// insertLineBreak — while the model writes <p> blocks, so any piece that was
// generated and then edited by hand is a mix of the two. A run of two <br>s is
// a paragraph break to whoever typed it, but to a mail client it is two line
// breaks inside a single paragraph, which Outlook is free to collapse. Worse,
// a draft typed or pasted from scratch can be nothing but <br>s, and no amount
// of styling <p> tags helps a document that has none. So the markup is rebuilt
// into real blocks first: a blank line becomes a <p>, however it was written.
//
// The second is styling. Mail clients apply their own paragraph rules and none
// of them honour a stylesheet arriving on the clipboard. Outlook zeroes <p>
// margins and, because its renderer is Word, resets each block to the Normal
// style rather than inheriting the wrapper's font. Every block therefore
// carries its own margin, font, and line height inline.

import { htmlToPlain } from "./types";

// Two destinations, two shapes, and they are not the same shape — which is the
// bug this split fixes.
//
// The CLIPBOARD lands in an unknown client via a paste, so it declares
// everything: a font, because there is no telling what the paste target's
// default is, and a margin AND a blank paragraph between blocks, because Word
// throws the margin away and something has to survive.
//
// An INSERT into Outlook is not a paste. setSelectedDataAsync and
// displayReplyForm hand the HTML to the message body directly, so the margin
// survives — and then the blank paragraph is on top of it, which is the extra
// space. Worse, a declared font overrides the font the person set as their
// default, so text arrives as Calibri 11 in a message they write in something
// else. So there: no font at all unless we read theirs off the message, and no
// margin, leaving the blank paragraph as the one and only gap. That is exactly
// what Outlook itself writes when somebody presses Enter twice.
const CLIPBOARD_FONT =
  "font-family:Calibri,Helvetica,Arial,sans-serif;font-size:11pt;line-height:1.45";

/** The inline styles every block gets, for one destination. */
interface Skin {
  font: string;
  paragraph: string;
  list: string;
  nestedList: string;
  item: string;
  heading: string;
}

/** A skin from a font declaration (possibly empty) and a block margin. */
function skin(font: string, margin: string): Skin {
  const f = font ? `;${font}` : "";
  // A heading sets its own size; inheriting the body's would flatten it.
  const headingFont = font.replace(/(^|;)\s*font-size\s*:[^;]*/gi, "").replace(/^;+|;+$/g, "");
  return {
    font,
    paragraph: `${margin}${f}`,
    list: `${margin}${f};padding-left:24px`,
    nestedList: `margin:4px 0 0 0${f};padding-left:24px`,
    item: `margin:0 0 4px 0${f}`,
    heading: `${margin}${headingFont ? `;${headingFont}` : ""};line-height:1.3`,
  };
}

const CLIPBOARD_SKIN = skin(CLIPBOARD_FONT, "margin:0 0 12px 0");

// Tags that end the paragraph they appear in. Anything else is inline, and a
// run of inline nodes sitting loose at the top level is a paragraph nobody got
// round to wrapping.
const BLOCK_TAGS = new Set([
  "P", "DIV", "UL", "OL", "LI", "H1", "H2", "H3", "H4", "H5", "H6",
  "BLOCKQUOTE", "TABLE", "PRE", "HR",
]);

const CONTAINS_BLOCK = "p,div,ul,ol,h1,h2,h3,h4,h5,h6,blockquote,table";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Draft HTML plus an optional subject and signature, styled to paste
 * correctly into mail. A copy can only ever land wherever the cursor is on
 * paste, and a mail client's Subject box is a separate field from the body —
 * there is no way for one clipboard write to reach both. Leading with the
 * subject as its own bold line means it is still there to grab and move,
 * rather than silently dropped.
 */
export function toEmailHtml(bodyHtml: string, signatureHtml = "", subject = ""): string {
  return assemble(CLIPBOARD_SKIN, bodyHtml, signatureHtml, subject);
}

/**
 * The same piece, for going straight into an Outlook message rather than onto
 * the clipboard — `setSelectedDataAsync` in a draft, `displayReplyForm` from a
 * message you are reading.
 *
 * `font` is the font declaration read off the message being written, when
 * there was one to read (see `composeFont`). Empty is the better default, not
 * a worse one: text with no font of its own takes the font the person set for
 * writing mail, which is the answer they actually wanted.
 */
export function toOutlookHtml(bodyHtml: string, signatureHtml = "", font = ""): string {
  return assemble(skin(font, "margin:0"), bodyHtml, signatureHtml);
}

function assemble(s: Skin, bodyHtml: string, signatureHtml: string, subject = ""): string {
  const body = normalizeBlocks(bodyHtml, s);
  const signature = signatureHtml ? normalizeBlocks(signatureHtml, s) : "";
  // Same reasoning as the spacers inside each block (see injectSpacers): the
  // gap has to be a real paragraph, not a margin, or Outlook drops it at the
  // seam after the subject line and the one before the signature too.
  const spacer = `<p style="margin:0${s.font ? `;${s.font}` : ""}">&nbsp;</p>`;
  const subjectLine = subject.trim()
    ? `<p style="${s.paragraph}"><b>Subject: ${escapeHtml(subject.trim())}</b></p>${spacer}`
    : "";
  const gap = body && signature ? spacer : "";
  const wrapper = s.font ? ` style="${s.font}"` : "";
  return `<div${wrapper}>${subjectLine}${body}${gap}${signature}</div>`;
}

/**
 * The font the open Outlook message is already written in, as a declaration to
 * hand back to it — or "" when the HTML doesn't say.
 *
 * Outlook spells this two ways depending on which Outlook it is. The new one
 * and OWA wrap whatever you type in `<div class="elementToProof" style="font-
 * family:Aptos…;font-size:12pt">`. Classic Outlook is Word, so it puts the
 * answer in a stylesheet instead, on `p.MsoNormal` or on the `span.EmailStyle`
 * rule Word generates for the current message.
 *
 * `@font-face` blocks are dropped before anything is read: every Outlook ships
 * one for "Cambria Math", and it sits above the rule that matters.
 */
export function composeFont(html: string): string {
  if (!html) return "";
  const source = html.replace(/@font-face\s*\{[^}]*\}/gi, "");

  const declaration = (block: string): string => {
    const family = block.match(/font-family\s*:\s*([^;"}]+)/i)?.[1]?.trim();
    const size = block.match(/font-size\s*:\s*([^;"}]+)/i)?.[1]?.trim();
    if (!family && !size) return "";
    return [family && `font-family:${family}`, size && `font-size:${size}`]
      .filter(Boolean)
      .join(";");
  };

  // What the person is typing into, first: it is the live answer rather than a
  // rule that may or may not apply to this block.
  const proof = source.match(/class\s*=\s*"[^"]*elementToProof[^"]*"[^>]*style\s*=\s*"([^"]*)"/i);
  if (proof) {
    const d = declaration(proof[1]);
    if (d) return d;
  }
  for (const rule of [/(?:span\.EmailStyle\d+|p\.MsoNormal|\.MsoNormal)\s*(?:,[^{]*)?\{([^}]*)\}/i]) {
    const m = source.match(rule);
    if (m) {
      const d = declaration(m[1]);
      if (d) return d;
    }
  }
  // Last resort: the first style attribute that names both. A lone font-family
  // is not enough — Outlook puts one on wrappers that are not the body text.
  for (const m of source.matchAll(/style\s*=\s*"([^"]*)"/gi)) {
    if (/font-family/i.test(m[1]) && /font-size/i.test(m[1])) {
      const d = declaration(m[1]);
      if (d) return d;
    }
  }
  return "";
}

/**
 * The other direction: plain text arriving from somewhere else — the clipboard,
 * or an email read out of Outlook — turned into the simple block HTML the
 * editor and the AI both expect. Blank lines become paragraphs, single newlines
 * stay line breaks, and the text is escaped, because an email quoting a bit of
 * markup should not be able to put tags into the draft.
 */
export function plainToHtml(text: string): string {
  return (text || "")
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/**
 * The same content as plain text — the other flavor on the clipboard, and what
 * a mailto: body gets. Derived from the same rebuilt markup as the HTML so the
 * two agree about where the blank lines are.
 */
export function toEmailText(bodyHtml: string, signatureHtml = "", subject = ""): string {
  const body = htmlToPlain(normalizeBlocks(bodyHtml, CLIPBOARD_SKIN));
  const signature = signatureHtml
    ? htmlToPlain(normalizeBlocks(signatureHtml, CLIPBOARD_SKIN))
    : "";
  const withSignature = signature ? `${body}\n\n${signature}` : body;
  return subject.trim() ? `Subject: ${subject.trim()}\n\n${withSignature}` : withSignature;
}

/**
 * Rebuild stored HTML as explicit, individually styled blocks: loose inline
 * runs wrapped, blank lines promoted to paragraphs, spacing inlined.
 */
function normalizeBlocks(html: string, s: Skin): string {
  if (!html?.trim()) return "";
  // Server-side (or any DOM-less caller) falls back to styling whatever blocks
  // are already there. Copying only ever happens in the browser, so this is a
  // safety net rather than a path anyone takes.
  if (typeof DOMParser === "undefined") return withInlineSpacing(html, s);

  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const root = doc.body;
  wrapLooseInlines(root, doc);
  for (const el of Array.from(root.querySelectorAll("p,div,h1,h2,h3,h4,h5,h6")))
    splitOnBlankLines(el);
  injectSpacers(root, doc);
  applyInlineStyles(root, s);
  return root.innerHTML;
}

/**
 * Outlook's paste engine is Word, and Word regularly discards margin/padding
 * on pasted <p> tags in favor of its own Normal style — the gap this file
 * spends so much effort giving every block (BLOCK_MARGIN, above) survives
 * plenty of destinations but not that one. A literal blank paragraph between
 * blocks survives everywhere, because there is no styling for a client to
 * ignore: the line is really there. Lists are skipped — a bullet list already
 * reads as separate from what precedes it, and a blank line before one looks
 * like a mistake rather than a paragraph break.
 */
function injectSpacers(root: HTMLElement, doc: Document) {
  const children = Array.from(root.children);
  for (let i = children.length - 1; i > 0; i--) {
    const prev = children[i - 1];
    const cur = children[i];
    if (isList(prev) || isList(cur)) continue;
    cur.before(doc.createElement("p"));
  }
}

function isList(el: Element): boolean {
  return el.tagName === "UL" || el.tagName === "OL";
}

/** Does this node put anything on the page? A lone <br> or stray space doesn't. */
function hasContent(node: Node): boolean {
  if (node.nodeType === Node.TEXT_NODE) return !!node.textContent?.trim();
  if (node.nodeType !== Node.ELEMENT_NODE) return false;
  const el = node as Element;
  if (el.tagName === "BR") return false;
  return !!el.textContent?.trim() || !!el.querySelector("img");
}

function isBr(node: Node): boolean {
  return node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName === "BR";
}

/**
 * Top-level text and <br>s — a draft typed straight into the editor, or pasted
 * as one run — become real paragraphs, so they have something to hang spacing
 * off once they reach the mail client.
 */
function wrapLooseInlines(root: HTMLElement, doc: Document) {
  const runs: Node[][] = [];
  let run: Node[] = [];
  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has((node as Element).tagName)) {
      if (run.length) runs.push(run);
      run = [];
    } else {
      run.push(node);
    }
  }
  if (run.length) runs.push(run);

  for (const nodes of runs) {
    // Whitespace and stray breaks between two blocks are the editor's leftovers,
    // not content; wrapping them would add a phantom empty line.
    if (!nodes.some(hasContent)) {
      for (const n of nodes) (n as ChildNode).remove();
      continue;
    }
    const p = doc.createElement("p");
    (nodes[0] as ChildNode).before(p);
    p.append(...nodes);
  }
}

/**
 * Split a text block wherever two or more <br>s sit together: that is a blank
 * line, and a blank line is a paragraph break. Single breaks are left alone —
 * they are line breaks and should stay line breaks.
 */
function splitOnBlankLines(el: Element) {
  // A parent of other blocks is a container, and its children get handled on
  // their own pass. Its direct <br>s, if any, are not a paragraph shape.
  if (!el.isConnected || el.querySelector(CONTAINS_BLOCK)) return;
  const kids = Array.from(el.childNodes);
  if (!kids.some(isBr)) return;

  const segments: Node[][] = [];
  let segment: Node[] = [];
  // Breaks and whitespace held back until we know whether content follows: a
  // run of them mid-block is a separator, at the end it is trailing noise.
  let pending: Node[] = [];

  for (const node of kids) {
    if (isBr(node) || (node.nodeType === Node.TEXT_NODE && !node.textContent?.trim())) {
      pending.push(node);
      continue;
    }
    if (pending.filter(isBr).length >= 2) {
      segments.push(segment);
      segment = [];
    } else {
      segment.push(...pending);
    }
    pending = [];
    segment.push(node);
  }
  segments.push(segment);

  const useful = segments.filter((s) => s.some(hasContent));
  // Nothing but breaks — an intentional blank spacer paragraph. Leave it be;
  // the styling pass gives it a height.
  if (!useful.length) return;

  const replacements = useful.map((nodes) => {
    const block = el.cloneNode(false) as Element;
    block.append(...nodes);
    return block;
  });
  el.replaceWith(...replacements);
}

/** Give every block its own margin, font, and line height. */
function applyInlineStyles(root: HTMLElement, s: Skin) {
  const blocks = root.querySelectorAll<HTMLElement>(
    "p,div,ul,ol,li,h1,h2,h3,h4,h5,h6,blockquote",
  );
  for (const el of Array.from(blocks)) {
    const tag = el.tagName;
    if (tag === "UL" || tag === "OL") {
      // A list nested inside an item belongs to the line above it, so it takes
      // the tight item spacing rather than a full paragraph gap.
      addStyle(el, el.parentElement?.tagName === "LI" ? s.nestedList : s.list);
    } else if (tag === "LI") {
      addStyle(el, s.item);
    } else if (/^H[1-6]$/.test(tag)) {
      addStyle(el, s.heading);
    } else if (tag === "BLOCKQUOTE") {
      addStyle(el, `${s.paragraph};padding-left:12px;border-left:3px solid #d0d0d0`);
    } else if (!el.querySelector(CONTAINS_BLOCK)) {
      // A <div> wrapping other blocks is scaffolding; only text blocks get the
      // paragraph gap, or the spacing doubles up.
      addStyle(el, s.paragraph);
      // An empty paragraph is how the editor spells "blank line". Give it
      // something to be tall, or every client collapses it away.
      if (!el.textContent?.trim() && !el.querySelector("img")) el.innerHTML = "&nbsp;";
    }
  }
}

/** Add `style` to an element, keeping — and overriding — anything already set. */
function addStyle(el: HTMLElement, style: string) {
  const existing = el.getAttribute("style")?.replace(/;\s*$/, "");
  el.setAttribute("style", existing ? `${existing};${style}` : style);
}

// --- DOM-less fallback ------------------------------------------------------
// Styles the blocks that are already present. No restructuring, so a <br>-only
// draft still pastes flat — but nothing here needs a browser.

function withInlineSpacing(html: string, s: Skin): string {
  return html
    .replace(/<(p|h[1-6])(\s[^>]*)?>/gi, (_m, tag, attrs = "") =>
      `<${tag}${mergeStyle(attrs, tag.toLowerCase() === "p" ? s.paragraph : s.heading)}>`,
    )
    .replace(/<(ul|ol)(\s[^>]*)?>/gi, (_m, tag, attrs = "") =>
      `<${tag}${mergeStyle(attrs, s.list)}>`,
    )
    .replace(/<li(\s[^>]*)?>/gi, (_m, attrs = "") => `<li${mergeStyle(attrs, s.item)}>`)
    .replace(/<p([^>]*)>\s*(?:&nbsp;)?\s*<\/p>/gi, "<p$1>&nbsp;</p>");
}

function mergeStyle(attrs: string, style: string): string {
  if (/\sstyle\s*=/i.test(attrs))
    return attrs.replace(/(\sstyle\s*=\s*")([^"]*)"/i, (_m, lead, existing) =>
      `${lead}${existing.replace(/;\s*$/, "")};${style}"`,
    );
  return `${attrs} style="${style}"`;
}
