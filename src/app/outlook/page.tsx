"use client";

// The Outlook side of Writing Studio.
//
// The whole point of this page is to delete a habit: select the email, Ctrl+C,
// switch to the browser, find Writing Studio, paste, then type "can you respond
// to this and here's what else you need to know". Every one of those steps is
// carrying the same email across a gap. Outlook already has it open, so the
// add-in reads it directly — sender, subject, body, and the thread underneath —
// and the only thing left to type is the part only you know.
//
// It closes the loop as well: once the reply is written, come back to the
// compose window and this pane drops it in, formatted, with the signature.
//
// Not a second writing tool. It creates a normal Writing Studio piece and hands
// off to the workspace, which is where every prompt, chip and version already
// lives. Everything here is intake and delivery.

import { useCallback, useEffect, useRef, useState } from "react";
import Script from "next/script";
import { plainToHtml, toEmailHtml } from "@/lib/writer/clipboard";
import {
  useUserId,
  useWriterDocs,
  useWriterSettings,
} from "@/lib/writer/hooks";
import { emptyContext, htmlToPlain, type WriterDoc } from "@/lib/writer/types";

// The Office.js surface this uses, typed to what it touches. The real library
// is loaded from Microsoft's CDN at runtime (Office refuses to host it
// anywhere else), so there is no package to take types from.
type OfficeBody = {
  getAsync: (
    coercionType: string,
    callback: (result: { status: string; value: string }) => void,
  ) => void;
  setSelectedDataAsync: (
    data: string,
    options: { coercionType: string },
    callback: (result: { status: string; error?: { message: string } }) => void,
  ) => void;
};
type OfficeItem = {
  itemType?: string;
  subject?: string | { getAsync: (cb: (r: { status: string; value: string }) => void) => void };
  from?: { displayName?: string; emailAddress?: string };
  sender?: { displayName?: string; emailAddress?: string };
  dateTimeCreated?: Date;
  body: OfficeBody;
  displayReplyAllForm?: (html: string) => void;
};
declare global {
  interface Window {
    Office?: {
      onReady: (cb: (info: { host?: string }) => void) => void;
      context: { mailbox?: { item?: OfficeItem } };
      CoercionType: { Text: string; Html: string };
      AsyncResultStatus: { Succeeded: string };
    };
  }
}

/** What we managed to read out of the open message. */
interface ReadEmail {
  subject: string;
  from: string;
  body: string;
  /** Compose mode: they are writing, not reading. Different job. */
  composing: boolean;
}

