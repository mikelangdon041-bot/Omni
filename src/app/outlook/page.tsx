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
// It closes the loop as well: once the reply is written, this pane drops it
// into Outlook, formatted, with the signature. Generation happens right here —
// read the email, say what you want (or nothing), hit write, watch it come
// back, edit it if it's not quite right, send it across.
//
// The layout is the one Gmail's "Help me write" and Copilot in Outlook settled
// on, because it is the one that needs no explaining: what the email says at
// the top, ONE optional box, one button that says what it is about to do, and
// the dials folded away behind "Options" for the times they matter.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Script from "next/script";
import { composeFont, plainToHtml, toOutlookHtml } from "@/lib/writer/clipboard";
import { isShortSignOff } from "@/lib/writer/signature";
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
  type WordSwap,
  type WriterContext,
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
      context: {
        mailbox?: {
          item?: OfficeItem;
          // Who is signed into this mailbox. The one thing that makes "which
          // of these messages did I write?" answerable, which is what turns a
          // thread into writing samples without anybody pasting anything.
          userProfile?: { displayName?: string; emailAddress?: string };
        };
      };
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

/** How much of a thread goes to the model. */
type Scope = "thread" | "one";

/** Recipients as names to greet or to account for. */
function addressNames(list: OfficeAddress[] | undefined, cap = 8): string {
  return (list || [])
    .map((r) => r?.displayName || r?.emailAddress || "")
    .filter(Boolean)
    .slice(0, cap)
    .join(", ");
}

const sameEmail = (a: ReadEmail, b: ReadEmail) =>
  a.subject === b.subject &&
  a.from === b.from &&
  a.to === b.to &&
  a.cc === b.cc &&
  a.body === b.body &&
  a.composing === b.composing;

/**
 * The body, taken apart: what you typed, and then the thread underneath as the
 * list of separate messages it actually is. A thread handed over whole is how
 * the model ends up answering the newest message when you asked for the first
 * one, and greeting a name it found at the top. lib/writer/quoted.ts carries
 * the reasoning and the markers. A plain function rather than only a memo,
 * because "Write" re-reads the message and has to parse the fresh copy on the
 * spot, not the one from the last render.
 */
