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
import Link from "next/link";
import Script from "next/script";
import { plainToHtml, toEmailHtml } from "@/lib/writer/clipboard";
import { ChipGroup } from "@/components/writer/Chips";
import {
  useUserId,
  useWriterDocs,
  useWriterSettings,
  useWriterStyles,
} from "@/lib/writer/hooks";
import {
  AUDIENCE_CHIPS,
  FIDELITY_OPTIONS,
  LENGTHS,
  TONE_CHIPS,
  chipOptions,
  emptyContext,
  htmlToPlain,
  type Fidelity,
  type WriterDoc,
} from "@/lib/writer/types";

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
  /**
   * Office says this is a draft rather than something received. Used to word
   * the page, and for nothing else — see the note on the render below about why
   * this must never decide which controls exist.
   */
  composing: boolean;
}

export default function OutlookPage() {
  const { userId } = useUserId();
  const { docs, add } = useWriterDocs(userId);
  const { settings } = useWriterSettings(userId);

  const { styles } = useWriterStyles(userId);

  const [officeReady, setOfficeReady] = useState(false);
  const [outsideOutlook, setOutsideOutlook] = useState(false);
  const [email, setEmail] = useState<ReadEmail | null>(null);
  const [note, setNote] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [inserted, setInserted] = useState(false);

  // The same dials as the workspace, because the whole promise here is that you
  // never have to go to the workspace to set them. Answering something you were
  // sent is writing from scratch, so "Write it" is the honest default — the
  // other modes only start meaning something once the draft in front of you is
  // partly yours.
  const [fidelity, setFidelity] = useState<Fidelity>("draft");
  const [tone, setTone] = useState<string[]>([]);
  const [audience, setAudience] = useState<string[]>([]);
  const [length, setLength] = useState("as_is");
  const [styleIds, setStyleIds] = useState<string[]>([]);
  // Derived rather than set: flipping a "reading" flag on in the effect body is
  // a synchronous setState inside an effect, which is a cascading render for a
  // spinner. The read is under way from the moment there is an email to read.
  const [extractDone, setExtractDone] = useState(false);
  const [autoFilled, setAutoFilled] = useState<string[]>([]);

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
    // expose it as a plain string. Both shapes are handled because both turn up
    // — but the answer only changes the wording, never which controls exist.
    const subjectField = item.subject;
    const composing = typeof subjectField === "object" && subjectField !== null;
    const who =
      item.from?.displayName ||
      item.from?.emailAddress ||
      item.sender?.displayName ||
      item.sender?.emailAddress ||
      "";

    const finish = (subject: string) =>
      item.body.getAsync(Office.CoercionType.Text, (result) => {
        const body =
          result.status === Office.AsyncResultStatus.Succeeded ? result.value || "" : "";
        setEmail({ subject, from: who, body: body.slice(0, 40000), composing });
      });

    if (typeof subjectField === "string") finish(subjectField);
    else if (composing)
      // A draft's subject has to be asked for. Reading the body regardless of
      // how that goes: in a reply the body already holds the thread being
      // answered, which is the part that matters here.
      subjectField.getAsync((r) =>
        finish(r.status === Office.AsyncResultStatus.Succeeded ? r.value || "" : ""),
      );
    else finish("");
  }, []);

  useEffect(() => {
    if (!officeReady || readied.current) return;
    readied.current = true;
    window.Office?.onReady(() => readOpenItem());
  }, [officeReady, readOpenItem]);

  // Read the dials off the email itself. Who it is from and how it is written
  // already answer most of "what tone, what audience" — asking you to pick them
  // by hand for a message the add-in is looking at would be asking you to type
  // out something it can see. Guesses, so they are flagged as guesses and one
  // tap moves any of them.
  const extracted = useRef(false);
  useEffect(() => {
    if (!email || !userId || extracted.current) return;
    if (!email.body.trim() && !email.subject.trim()) return;
    extracted.current = true;
    void (async () => {
      try {
        const res = await fetch("/api/writer/ai", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            action: "extract",
            docType: "email",
            brief: `${email.subject}\nFrom: ${email.from}\n\n${email.body}`.slice(0, 20000),
          }),
        });
        const { extracted: ex } = await res.json();
        if (!res.ok || !ex) return;
        const filled: string[] = [];
        if (Array.isArray(ex.tone) && ex.tone.length) {
          setTone(ex.tone);
          filled.push("tone");
        }
        if (Array.isArray(ex.audience) && ex.audience.length) {
          setAudience(ex.audience);
          filled.push("audience");
        }
        if (ex.length && LENGTHS.some((l) => l.key === ex.length) && ex.length !== "as_is") {
          setLength(String(ex.length));
          filled.push("length");
        }
        setAutoFilled(filled);
      } catch {
        // A failed guess is not worth a message: every dial has a usable
        // default and you were going to check them anyway.
      } finally {
        setExtractDone(true);
      }
    })();
  }, [email, userId]);

  const reading = !!email && !!userId && !extractDone;

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
          fidelity,
          tone,
          audience,
          length,
          styleIds,
          recipient: email.from,
          brief: plainToHtml(
            note.trim()
              ? `Write a reply to the email below. ${note.trim()}`
              : "Write a reply to the email below.",
          ),
        },
      });
      if (!doc) throw new Error("Couldn't create the piece");
      // `go=1` writes it on arrival. Everything the workspace would have asked
      // for was answered here, so landing on a filled-in form with a Generate
      // button would be asking for the same decision twice, in two windows.
      window.open(`/writing-studio/${doc.id}?go=1`, "_blank", "noopener");
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
            {email?.composing ? "This draft" : "Answer this one"}
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
            <Link className="font-medium text-[var(--accent)]" href="/writing-studio">
              Writing Studio
            </Link>{" "}
            directly in the browser.
          </p>
        )}

        {error && (
          <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </p>
        )}

        {/* Both jobs, always, for whichever of the two you came here to do.
            This used to be an either/or keyed off the read-vs-compose guess,
            and when the guess went the wrong way it left a list of old pieces
            and no box to type in — no way to ask for anything, and nothing on
            screen explaining why. A guess about which button you pressed is not
            worth a dead end, so it now only changes the wording. */}
        {userId && email && (
          <>
            <div className="rounded-xl border border-border bg-surface p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                {email.composing ? "What I can see" : "What I'm answering"}
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

            {/* Everything the workspace would ask, asked here instead — the
                point of the pane is that you never have to go there to set a
                dial. Folded away because the defaults are usually right and an
                open accordion of chips in a 400px panel buries the one box that
                matters. */}
            <details className="rounded-xl border border-border bg-surface">
              <summary className="cursor-pointer list-none p-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
                How it should read ▾
                {reading ? (
                  <span className="ml-1 font-normal normal-case">reading it…</span>
                ) : autoFilled.length > 0 ? (
                  <span className="ml-1 font-normal normal-case text-[var(--accent)]">
                    {autoFilled.join(", ")} filled in — check me
                  </span>
                ) : null}
              </summary>
              <div className="space-y-2.5 px-2.5 pb-2.5">
                <ChipGroup
                  label="How much to write"
                  options={FIDELITY_OPTIONS.map((f) => ({ key: f.key, label: f.label }))}
                  selected={[fidelity]}
                  single
                  onToggle={(k) => setFidelity(k as Fidelity)}
                />
                <ChipGroup
                  label="Tone"
                  options={chipOptions(TONE_CHIPS)}
                  selected={tone}
                  hue="sky"
                  onToggle={(k) =>
                    setTone((p) => (p.includes(k) ? p.filter((t) => t !== k) : [...p, k]))
                  }
                />
                <ChipGroup
                  label="Audience"
                  options={chipOptions(AUDIENCE_CHIPS)}
                  selected={audience}
                  hue="violet"
                  onToggle={(k) =>
                    setAudience((p) =>
                      p.includes(k) ? p.filter((a) => a !== k) : [...p, k],
                    )
                  }
                />
                <ChipGroup
                  label="Length"
                  options={LENGTHS}
                  selected={[length]}
                  single
                  hue="amber"
                  onToggle={setLength}
                />
                {styles.length > 0 && (
                  <ChipGroup
                    label="Your styles & voices"
                    options={styles.map((s) => ({
                      key: s.id,
                      label: `${s.kind === "voice" ? "🎙️" : "📐"} ${s.name}`,
                    }))}
                    selected={styleIds}
                    hue="teal"
                    onToggle={(k) =>
                      setStyleIds((p) =>
                        p.includes(k) ? p.filter((s) => s !== k) : [...p, k],
                      )
                    }
                  />
                )}
              </div>
            </details>

            <button
              onClick={startReply}
              disabled={working}
              className="w-full rounded-lg bg-[var(--accent)] px-3 py-2.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
            >
              {working ? "Writing it…" : "Write the reply"}
            </button>
            <p className="text-[11px] leading-snug text-muted">
              Opens in your browser and starts writing straight away. When it
              reads right, come back to your Outlook reply and drop it in below.
            </p>

            {/* The other half of the loop, always in reach. Inserting only
                works in a draft — Outlook has nowhere to put text in a message
                you are only reading — so a failure here is reported rather than
                pre-empted by hiding the list. */}
            {recent.length > 0 && (
              <details className="rounded-xl border border-border bg-surface">
                <summary className="cursor-pointer list-none p-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
                  Already written it? Drop one in ▾
                </summary>
                <div className="space-y-1.5 px-2.5 pb-2.5">
                  <p className="text-[11px] leading-relaxed text-muted">
                    Put the cursor in your reply where it should go, then pick
                    one. It arrives formatted, with your signature.
                  </p>
                  {inserted && (
                    <p className="rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-700">
                      Dropped in.
                    </p>
                  )}
                  <ul className="space-y-1.5">
                    {recent.map((d) => (
                      <li key={d.id}>
                        <button
                          onClick={() => insertIntoReply(d)}
                          className="w-full rounded-lg border border-border bg-canvas p-2.5 text-left transition hover:border-[var(--accent)]"
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
                </div>
              </details>
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
