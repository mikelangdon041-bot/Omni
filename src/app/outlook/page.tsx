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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Script from "next/script";
import { plainToHtml, toEmailHtml } from "@/lib/writer/clipboard";
import {
  splitComposeBody,
  splitThread,
  threadForPrompt,
  type ThreadMessage,
} from "@/lib/writer/quoted";
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
import { useOutlookSignIn } from "@/lib/outlook-remember";
import {
  AUDIENCE_CHIPS,
  FIDELITY_OPTIONS,
  LENGTHS,
  RELATIVE_TO_ABSOLUTE,
  TARGET_LENGTHS,
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
  // Optional on purpose: a message you are only reading does not have this at
  // all, and calling it there throws rather than failing politely.
  setSelectedDataAsync?: (
    data: string,
    options: { coercionType: string },
    callback: (result: { status: string; error?: { message: string } }) => void,
  ) => void;
};
type OfficeAddress = { displayName?: string; emailAddress?: string };
type OfficeItem = {
  itemType?: string;
  subject?: string | { getAsync: (cb: (r: { status: string; value: string }) => void) => void };
  from?: OfficeAddress;
  sender?: OfficeAddress;
  // A message you are reading hands its recipients over as a plain array; one
  // you are writing makes you ask for them. Both shapes turn up, for the same
  // reason the subject does.
  to?: OfficeRecipients;
  cc?: OfficeRecipients;
  dateTimeCreated?: Date;
  body: OfficeBody;
  displayReplyForm?: (html: string) => void;
  displayReplyAllForm?: (html: string) => void;
};
type OfficeRecipients =
  | OfficeAddress[]
  | { getAsync: (cb: (r: { status: string; value: OfficeAddress[] }) => void) => void };
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
  /**
   * Everyone on the message. Read in both directions, because a reply is read
   * by all of them — without this the model cheerfully offers to pass your note
   * along to somebody who is copied on the email it is writing.
   */
  to: string;
  cc: string;
  body: string;
  /**
   * Office says this is a draft rather than something received. It decides how
   * the body is read — see lib/writer/quoted.ts — and how the page is worded,
   * and nothing else: the note on the render below covers why this must never
   * decide which controls exist.
   */
  composing: boolean;
}

