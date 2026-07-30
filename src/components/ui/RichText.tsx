"use client";

import { useEffect, useRef, useState } from "react";
import DOMPurify from "dompurify";
import {
  Bold,
  Italic,
  Link2,
  Link2Off,
  List,
  ListOrdered,
  IndentIncrease,
  IndentDecrease,
} from "lucide-react";

// Keep pasted content's structure (bold/italic/lists/links) but drop the
// colors/borders/fonts browsers carry over from Word, Docs, and web pages.
function cleanPaste(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ["b", "strong", "i", "em", "u", "ul", "ol", "li", "p", "br", "a", "h3", "h4"],
    // target/rel are kept so a link pasted in, or made here, still opens in a
    // new tab after a round trip through the clipboard.
    ALLOWED_ATTR: ["href", "target", "rel"],
  });
}

// What we are willing to turn into a link.
//
// "javascript:" and "data:" in an href are script execution dressed as a
// destination, and this text gets rendered back out in the app and pasted into
// email, so they are refused rather than sanitized later. Anything without a
// scheme is assumed to be a web address, because that is what someone typing
// "anthropic.com" means.
function normalizeUrl(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(text)
    ? text
    : text.startsWith("//")
      ? `https:${text}`
      : `https://${text}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  return ["http:", "https:", "mailto:", "tel:"].includes(url.protocol) ? url.href : null;
}

/** The <a> the caret or selection currently sits inside, if any. */
function anchorAt(node: Node | null, root: HTMLElement | null): HTMLAnchorElement | null {
  let current: Node | null = node;
  while (current && current !== root) {
    if (current.nodeName === "A") return current as HTMLAnchorElement;
    current = current.parentNode;
  }
  return null;
}

// Rich-text editor matching the session/KOL notes format: a compact toolbar
// (bold/italic · bullets/numbers · indent/outdent), keyboard shortcuts, and
// clean paste. Stores HTML; emits on input.
// Files carried by a paste or a drop. A screenshot copied with Snipping Tool
// or ⌘⇧4 arrives here as an image file, which is how "paste the screenshot
// straight in" works without an upload dialog.
function filesFrom(dt: DataTransfer | null): File[] {
  if (!dt) return [];
  return Array.from(dt.files || []).filter((f) => f.size > 0);
}

export function RichText({
  value,
  onChange,
  placeholder = "Start typing… (saves automatically)",
  minHeight = "min-h-28",
  onFiles,
  autoFocus = false,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: string;
  /** Handle images pasted or files dropped into the editor. */
  onFiles?: (files: File[]) => void;
  /** Put the caret in here on mount and scroll it into view. */
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const last = useRef(value);
  const [dragging, setDragging] = useState(false);

  // Linking. The selection is lost the moment focus moves to the URL box, so
  // the range is stashed first and restored before the link is applied.
  const savedRange = useRef<Range | null>(null);
  const [linkBox, setLinkBox] = useState<{
    top: number;
    left: number;
    url: string;
    /** Set when editing an existing link rather than making a new one. */
    editing: boolean;
    /** No text was selected, so the popover has to ask what the link says. */
    needsText: boolean;
    text: string;
  } | null>(null);
  const [menu, setMenu] = useState<{ top: number; left: number; onLink: boolean } | null>(null);

  // Sync external value in without clobbering the caret while typing.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.innerHTML !== value && (el.innerHTML === "" || last.current !== value)) {
      el.innerHTML = value || "";
      last.current = value;
    }
  }, [value]);

  // Land with the caret already in the box. contenteditable needs the caret
  // placed explicitly — focus() alone can leave it at the top of the document
  // in some browsers — and the scroll keeps the editor in view when it sits
  // below the fold.
  useEffect(() => {
    if (!autoFocus) return;
    const el = ref.current;
    if (!el) return;
    const t = setTimeout(() => {
      el.focus({ preventScroll: true });
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 0);
    return () => clearTimeout(t);
    // Mount only — refocusing on every value change would fight the caret.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function emit() {
    const html = ref.current?.innerHTML || "";
    last.current = html;
    onChange(html);
  }

  function exec(command: string) {
    ref.current?.focus();
    document.execCommand(command, false);
    emit();
  }

  // --- linking ------------------------------------------------------------

  /** Where to float the popover, relative to the editor. */
  function anchorPoint(): { top: number; left: number } {
    const box = ref.current?.getBoundingClientRect();
    const selection = window.getSelection();
    if (!box || !selection?.rangeCount) return { top: 8, left: 8 };
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    // A collapsed caret at the very start can report an empty rect.
    const top = (rect.bottom || box.top) - box.top + 6;
    const left = Math.max(0, (rect.left || box.left) - box.left);
    return { top, left };
  }

  function openLinkBox() {
    const el = ref.current;
    const selection = window.getSelection();
    if (!el || !selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!el.contains(range.commonAncestorContainer)) return;

    const existing = anchorAt(range.commonAncestorContainer, el);
    if (existing) {
      // Editing a link: work on the whole anchor, not the few characters the
      // caret happens to sit between.
      const whole = document.createRange();
      whole.selectNodeContents(existing);
      savedRange.current = whole;
      setMenu(null);
      setLinkBox({
        ...anchorPoint(),
        url: existing.getAttribute("href") || "",
        editing: true,
        needsText: false,
        text: "",
      });
      return;
    }

    savedRange.current = range.cloneRange();
    setMenu(null);
    setLinkBox({
      ...anchorPoint(),
      url: "",
      editing: false,
      // With nothing selected there is no text to turn into a link, so the
      // popover asks what it should say rather than silently doing nothing.
      needsText: range.collapsed,
      text: "",
    });
  }

  function restoreSelection() {
    const range = savedRange.current;
    if (!range) return false;
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    return true;
  }

  function applyLink(rawUrl: string, linkText: string) {
    const url = normalizeUrl(rawUrl);
    const el = ref.current;
    if (!url || !el) return;
    el.focus();
    if (!restoreSelection()) return;

    const selection = window.getSelection();
    const collapsed = selection?.getRangeAt(0).collapsed ?? true;
    if (collapsed) {
      // Nothing highlighted: insert the words, then link them.
      const label = linkText.trim() || url;
      document.execCommand("insertText", false, label);
      const range = selection?.getRangeAt(0);
      if (range) {
        range.setStart(range.endContainer, Math.max(0, range.endOffset - label.length));
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
    }
    document.execCommand("createLink", false, url);

    // execCommand leaves a bare <a href>. These open outside the app, so they
    // get the target and the rel that stops the new tab reaching back.
    for (const a of Array.from(el.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer");
    }
    savedRange.current = null;
    setLinkBox(null);
    emit();
  }

  function removeLink() {
    const el = ref.current;
    const selection = window.getSelection();
    if (!el || !selection?.rangeCount) return;
    const existing = anchorAt(selection.getRangeAt(0).commonAncestorContainer, el);
    if (!existing) return;
    const whole = document.createRange();
    whole.selectNodeContents(existing);
    selection.removeAllRanges();
    selection.addRange(whole);
    el.focus();
    document.execCommand("unlink");
    setMenu(null);
    setLinkBox(null);
    emit();
  }

  function onInput() {
    if (composing.current) return;
    emit();
  }

  function onPaste(e: React.ClipboardEvent) {
    const html = e.clipboardData.getData("text/html");
    const text = e.clipboardData.getData("text/plain");
    const images = filesFrom(e.clipboardData).filter((f) =>
      f.type.startsWith("image/"),
    );

    // A pasted screenshot is always intercepted, whether or not this editor can
    // do something with it. A snip from Windows or ⌘⇧4 puts an image on the
    // clipboard and nothing in text/html or text/plain, so falling through here
    // hands it to the browser, which drops the picture into the text at full
    // size and leaves nowhere to put the caret. An editor that takes files gets
    // it; one that doesn't simply declines it.
    if (images.length) {
      e.preventDefault();
      if (onFiles) onFiles(images);
      else if (text) {
        document.execCommand("insertText", false, text);
        emit();
      }
      return;
    }

    if (!html && !text) return;
    e.preventDefault();
    if (html) document.execCommand("insertHTML", false, cleanPaste(html));
    else document.execCommand("insertText", false, text);
    emit();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === "b") { e.preventDefault(); exec("bold"); }
    if ((e.metaKey || e.ctrlKey) && e.key === "i") { e.preventDefault(); exec("italic"); }
    if ((e.metaKey || e.ctrlKey) && e.key === "u") { e.preventDefault(); exec("underline"); }
    // The shortcut every other editor uses for this.
    if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); openLinkBox(); }
    if (e.key === "Escape" && (linkBox || menu)) {
      e.preventDefault();
      setLinkBox(null);
      setMenu(null);
    }
    if (e.key === "Tab") { e.preventDefault(); exec(e.shiftKey ? "outdent" : "indent"); }
    // Enter: keep the browser default inside lists (new bullet), but insert
    // an explicit line break elsewhere — default block insertion is
    // unreliable in contenteditable across browsers and could swallow the
    // carriage return entirely.
    if (e.key === "Enter" && !e.shiftKey) {
      let node: Node | null = window.getSelection()?.anchorNode ?? null;
      let inList = false;
      while (node && node !== ref.current) {
        if (node.nodeName === "LI") { inList = true; break; }
        node = node.parentNode;
      }
      if (!inList) {
        e.preventDefault();
        const ok = document.execCommand("insertLineBreak");
        if (!ok) document.execCommand("insertHTML", false, "<br>");
        emit();
      }
    }
  }

  return (
    <div
      onDragOver={(e) => {
        // Claim every drop, not just OS file drops. An image dragged out of a
        // web page or a Word document arrives as HTML with an <img src> and no
        // File at all — and if this handler passes on it, the browser's default
        // drops the picture straight into the contenteditable, where it renders
        // full-size and there is no way to get a caret past it.
        if (!onFiles) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        if (!onFiles) return;
        e.preventDefault();
        setDragging(false);
        const files = filesFrom(e.dataTransfer);
        if (files.length) {
          onFiles(files);
          return;
        }
        // No file behind it, so take the words and leave the markup: dropping
        // rich content from a page should never bring an image with it.
        const text = e.dataTransfer.getData("text/plain");
        if (text) {
          ref.current?.focus();
          document.execCommand("insertText", false, text);
          emit();
        }
      }}
      className={`overflow-hidden rounded-lg border focus-within:border-[var(--accent)] focus-within:ring-2 focus-within:ring-[var(--accent)]/20 ${
        dragging
          ? "border-[var(--accent)] ring-2 ring-[var(--accent)]/30"
          : "border-border"
      }`}
    >
      <div className="flex items-center gap-0.5 border-b border-border bg-canvas px-2 py-1.5">
        <Btn title="Bold (⌘B)" onClick={() => exec("bold")}><Bold size={14} /></Btn>
        <Btn title="Italic (⌘I)" onClick={() => exec("italic")}><Italic size={14} /></Btn>
        <span className="mx-1 h-4 w-px bg-border" />
        <Btn title="Bullet list" onClick={() => exec("insertUnorderedList")}><List size={14} /></Btn>
        <Btn title="Numbered list" onClick={() => exec("insertOrderedList")}><ListOrdered size={14} /></Btn>
        <span className="mx-1 h-4 w-px bg-border" />
        <Btn title="Indent (Tab)" onClick={() => exec("indent")}><IndentIncrease size={14} /></Btn>
        <Btn title="Outdent (⇧Tab)" onClick={() => exec("outdent")}><IndentDecrease size={14} /></Btn>
        <span className="mx-1 h-4 w-px bg-border" />
        <Btn title="Link (⌘K) — or right-click a selection" onClick={openLinkBox}>
          <Link2 size={14} />
        </Btn>
      </div>
      <div className="relative">
        <div
          ref={ref}
          contentEditable
          suppressContentEditableWarning
          onInput={onInput}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          spellCheck
          onContextMenu={(e) => {
            // Right-click is where people look for "make this a link", so the
            // browser's own menu is replaced with one that offers it — but only
            // when there is a link to act on.
            //
            // Right-clicking a single word with nothing selected is how you get
            // spelling suggestions for the red squiggle under it, and that menu
            // is the browser's to draw: there is no API to read the suggestions
            // and no way to reopen it once preventDefault has run. So a plain
            // caret keeps the native menu, and ours appears for a selection (a
            // phrase to turn into a link) or inside an existing link.
            const el = ref.current;
            const selection = window.getSelection();
            if (!el || !selection?.rangeCount) return;
            const range = selection.getRangeAt(0);
            if (!el.contains(range.commonAncestorContainer)) return;
            const onLink = !!anchorAt(range.commonAncestorContainer, el);
            if (range.collapsed && !onLink) return;
            e.preventDefault();
            savedRange.current = range.cloneRange();
            const box = el.getBoundingClientRect();
            setLinkBox(null);
            setMenu({
              top: e.clientY - box.top,
              left: e.clientX - box.left,
              onLink,
            });
          }}
          onCompositionStart={() => (composing.current = true)}
          onCompositionEnd={() => { composing.current = false; emit(); }}
          data-placeholder={placeholder}
          className={`omni-rt ${minHeight} px-3 py-2.5 text-sm leading-relaxed outline-none`}
          style={{ wordBreak: "break-word" }}
        />

        {menu && (
          <>
            <button
              type="button"
              aria-label="Close menu"
              className="fixed inset-0 z-20 cursor-default"
              onClick={() => setMenu(null)}
              onContextMenu={(e) => { e.preventDefault(); setMenu(null); }}
            />
            <div
              style={{ top: menu.top, left: menu.left }}
              className="absolute z-30 min-w-40 overflow-hidden rounded-lg border border-border bg-surface py-1 text-sm shadow-lg"
            >
              <MenuItem
                onClick={() => {
                  // The right-click moved the caret; put the selection back
                  // before deciding what to link.
                  restoreSelection();
                  openLinkBox();
                }}
              >
                <Link2 size={13} /> {menu.onLink ? "Edit link" : "Add link"}
              </MenuItem>
              {menu.onLink && (
                <MenuItem
                  onClick={() => {
                    restoreSelection();
                    removeLink();
                  }}
                >
                  <Link2Off size={13} /> Remove link
                </MenuItem>
              )}
            </div>
          </>
        )}

        {linkBox && (
          <>
            <button
              type="button"
              aria-label="Cancel link"
              className="fixed inset-0 z-20 cursor-default"
              onClick={() => setLinkBox(null)}
            />
            <div
              style={{ top: linkBox.top, left: linkBox.left }}
              className="absolute z-30 w-72 rounded-lg border border-border bg-surface p-2.5 shadow-lg"
            >
              {linkBox.needsText && (
                <input
                  autoFocus
                  placeholder="Text to show"
                  onChange={(e) =>
                    setLinkBox((b) => (b ? { ...b, text: e.target.value } : b))
                  }
                  className="mb-2 w-full rounded-md border border-border bg-canvas px-2 py-1.5 text-sm outline-none focus:border-[var(--accent)]"
                />
              )}
              <input
                autoFocus={!linkBox.needsText}
                defaultValue={linkBox.url}
                placeholder="Paste or type a URL"
                spellCheck={false}
                onChange={(e) => setLinkBox((b) => (b ? { ...b, url: e.target.value } : b))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    applyLink(linkBox.url, linkBox.text);
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setLinkBox(null);
                  }
                }}
                className="w-full rounded-md border border-border bg-canvas px-2 py-1.5 text-sm outline-none focus:border-[var(--accent)]"
              />
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => applyLink(linkBox.url, linkBox.text)}
                  disabled={!normalizeUrl(linkBox.url)}
                  className="rounded-md bg-[var(--accent)] px-2.5 py-1 text-xs font-semibold text-white transition disabled:opacity-50"
                >
                  {linkBox.editing ? "Update" : "Add link"}
                </button>
                {linkBox.editing && (
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { restoreSelection(); removeLink(); }}
                    className="rounded-md px-2 py-1 text-xs font-medium text-muted transition hover:text-red-600"
                  >
                    Remove
                  </button>
                )}
                <span className="flex-1" />
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setLinkBox(null)}
                  className="rounded-md px-2 py-1 text-xs font-medium text-muted transition hover:text-ink"
                >
                  Cancel
                </button>
              </div>
              {linkBox.url.trim() && !normalizeUrl(linkBox.url) && (
                <p className="mt-1.5 text-[11px] text-red-600">
                  That isn&apos;t a web address I can link to.
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function MenuItem({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs font-medium text-ink transition hover:bg-canvas"
    >
      {children}
    </button>
  );
}

function Btn({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => {
        e.preventDefault();
        onClick();
      }}
      className="grid h-7 w-7 place-items-center rounded text-muted transition hover:bg-surface hover:text-ink"
    >
      {children}
    </button>
  );
}

export function RichTextView({ html }: { html: string }) {
  if (!html?.trim()) return null;
  return (
    <div
      className="omni-rt-view text-sm leading-relaxed text-ink/90"
      dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(html) }}
    />
  );
}

// Renders stored text that may be either rich HTML (new entries) or plain
// text with newlines (entries saved before the editors became rich text).
export function TextView({ value }: { value: string }) {
  if (!value?.trim()) return null;
  const isHtml = /<[a-z][^>]*>/i.test(value);
  if (isHtml) return <RichTextView html={value} />;
  return <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink/90">{value}</p>;
}