export default function OutlookPage() {
  const { userId } = useUserId();
  const { docs, add } = useWriterDocs(userId);
  const { settings } = useWriterSettings(userId);

  const [officeReady, setOfficeReady] = useState(false);
  const [outsideOutlook, setOutsideOutlook] = useState(false);
  const [email, setEmail] = useState<ReadEmail | null>(null);
  const [note, setNote] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [inserted, setInserted] = useState(false);

  // Office.onReady fires once and only once per pane load. Guarded because
  // next/script can re-run onLoad across a fast-refresh in development.
  const readied = useRef(false);

  const readOpenItem = useCallback(() => {
    const Office = window.Office;
    const item = Office?.context?.mailbox?.item;
    if (!Office || !item) {
      setOutsideOutlook(true);
      return;
    }
    // Compose items report their subject through an async accessor; read items
    // expose it as a plain string. The distinction is also how we tell which of
    // the two jobs this pane is here to do.
    const composing = typeof item.subject === "object" && item.subject !== null;
    const who =
      item.from?.displayName ||
      item.from?.emailAddress ||
      item.sender?.displayName ||
      item.sender?.emailAddress ||
      "";
    const subject = typeof item.subject === "string" ? item.subject : "";

    item.body.getAsync(Office.CoercionType.Text, (result) => {
      const body =
        result.status === Office.AsyncResultStatus.Succeeded ? result.value || "" : "";
      setEmail({ subject, from: who, body: body.slice(0, 40000), composing });
    });
  }, []);

  useEffect(() => {
    if (!officeReady || readied.current) return;
    readied.current = true;
    window.Office?.onReady(() => readOpenItem());
  }, [officeReady, readOpenItem]);

  // Hand the email to Writing Studio as a normal piece and open the workspace.
  // The email goes in the draft box (it is source material, the thing being
  // answered) and the note goes in the instructions box, which is exactly the
  // split the prompt already knows how to read.
  async function startReply() {
    if (!email || working) return;
    setWorking(true);
    setError("");
    try {
      const header = [
        email.from && `From: ${email.from}`,
        email.subject && `Subject: ${email.subject}`,
      ]
        .filter(Boolean)
        .join("\n");
      const doc = await add({
        doc_type: "email",
        mode: "create",
        title: email.subject ? `Re: ${email.subject}` : "Reply",
        subject: email.subject ? `Re: ${email.subject}` : "",
        original: plainToHtml(`${header}\n\n${email.body}`),
        context: {
          ...emptyContext(),
          // Source material plus an instruction, not a draft of theirs to
          // preserve — so the AI writes the reply rather than proofreading the
          // email it was sent.
          fidelity: "draft",
          recipient: email.from,
          brief: plainToHtml(
            note.trim()
              ? `Write a reply to the email below. ${note.trim()}`
              : "Write a reply to the email below.",
          ),
        },
      });
      if (!doc) throw new Error("Couldn't create the piece");
      window.open(`/writing-studio/${doc.id}`, "_blank", "noopener");
    } catch (e) {
      setError((e as Error).message || "That didn't work");
    } finally {
      setWorking(false);
    }
  }

  // The other half of the loop: the reply is written, they are back in Outlook
  // with a compose window open, and this drops the finished piece in where the
  // cursor is — styled, because a paste into Outlook that keeps its paragraph
  // breaks needs its spacing inline.
  function insertIntoReply(doc: WriterDoc) {
    const Office = window.Office;
    const item = Office?.context?.mailbox?.item;
    if (!Office || !item) return;
    const useSig = doc.context?.useSignature !== false;
    const html = toEmailHtml(doc.content, useSig ? settings?.signature || "" : "");
    item.body.setSelectedDataAsync(
      html,
      { coercionType: Office.CoercionType.Html },
      (result) => {
        if (result.status === Office.AsyncResultStatus.Succeeded) {
          setInserted(true);
          setTimeout(() => setInserted(false), 2500);
        } else {
          setError(result.error?.message || "Outlook wouldn't take it");
        }
      },
    );
  }

  const recent = docs.filter((d) => htmlToPlain(d.content).trim()).slice(0, 6);

  return (
    <>
      {/* Office.js has to come from Microsoft's CDN — the host validates the
          origin, and a self-hosted copy is not supported. */}
      <Script
        src="https://appsforoffice.microsoft.com/lib/1/hosted/office.js"
        strategy="afterInteractive"
        onLoad={() => setOfficeReady(true)}
        onError={() => setOutsideOutlook(true)}
      />

      <main className="mx-auto max-w-md space-y-3 p-3 text-ink">
        <header>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--accent)]">
            Writing Studio
          </p>
          <h1 className="text-base font-semibold">
            {email?.composing ? "Drop a piece in" : "Answer this one"}
          </h1>
        </header>

        {!userId && (
          <div className="rounded-xl border border-border bg-surface p-3 text-xs">
            <p className="font-medium">Sign in to Omni first.</p>
            <p className="mt-1 leading-relaxed text-muted">
              Once, in this panel. Outlook keeps its own browser, so signing in
              on another tab doesn&apos;t count here.
            </p>
            {/* In place, not a new tab: on Outlook for Windows this pane runs in
                its own WebView with its own cookies, so a session created
                anywhere else never reaches it. */}
            {/* ?next= brings the panel back here afterwards. Without it the
                login lands on the dashboard, and a 400px panel with no address
                bar has no way back to the add-in — which just looks like the
                whole app crammed into a sliver. */}
            <button
              onClick={() => {
                window.location.href = "/login?next=%2Foutlook";
              }}
              className="mt-2 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-white"
            >
              Sign in
            </button>
          </div>
        )}

        {outsideOutlook && (
          <p className="rounded-xl border border-dashed border-border bg-canvas p-3 text-xs leading-relaxed text-muted">
            This page is the Outlook add-in — it only has an email to read when
            it&apos;s open inside Outlook. Use{" "}
            <a className="font-medium text-[var(--accent)]" href="/writing-studio">
              Writing Studio
            </a>{" "}
            directly in the browser.
          </p>
        )}

        {error && (
          <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </p>
        )}

        {/* Reading an email: the reply path. */}
        {userId && email && !email.composing && (
          <>
            <div className="rounded-xl border border-border bg-surface p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                What I&apos;m answering
              </p>
              <p className="mt-1 truncate text-xs font-medium">
                {email.subject || "(no subject)"}
              </p>
              <p className="truncate text-[11px] text-muted">
                {email.from || "(unknown sender)"}
              </p>
              <p className="mt-1.5 line-clamp-3 text-[11px] leading-relaxed text-muted">
                {email.body.trim() || "(couldn't read the body)"}
              </p>
            </div>

            <div>
              <label
                htmlFor="note"
                className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted"
              >
                Anything else I need to know?
              </label>
              <textarea
                id="note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                autoFocus
                placeholder={
                  'e.g. "say yes but push it to the 12th, and don\'t commit to a budget yet"'
                }
                className="min-h-24 w-full rounded-lg border border-border bg-surface p-2 text-xs leading-relaxed outline-none focus:border-[var(--accent)]"
              />
              <p className="mt-1 text-[11px] leading-snug text-muted">
                Optional. Everything about the email itself, I already have.
              </p>
            </div>

            <button
              onClick={startReply}
              disabled={working}
              className="w-full rounded-lg bg-[var(--accent)] px-3 py-2.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
            >
              {working ? "Setting it up…" : "Write the reply"}
            </button>
            <p className="text-[11px] leading-snug text-muted">
              Opens in your browser with the email already in. When it reads
              right, come back to your Outlook reply and this pane will drop it
              in for you.
            </p>
          </>
        )}

        {/* Composing: the delivery path. */}
        {userId && email?.composing && (
          <>
            <p className="text-[11px] leading-relaxed text-muted">
              Put the cursor where it should go, then pick the piece. It arrives
              formatted, with your signature.
            </p>
            {inserted && (
              <p className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
                Dropped in.
              </p>
            )}
            {recent.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border bg-canvas p-3 text-xs text-muted">
                Nothing written yet. Open this pane on the email you want to
                answer and start there.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {recent.map((d) => (
                  <li key={d.id}>
                    <button
                      onClick={() => insertIntoReply(d)}
                      className="w-full rounded-lg border border-border bg-surface p-2.5 text-left transition hover:border-[var(--accent)]"
                    >
                      <span className="block truncate text-xs font-medium">
                        {d.title || d.subject || "Untitled"}
                      </span>
                      <span className="mt-0.5 block line-clamp-2 text-[11px] leading-snug text-muted">
                        {htmlToPlain(d.content)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {userId && !email && !outsideOutlook && (
          <p className="text-xs text-muted">Reading the message…</p>
        )}
      </main>
    </>
  );
}