/** Recipients as names to greet or to account for. */
function addressNames(list: OfficeAddress[] | undefined, cap = 8): string {
  return (list || [])
    .map((r) => r?.displayName || r?.emailAddress || "")
    .filter(Boolean)
    .slice(0, cap)
    .join(", ");
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
  const { userId, loading: userLoading } = useUserId();
  const { docs, add, refresh } = useWriterDocs(userId);
  const { settings } = useWriterSettings(userId);

  const { styles } = useWriterStyles(userId);

  const [officeReady, setOfficeReady] = useState(false);
  // Office.onReady has fired, so the mailbox — and the saved sign-in in its
  // roaming settings — can be read.
  const [hostReady, setHostReady] = useState(false);
  const [outsideOutlook, setOutsideOutlook] = useState(false);
  // Outlook moves this pane's browser storage whenever Office or WebView2
  // updates, and the session cookie is left behind in the old folder. This puts
  // it back from a key kept in the mailbox — see lib/outlook-keys.ts.
  const { restoring, signOut } = useOutlookSignIn(hostReady, userId, userLoading);
  const [email, setEmail] = useState<ReadEmail | null>(null);
  // The box you type in, and nothing else. It starts empty and STAYS empty
  // until you put something in it — see the note above `source` for why this
  // is the one rule here that must never be relaxed again. Everything the
  // add-in can read for itself travels separately, in `typed` and `source`.
  const [draftHtml, setDraftHtml] = useState("");
  const [briefHtml, setBriefHtml] = useState("");
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
  // Every instruction given on this piece, oldest first. Two jobs: it goes to
  // the model, so round three still honours what was asked in round one, and it
  // goes on screen, because a panel that has silently accumulated four
  // instructions and shows none of them is impossible to reason about.
  const [asked, setAsked] = useState<string[]>([]);

  // Mirrored into a ref so the next pass can see the subject as it stands on
  // screen without waiting for a render, and flagged when it was typed rather
  // than generated — a subject somebody wrote by hand is the one thing here
  // that must survive a rewrite.
  const subjectRef = useRef("");
  const subjectEdited = useRef(false);
  function applySubject(next: string) {
    subjectRef.current = next;
    setResultSubject(next);
  }
  function editSubject(next: string) {
    subjectEdited.current = true;
    applySubject(next);
  }

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

    const finish = (subject: string, to: string, cc: string) =>
      item.body.getAsync(Office.CoercionType.Text, (result) => {
        const body =
          result.status === Office.AsyncResultStatus.Succeeded ? result.value || "" : "";
        setEmail({ subject, from: who, to, cc, body: body.slice(0, 40000), composing });
      });

    // Everyone on the message. A draft hands its recipients over only if you
    // ask; one you are reading has them sitting there as an array. Both are
    // worth having: the To field is who the reply opens to, and the whole list
    // is who will read it.
    const readList = (field: OfficeRecipients | undefined, then: (names: string) => void) => {
      if (!field) return then("");
      if (Array.isArray(field)) return then(addressNames(field));
      field.getAsync((r) =>
        then(r.status === Office.AsyncResultStatus.Succeeded ? addressNames(r.value) : ""),
      );
    };

    const withRecipients = (subject: string) =>
      readList(item.to, (to) => readList(item.cc, (cc) => finish(subject, to, cc)));

    if (typeof subjectField === "string") withRecipients(subjectField);
    else if (composing)
      // A draft's subject has to be asked for. Reading the body regardless of
      // how that goes: in a reply the body already holds the thread being
      // answered, which is the part that matters here.
      subjectField.getAsync((r) =>
        withRecipients(r.status === Office.AsyncResultStatus.Succeeded ? r.value || "" : ""),
      );
    else withRecipients("");
  }, []);

  useEffect(() => {
    if (!officeReady || readied.current) return;
    readied.current = true;
    window.Office?.onReady(() => {
      setHostReady(true);
      readOpenItem();
    });
  }, [officeReady, readOpenItem]);

  // The body, taken apart: what you typed, and then the thread underneath as
  // the list of separate messages it actually is. A thread handed over whole is
  // how the model ends up answering the newest message when you asked for the
  // first one, and greeting a name it found at the top. lib/writer/quoted.ts
  // carries the reasoning and the markers.
  const { typed, messages } = useMemo<{ typed: string; messages: ThreadMessage[] }>(() => {
    if (!email) return { typed: "", messages: [] };
    if (email.composing) {
      const split = splitComposeBody(email.body, htmlToPlain(settings?.signature || ""));
      return { typed: split.mine.trim(), messages: splitThread(split.quoted) };
    }
    // A message you were sent is itself the newest message in the thread, and
    // its headers came from Office rather than from a quoted block.
    const split = splitComposeBody(email.body, "");
    return {
      typed: "",
      messages: [
        {
          from: email.from,
          to: email.to,
          cc: email.cc,
          sent: "",
          subject: email.subject,
          body: split.mine.trim(),
        },
        ...splitThread(split.quoted),
      ],
    };
  }, [email, settings]);

  // Which message in the thread is being answered. Defaults to the newest,
  // which is right most of the time and wrong exactly when somebody says
  // "reply to the original" — so it is a control, not an assumption.
  const [targetIdx, setTargetIdx] = useState(0);
  const pick = messages.length ? Math.min(targetIdx, messages.length - 1) : 0;
  const target = messages[pick];
  // ONE RULE, and it has now been got wrong in three different ways: NOTHING
  // THE ADD-IN READS EVER GOES IN THE BOX. The box is empty until the person
  // types in it.
  //
  //   the message being answered  → `source`  → the model, as background
  //   what they typed in Outlook  → `typed`   → the model, as the draft
  //   what they type in this pane → the box   → the model, as the instruction
  //
  // All three reach the model. Only the third one is ever on screen in the box.
  //
  // The two failures it has had are the same failure: first it ignored the
  // half-written draft and answered from nothing, then it pasted the email —
  // signature, thread and all — into the box and called that reading it. A
  // prefilled box cannot be typed in. "Make it longer" and "just edit what I
  // wrote" are the normal things to want to say, and there is nowhere to say
  // them when the box already holds forty lines of somebody else's email. The
  // add-in can read the message by itself; that is the entire point of it being
  // in Outlook, and it is exactly why the reading does not need to be shown
  // back to you in the one place you were meant to write.
  const source = useMemo(() => {
    const thread = threadForPrompt(messages, pick);
    if (!thread || !email?.composing) return thread;
    // On a draft, who it will actually go to is known, and it is not always the
    // same set as the message being answered.
    const going = [email.to && `To: ${email.to}`, email.cc && `Cc: ${email.cc}`]
      .filter(Boolean)
      .join("; ");
    return going
      ? `Your reply is addressed to — ${going}. Everyone there will read it.\n\n${thread}`
      : thread;
  }, [messages, pick, email]);
  // Whoever wrote the message being answered, which is the whole point of the
  // picker above: on a thread the sender of the newest message and the sender
  // of the one you meant are different people.
  const recipient = target?.from || (email?.composing ? email.to : email?.from) || "";
  // Relative lengths are unanswerable before anything exists — shorter than
  // what? They are offered only when there is a draft of yours to be shorter
  // than; otherwise the same dial asks in absolute terms.
  const lengthOptions = typed ? LENGTHS : TARGET_LENGTHS;
  // A message to answer is on its own enough to write from — "just reply to
  // this" is a complete request, and the empty box is the normal state for it.
  // So is a draft already half-written in Outlook. Nothing at all, though, and
  // a model handed nothing writes a blank template for somebody else to fill
  // in. Better to say so than to send it.
  const hasIntake =
    !!htmlToPlain(draftHtml).trim() ||
    !!htmlToPlain(briefHtml).trim() ||
    !!typed.trim() ||
    !!source.trim();

  // Read the dials off the email itself. Who it is from and how it is written
  // already answer most of "what tone, what audience" — asking you to pick them
  // by hand for a message the add-in is looking at would be asking you to type
  // out something it can see. Guesses, so they are flagged as guesses and one
  // tap moves any of them.
  const extracted = useRef(false);
  useEffect(() => {
    if (!email || !userId || !settings || extracted.current) return;
    // Your own words where there are any, the message being answered where
    // there are not. Never both: a forty-line thread would otherwise pick the
    // tone for a reply you have already written half of, and "how much license
    // do I have with this draft" would be answered about somebody else's
    // writing.
    const material = typed || source;
    if (!material.trim() && !email.subject.trim()) return;
    extracted.current = true;
    void (async () => {
      try {
        // Only while composing: `source` already opens with the sender and the
        // subject when it is a message that arrived.
        const header = email.composing
          ? [email.subject && `Subject: ${email.subject}`, email.to && `To: ${email.to}`]
              .filter(Boolean)
              .join("\n")
          : "";
        const res = await fetch("/api/writer/ai", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            action: "extract",
            docType: "email",
            brief: (header ? `${header}\n\n${material}` : material).slice(0, 20000),
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
        if (ex.length && ex.length !== "as_is") {
          // The model can only answer in the relative vocabulary it was given,
          // so "cut it down" comes back as "shorter" even when there is nothing
          // yet to be shorter than. Read as the absolute it meant.
          const wanted = typed
            ? String(ex.length)
            : RELATIVE_TO_ABSOLUTE[String(ex.length)] || String(ex.length);
          if ((typed ? LENGTHS : TARGET_LENGTHS).some((l) => l.key === wanted)) {
            setLength(wanted);
            filled.push("length");
          }
        }
        // How much license the piece gets, but only over words that are
        // actually yours. "Write it" is the right default for answering
        // somebody else from scratch and the wrong one for a draft you have
        // already written properly — handed that, this dial is the difference
        // between a proofread and a stranger's letter.
        if (typed && ex.fidelity && FIDELITY_OPTIONS.some((f) => f.key === ex.fidelity)) {
          setFidelity(ex.fidelity as Fidelity);
          filled.push("how much to write");
        }
        setAutoFilled(filled);
      } catch {
        // A failed guess is not worth a message: every dial has a usable
        // default and you were going to check them anyway.
      } finally {
        setExtractDone(true);
      }
    })();
    // `typed` and `quoted` are derived from `email` and `settings`, so listing
    // them would not change when this runs; the ref is what makes it once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, userId, settings]);

  const reading = !!email && !!userId && !extractDone;

  // There is deliberately no effect here putting anything into the box. The
  // read lands in `typed` and `source` and goes straight to the model from
  // there; see the rule above `source`.

  // The pane reads the message once, when it opens. Open it on an empty reply,
  // then type in Outlook, and it is still holding the read from before you
  // typed — which from in here is indistinguishable from the add-in ignoring
  // you. Always offered now: with nothing ever prefilled, a re-read cannot
  // overwrite a word you typed in this panel, so the button no longer has to
  // hide itself the moment there is something to lose.
  function rereadMessage() {
    extracted.current = false;
    setExtractDone(false);
    setAutoFilled([]);
    setTargetIdx(0);
    setError("");
    readOpenItem();
  }

  // The actual AI call, shared by the first write and every refine after it.
  // `refineGuidance` present means "revise what's on screen"; absent means
  // "write it from the intake". Either way the result lands in state and is
  // persisted to the same row, so the doc this pane is working on never
  // multiplies into several.
  async function runGenerate(
    target: WriterDoc,
    refineGuidance?: string,
    priorInstructions: string[] = [],
  ) {
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
            recipient,
            // The message being answered. Handed over as background on
            // purpose: it is what the reply has to make sense against, not a
            // draft to improve and not something to quote back.
            background: source,
            brief: htmlToPlain(target.context.brief),
          },
          styles: styleTexts,
          signature: settings?.signature ? htmlToPlain(settings.signature) : "",
          priorInstructions,
          variants: 1,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Generation failed");
      const first = json.variants?.[0];
      if (!first) throw new Error("Nothing usable came back — try again");
      // The subject Outlook already has beats one the model invented: on a
      // reply the thread's subject is the right answer, and a freshly made-up
      // "Quick note" landing over the top of "RE: …" is only something to undo
      // by hand. One typed in this panel outranks both; one the model wrote
      // last time outranks nothing, or a bad first pass would hand its subject
      // down to every pass after it.
      const subject =
        (subjectEdited.current ? subjectRef.current.trim() : "") ||
        target.subject.trim() ||
        first.subject ||
        "";
      setResultContent(first.html);
      applySubject(subject);
      await supabase
        .from("writer_docs")
        .update({ content: first.html, subject })
        .eq("id", target.id);
      void refresh();
      setGuidance("");
    } catch (e) {
      setError((e as Error).message || "That didn't work");
    } finally {
      setGenerating(false);
    }
  }

  // Create the piece and write it, right here — or, when one has already been
  // written and the intake has been corrected since, write that same piece
  // again rather than leaving an abandoned copy of the bad one in the library.
  async function writeReply() {
    if (!email || generating || !hasIntake) return;
    const rewriting = resultDoc;
    setError("");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    pendingRef.current = {};
    try {
      // "Re:" belongs on an answer, not on a message you're writing from
      // scratch — composing already has whatever subject you've typed, if
      // any, and it isn't a reply to prefix.
      const isReply = !email.composing;
      const subjectLine = email.subject
        ? isReply
          ? `Re: ${email.subject}`
          : email.subject
        : "";
      // The three inputs, sorted into the two fields the workspace's Draft and
      // "Anything else I should know?" boxes already save to.
      //
      // When Outlook has a half-written draft, THAT is the draft — the box is
      // you talking about it ("make it longer", "just fix the grammar"), which
      // is the brief. With no draft in Outlook the box is the only thing you
      // have said, so it is the draft itself, exactly as the workspace reads
      // its one box. Either way the thread stays in `background`: context for
      // the reply, never something to rewrite.
      const boxText = htmlToPlain(draftHtml).trim();
      const original = typed ? plainToHtml(typed) : draftHtml;
      const brief = typed && boxText ? `${draftHtml}${briefHtml}` : briefHtml;
      const context = {
        ...emptyContext(),
        fidelity,
        tone,
        audience,
        length,
        styleIds,
        recipient,
        background: source,
        brief,
      };
      const doc = rewriting
        ? { ...rewriting, subject: subjectLine, original, context }
        : await add({
            doc_type: "email",
            mode: "create",
            title: subjectLine || (isReply ? "Reply" : "New message"),
            subject: subjectLine,
            original,
            context,
          });
      if (!doc) throw new Error("Couldn't create the piece");
      if (rewriting)
        await supabase
          .from("writer_docs")
          .update({ subject: subjectLine, original, context })
          .eq("id", doc.id);
      setResultDoc(doc);
      setResultContent("");
      // A subject typed by hand survives a rewrite; a fresh piece takes the
      // one the thread already has.
      if (!rewriting) applySubject(doc.subject);
      // A write from the intake starts the history over: what was asked travels
      // as the brief, not as a standing instruction on top of itself.
      const note = htmlToPlain(brief).trim();
      setAsked(note ? [note] : []);
      await runGenerate(doc);
    } catch (e) {
      setError((e as Error).message || "That didn't work");
    }
  }

  async function refine() {
    if (!resultDoc || !guidance.trim() || generating) return;
    const instruction = guidance.trim();
    // What was asked BEFORE this round is what the model needs as standing
    // constraints; this round's instruction travels separately.
    const prior = asked;
    setAsked([...prior, instruction]);
    await runGenerate(resultDoc, instruction, prior);
  }

  // Back to the dials, to write it again from scratch a different way.
  function startOver() {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    pendingRef.current = {};
    setResultDoc(null);
    setResultContent("");
    subjectEdited.current = false;
    applySubject("");
    setGuidance("");
    setAsked([]);
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
    const insert = item.body.setSelectedDataAsync;
    // A message you are only reading has no cursor to insert at, and Outlook
    // does not say so politely — the method is simply not there, and calling it
    // throws inside a click handler where nothing is listening. That is what
    // "the Add to email button didn't do anything" was.
    if (typeof insert !== "function") {
      setError("Nowhere to put it in a message you're reading — open a reply below instead.");
      return;
    }
    try {
      insert.call(item, withSig, { coercionType: Office.CoercionType.Html }, (result) => {
        if (result.status === Office.AsyncResultStatus.Succeeded) {
          setInserted(true);
          setTimeout(() => setInserted(false), 2500);
        } else {
          setError(result.error?.message || "Outlook wouldn't take it");
        }
      });
    } catch (e) {
      setError((e as Error).message || "Outlook wouldn't take it");
    }
  }

  /**
   * The other half of the same intention, for a message you are reading: there
   * is no draft to insert into, so make one. Outlook opens its own reply window
   * with the piece already in it, above the quoted thread, exactly where a
   * reply you typed yourself would go.
   */
  function openReply(html: string, useSig: boolean, all: boolean) {
    const Office = window.Office;
    const item = Office?.context?.mailbox?.item;
    if (!Office || !item) return;
    const withSig = toEmailHtml(html, useSig ? settings?.signature || "" : "");
    const open = all ? item.displayReplyAllForm : item.displayReplyForm;
    if (typeof open !== "function") {
      setError("This Outlook won't open a reply from the pane — copy it across instead.");
      return;
    }
    try {
      open.call(item, withSig);
      setInserted(true);
      setTimeout(() => setInserted(false), 2500);
    } catch (e) {
      setError((e as Error).message || "Outlook wouldn't open the reply");
    }
  }

  /** Put a finished piece into an email, whichever way this window allows. */
  function sendToOutlook(html: string, useSig: boolean, all = true) {
    if (email?.composing) insertHtml(html, useSig);
    else openReply(html, useSig, all);
  }

  function insertIntoReply(doc: WriterDoc) {
    sendToOutlook(doc.content, doc.context?.useSignature !== false);
  }

  const progress = useProgress(generating, 20000);
  const recent = docs.filter((d) => htmlToPlain(d.content).trim()).slice(0, 6);
  const hasResult = !!resultContent.trim();
  // Who will actually read this. Shown because it is the fact behind the model
  // no longer offering to pass your note along to somebody who is copied on it.
  const onThread = (
    email?.composing ? [email.to, email.cc] : [target?.to, target?.cc]
  )
    .filter(Boolean)
    .join(", ");

  // The intake: the two boxes and the dials. Rendered on its own before
  // anything has been written, and again — folded away — underneath what was
  // written. "I pasted my message into the box and nothing happened" is what a
  // panel that deletes the box you were meant to type in looks like from the
  // outside: after the first pass there was nothing left on screen but an
  // editor for the piece it had already written.
  const intake = email && (
    <>
      {messages.length > 1 && (
        <div>
          <label
            htmlFor="answering"
            className="mb-1 block text-sm font-semibold text-ink"
          >
            Which one are you answering?
          </label>
          <select
            id="answering"
            value={pick}
            onChange={(e) => setTargetIdx(Number(e.target.value))}
            className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-[11px] outline-none focus:border-[var(--accent)]"
          >
            {messages.map((m, i) => (
              <option key={i} value={i}>
                {m.from || "unknown sender"}
                {m.sent ? ` · ${m.sent}` : ""}
                {i === 0 ? " · most recent" : ""}
              </option>
            ))}
          </select>
          <p className="mt-0.5 text-[10px] leading-snug text-muted">
            A thread is several messages by different people. I answer this one
            and greet whoever sent it; the rest is history I read but don&apos;t
            reply to.
          </p>
        </div>
      )}

      {/* The two boxes the workspace itself uses — Draft and "Anything else I
          should know?" — not a reinterpretation of them. This one is bigger
          and comes first on purpose: it's the one thing only you know. It is
          also EMPTY on purpose. Everything the add-in can read is read below,
          not pasted in here — a box with the email already in it is a box you
          cannot type "make it longer" into. */}
      <div>
        <label className="mb-1 block text-sm font-semibold text-ink">
          What do you want to say?
        </label>
        <RichText
          dense
          autoFocus={!resultDoc}
          value={draftHtml}
          onChange={setDraftHtml}
          placeholder={
            typed
              ? "e.g. 'make it longer' or 'just tidy up what I wrote' — I've got your draft"
              : source
                ? "e.g. 'reply saying I can do Thursday but not Tuesday' — or leave it empty and I'll just answer it"
                : "Your message, or just what you want it to say — I'll work out which it is."
          }
          minHeight="min-h-28"
        />
        <p className="mt-0.5 text-[10px] leading-snug text-muted">
          {typed
            ? "I've already got the draft you started in Outlook — it's down below. This box is for what to do with it."
            : source
              ? "I've read the message — say what you want to come back with, or leave this empty and I'll just answer it."
              : "Nothing in the message yet, so this is where you say it."}
        </p>
      </div>

      <div>
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
          Anything else I should know?
        </p>
        <RichText
          dense
          value={briefHtml}
          onChange={setBriefHtml}
          placeholder="Who it's for, what's at stake, what to change, anything to avoid…"
          minHeight="min-h-12"
        />
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
            label={typed ? "Length" : "How long"}
            options={lengthOptions}
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
        disabled={generating || !hasIntake}
        className="w-full rounded-lg bg-[var(--accent)] px-3 py-2.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
      >
        {generating
          ? "Writing it…"
          : resultDoc
            ? "Write it again"
            : email.composing
              ? "Write it"
              : "Write the reply"}
      </button>
      <div className="space-y-1.5">
        <p className="text-[11px] leading-snug text-muted">
          {hasIntake
            ? "Writes it right here, then you can edit it or drop it into your reply below."
            : "There's nothing here to write from yet — say what you want it to say above, or write a line or two in Outlook and read it back in."}
        </p>
        {/* Always available: the pane reads the message once, when it opens, so
            anything typed in Outlook afterwards is invisible to it until this
            is pressed. It used to hide itself as soon as there was anything to
            write from, because re-reading would have overwritten the box —
            nothing is prefilled any more, so there is nothing left to lose. */}
        <button
          onClick={rereadMessage}
          className="rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-medium text-muted transition hover:text-ink"
        >
          Re-read my message
        </button>
      </div>
    </>
  );

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

      <main className="mx-auto w-full max-w-md space-y-2 p-2.5 text-ink">
        <header className="flex items-start justify-between gap-2">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--accent)]">
              Writing Studio
            </p>
            <h1 className="text-base font-semibold">
              {email?.composing ? "This draft" : "Answer this one"}
            </h1>
          </div>
          {/* The pane now stays signed in on its own, so it needs a way out
              that means it: this also revokes the saved sign-in, where a plain
              cookie sign-out would be quietly undone on the next open. */}
          {userId && !userLoading && (
            <button
              onClick={() => void signOut()}
              className="mt-0.5 text-[10px] font-medium text-muted transition hover:text-ink"
            >
              Sign out
            </button>
          )}
        </header>

        {restoring && (
          <p className="rounded-xl border border-border bg-surface p-3 text-xs text-muted">
            Signing you back in…
          </p>
        )}

        {/* Held back until Office has answered and the session check is done:
            before that a missing id means "not known yet", not "signed out",
            and flashing a sign-in prompt at somebody about to be signed back in
            automatically is exactly the complaint this replaced. */}
        {!userId && !userLoading && !restoring && (hostReady || outsideOutlook) && (
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
            {!resultDoc && intake}

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
                          editSubject(e.target.value);
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
                          sendToOutlook(
                            resultContent,
                            resultDoc.context?.useSignature !== false,
                            true,
                          )
                        }
                        className="flex-1 rounded-lg bg-[var(--accent)] px-3 py-2.5 text-xs font-semibold text-white transition hover:opacity-90"
                      >
                        {inserted
                          ? email.composing
                            ? "Dropped in ✓"
                            : "Opened ✓"
                          : email.composing
                            ? "Add to email"
                            : onThread
                              ? "Reply all"
                              : "Reply"}
                      </button>
                      {!email.composing && onThread && (
                        <button
                          onClick={() =>
                            openReply(
                              resultContent,
                              resultDoc.context?.useSignature !== false,
                              false,
                            )
                          }
                          className="rounded-lg border border-border px-3 py-2.5 text-xs font-medium text-muted transition hover:text-ink"
                        >
                          Reply
                        </button>
                      )}
                      <button
                        onClick={startOver}
                        className="rounded-lg border border-border px-3 py-2.5 text-xs font-medium text-muted transition hover:text-ink"
                      >
                        Start over
                      </button>
                    </div>
                    <p className="text-[10px] leading-snug text-muted">
                      {!email.composing
                        ? "Outlook opens its own reply window with this already in it, above the quoted thread."
                        : typed
                          ? "Select the notes in your message first and this replaces them. Otherwise it lands wherever the cursor is."
                          : "It lands wherever the cursor is in your message, formatted, with your signature."}
                    </p>

                    {asked.length > 0 && (
                      <div className="rounded-xl border border-border bg-surface p-2.5">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
                          What you&apos;ve asked for so far
                        </p>
                        <ol className="mt-1 space-y-1">
                          {asked.map((one, i) => (
                            <li
                              key={i}
                              className="flex gap-1.5 text-[11px] leading-snug text-muted"
                            >
                              <span className="shrink-0 font-semibold text-[var(--accent)]">
                                {i + 1}.
                              </span>
                              <span>{one}</span>
                            </li>
                          ))}
                        </ol>
                        <p className="mt-1 text-[10px] leading-snug text-muted">
                          All of it still applies — anything you add below is on
                          top of these, not instead of them.
                        </p>
                      </div>
                    )}

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

                    <details className="rounded-xl border border-border bg-surface">
                      <summary className="cursor-pointer list-none p-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
                        Not what you meant? What I wrote it from ▾
                      </summary>
                      <div className="space-y-2 p-2.5 pt-0">{intake}</div>
                    </details>
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
                {target?.subject || email.subject || "(no subject)"}
              </p>
              <p className="truncate text-[11px] text-muted">
                {target?.from
                  ? `From: ${target.from}`
                  : email.composing
                    ? email.to
                      ? `To: ${email.to}`
                      : "(no recipient yet)"
                    : email.from || "(unknown sender)"}
              </p>
              {onThread && (
                <p className="truncate text-[11px] text-muted">
                  Everyone on it: {onThread}
                </p>
              )}
              {/* The draft you started in Outlook. It goes to the model as the
                  draft — but it is shown HERE, read-only, rather than loaded
                  into the box, so the box stays free for "make it longer".
                  Without this there would be no way to tell a draft that was
                  read from one that was missed, which is the complaint that
                  put it in the box in the first place. */}
              {typed && (
                <details className="mt-1.5 rounded-lg border border-border bg-canvas p-1.5">
                  <summary className="cursor-pointer list-none text-[10px] font-semibold uppercase tracking-wide text-[var(--accent)]">
                    Your draft, read from Outlook ▾
                  </summary>
                  <p className="mt-1 whitespace-pre-wrap text-[11px] leading-relaxed text-muted">
                    {typed}
                  </p>
                  <p className="mt-1 text-[10px] leading-snug text-muted">
                    Your signature and the thread below it are left off. Edit it
                    in Outlook, then press &ldquo;Re-read my message&rdquo;.
                  </p>
                </details>
              )}
              {messages.length ? (
                <>
                  <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted">
                    {target?.body || "(that one has no text in it)"}
                  </p>
                  {/* The thread is not in the box any more, so this panel is the
                      only place left to check what was actually read — and with
                      several messages it is also where you confirm the right one
                      is selected. Two clamped lines say "it has it"; the rest is
                      one click away rather than forty lines standing between you
                      and the button. */}
                  <details className="mt-1">
                    <summary className="cursor-pointer list-none text-[10px] font-medium text-[var(--accent)]">
                      {messages.length > 1
                        ? `Show all ${messages.length} messages ▾`
                        : "Show the whole message ▾"}
                    </summary>
                    <div className="mt-1 max-h-64 space-y-2 overflow-y-auto rounded-lg border border-border bg-canvas p-2">
                      {messages.map((m, i) => (
                        <div
                          key={i}
                          className={
                            i === pick && messages.length > 1
                              ? "rounded-md border-l-2 border-[var(--accent)] pl-2"
                              : "pl-2 opacity-70"
                          }
                        >
                          <p className="text-[10px] font-semibold text-ink">
                            {m.from || "unknown sender"}
                            {m.sent ? ` · ${m.sent}` : ""}
                            {i === pick && messages.length > 1 ? " · answering this" : ""}
                          </p>
                          <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-muted">
                            {m.body || "(no text)"}
                          </p>
                        </div>
                      ))}
                    </div>
                  </details>
                </>
              ) : (
                <p className="mt-1 text-[11px] leading-relaxed text-muted">
                  {typed
                    ? "Nothing underneath it — a new message rather than a reply."
                    : "(nothing in the message yet)"}
                </p>
              )}
              {typed && source && (
                <p className="mt-1 text-[10px] leading-snug text-muted">
                  I write your draft against this thread; the thread itself I
                  never rewrite or quote back.
                </p>
              )}
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
