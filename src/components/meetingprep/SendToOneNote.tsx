"use client";

// "Send to OneNote" — the copy and the paste, done for you.
//
// The picker is two steps, not three: a section, then optionally a page inside
// it. OneNote's own hierarchy has notebooks above sections and section groups
// in between, but the question is "where does this note go", which is one
// answer. Sections carry their notebook's name as a label instead.
//
// Landing on an existing page prepends, so the newest meeting is the first
// thing on it rather than the thing you scroll to.

import { useCallback, useEffect, useState } from "react";
import { Check, ExternalLink, Loader2, NotebookPen, Plus, X } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";

interface Section {
  id: string;
  name: string;
  notebook: string;
}
interface Page {
  id: string;
  title: string;
  updated: string;
}
interface Status {
  configured: boolean;
  connected: boolean;
  email?: string | null;
  lastSectionId?: string | null;
  lastSectionName?: string | null;
}

async function onenote<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/onenote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "OneNote didn't answer");
  return json as T;
}

export function SendToOneNote({
  open,
  onClose,
  getNotes,
}: {
  open: boolean;
  onClose: () => void;
  /**
   * Read at send time, not passed in. The notes are edited right up to the
   * moment this is pressed, and reading them during the parent's render meant
   * touching a ref mid-render — which React is right to object to, and which
   * would eventually have sent a version that was already stale.
   */
  getNotes: () => { title: string; html: string } | null;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [sectionId, setSectionId] = useState("");
  // Keyed by the section they belong to, so switching sections shows nothing
  // rather than briefly showing the previous section's pages — and so clearing
  // them needs no synchronous setState inside an effect.
  const [pageData, setPageData] = useState<{ sectionId: string; pages: Page[] } | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [title, setTitle] = useState("Meeting notes");

  const pages = pageData?.sectionId === sectionId ? pageData.pages : [];
  // Derived, not set: the first thing an effect does must not be a setState,
  // and "we have not heard back yet" is exactly what an empty status means.
  const loading = open && !status && !error;

  // Every setState below lands after an await, deliberately — see above.
  const load = useCallback(async () => {
    try {
      const s = await onenote<Status>({ action: "status" });
      setStatus(s);
      if (!s.connected) return;
      const { sections: list } = await onenote<{ sections: Section[] }>({
        action: "sections",
      });
      setSections(list);
      // Default to wherever the last one went. Almost always right, and it is
      // the re-picking this feature exists to remove.
      const remembered = list.find((x) => x.id === s.lastSectionId);
      if (remembered) setSectionId(remembered.id);
      // The new-page title is the meeting's, read on open so the label on the
      // button matches what will actually be created.
      setTitle(getNotes()?.title || "Meeting notes");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [getNotes]);

  useEffect(() => {
    if (!open) return;
    // `load` reaches its first await before it touches state, so nothing here
    // sets state synchronously; the rule cannot see across the async boundary
    // and assumes the worst of any call it can't follow.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [open, load]);

  // Reset on the way out rather than on the way in: closing is an event, and
  // an event handler is allowed to set state without costing a render pass.
  function close() {
    setSent(false);
    setError("");
    onClose();
  }

  // Pages are only worth fetching once a section is chosen, and they change per
  // section, so this follows the choice rather than the modal opening.
  useEffect(() => {
    if (!sectionId) return;
    let live = true;
    void (async () => {
      try {
        const { pages: list } = await onenote<{ pages: Page[] }>({
          action: "pages",
          sectionId,
        });
        if (live) setPageData({ sectionId, pages: list });
      } catch {
        if (live) setPageData({ sectionId, pages: [] });
      }
    })();
    return () => {
      live = false;
    };
  }, [sectionId]);

  async function send(pageId?: string) {
    if (sending) return;
    // Read now, so what goes to OneNote is what is on screen — not what was on
    // screen when this dialog opened.
    const notes = getNotes();
    if (!notes?.html.trim()) {
      setError("There's nothing in the notes to send.");
      return;
    }
    setSending(true);
    setError("");
    try {
      const section = sections.find((s) => s.id === sectionId);
      await onenote({
        action: "send",
        html: notes.html,
        title: notes.title,
        pageId: pageId || "",
        sectionId,
        sectionName: section ? `${section.notebook} › ${section.name}` : "",
      });
      setSent(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  const connectHref = `/api/integrations/microsoft/start?next=${encodeURIComponent(
    typeof window !== "undefined" ? window.location.pathname : "/meeting-prep",
  )}`;

  return (
    <Modal open={open} onClose={close} title="Send these notes to OneNote">
      {loading && (
        <p className="flex items-center gap-2 py-6 text-sm text-muted">
          <Loader2 size={15} className="animate-spin" /> Looking at your notebooks…
        </p>
      )}

      {!loading && status && !status.configured && (
        <p className="rounded-lg border border-dashed border-border bg-canvas p-3 text-xs leading-relaxed text-muted">
          OneNote isn&apos;t set up on this deployment yet — it needs a Microsoft
          app registration. See <code>docs/onenote.md</code>.
        </p>
      )}

      {!loading && status?.configured && !status.connected && (
        <div className="space-y-3">
          <p className="text-xs leading-relaxed text-muted">
            Connect your Microsoft account once and Omni can put finished notes
            straight onto a OneNote page — at the top of it, so the newest
            meeting is the first thing you see.
          </p>
          <a
            href={connectHref}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-3 py-2.5 text-xs font-semibold text-white transition hover:opacity-90"
          >
            <NotebookPen size={15} /> Connect OneNote
          </a>
        </div>
      )}

      {error && (
        <p className="mt-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      )}

      {sent && (
        <div className="space-y-3 py-2">
          <p className="flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">
            <Check size={16} /> On the page.
          </p>
          <Button variant="secondary" className="w-full" onClick={close}>
            Done
          </Button>
        </div>
      )}

      {!loading && status?.connected && !sent && (
        <div className="space-y-3">
          <div>
            <label
              htmlFor="onenote-section"
              className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted"
            >
              Section
            </label>
            <select
              id="onenote-section"
              value={sectionId}
              onChange={(e) => setSectionId(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface px-2.5 py-2 text-sm outline-none focus:border-[var(--accent)]"
            >
              <option value="">Choose a section…</option>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.notebook ? `${s.notebook} › ${s.name}` : s.name}
                </option>
              ))}
            </select>
          </div>

          {sectionId && (
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
                Where in it
              </p>
              <button
                onClick={() => void send()}
                disabled={sending}
                className="mb-1.5 flex w-full items-center gap-2 rounded-lg border border-[var(--accent)]/50 bg-[var(--accent-soft)]/40 p-2.5 text-left transition hover:bg-[var(--accent-soft)] disabled:opacity-50"
              >
                <Plus size={15} className="shrink-0 text-[var(--accent)]" />
                <span>
                  <span className="block text-xs font-semibold">A new page</span>
                  <span className="block text-[11px] text-muted">
                    Titled &ldquo;{title}&rdquo;
                  </span>
                </span>
              </button>

              {pages.length > 0 && (
                <>
                  <p className="mb-1 mt-2 text-[11px] leading-snug text-muted">
                    Or onto a page you already have — it goes at the top, above
                    what&apos;s there.
                  </p>
                  <ul className="max-h-56 space-y-1 overflow-y-auto">
                    {pages.map((p) => (
                      <li key={p.id}>
                        <button
                          onClick={() => void send(p.id)}
                          disabled={sending}
                          className="w-full rounded-lg border border-border bg-surface p-2.5 text-left transition hover:border-[var(--accent)] disabled:opacity-50"
                        >
                          <span className="block truncate text-xs font-medium">
                            {p.title}
                          </span>
                          <span className="block text-[11px] text-muted">
                            edited{" "}
                            {new Date(p.updated).toLocaleDateString(undefined, {
                              month: "short",
                              day: "numeric",
                            })}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}

          {sending && (
            <p className="flex items-center gap-2 text-xs text-muted">
              <Loader2 size={13} className="animate-spin" /> Sending…
            </p>
          )}

          <div className="flex items-center justify-between gap-2 border-t border-border pt-2">
            <span className="truncate text-[11px] text-muted">
              {status.email || "Connected"}
            </span>
            <button
              onClick={async () => {
                await onenote({ action: "disconnect" }).catch(() => {});
                void load();
              }}
              className="flex items-center gap-1 whitespace-nowrap rounded px-2 py-1 text-[11px] font-medium text-muted transition hover:text-red-600"
            >
              <X size={12} /> Disconnect
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** The little "opens OneNote" hint used beside the button. */
export function OneNoteHint() {
  return (
    <span className="flex items-center gap-1 text-[11px] text-muted">
      <ExternalLink size={11} /> lands at the top of the page you pick
    </span>
  );
}
