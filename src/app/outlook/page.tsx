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
// Generation happens right here in the pane — read the email, set the dials,
// hit write, watch it come back, edit it if it's not quite right, drop it in.
// No hand-off to a separate tab: everything the workspace can do to a piece is
// available here too, just for the one piece this pane exists to write.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Script from "next/script";
import { plainToHtml, toEmailHtml } from "@/lib/writer/clipboard";
import { ChipGroup } from "@/components/writer/Chips";
import { RichText } from "@/components/ui/RichText";
import { ProgressBar, useProgress } from "@/components/ui/Progress";
import { createClient } from "@/lib/supabase/client";
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

const supabase = createClient();

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

/** Grow with what's typed, up to a cap, then scroll — never a fixed box you
 * have to scroll inside to see what you just wrote. */
function useAutoGrow(ref: React.RefObject<HTMLTextAreaElement | null>, value: string) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [ref, value]);
}

export default function OutlookPage() {
  const { userId } = useUserId();
  const { docs, add, refresh } = useWriterDocs(userId);
  const { settings } = useWriterSettings(userId);

  const { styles } = useWriterStyles(userId);

  const [officeReady, setOfficeReady] = useState(false);
  const [outsideOutlook, setOutsideOutlook] = useState(false);
  const [email, setEmail] = useState<ReadEmail | null>(null);
  const [note, setNote] = useState("");
  const [generating, setGenerating] = useState(false);
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

  // The piece being written, once "Write the reply" has been pressed. Its
  // presence is what switches the pane from intake to result — everything
  // after that point (editing, refining, inserting) happens against this doc
  // without ever leaving the pane.
  const [resultDoc, setResultDoc] = useState<WriterDoc | null>(null);
  const [resultContent, setResultContent] = useState("");
  const [resultSubject, setResultSubject] = useState("");
  const [guidance, setGuidance] = useState("");

  const noteRef = useRef<HTMLTextAreaElement>(null);
  useAutoGrow(noteRef, note);
  const guidanceRef = useRef<HTMLTextAreaElement>(null);
  useAutoGrow(guidanceRef, guidance);

  // Autosave for edits made in the result box: optimistic locally, debounced to
  // the database so the piece survives a reopen and shows up right in "Drop one
  // in" — but "Add to email" below always uses what's on screen, so a save that
  // hasn't landed yet is never the thing missing from the reply.
  const pendingRef = useRef<{ content?: string; subject?: string }>({});
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function queueResultSave(partial: { content?: string; subject?: string }) {
    if (!resultDoc) return;
    pendingRef.current = { ...pendingRef.current, ...partial };
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const p = pendingRef.current;
      pendingRef.current = {};
      void supabase.from("writer_docs").update(p).eq("id", resultDoc.id);
    }, 800);
  }

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

  // The actual AI call, shared by the first write and every refine after it.
  // `refineGuidance` present means "revise what's on screen"; absent means
  // "write it from the intake". Either way the result lands in state and is
  // persisted to the same row, so the doc this pane is working on never
  // multiplies into several.
  async function runGenerate(target: WriterDoc, refineGuidance?: string) {
    setGenerating(true);
    setError("");
    try {
      const styleTexts = styles
        .filter((s) => styleIds.includes(s.id))
        .map((s) => ({
          name: s.name,
          text: s.kind === "voice" ? s.voice_profile : s.rules,
        }));
      const refining = !!refineGuidance && !!resultContent.trim();
      const res = await fetch("/api/writer/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          action: "generate",
          docType: "email",
          original: htmlToPlain(target.original),
          previous: refining ? resultContent : "",
          guidance: refineGuidance || "",
          fidelity,
          context: {
            ...emptyContext(),
            fidelity,
            tone,
            audience,
            length,
            styleIds,
            recipient: email?.from || "",
            brief: htmlToPlain(target.context.brief),
          },
          styles: styleTexts,
          signature: settings?.signature ? htmlToPlain(settings.signature) : "",
          variants: 1,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Generation failed");
      const first = json.variants?.[0];
      if (!first) throw new Error("Nothing usable came back — try again");
      setResultContent(first.html);
      setResultSubject(first.subject || target.subject);
      await supabase
        .from("writer_docs")
        .update({ content: first.html, subject: first.subject || target.subject })
        .eq("id", target.id);
      void refresh();
      setGuidance("");
    } catch (e) {
      setError((e as Error).message || "That didn't work");
    } finally {
      setGenerating(false);
    }
  }

  // Create the piece and write it, right here. The email goes in the draft box
  // (it is source material, the thing being answered) and the note goes in the
  // instructions box, which is exactly the split the prompt already knows how
  // to read.
  async function writeReply() {
    if (!email || generating) return;
    setError("");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    pendingRef.current = {};
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
      setResultDoc(doc);
      setResultContent("");
      setResultSubject(doc.subject);
      await runGenerate(doc);
    } catch (e) {
      setError((e as Error).message || "That didn't work");
    }
  }

  async function refine() {
    if (!resultDoc || !guidance.trim() || generating) return;
    await runGenerate(resultDoc, guidance.trim());
  }

  // Back to the dials, to write it again from scratch a different way.
  function startOver() {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    pendingRef.current = {};
    setResultDoc(null);
    setResultContent("");
    setResultSubject("");
    setGuidance("");
    setError("");
  }

  // The other half of the loop: the reply is written, they are back in Outlook
  // with a compose window open, and this drops the finished piece in where the
  // cursor is — styled, because a paste into Outlook that keeps its paragraph
  // breaks needs its spacing inline.
  function insertHtml(html: string, useSig: boolean) {
    const Office = window.Office;
    const item = Office?.context?.mailbox?.item;
    if (!Office || !item) return;
    const withSig = toEmailHtml(html, useSig ? settings?.signature || "" : "");
    item.body.setSelectedDataAsync(
      withSig,
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

  function insertIntoReply(doc: WriterDoc) {
    insertHtml(doc.content, doc.context?.useSignature !== false);
  }

  const progress = useProgress(generating, 20000);
  const recent = docs.filter((d) => htmlToPlain(d.content).trim()).slice(0, 6);
  const hasResult = !!resultContent.trim();

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

      <main className="mx-auto max-w-md space-y-2 p-2.5 text-ink">
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
            {!resultDoc && (
              <>
                {/* The heart of the pane: the one thing only you know. Bigger
                    and bolder than every other label here on purpose — the
                    email context below answers itself, this doesn't. */}
                <div>
                  <label htmlFor="note" className="block text-sm font-semibold text-ink">
                    What do you want to say?
                  </label>
                  <p className="mb-1 text-[11px] text-muted">Anything else I need to know?</p>
                  <textarea
                    id="note"
                    ref={noteRef}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    autoFocus
                    rows={4}
                    placeholder={
                      'e.g. "say yes but push it to the 12th, and don\'t commit to a budget yet"'
                    }
                    className="max-h-56 w-full resize-none overflow-y-auto rounded-lg border border-border bg-surface p-2 text-xs leading-snug outline-none focus:border-[var(--accent)]"
                  />
                  <p className="mt-0.5 text-[10px] leading-snug text-muted">
                    Optional. Everything about the email itself, I already have.
                  </p>
                </div>

                {/* Everything the workspace would ask, asked here instead — the
                    point of the pane is that you never have to go there to set a
                    dial. Left open, not tucked behind a chevron: a tone and style
                    picked after Generate has already been pressed doesn't count. */}
                <div className="rounded-xl border border-border bg-surface">
                  <p className="p-2 pb-0 text-[10px] font-semibold uppercase tracking-wide text-muted">
                    How it should read
                    {reading ? (
                      <span className="ml-1 font-normal normal-case">reading it…</span>
                    ) : autoFilled.length > 0 ? (
                      <span className="ml-1 font-normal normal-case text-[var(--accent)]">
                        {autoFilled.join(", ")} filled in — check me
                      </span>
                    ) : null}
                  </p>
                  <div className="space-y-1.5 p-2">
                    <ChipGroup
                      dense
                      label="How much to write"
                      options={FIDELITY_OPTIONS.map((f) => ({ key: f.key, label: f.label }))}
                      selected={[fidelity]}
                      single
                      onToggle={(k) => setFidelity(k as Fidelity)}
                    />
                    <ChipGroup
                      dense
                      label="Tone"
                      options={chipOptions(TONE_CHIPS)}
                      selected={tone}
                      hue="sky"
                      onToggle={(k) =>
                        setTone((p) => (p.includes(k) ? p.filter((t) => t !== k) : [...p, k]))
                      }
                    />
                    <ChipGroup
                      dense
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
                      dense
                      label="Length"
                      options={LENGTHS}
                      selected={[length]}
                      single
                      hue="amber"
                      onToggle={setLength}
                    />
                    {styles.length > 0 && (
                      <ChipGroup
                        dense
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
                </div>

                <button
                  onClick={writeReply}
                  disabled={generating}
                  className="w-full rounded-lg bg-[var(--accent)] px-3 py-2.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
                >
                  {generating ? "Writing it…" : "Write the reply"}
                </button>
                <p className="text-[11px] leading-snug text-muted">
                  Writes it right here, then you can edit it or drop it into your
                  reply below.
                </p>
              </>
            )}

            {resultDoc && (
              <div className="space-y-2.5">
                {generating && (
                  <div className="rounded-xl border border-border bg-surface p-3">
                    <ProgressBar
                      pct={progress}
                      label={hasResult ? "Revising it…" : "Writing your reply…"}
                    />
                  </div>
                )}

                {!generating && hasResult && (
                  <>
                    <div className="rounded-xl border border-border bg-surface p-2">
                      <label
                        htmlFor="subject"
                        className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-muted"
                      >
                        Subject
                      </label>
                      <input
                        id="subject"
                        value={resultSubject}
                        onChange={(e) => {
                          setResultSubject(e.target.value);
                          queueResultSave({ subject: e.target.value });
                        }}
                        className="w-full rounded-md border border-border bg-canvas px-2 py-1 text-[11px] font-medium outline-none focus:border-[var(--accent)]"
                      />
                    </div>

                    <RichText
                      value={resultContent}
                      onChange={(html) => {
                        setResultContent(html);
                        queueResultSave({ content: html });
                      }}
                      minHeight="min-h-32"
                      dense
                    />

                    <div className="flex gap-2">
                      <button
                        onClick={() =>
                          insertHtml(resultContent, resultDoc.context?.useSignature !== false)
                        }
                        className="flex-1 rounded-lg bg-[var(--accent)] px-3 py-2.5 text-xs font-semibold text-white transition hover:opacity-90"
                      >
                        {inserted ? "Dropped in ✓" : "Add to email"}
                      </button>
                      <button
                        onClick={startOver}
                        className="rounded-lg border border-border px-3 py-2.5 text-xs font-medium text-muted transition hover:text-ink"
                      >
                        Start over
                      </button>
                    </div>

                    <div>
                      <label
                        htmlFor="guidance"
                        className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-muted"
                      >
                        Want it different?
                      </label>
                      <textarea
                        id="guidance"
                        ref={guidanceRef}
                        value={guidance}
                        onChange={(e) => setGuidance(e.target.value)}
                        rows={1}
                        placeholder='e.g. "shorter, and a bit warmer"'
                        className="max-h-40 w-full resize-none overflow-y-auto rounded-lg border border-border bg-surface p-1.5 text-[11px] leading-snug outline-none focus:border-[var(--accent)]"
                      />
                      <button
                        onClick={refine}
                        disabled={generating || !guidance.trim()}
                        className="mt-1.5 w-full rounded-lg border border-[var(--accent)] px-3 py-2 text-xs font-semibold text-[var(--accent)] transition hover:bg-[var(--accent-soft)] disabled:opacity-50"
                      >
                        Revise
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Context, not the point — folded down here so the box you
                actually type into is the first thing on screen, not this. */}
            <div className="rounded-xl border border-border bg-surface p-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                {email.composing ? "What I can see" : "What I'm answering"}
              </p>
              <p className="mt-0.5 truncate text-xs font-medium">
                {email.subject || "(no subject)"}
              </p>
              <p className="truncate text-[11px] text-muted">
                {email.from || "(unknown sender)"}
              </p>
              <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted">
                {email.body.trim() || "(couldn't read the body)"}
              </p>
            </div>

            {/* The other half of the loop, always in reach. Inserting only
                works in a draft — Outlook has nowhere to put text in a message
                you are only reading — so a failure here is reported rather than
                pre-empted by hiding the list. */}
            {!resultDoc && recent.length > 0 && (
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