function readBody(
  email: ReadEmail | null,
  signature: string,
): { typed: string; messages: ThreadMessage[]; dropped: string } {
  if (!email) return { typed: "", messages: [], dropped: "" };
  if (email.composing) {
    const split = splitComposeBody(email.body, signature, true);
    // `dropped` is the signature Outlook itself put in this draft. Kept,
    // because it answers two questions nothing else can: how this person signs
    // off, and whether Outlook is already going to add one.
    return {
      typed: split.mine.trim(),
      messages: splitThread(split.quoted),
      dropped: split.dropped,
    };
  }
  // A message you were sent is itself the newest message in the thread, and
  // its headers came from Office rather than from a quoted block.
  const split = splitComposeBody(email.body, "");
  return {
    typed: "",
    dropped: "",
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
}

// ONE RULE, and it has been got wrong in three different ways: NOTHING THE
// ADD-IN READS EVER GOES IN THE BOX. The box is empty until the person types
// in it.
//
//   the message being answered  → `source`  → the model, as background
//   what they typed in Outlook  → `typed`   → the model, as the draft
//   what they type in this pane → the box   → the model, as the draft or the
//                                              instruction (see writeReply)
//
// All three reach the model. Only the third one is ever on screen in the box.
// A prefilled box cannot be typed in, and "make it longer" or "just edit what
// I wrote" are the normal things to want to say. The add-in reads the message
// by itself; the summary card is where you see that it did.
function sourceFor(
  email: ReadEmail | null,
  messages: ThreadMessage[],
  pick: number,
  scope: Scope,
): string {
  // "Just this message" is the one being answered on its own — no history, and
  // a good deal fewer tokens on a long chain.
  const thread =
    scope === "one" && messages[pick]
      ? threadForPrompt([messages[pick]], 0)
      : threadForPrompt(messages, pick);
  if (!thread || !email?.composing) return thread;
  // On a draft, who it will actually go to is known, and it is not always the
  // same set as the message being answered.
  const going = [email.to && `To: ${email.to}`, email.cc && `Cc: ${email.cc}`]
    .filter(Boolean)
    .join("; ");
  return going
    ? `Your reply is addressed to — ${going}. Everyone there will read it.\n\n${thread}`
    : thread;
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

// "How much should I change your words" only means something once there are
// words of yours. Worded as what the button will do, and with "write it from
// this" first when all there is is a note typed here — that is what a note is.
const FIDELITY_LABELS: Record<Fidelity, string> = {
  draft: "📝 Write it from this",
  light: "🔍 Just fix it",
  polish: "✍️ Polish it",
  rewrite: "🚀 Rewrite it",
};
const BUTTON_FOR: Record<Fidelity, string> = {
  draft: "Write it",
  light: "Fix it",
  polish: "Polish it",
  rewrite: "Rewrite it",
};

/** Between one piece of somebody's writing and the next. */
const SAMPLE_SEPARATOR = "\n\n---\n\n";

const nameTokens = (s: string) => s.toLowerCase().match(/[a-z]{2,}/g) || [];

/**
 * Is this "From:" line this person?
 *
 * Harder than it sounds, and worth getting right, because it is what decides
 * which messages in a thread are writing samples. Outlook writes the same
 * person as "Balmuth-Loris, Zak" in a quoted header and hands Office
 * "Zak Balmuth-Loris" as the display name, so a substring test says no. The
 * address is the sure thing when it survives into the header; otherwise every
 * part of the shorter name has to turn up in the longer one, and a name of one
 * word has to match outright — "Zak" should not claim every Zak on the thread.
 */
function samePerson(from: string, name: string, mail: string): boolean {
  const f = (from || "").toLowerCase().trim();
  if (!f) return false;
  const m = mail.toLowerCase().trim();
  if (m && f.includes(m)) return true;
  const local = m.split("@")[0];
  if (local.length > 3 && f.includes(local)) return true;

  const a = nameTokens(f);
  const b = nameTokens(name);
  if (!a.length || !b.length) return false;
  const [short, long]: [string[], string[]] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length < 2) return a.join(" ") === b.join(" ");
  return short.every((t) => long.includes(t));
}

/** Below this there is no style to read, only "sounds good". */
const SAMPLE_FLOOR = 80;

function countSamples(samples?: string): number {
  return (samples || "")
    .split(/\n\s*---+\s*\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 40).length;
}

export default function OutlookPage() {
  const { userId, loading: userLoading } = useUserId();
  const { docs, add, refresh } = useWriterDocs(userId);
  const { settings, save: saveSettings } = useWriterSettings(userId);

  const { styles, add: addStyle, update: updateStyle } = useWriterStyles(userId);

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
  // The one box. Starts empty and STAYS empty until you type — see the rule
  // above `sourceFor`.
  const [draftHtml, setDraftHtml] = useState("");
  // "Anything else I should know?" — kept, but in Options: two boxes side by
  // side, both optional, was the single most confusing thing on this panel.
  const [briefHtml, setBriefHtml] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [inserted, setInserted] = useState(false);

  // The same dials as the workspace, so you never have to go there to set
  // them — but folded away, because most replies need none of them. Answering
  // somebody from scratch is "write it"; the other modes only mean something
  // once there are words of yours to be faithful to.
  const [fidelity, setFidelity] = useState<Fidelity>("draft");
  const [tone, setTone] = useState<string[]>([]);
  const [audience, setAudience] = useState<string[]>([]);
  const [length, setLength] = useState("as_is");
  // null means "you haven't chosen", which is not the same as "none". A voice
  // you taught it is the whole point of teaching it, so until you say otherwise
  // the voices are on — see `activeStyleIds`.
  const [styleIds, setStyleIds] = useState<string[] | null>(null);
  const [scope, setScope] = useState<Scope>("thread");
  const [summary, setSummary] = useState("");
  const [extractDone, setExtractDone] = useState(false);
  const [autoFilled, setAutoFilled] = useState<string[]>([]);

  // The font this message is already written in, read off the draft. Handed
  // straight back on the way in, so what lands matches what is around it —
  // before this, everything arrived as Calibri 11 whatever the person's own
  // default was, and they were fixing it with the format painter.
  const [bodyFont, setBodyFont] = useState("");
  // Who is signed into this mailbox, so "which of these did I write?" has an
  // answer. Only used to find writing samples.
  const [me, setMe] = useState<{ name: string; email: string }>({ name: "", email: "" });
  const [learning, setLearning] = useState(false);
  const [learned, setLearned] = useState("");
  const [swapAvoid, setSwapAvoid] = useState("");
  const [swapPrefer, setSwapPrefer] = useState("");
  const [signOffDraft, setSignOffDraft] = useState("");
  const [signOffSaved, setSignOffSaved] = useState(false);

  // The piece being written, once the button has been pressed. Its presence is
  // what switches the pane from intake to result — everything after that point
  // (editing, refining, inserting) happens against this doc without ever
  // leaving the pane.
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
  // the database so the piece survives a reopen and shows up in "Drop one in" —
  // but sending it to Outlook always uses what's on screen, so a save that
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

  /** Read the open message into state, and hand the fresh copy back. */
  const readOpenItem = useCallback(
    (): Promise<ReadEmail | null> =>
      new Promise((resolve) => {
        const Office = window.Office;
        const item = Office?.context?.mailbox?.item;
        if (!Office || !item) {
          setOutsideOutlook(true);
          resolve(null);
          return;
        }
        // Compose items report their subject through an async accessor; read
        // items expose it as a plain string. Both shapes are handled because
        // both turn up — but the answer only changes the wording, never which
        // controls exist.
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
            const next = { subject, from: who, to, cc, body: body.slice(0, 40000), composing };
            // Same message as last time → same object, so a re-read on focus
            // does not re-render the whole panel for nothing.
            setEmail((prev) => (prev && sameEmail(prev, next) ? prev : next));
            resolve(next);
          });

        // Everyone on the message. A draft hands its recipients over only if
        // you ask; one you are reading has them sitting there as an array.
        const readList = (field: OfficeRecipients | undefined, then: (names: string) => void) => {
          if (!field) return then("");
          if (Array.isArray(field)) return then(addressNames(field));
          field.getAsync((r) =>
            then(r.status === Office.AsyncResultStatus.Succeeded ? addressNames(r.value) : ""),
          );
        };

        const withRecipients = (subject: string) =>
          readList(item.to, (to) => readList(item.cc, (cc) => finish(subject, to, cc)));

        try {
          if (typeof subjectField === "string") withRecipients(subjectField);
          else if (composing)
            // A draft's subject has to be asked for. Reading the body
            // regardless of how that goes: in a reply the body already holds
            // the thread being answered, which is the part that matters here.
            subjectField.getAsync((r) =>
              withRecipients(r.status === Office.AsyncResultStatus.Succeeded ? r.value || "" : ""),
            );
          else withRecipients("");
        } catch {
          resolve(null);
        }
      }),
    [],
  );

  useEffect(() => {
    if (!officeReady || readied.current) return;
    readied.current = true;
    window.Office?.onReady(() => {
      setHostReady(true);
      const profile = window.Office?.context?.mailbox?.userProfile;
      if (profile)
        setMe({ name: profile.displayName || "", email: profile.emailAddress || "" });
      void readOpenItem();
    });
  }, [officeReady, readOpenItem]);


  // A draft keeps changing after the pane opens — you type in Outlook, then
  // come back here. There used to be a "Re-read my message" button for that,
  // and it looked like a setting rather than something to press. Now the pane
  // simply re-reads whenever you come back to it, and again the moment you
  // press the button, so what it writes from is never stale.
  const composingNow = !!email?.composing;
  useEffect(() => {
    if (!composingNow) return;
    const onFocus = () => void readOpenItem();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [composingNow, readOpenItem]);

  // The font the message is written in. A second read, in HTML this time,
  // because the text coercion the rest of the pane uses has thrown exactly the
  // part we need away. Composing only: a message you are reading is in the
  // sender's font, and the reply window uses the person's own default —
  // which is precisely what we want it to do.
  useEffect(() => {
    if (!composingNow) return;
    const Office = window.Office;
    const item = Office?.context?.mailbox?.item;
    if (!Office || !item) return;
    try {
      item.body.getAsync(Office.CoercionType.Html, (r) => {
        if (r.status !== Office.AsyncResultStatus.Succeeded) return;
        const font = composeFont(r.value || "");
        if (font) setBodyFont(font);
      });
    } catch {
      // Nothing read means nothing declared, which is the safe default anyway.
    }
  }, [composingNow]);

  // Which styles this piece gets. Derived rather than seeded by an effect: a
  // voice is on until you turn it off, and an effect that wrote the default
  // into state would fight anyone who turned it off before the styles loaded.
  const activeStyleIds =
    styleIds ?? styles.filter((s) => s.kind === "voice").map((s) => s.id);
  const toggleStyle = (id: string) =>
    setStyleIds(
      activeStyleIds.includes(id)
        ? activeStyleIds.filter((s) => s !== id)
        : [...activeStyleIds, id],
    );

  // The signature, and the question that decides everything about it: is it a
  // block of letterhead, or is it two lines of "Cheers, Zak"? A block is an
  // object, stapled under the piece by whoever inserts it. A sign-off is the
  // last sentence of the email, so the model writes it and nothing is stapled —
  // see lib/writer/signature.ts.
  const signatureHtml = settings?.signature || "";
  const signature = htmlToPlain(signatureHtml);
  const signsOff = !!signature.trim() && isShortSignOff(signature);
  const {
    typed,
    messages,
    dropped: outlookSignature,
  } = useMemo(() => readBody(email, signature), [email, signature]);

  // Which message in the thread is being answered. Defaults to the newest,
  // which is right most of the time and wrong exactly when somebody says
  // "reply to the original" — so it is a control, not an assumption.
  const [targetIdx, setTargetIdx] = useState(0);
  const pick = messages.length ? Math.min(targetIdx, messages.length - 1) : 0;
  const target = messages[pick];
  const source = useMemo(
    () => sourceFor(email, messages, pick, scope),
    [email, messages, pick, scope],
  );
  // The whole thread, whatever the scope says: the summary is read once, when
  // the pane opens, and is about the conversation, not about a dial.
  const wholeThread = useMemo(
    () => sourceFor(email, messages, pick, "thread"),
    [email, messages, pick],
  );
  const boxText = htmlToPlain(draftHtml).trim();
  // Words of yours to be faithful to: a draft started in Outlook, or anything
  // typed here when there is no such draft. Without either there is nothing to
  // "just fix", so that dial is not offered and the piece is written fresh.
  const ownWords = !!typed || !!boxText;
  const effectiveFidelity: Fidelity = ownWords ? fidelity : "draft";
  // Relative lengths are unanswerable before anything exists — shorter than
  // what? They are offered only when there is a draft of yours to be shorter
  // than; otherwise the same dial asks in absolute terms.
  const lengthOptions = typed ? LENGTHS : TARGET_LENGTHS;
  // A message to answer is on its own enough to write from — "just reply to
  // this" is a complete request, and the empty box is the normal state for it.
  // Nothing at all, though, and a model handed nothing writes a blank template
  // for somebody else to fill in. Better to say so than to send it.
  const hasIntake =
    !!boxText || !!htmlToPlain(briefHtml).trim() || !!typed.trim() || !!source.trim();

  // Read the dials off the email itself, and sum it up for the card at the top,
  // in the one call. Who it is from and how it is written already answer most
  // of "what tone, what audience" — asking you to pick them by hand for a
  // message the add-in is looking at would be asking you to type out something
  // it can see. Guesses, so they are flagged as guesses.
  const extracted = useRef(false);
  useEffect(() => {
    if (!email || !userId || !settings || extracted.current) return;
    // Your own words where there are any, the message being answered where
    // there are not. Never both for the dials: a forty-line thread would
    // otherwise pick the tone for a reply you have already written half of.
    // The thread still goes along when there is a draft, for the summary only.
    const material = typed || wholeThread;
    if (!material.trim() && !email.subject.trim()) return;
    extracted.current = true;
    void (async () => {
      try {
        // Only while composing: the thread already opens with the sender and
        // the subject when it is a message that arrived.
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
            summarize: messages.length > 0,
            thread: typed ? wholeThread.slice(0, 20000) : "",
          }),
        });
        const { extracted: ex } = await res.json();
        if (!res.ok || !ex) return;
        if (typeof ex.summary === "string") setSummary(ex.summary.trim());
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
        // actually yours — handed a draft written properly, this dial is the
        // difference between a proofread and a stranger's letter.
        if (typed && ex.fidelity && FIDELITY_OPTIONS.some((f) => f.key === ex.fidelity)) {
          setFidelity(ex.fidelity as Fidelity);
          filled.push("how much to change");
        }
        setAutoFilled(filled);
      } catch {
        // A failed guess is not worth a message: every dial has a usable
        // default, and the card falls back to the message itself.
      } finally {
        setExtractDone(true);
      }
    })();
    // `typed`, `wholeThread` and `messages` are derived from `email` and
    // `settings`, so listing them would not change when this runs; the ref is
    // what makes it once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, userId, settings]);

  const reading = !!email && !!userId && !extractDone;

  // The actual AI call, shared by the first write and every refine after it.
  // Everything it writes from comes off the piece itself — the context saved
  // with it when the button was pressed — so a refine revises what was
  // actually asked for, not whatever the dials drifted to afterwards.
  async function runGenerate(
    doc: WriterDoc,
    refineGuidance?: string,
    priorInstructions: string[] = [],
  ) {
    setGenerating(true);
    setError("");
    try {
      const ctx = doc.context;
      const styleTexts = styles
        .filter((s) => ctx.styleIds.includes(s.id))
        .map((s) => ({
          name: s.name,
          text: s.kind === "voice" ? s.voice_profile : s.rules,
          // The writing the voice was learned from, not only the description of
          // it. Sentences are a better guide than a summary of sentences.
          samples: s.kind === "voice" ? s.samples || "" : "",
        }));
      const refining = !!refineGuidance && !!resultContent.trim();
      const res = await fetch("/api/writer/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          action: "generate",
          docType: "email",
          original: htmlToPlain(doc.original),
          previous: refining ? resultContent : "",
          guidance: refineGuidance || "",
          fidelity: ctx.fidelity,
          context: {
            ...ctx,
            // The message being answered travels as background on purpose: it
            // is what the reply has to make sense against, not a draft to
            // improve and not something to quote back.
            brief: htmlToPlain(ctx.brief),
          },
          styles: styleTexts,
          signature,
          // Whether the model ends on the sign-off itself or leaves room for a
          // block to be stapled under it. The caller decides, because the
          // caller is the one that knows whether it will staple anything.
          signOff: signsOff,
          wordSwaps: settings?.word_swaps || [],
          priorInstructions,
          variants: 1,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Generation failed");
      const first = json.variants?.[0];
      if (!first) throw new Error("Nothing usable came back — try again");
      // The subject Outlook already has beats one the model invented: on a
      // reply the thread's subject is the right answer. One typed in this panel
      // outranks both; one the model wrote last time outranks nothing, or a
      // bad first pass would hand its subject down to every pass after it.
      const subject =
        (subjectEdited.current ? subjectRef.current.trim() : "") ||
        doc.subject.trim() ||
        first.subject ||
        "";
      setResultContent(first.html);
      applySubject(subject);
      await supabase
        .from("writer_docs")
        .update({ content: first.html, subject })
        .eq("id", doc.id);
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
    setGenerating(true);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    pendingRef.current = {};
    try {
      // A draft may have changed since the pane last looked. Read it again now
      // rather than write from a stale copy — capped, so an Outlook that never
      // answers costs a second, not the whole write.
      const fresh = email.composing
        ? ((await Promise.race([
            readOpenItem(),
            new Promise<null>((r) => setTimeout(() => r(null), 1500)),
          ])) ?? email)
        : email;
      const now = readBody(fresh, signature);
      const nowPick = now.messages.length ? Math.min(targetIdx, now.messages.length - 1) : 0;
      const nowTarget = now.messages[nowPick];
      const nowSource = sourceFor(fresh, now.messages, nowPick, scope);

      // "Re:" belongs on an answer, not on a message you're writing from
      // scratch — composing already has whatever subject you've typed.
      const isReply = !fresh.composing;
      const subjectLine = fresh.subject
        ? isReply
          ? `Re: ${fresh.subject}`
          : fresh.subject
        : "";
      // The inputs, sorted into the two fields the workspace's Draft and
      // "Anything else I should know?" boxes already save to.
      //
      // When Outlook has a half-written draft, THAT is the draft — the box is
      // you talking about it ("make it longer"), which is the brief. With no
      // draft in Outlook the box is the only thing you have said, so it is the
      // draft itself, exactly as the workspace reads its one box. Either way
      // the thread stays in `background`: context, never something to rewrite.
      const mine = now.typed;
      const original = mine ? plainToHtml(mine) : draftHtml;
      const brief = mine && boxText ? `${draftHtml}${briefHtml}` : briefHtml;
      const context: WriterContext = {
        ...emptyContext(),
        fidelity: mine || boxText ? fidelity : "draft",
        tone,
        audience,
        length,
        styleIds: activeStyleIds,
        recipient:
          nowTarget?.from || (fresh.composing ? fresh.to : fresh.from) || "",
        background: nowSource,
        brief,
      };
      // (The recipient is whoever wrote the message being answered — on a
      // thread, not necessarily the sender of the newest one.)
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
      setGenerating(false);
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

  // --- Sounding like the person doing the writing ---------------------------
  //
  // Three separate complaints, and they need three separate answers, because
  // they fail in three different ways:
  //
  //   "it doesn't sound like me"     → a voice, learned from real writing
  //   "I would never say lovely"     → that one word, swapped for the one you do
  //   "it doesn't sign off like me"  → the sign-off, saved once
  //
  // What the industry settled on for the first is what Gmail now does: read
  // the person's own past emails. An add-in cannot go through the Sent folder,
  // but it does not need to — half a thread is usually the person's own
  // replies, already on screen, already parsed into separate messages.

  /** Messages in this thread that this person wrote. Their writing, for free. */
  const myMessages = useMemo(() => {
    if (!me.name.trim() && !me.email.trim()) return [];
    return messages.filter(
      (m) => samePerson(m.from, me.name, me.email) && m.body.trim().length >= SAMPLE_FLOOR,
    );
  }, [messages, me]);

  const voice = styles.find((s) => s.kind === "voice") || null;
  const voiceCount = countSamples(voice?.samples);
  // A draft of your own counts too: it is the most recent thing you have
  // written, and it is about this very email.
  const newSamples = [...myMessages.map((m) => m.body.trim()), typed.trim()]
    .filter((s) => s.length >= SAMPLE_FLOOR)
    // Nothing it has already been taught. Pressing the button twice on the same
    // thread should say there is nothing new, not learn the same email again.
    .filter((s) => !(voice?.samples || "").includes(s.slice(0, SAMPLE_FLOOR)));

  /**
   * Learn — or re-learn — the voice from those. Samples are kept alongside the
   * profile, never replaced by it: a description of how somebody writes is a
   * weaker guide than their actual sentences, and generate sends both.
   */
  async function learnVoice() {
    if (!newSamples.length || learning) return;
    setLearning(true);
    setError("");
    try {
      const merged = [voice?.samples || "", ...newSamples]
        .filter(Boolean)
        .join(SAMPLE_SEPARATOR)
        .slice(-24000);
      const res = await fetch("/api/writer/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ action: "analyze_voice", samples: merged }),
      });
      const json = await res.json();
      if (!res.ok || !json.profile) throw new Error(json.error || "Couldn't read your voice");
      if (voice) {
        await updateStyle(voice.id, { voice_profile: json.profile, samples: merged });
        if (!activeStyleIds.includes(voice.id)) setStyleIds([...activeStyleIds, voice.id]);
      } else {
        const created = await addStyle({
          name: "My voice",
          kind: "voice",
          voice_profile: json.profile,
          samples: merged,
        });
        if (created) setStyleIds([...activeStyleIds, created.id]);
      }
      const n = newSamples.length;
      setLearned(`Got it — ${n} ${n === 1 ? "piece" : "pieces"} of your writing added.`);
      setTimeout(() => setLearned(""), 4000);
    } catch (e) {
      setError((e as Error).message || "Couldn't read your voice");
    } finally {
      setLearning(false);
    }
  }

  const swaps: WordSwap[] = settings?.word_swaps || [];

  /** "Never lovely, say great." Stored as a pair — see the type for why. */
  async function addSwap() {
    const avoid = swapAvoid.trim();
    if (!avoid) return;
    const next = [
      ...swaps.filter((w) => w.avoid.toLowerCase() !== avoid.toLowerCase()),
      { avoid, prefer: swapPrefer.trim() },
    ].slice(-40);
    setSwapAvoid("");
    setSwapPrefer("");
    await saveSettings({ word_swaps: next });
  }

  async function removeSwap(avoid: string) {
    await saveSettings({ word_swaps: swaps.filter((w) => w.avoid !== avoid) });
  }

  async function saveSignOff(text: string) {
    const clean = text.trim();
    if (!clean) return;
    await saveSettings({ signature: plainToHtml(clean) });
    setSignOffDraft("");
    setSignOffSaved(true);
    setTimeout(() => setSignOffSaved(false), 3000);
  }

  // Back to the intake, to write it again from scratch a different way.
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

  /**
   * The signature to staple under the piece on its way into Outlook — which,
   * more often than not, is nothing at all. Three ways it can already be
   * handled, and each of them made a second copy appear before this:
   *
   * - a short sign-off is written by the model as the last lines of the piece;
   * - Outlook has already dropped its own into this draft;
   * - the user asked for it to be left off.
   */
  function signatureFor(useSig: boolean): string {
    if (!useSig || !signatureHtml) return "";
    if (signsOff) return "";
    if (outlookSignature) return "";
    return signatureHtml;
  }

  // The other half of the loop: the reply is written, and this drops the
  // finished piece in where the cursor is — in the font the message is already
  // written in, with one blank line between paragraphs and no margins on top
  // of it. See toOutlookHtml: an insert is not a paste, and the shape that
  // survives a paste is the shape that double-spaces an insert.
  function insertHtml(html: string, useSig: boolean) {
    const Office = window.Office;
    const item = Office?.context?.mailbox?.item;
    if (!Office || !item) return;
    const withSig = toOutlookHtml(html, signatureFor(useSig), bodyFont);
    const insert = item.body.setSelectedDataAsync;
    // A message you are only reading has no cursor to insert at, and Outlook
    // does not say so politely — the method is simply not there, and calling it
    // throws inside a click handler where nothing is listening.
    if (typeof insert !== "function") {
      setError("Nowhere to put it in a message you're reading — open a reply instead.");
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
   * The same intention, for a message you are reading: there is no draft to
   * insert into, so make one. Outlook opens its own reply window with the piece
   * already in it, above the quoted thread, exactly where a reply you typed
   * yourself would go.
   */
  function openReply(html: string, useSig: boolean, all: boolean) {
    const Office = window.Office;
    const item = Office?.context?.mailbox?.item;
    if (!Office || !item) return;
    // No font here on purpose: the reply window does not exist yet, so there is
    // nothing to match, and text with no font of its own takes the one the
    // person set for writing mail. That is the right answer.
    const withSig = toOutlookHtml(html, signatureFor(useSig));
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
  // Who else will read this. Shown because it is the fact behind the model no
  // longer offering to pass your note along to somebody who is copied on it.
  const onThread = (
    email?.composing ? [email.to, email.cc] : [target?.to, target?.cc]
  )
    .filter(Boolean)
    .join(", ");
  const typedWords = typed ? typed.split(/\s+/).filter(Boolean).length : 0;

  // What the collapsed Options row says it is set to, so nobody has to open it
  // to find out.
  const lengthLabel = lengthOptions.find((l) => l.key === length && l.key !== "as_is")?.label;
  const styleNames = styles.filter((s) => activeStyleIds.includes(s.id)).map((s) => s.name);
  const optionBits = [...tone, ...audience, lengthLabel, ...styleNames].filter(Boolean);
  const optionsSummary = optionBits.length ? optionBits.join(" · ") : "automatic";

  const fidelityChoices = (
    typed
      ? FIDELITY_OPTIONS
      : [
          ...FIDELITY_OPTIONS.filter((f) => f.key === "draft"),
          ...FIDELITY_OPTIONS.filter((f) => f.key !== "draft"),
        ]
  ).map((f) => ({ key: f.key, label: FIDELITY_LABELS[f.key] }));
  const fidelityBlurb = FIDELITY_OPTIONS.find((f) => f.key === effectiveFidelity)?.blurb;

  const buttonLabel = generating
    ? "Writing it…"
    : resultDoc
      ? "Write it again"
      : ownWords
        ? BUTTON_FOR[effectiveFidelity]
        : messages.length
          ? "Write the reply"
          : "Write it";

  // The three ways it can fail to sound like you, in one fold. Folded because
  // it is set up once and then forgotten, and on screen in both halves of the
  // pane because "I'd never say that" is a thought you have while reading what
  // came back, not while filling the form in.
  const soundsBits = [
    voiceCount ? "voice ✓" : "",
    swaps.length ? `${swaps.length} word${swaps.length === 1 ? "" : "s"}` : "",
    signature.trim() ? "sign-off ✓" : "",
  ].filter(Boolean);
  const outlookSignOff = outlookSignature.trim();

  const soundsLikeYou = (
    <details className="rounded-xl border border-border bg-surface">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 p-2">
        <span className="text-[11px] font-semibold text-ink">
          Make it sound like you <span className="font-normal text-muted">▾</span>
        </span>
        <span className="truncate text-[10px] text-muted">
          {soundsBits.length ? soundsBits.join(" · ") : "not set up"}
        </span>
      </summary>
      <div className="space-y-3 px-2 pb-2.5">
        {/* 1. The voice, learned from writing you have already done. */}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
            Your voice
          </p>
          {voiceCount > 0 && (
            <p className="mt-0.5 text-[11px] leading-snug text-ink">
              ✓ Learned from {voiceCount} {voiceCount === 1 ? "piece" : "pieces"} of your
              writing, and used on every reply.
            </p>
          )}
          {newSamples.length > 0 ? (
            <button
              type="button"
              onClick={() => void learnVoice()}
              disabled={learning}
              className="mt-1 w-full rounded-lg border border-[var(--accent)] px-2 py-1.5 text-[11px] font-semibold text-[var(--accent)] transition hover:bg-[var(--accent-soft)] disabled:opacity-50"
            >
              {learning
                ? "Reading how you write…"
                : voiceCount
                  ? `Add the ${newSamples.length} ${newSamples.length === 1 ? "message" : "messages"} you wrote here`
                  : `Learn from the ${newSamples.length} ${newSamples.length === 1 ? "message" : "messages"} you wrote in this thread`}
            </button>
          ) : (
            <p className="mt-0.5 text-[11px] leading-snug text-muted">
              {voiceCount
                ? "Nothing new here to learn from — open a thread you've replied on and I'll add those too."
                : "Open a thread you've replied on and I'll learn from the messages you wrote in it. No pasting."}
            </p>
          )}
          {learned && (
            <p className="mt-1 rounded-lg border border-emerald-300 bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700">
              {learned}
            </p>
          )}
        </div>

        {/* 2. The one word. */}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
            Words you&apos;d never use
          </p>
          {swaps.length > 0 && (
            <ul className="mt-1 flex flex-wrap gap-1">
              {swaps.map((w) => (
                <li
                  key={w.avoid}
                  className="flex items-center gap-1 rounded-full border border-border bg-canvas px-2 py-0.5 text-[10px]"
                >
                  <span className="text-muted line-through">{w.avoid}</span>
                  {w.prefer && <span className="font-medium text-ink">→ {w.prefer}</span>}
                  <button
                    type="button"
                    aria-label={`Stop swapping ${w.avoid}`}
                    onClick={() => void removeSwap(w.avoid)}
                    className="text-muted transition hover:text-ink"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-1 flex items-center gap-1">
            <input
              aria-label="Word to avoid"
              value={swapAvoid}
              onChange={(e) => setSwapAvoid(e.target.value)}
              placeholder="lovely"
              className="min-w-0 flex-1 rounded-md border border-border bg-canvas px-2 py-1 text-[11px] outline-none focus:border-[var(--accent)]"
            />
            <span className="shrink-0 text-[11px] text-muted">→</span>
            <input
              aria-label="Word to use instead"
              value={swapPrefer}
              onChange={(e) => setSwapPrefer(e.target.value)}
              placeholder="great"
              className="min-w-0 flex-1 rounded-md border border-border bg-canvas px-2 py-1 text-[11px] outline-none focus:border-[var(--accent)]"
            />
            <button
              type="button"
              onClick={() => void addSwap()}
              disabled={!swapAvoid.trim()}
              className="shrink-0 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted transition hover:text-ink disabled:opacity-40"
            >
              Add
            </button>
          </div>
          <p className="mt-0.5 text-[10px] leading-snug text-muted">
            A swap, not a ban. Telling a model to avoid a word puts the word in front
            of it and makes it more likely — giving it somewhere else to go works.
          </p>
        </div>

        {/* 3. The sign-off. */}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
            How you sign off
          </p>
          {signature.trim() ? (
            <>
              <p className="mt-0.5 whitespace-pre-wrap rounded-lg border border-border bg-canvas px-2 py-1 text-[11px] leading-snug text-ink">
                {signature.trim()}
              </p>
              <p className="mt-0.5 text-[10px] leading-snug text-muted">
                {signsOff
                  ? "Written as the last lines of the email, in your own font — not pasted on after it."
                  : "Added under every reply. Outlook won't be asked to add a second one."}
              </p>
            </>
          ) : (
            <p className="mt-0.5 text-[11px] leading-snug text-muted">
              Nothing saved, so replies end on the last sentence.
            </p>
          )}
          {/* Outlook already put the person's real sign-off in this draft. It is
              the one piece of evidence the pane has, and it costs one tap. */}
          {outlookSignOff && outlookSignOff !== signature.trim() && (
            <button
              type="button"
              onClick={() => void saveSignOff(outlookSignOff)}
              className="mt-1 w-full rounded-lg border border-[var(--accent)] px-2 py-1.5 text-left text-[11px] font-semibold text-[var(--accent)] transition hover:bg-[var(--accent-soft)]"
            >
              Use the one Outlook put in this message
              <span className="mt-0.5 block truncate font-normal text-muted">
                {outlookSignOff.replace(/\s*\n\s*/g, " · ").slice(0, 70)}
              </span>
            </button>
          )}
          <textarea
            aria-label="Your sign-off"
            value={signOffDraft}
            onChange={(e) => setSignOffDraft(e.target.value)}
            rows={2}
            placeholder={"Cheers,\nZak"}
            className="mt-1 w-full resize-none rounded-md border border-border bg-canvas px-2 py-1 text-[11px] leading-snug outline-none focus:border-[var(--accent)]"
          />
          <button
            type="button"
            onClick={() => void saveSignOff(signOffDraft)}
            disabled={!signOffDraft.trim()}
            className="mt-1 w-full rounded-lg border border-border px-2 py-1.5 text-[11px] font-medium text-muted transition hover:text-ink disabled:opacity-40"
          >
            {signOffSaved ? "Saved ✓" : signature.trim() ? "Replace it" : "Save it"}
          </button>
        </div>
      </div>
    </details>
  );

  // What the email says, and what the reply will be written against. First on
  // screen, because "has it actually read the email?" is the question every
  // other control depends on.
  const emailCard = email && (
    <section className="rounded-xl border border-border bg-surface p-2.5">
      {messages.length ? (
        <>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
            {email.composing ? "Replying to" : "From"}{" "}
            <span className="normal-case text-ink">{target?.from || "unknown sender"}</span>
          </p>
          <p className="mt-0.5 truncate text-xs font-medium">
            {target?.subject || email.subject || "(no subject)"}
          </p>
          <div className="mt-1.5 rounded-lg bg-canvas px-2 py-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--accent)]">
              Summary
            </p>
            {reading && !summary ? (
              <p className="mt-0.5 animate-pulse text-[11px] text-muted">Reading it…</p>
            ) : (
              <p
                className={`mt-0.5 text-[11px] leading-relaxed text-ink ${summary ? "" : "line-clamp-3"}`}
              >
                {summary || target?.body || "(that one has no text in it)"}
              </p>
            )}
          </div>
          {onThread && (
            <p className="mt-1 truncate text-[10px] text-muted">Also on it: {onThread}</p>
          )}

          {/* On a chain, how much of it to use. A real, pressable choice: the
              whole thread is the safe default; one message is quicker and
              keeps an old tangent out of the reply. */}
          {messages.length > 1 && (
            <div className="mt-2">
              <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
                Write from
              </p>
              <div className="grid grid-cols-2 gap-1" role="group" aria-label="Write from">
                {(
                  [
                    ["thread", `Whole thread (${messages.length})`],
                    ["one", "Just this message"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={scope === key}
                    onClick={() => setScope(key)}
                    className={`rounded-lg border px-2 py-1.5 text-[11px] font-medium transition ${
                      scope === key
                        ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                        : "border-border bg-canvas text-muted hover:text-ink"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <details className="mt-1.5">
            <summary className="cursor-pointer list-none text-[10px] font-medium text-[var(--accent)]">
              {messages.length > 1
                ? `Show the ${messages.length} messages · pick which to answer ▾`
                : "Show the whole email ▾"}
            </summary>
            <div className="mt-1 max-h-72 space-y-2 overflow-y-auto rounded-lg border border-border bg-canvas p-2">
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={
                    i === pick && messages.length > 1
                      ? "rounded-md border-l-2 border-[var(--accent)] pl-2"
                      : "pl-2 opacity-75"
                  }
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-[10px] font-semibold text-ink">
                      {m.from || "unknown sender"}
                      {m.sent ? ` · ${m.sent}` : ""}
                      {i === 0 && messages.length > 1 ? " · newest" : ""}
                    </p>
                    {messages.length > 1 &&
                      (i === pick ? (
                        <span className="shrink-0 text-[10px] font-semibold text-[var(--accent)]">
                          Answering
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setTargetIdx(i)}
                          className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted hover:text-ink"
                        >
                          Answer this one
                        </button>
                      ))}
                  </div>
                  <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-muted">
                    {m.body || "(no text)"}
                  </p>
                </div>
              ))}
            </div>
            <p className="mt-1 text-[10px] leading-snug text-muted">
              Signatures are left off — they never go to the AI.
            </p>
          </details>
        </>
      ) : (
        <>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">
            New message{email.to ? " to" : ""}{" "}
            {email.to && <span className="normal-case text-ink">{email.to}</span>}
          </p>
          <p className="mt-0.5 truncate text-xs font-medium">
            {email.subject || "(no subject yet)"}
          </p>
        </>
      )}
    </section>
  );

  // The intake: the email, the one box, and the button. Rendered on its own
  // before anything has been written, and again — folded away — underneath what
  // was written, so the thing you wrote from is always one click away.
  const intake = email && (
    <>
      {emailCard}

      <div>
        <label className="mb-1 flex items-baseline gap-1.5 text-sm font-semibold text-ink">
          What do you want to say?
          <span className="rounded-full bg-canvas px-1.5 py-px text-[10px] font-medium text-muted">
            optional
          </span>
        </label>

        {/* A draft already started in Outlook is used as the draft. Said here,
            beside the box, so it is obvious the box is for what to DO with it —
            and shown read-only, never loaded into the box. */}
        {typed && (
          <details className="mb-1.5 rounded-lg border border-[var(--accent)] bg-[var(--accent-soft)] px-2 py-1.5">
            <summary className="cursor-pointer list-none text-[11px] font-medium text-[var(--accent)]">
              ✓ Using the draft you started in Outlook ({typedWords}{" "}
              {typedWords === 1 ? "word" : "words"}) ▾
            </summary>
            <p className="mt-1 whitespace-pre-wrap text-[11px] leading-relaxed text-ink">
              {typed}
            </p>
            <p className="mt-1 text-[10px] leading-snug text-muted">
              Your signature and the thread below it are left off. Keep typing in
              Outlook if you like — I read it again when you press the button.
            </p>
          </details>
        )}

        <RichText
          dense
          autoFocus={!resultDoc}
          value={draftHtml}
          onChange={setDraftHtml}
          placeholder={
            typed
              ? "e.g. “make it longer” or “warmer” — or leave empty"
              : messages.length
                ? "Leave empty and I'll write the reply. Or give me the gist — “yes to the 21st, ask if Glenn should come”."
                : "What's it about? A few notes is plenty."
          }
          minHeight="min-h-20"
        />
        <p className="mt-0.5 text-[10px] leading-snug text-muted">
          {typed
            ? boxText
              ? "I'll apply this to your draft."
              : "Empty is fine — I'll work on your draft as it is."
            : boxText
              ? "Notes or your own wording — both work."
              : messages.length
                ? "Empty is fine — I'll write the whole reply from the email."
                : "Nothing to reply to here, so tell me what it's about."}
        </p>
      </div>

      {/* Only once there are words of yours. Before that there is nothing to
          "just fix" — the piece is written fresh, and asking would only be a
          question with one sensible answer. */}
      {ownWords && (
        <div>
          <ChipGroup
            dense
            label={typed ? "How much should I change your draft?" : "What should I do with that?"}
            options={fidelityChoices}
            selected={[effectiveFidelity]}
            single
            onToggle={(k) => setFidelity(k as Fidelity)}
          />
          {fidelityBlurb && (
            <p className="mt-0.5 text-[10px] leading-snug text-muted">{fidelityBlurb}</p>
          )}
        </div>
      )}

      {/* Everything else the workspace would ask, one tap away and filled in
          from the email. Folded, because most replies need none of it. */}
      <details className="rounded-xl border border-border bg-surface">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 p-2">
          <span className="text-[11px] font-semibold text-ink">
            Options <span className="font-normal text-muted">▾</span>
          </span>
          <span className="truncate text-[10px] text-muted">
            {reading
              ? "reading the email…"
              : autoFilled.length && optionBits.length
                ? `${optionsSummary} · my guess`
                : optionsSummary}
          </span>
        </summary>
        <div className="space-y-1.5 px-2 pb-2">
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
              setAudience((p) => (p.includes(k) ? p.filter((a) => a !== k) : [...p, k]))
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
              selected={activeStyleIds}
              hue="teal"
              onToggle={toggleStyle}
            />
          )}
          <div>
            <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
              Anything else I should know?
            </p>
            <RichText
              dense
              value={briefHtml}
              onChange={setBriefHtml}
              placeholder="Background, what's at stake, anything to avoid…"
              minHeight="min-h-12"
            />
          </div>
          {autoFilled.length > 0 && (
            <p className="text-[10px] leading-snug text-[var(--accent)]">
              I guessed the {autoFilled.join(", ")} from the email — tap to change.
            </p>
          )}
        </div>
      </details>

      {/* Only on the intake proper. When there is a result, this same intake is
          rendered folded away underneath it and the real copy sits up there,
          next to the words that prompted the thought. */}
      {!resultDoc && soundsLikeYou}

      <button
        onClick={writeReply}
        disabled={generating || !hasIntake}
        className="w-full rounded-lg bg-[var(--accent)] px-3 py-2.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
      >
        {buttonLabel}
      </button>
      {!hasIntake && (
        <p className="text-[11px] leading-snug text-muted">
          There&apos;s nothing to write from yet — say what it&apos;s about above.
        </p>
      )}
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
              Omni · Writing Studio
            </p>
            <h1 className="text-base font-semibold">
              {!email
                ? "Writing Studio"
                : email.composing
                  ? typed
                    ? "Your draft"
                    : messages.length
                      ? "Write your reply"
                      : "New message"
                  : "Write a reply"}
            </h1>
          </div>
          {/* The pane stays signed in on its own, so it needs a way out that
              means it: this also revokes the saved sign-in, where a plain
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
                its own WebView with its own cookies. ?next= brings the panel
                back here afterwards — a 400px panel with no address bar has no
                other way back. */}
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

        {/* Both jobs, always, whichever button opened this. A guess about read
            vs compose once left a list of old pieces and no box to type in, so
            it now only changes the wording. */}
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
                        ? "Outlook opens its own reply window with this already in it, above the quoted thread. Nothing is sent until you send it."
                        : typed
                          ? "Select your draft in the message first and this replaces it. Otherwise it lands wherever the cursor is."
                          : `It lands wherever the cursor is, in the font your message is already using${
                              signatureFor(true) ? ", with your signature" : ""
                            }.`}
                    </p>

                    {/* Right under what it wrote, because "I would never say
                        that" is a thought you have while reading it. */}
                    {soundsLikeYou}

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
                    one. It arrives in the font your message is already using.
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
