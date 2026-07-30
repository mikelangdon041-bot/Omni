"use client";

// The Writing Studio workspace: one box you drop anything into — a rough draft,
// an email to answer, or just what you want — plus an optional "anything else"
// note. Guided options fold into collapsible sections below, and the living
// output sits on the right: generate, refine with new guidance, flip through
// versions, see what changed, copy or send.

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  FileText,
  History,
  Image as ImageIcon,
  ListChecks,
  Mail,
  Palette,
  Paperclip,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import { BackButton } from "@/components/BackButton";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { RichText, RichTextView } from "@/components/ui/RichText";
import { AutoRichField } from "@/components/ui/AutoRichField";
import { ProgressBar, useProgress } from "@/components/ui/Progress";
import { WriterChat } from "@/components/writer/WriterChat";
import { toEmailHtml } from "@/lib/writer/clipboard";
import { wantsResearch } from "@/lib/writer/prompt";
import { useConfirm, useToast } from "@/components/ui/Feedback";
import { ChipGroup } from "@/components/writer/Chips";
import { IntakeSection } from "@/components/writer/IntakeSection";
import { diffHighlightHtml } from "@/lib/writer/diff";
import {
  useUserId,
  useWriterDoc,
  useWriterSettings,
  useWriterStyles,
} from "@/lib/writer/hooks";
import {
  ACTION_CHIPS,
  AUDIENCE_CHIPS,
  FIDELITY_OPTIONS,
  LENGTHS,
  TONE_CHIPS,
  emptyContext,
  type WriterAttachment,
  chipOptions,
  cleanTag,
  docTypeEmoji,
  docTypeLabel,
  htmlToPlain,
  type WriterContext,
  type WriterDoc,
  type WriterVersion,
} from "@/lib/writer/types";

// Field names as the person reading them would say them.
const AUTOFILL_LABELS: Record<string, string> = {
  recipient: "who it's to",
  ask: "what should happen",
  keyPoints: "key points",
  background: "background",
  tone: "tone",
  audience: "audience",
  actions: "what to change",
  length: "length",
  fidelity: "how much to change",
  noGreeting: "skip the greeting",
  research: "look it up",
};

/** Reset every field that was auto-filled, leaving anything you set yourself. */
function clearAutoFilled(ctx: WriterContext): Partial<WriterContext> {
  const blank = emptyContext() as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = { autoFilled: [] };
  for (const field of ctx.autoFilled) {
    if (field in blank && field !== "autoFilled") out[field] = blank[field];
  }
  return out as Partial<WriterContext>;
}

export default function WriterDocPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const { userId } = useUserId();
  const { settings, save: saveSettings } = useWriterSettings(userId);
  const { doc, versions, loading, save, flush, addVersion, remove } = useWriterDoc(
    id,
    userId,
    settings?.version_retention_days,
  );
  const { styles } = useWriterStyles(userId);

  const [busy, setBusy] = useState(false);
  const [researching, setResearching] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [editingSig, setEditingSig] = useState(false);
  // Refine dials: the same chips as the intake, but pointed at the version
  // that came out rather than at the draft that went in.
  const [refineActions, setRefineActions] = useState<string[]>([]);
  const [refineTone, setRefineTone] = useState<string[]>([]);
  const [refineLength, setRefineLength] = useState("as_is");

  // Nothing here reports real progress (the AI calls return in one shot), so the
  // bars are time-based estimates. Writing takes longer than a look-up, and a
  // look-up runs several searches, so they get different expectations.
  const writeProgress = useProgress(busy, 25000);
  const researchProgress = useProgress(researching, 30000);
  const uploadProgress = useProgress(uploading, 12000);
  const [tagDraft, setTagDraft] = useState("");
  const [guidance, setGuidance] = useState("");
  const [variantResults, setVariantResults] = useState<
    { subject: string; html: string }[]
  >([]);
  const [activeVariant, setActiveVariant] = useState(0);
  const [showVersions, setShowVersions] = useState(false);
  const [showDiff, setShowDiff] = useState<boolean | null>(null);
  const [copied, setCopied] = useState(false);
  const [extractNote, setExtractNote] = useState<"idle" | "working" | string>("idle");

  // Latest doc for use inside debounced callbacks without re-arming them.
  const docRef = useRef<WriterDoc | null>(null);
  docRef.current = doc;
  const lastExtracted = useRef("");
  const extractInit = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // The search-ready question extraction worked out of the brief, used when the
  // look-up runs. Kept in a ref: it is derived, not something you edit.
  const researchQuestion = useRef("");
  // Object URLs for images attached in this session, so an attachment can be
  // opened and eyeballed. Not persisted: after a reload the transcription is
  // what remains, which is the part the AI actually uses.
  const previewUrls = useRef<Record<string, string>>({});
  // The preview URL is resolved when the attachment is opened, not while
  // rendering: reading a ref during render is the kind of thing that works right
  // up until it doesn't.
  const [openAttachment, setOpenAttachment] = useState<{
    att: WriterAttachment;
    preview?: string;
  } | null>(null);

  // What you typed in the one box, plus the optional extra note. Everything —
  // extraction, generation, the diff — reads from these two.
  const inputPlain = doc ? htmlToPlain(doc.original) : "";
  const notesPlain = doc ? htmlToPlain(doc.context.brief) : "";
  const intakePlain = [inputPlain, notesPlain].filter(Boolean).join("\n\n");

  // Don't re-extract intake that was already there when the page opened.
  useEffect(() => {
    if (doc && !extractInit.current) {
      extractInit.current = true;
      lastExtracted.current = [
        htmlToPlain(doc.original),
        htmlToPlain(doc.context.brief),
      ]
        .filter(Boolean)
        .join("\n\n");
    }
  }, [doc]);

  const isEmail = doc?.doc_type === "email";
  const diffOn =
    (showDiff ?? settings?.show_diff ?? true) && !!doc && !!doc.content.trim();
  // Diff baseline: the previous version once there is one (so refines show what
  // the refine changed), else what you pasted — but only when that was
  // substantial enough to have been a draft. Diffing a polished piece against a
  // one-line description would just highlight the whole thing as new.
  const diffBase = useMemo(() => {
    if (!doc) return "";
    const prev = versions.find((v) => htmlToPlain(v.content) !== htmlToPlain(doc.content));
    if (prev) return htmlToPlain(prev.content);
    const pasted = htmlToPlain(doc.original);
    return pasted.split(/\s+/).filter(Boolean).length >= 25 ? pasted : "";
  }, [doc, versions]);

  // Auto-extract: once you've typed something real and paused, read both boxes
  // and fill in the intake — recipient, goal, key points, tone, and the chips
  // for what you asked for (grammar, length, edit level, greeting). Only ever
  // fills what you left alone. The floor is low because a note as short as
  // "no hi, cut it down" is already a full instruction.
  useEffect(() => {
    if (!doc || busy) return;
    if (intakePlain.length < 35 || intakePlain === lastExtracted.current) return;
    const timer = setTimeout(async () => {
      const d = docRef.current;
      if (!d) return;
      lastExtracted.current = intakePlain;
      setExtractNote("working");
      try {
        const res = await fetch("/api/writer/ai", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            action: "extract",
            docType: d.doc_type,
            brief: intakePlain,
          }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Extract failed");
        const ex = json.extracted || {};
        const cur = docRef.current;
        if (!cur) return;
        const partial: Partial<WriterContext> = {};
        const filled: string[] = [];
        if (!cur.context.recipient.trim() && ex.recipient) {
          partial.recipient = String(ex.recipient);
          filled.push("recipient");
        }
        if (!cur.context.ask.trim() && ex.ask) {
          partial.ask = String(ex.ask);
          filled.push("goal");
        }
        if (!cur.context.keyPoints.trim() && ex.keyPoints) {
          partial.keyPoints = String(ex.keyPoints);
          filled.push("key points");
        }
        if (!cur.context.background.trim() && ex.background) {
          partial.background = String(ex.background);
          filled.push("background");
        }
        if (!cur.context.tone.length && Array.isArray(ex.tone) && ex.tone.length) {
          partial.tone = ex.tone.filter((t: string) => TONE_CHIPS.includes(t));
          if (partial.tone!.length) filled.push("tone");
          else delete partial.tone;
        }
        if (
          !cur.context.audience.length &&
          Array.isArray(ex.audience) &&
          ex.audience.length
        ) {
          partial.audience = ex.audience.filter((a: string) =>
            AUDIENCE_CHIPS.includes(a),
          );
          if (partial.audience!.length) filled.push("audience");
          else delete partial.audience;
        }
        // The note is meant to be enough on its own, so what you asked for in
        // prose also flips the switches it maps to. Only ever fills what you
        // left alone, and every change is named in the banner so nothing moves
        // behind your back.
        if (!cur.context.actions.length && Array.isArray(ex.actions) && ex.actions.length) {
          partial.actions = ex.actions.filter((a: string) => ACTION_CHIPS.includes(a));
          if (partial.actions!.length) filled.push("what matters");
          else delete partial.actions;
        }
        if (
          cur.context.length === "as_is" &&
          ex.length &&
          ex.length !== "as_is" &&
          LENGTHS.some((l) => l.key === ex.length)
        ) {
          partial.length = String(ex.length);
          filled.push("length");
        }
        if (
          cur.context.fidelity === "light" &&
          ex.fidelity &&
          ex.fidelity !== "light" &&
          FIDELITY_OPTIONS.some((f) => f.key === ex.fidelity)
        ) {
          partial.fidelity = ex.fidelity as WriterContext["fidelity"];
          filled.push(
            FIDELITY_OPTIONS.find((f) => f.key === ex.fidelity)!.label.replace(/^\S+\s/, ""),
          );
        }
        if (!cur.context.noGreeting && ex.noGreeting === true) {
          partial.noGreeting = true;
          filled.push("no greeting");
        }
        // "Find out how others are doing this" is a request the writer can now
        // actually honour, so asking for it in the note turns the look-up on.
        if (!cur.context.research && ex.research === true) {
          partial.research = true;
          filled.push("look it up");
        }
        if (ex.researchQuestion && !researchQuestion.current)
          researchQuestion.current = String(ex.researchQuestion);
        const docPartial: Partial<WriterDoc> = {};
        if (Object.keys(partial).length) {
          // Flag every field the AI guessed at, so the picks read as "I filled
          // this in, check it" rather than as something you chose.
          partial.autoFilled = [
            ...new Set([...cur.context.autoFilled, ...Object.keys(partial)]),
          ].filter((k) => k !== "autoFilled");
          docPartial.context = { ...cur.context, ...partial };
        }
        if (!cur.title.trim() && ex.title) {
          docPartial.title = String(ex.title);
          filled.push("title");
        }
        if (Object.keys(docPartial).length) save(docPartial);
        setExtractNote(filled.length ? `Auto-filled: ${filled.join(", ")}` : "idle");
      } catch {
        setExtractNote("idle");
      }
    }, 2200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intakePlain, busy]);

  if (loading) return <p className="py-16 text-center text-sm text-muted">Loading…</p>;
  if (!doc)
    return (
      <div className="py-16 text-center">
        <p className="text-sm text-muted">This piece was deleted.</p>
        <div className="mt-3 flex justify-center">
          <BackButton label="Back to Writing Studio" />
        </div>
      </div>
    );

  const ctx = doc.context;
  const setCtx = (partial: Partial<WriterContext>) =>
    save({ context: { ...ctx, ...partial } });

  const toggle = (field: "actions" | "tone" | "audience" | "styleIds") => (key: string) => {
    const cur = ctx[field];
    setCtx({
      [field]: cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key],
    } as Partial<WriterContext>);
  };

  function deriveTitle(subject: string, html: string): string {
    if (subject.trim()) return subject.trim();
    const words = htmlToPlain(html).split(/\s+/).slice(0, 8).join(" ");
    return words || "Untitled";
  }

  // Emails carry the saved signature unless this piece opts out.
  const signatureOn = isEmail && ctx.useSignature && !!settings?.signature?.trim();

  // Has the version on screen been edited by hand since it was generated? If so,
  // Regenerate is almost certainly not what's wanted: it writes afresh from the
  // draft box, which means those edits are not an input and are replaced.
  const outputEdited =
    !!doc.content.trim() &&
    versions.length > 0 &&
    !versions.some((v) => htmlToPlain(v.content) === htmlToPlain(doc.content));

  // Refine can run on chips alone, with no typed instruction.
  const refineHasPicks =
    refineActions.length > 0 || refineTone.length > 0 || refineLength !== "as_is";
  const refinePicksSummary = [
    refineActions.length && refineActions.join("; "),
    refineTone.length && `tone: ${refineTone.join("; ")}`,
    refineLength !== "as_is" && `make it ${refineLength.replace("_", " ")}`,
  ]
    .filter(Boolean)
    .join(". ");
  // Anything that can open with "Hi Sarah," can be told not to. Only a
  // summary/abstract has no salutation to skip in the first place.
  const canGreet = doc.doc_type !== "summary";

  const hasIntake =
    !!inputPlain.trim() ||
    !!notesPlain.trim() ||
    !!ctx.ask.trim() ||
    !!ctx.keyPoints.trim() ||
    !!htmlToPlain(ctx.background).trim();

  // Get a document, PDF, or screenshot into the box. Uploading is one route in;
  // pasting a screenshot straight from the clipboard or dropping a file onto
  // the box are the same call, which is how most of these actually arrive.
  async function ingestFiles(files: File[]) {
    if (!doc || !files.length) return;
    setUploading(true);
    // Accumulated locally rather than re-read from the doc each pass: with two
    // files in flight the second read could land before React had re-rendered
    // the first one in, and quietly drop it.
    let list = [...(docRef.current?.context.attachments || [])];
    try {
      for (const file of files) {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/writer/ingest", {
          method: "POST",
          credentials: "same-origin",
          body: form,
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Could not read that file");
        const current = docRef.current;
        if (!current) return;
        const isImage = (file.type || "").startsWith("image/");
        const attachment: WriterAttachment = {
          id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          name: file.name || (isImage ? "Screenshot" : "Attachment"),
          kind: isImage ? "image" : "document",
          text: htmlToPlain(String(json.html || "")),
        };
        // The picture itself is only held for this session, so "open it" can
        // show the original as well as the transcription. Nothing to clean up
        // on the server, and nothing bloating the saved row.
        if (isImage) previewUrls.current[attachment.id] = URL.createObjectURL(file);
        list = [...list, attachment];
        save({ context: { ...current.context, attachments: list } });
        toast("success", `Attached ${attachment.name}`);
      }
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  function addTag() {
    const t = cleanTag(tagDraft);
    setTagDraft("");
    if (!t || !doc || doc.tags.includes(t)) return;
    save({ tags: [...doc.tags, t] });
  }

  async function discard() {
    if (
      !(await confirm({
        title: "Discard this piece?",
        message: "It won't be saved — the draft and every version go away.",
        confirmLabel: "Discard",
        danger: true,
      }))
    )
      return;
    await remove();
    router.replace("/writing-studio");
  }

  /**
   * Keep whatever is currently in the output pane as a restorable version, but
   * only when it isn't already saved as one. That covers the case the version
   * list otherwise loses: you edit the AI's text by hand, then regenerate or
   * restore something older, and your edits are gone with nothing to go back to.
   */
  async function snapshotCurrent(label: string) {
    const current = docRef.current;
    if (!current?.content.trim()) return;
    const plain = htmlToPlain(current.content);
    if (versions.some((v) => htmlToPlain(v.content) === plain)) return;
    await addVersion({
      doc_id: current.id,
      content: current.content,
      subject: current.subject,
      instructions: label,
      variant_label: "",
    });
  }

  // Go and look it up. Returns the findings so generate can use them on the same
  // click, and saves them so they're visible and removable afterwards.
  async function runResearch(): Promise<string> {
    const current = docRef.current;
    if (!current) return "";
    const question =
      researchQuestion.current.trim() ||
      [notesPlain, inputPlain].filter(Boolean).join("\n\n").slice(0, 2000);
    if (!question.trim()) return "";
    setResearching(true);
    try {
      const res = await fetch("/api/writer/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          action: "research",
          docType: current.doc_type,
          question,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Could not look that up");
      const notes = String(json.notes || "");
      const latest = docRef.current;
      if (latest) save({ context: { ...latest.context, researchNotes: notes } });
      toast("success", "Looked it up");
      return notes;
    } catch (e) {
      toast("error", (e as Error).message);
      return "";
    } finally {
      setResearching(false);
    }
  }

  async function generate(refineGuidance?: string) {
    if (!doc) return;
    // Anything already on screen goes to history first, refine or regenerate
    // alike. Regenerate writes from the draft, so hand edits made in the output
    // pane are not an input to it — but they must never be lost to it either.
    await snapshotCurrent(
      refineGuidance ? "Your version before this refine" : "Your version before regenerating",
    );
    // Look things up before writing, so the findings are available as fact.
    // Asking for it in the note counts as asking for it: the checkbox is a
    // convenience, not the only way in, and waiting for extraction to tick it
    // would lose the request if Generate is pressed straight after typing.
    const askedInWords = wantsResearch(`${notesPlain}\n${inputPlain}`);
    const researchNotes =
      (ctx.research || askedInWords) && !ctx.researchNotes.trim() && !refineGuidance
        ? await runResearch()
        : ctx.researchNotes;
    setBusy(true);
    try {
      await flush();
      // Read the doc as it stands right now, not as it was when this click was
      // wired up. Snapshotting and looking things up both take time, and typing
      // during either would otherwise be written out of the request.
      const cur = docRef.current || doc;
      const curCtx = cur.context;
      const inputNow = htmlToPlain(cur.original);
      const notesNow = htmlToPlain(curCtx.brief);
      const styleTexts = styles
        .filter((s) => curCtx.styleIds.includes(s.id))
        .map((s) => ({
          name: s.name,
          text: s.kind === "voice" ? s.voice_profile : s.rules,
        }));
      const refining = !!refineGuidance && !!cur.content.trim();
      const res = await fetch("/api/writer/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          action: "generate",
          docType: cur.doc_type,
          original: inputNow,
          previous: refining ? cur.content : "",
          guidance: refineGuidance || "",
          fidelity: curCtx.fidelity,
          noGreeting: curCtx.noGreeting,
          context: {
            ...curCtx,
            brief: notesNow,
            background: htmlToPlain(curCtx.background),
            researchNotes,
            // On a refine, the chips in the refine panel are what the user is
            // asking for now; the intake's chips described the original draft.
            ...(refining
              ? {
                  actions: refineActions,
                  tone: refineTone.length ? refineTone : curCtx.tone,
                  length: refineLength,
                }
              : {}),
          },
          styles: styleTexts,
          signature: signatureOn ? htmlToPlain(settings?.signature || "") : "",
          variants: refining ? 1 : settings?.variant_count ?? 1,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Generation failed");
      const results: { subject: string; html: string }[] = json.variants;

      const letters = ["A", "B", "C", "D"];
      for (let i = 0; i < results.length; i++) {
        await addVersion({
          doc_id: doc.id,
          content: results[i].html,
          subject: results[i].subject,
          instructions: refineGuidance || "Generated from intake",
          variant_label: results.length > 1 ? letters[i] : "",
        });
      }
      setVariantResults(results);
      setActiveVariant(0);
      const first = results[0];
      save({
        content: first.html,
        subject: isEmail ? first.subject || doc.subject : doc.subject,
        title: doc.title || deriveTitle(first.subject, first.html),
      });
      setGuidance("");
    } catch (e) {
      toast("error", (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function pickVariant(i: number) {
    const v = variantResults[i];
    if (!v || !doc) return;
    setActiveVariant(i);
    save({
      content: v.html,
      subject: isEmail ? v.subject || doc.subject : doc.subject,
    });
  }

  async function restoreVersion(v: WriterVersion) {
    // Bank what's on screen before replacing it, so restoring is never a
    // one-way door.
    await snapshotCurrent("Your version before restoring");
    save({ content: v.content, subject: v.subject || doc?.subject || "" });
    setVariantResults([]);
    setShowVersions(false);
    toast("success", "Version restored — the one you had is saved too");
  }

  async function copyOut() {
    if (!doc) return;
    // Paragraph spacing has to be inline for Outlook and Gmail to keep it, and
    // the plain-text flavor needs real blank lines between paragraphs.
    const html = toEmailHtml(doc.content, signatureOn ? settings!.signature : "");
    const plain =
      htmlToPlain(doc.content) +
      (signatureOn ? `\n\n${htmlToPlain(settings!.signature)}` : "");
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([plain], { type: "text/plain" }),
        }),
      ]);
    } catch {
      await navigator.clipboard.writeText(plain);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function openInEmail() {
    if (!doc) return;
    const body =
      htmlToPlain(doc.content) +
      (signatureOn ? `\n\n${htmlToPlain(settings!.signature)}` : "");
    window.location.href = `mailto:?subject=${encodeURIComponent(doc.subject)}&body=${encodeURIComponent(body)}`;
  }

  const selectedStyleCount = ctx.styleIds.filter((sid) =>
    styles.some((s) => s.id === sid),
  ).length;
  const toneStyleCount =
    ctx.actions.length + ctx.tone.length + ctx.audience.length + (ctx.length !== "as_is" ? 1 : 0);
  const detailCount = [ctx.recipient, ctx.ask, ctx.keyPoints, htmlToPlain(ctx.background)]
    .filter((v) => v.trim()).length;

  return (
    <>
      <div className="mb-4 flex items-center gap-3">
        <BackButton label="Writing Studio" />
        <span className="rounded-full bg-gradient-to-r from-[var(--grad-from)] to-[var(--grad-to)] px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white shadow-sm">
          {docTypeEmoji(doc.doc_type)} {docTypeLabel(doc.doc_type)}
        </span>
        <span className="hidden text-xs text-muted sm:inline">
          Saves as you type
        </span>
        <span className="flex-1" />
        <button
          onClick={discard}
          className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-muted transition hover:border-red-300 hover:text-red-600"
        >
          <Trash2 size={13} /> Discard
        </button>
      </div>

      {/* Even-ish split: the intake box is where the work happens before there
          is any output, so it gets close to half the width rather than a
          narrow rail against a mostly-empty result pane. */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        {/* ---------------- Intake ---------------- */}
        <div className="space-y-3">
          {/* Anything the AI guessed from your note waits for a nod here. It
              still applies if you ignore it, but it never looks like a choice
              you made — which is how a fresh piece ends up feeling as though it
              remembered settings from the last one. */}
          {ctx.autoFilled.length > 0 && (
            <section className="rounded-xl border border-amber-300 bg-amber-50/70 p-3">
              <p className="text-xs font-semibold text-amber-900">
                I filled these in from what you wrote — worth a check
              </p>
              <p className="mt-0.5 text-[11px] leading-snug text-amber-800">
                {ctx.autoFilled.map((f) => AUTOFILL_LABELS[f] || f).join(", ")}
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setCtx({ autoFilled: [] })}
                  className="rounded-lg bg-amber-900 px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-amber-800"
                >
                  Looks right
                </button>
                <button
                  type="button"
                  onClick={() => setCtx(clearAutoFilled(ctx))}
                  className="rounded-lg border border-amber-300 px-2.5 py-1 text-[11px] font-medium text-amber-900 transition hover:bg-amber-100"
                >
                  Clear them
                </button>
              </div>
            </section>
          )}
          {/* The brief — the one box that does the work */}
          <section className="overflow-hidden rounded-xl border border-[var(--accent)]/40 bg-surface shadow-sm">
            <div className="h-1 bg-gradient-to-r from-[var(--grad-from)] via-[var(--grad-via)] to-[var(--grad-to)]" />
            <div className="space-y-3 p-3.5">
              <Input
                label="Title (optional)"
                value={doc.title}
                onChange={(e) => save({ title: e.target.value })}
                placeholder="Leave it — it names itself when you generate"
              />

              {/* Tags: how you find this again once the library fills up. */}
              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
                  Tags{" "}
                  <span className="font-normal normal-case">
                    (optional — for finding it later)
                  </span>
                </p>
                <div className="flex flex-wrap items-center gap-1.5">
                  {doc.tags.map((t) => (
                    <span
                      key={t}
                      className="flex items-center gap-1 rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[11px] font-medium text-[var(--accent)]"
                    >
                      🏷️ {t}
                      <button
                        type="button"
                        onClick={() => save({ tags: doc.tags.filter((x) => x !== t) })}
                        className="opacity-60 transition hover:opacity-100"
                      >
                        <X size={11} />
                      </button>
                    </span>
                  ))}
                  <input
                    value={tagDraft}
                    onChange={(e) => setTagDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === ",") {
                        e.preventDefault();
                        addTag();
                      }
                    }}
                    onBlur={addTag}
                    placeholder={doc.tags.length ? "Add another…" : "e.g. Q3 launch"}
                    className="min-w-28 flex-1 rounded-lg border border-border bg-surface px-2 py-1 text-xs outline-none transition focus:border-[var(--accent)]"
                  />
                </div>
              </div>

              {/* The one box that does the work. */}
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--accent)]">
                    <Sparkles size={12} /> Draft
                  </span>
                  {extractNote !== "idle" && (
                    <span className="text-[11px] text-muted">
                      {extractNote === "working" ? "Reading it…" : extractNote}
                    </span>
                  )}
                </div>
                <p className="mb-1.5 text-[11px] leading-snug text-muted">
                  Put whatever you have in here and nothing else is needed. A rough
                  draft to clean up, an email you need to answer, or a sentence
                  saying what you want — I&apos;ll work out which it is.
                </p>
                <RichText
                  value={doc.original}
                  onChange={(html) => save({ original: html })}
                  onFiles={(files) => void ingestFiles(files)}
                  placeholder={
                    'e.g. paste an email and add "reply pushing the meeting to next week" — or write your own rough version and I\'ll tidy it up.'
                  }
                  minHeight="min-h-40"
                />
                <div className="mt-1.5 flex items-center gap-2">
                  <input
                    ref={fileRef}
                    type="file"
                    multiple
                    className="hidden"
                    accept=".pdf,.docx,.doc,.txt,.md,.csv,.png,.jpg,.jpeg,.gif,.webp"
                    onChange={(e) => {
                      const files = Array.from(e.target.files || []);
                      e.target.value = "";
                      if (files.length) void ingestFiles(files);
                    }}
                  />
                  <button
                    type="button"
                    disabled={uploading}
                    onClick={() => fileRef.current?.click()}
                    className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-medium text-muted transition hover:border-[var(--accent)]/50 hover:text-ink disabled:opacity-60"
                  >
                    <Paperclip size={12} />
                    {uploading ? "Reading…" : "Upload a file"}
                  </button>
                  <span className="text-[10px] leading-snug text-muted">
                    Or paste a screenshot straight in, or drop a file on the box.
                    It gets attached and read, not pasted into your text.
                  </span>
                </div>

                {/* Attachments. Files stay out of the writing box on purpose: a
                    transcribed screenshot dropped inline is a wall of text you
                    then have to type around, and an image dropped inline can't
                    be typed past at all. */}
                {ctx.attachments.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {ctx.attachments.map((att) => (
                      <span
                        key={att.id}
                        className="flex items-center gap-1.5 rounded-lg border border-border bg-canvas py-1 pl-2 pr-1 text-[11px]"
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setOpenAttachment({
                              att,
                              preview: previewUrls.current[att.id],
                            })
                          }
                          title="Open to check what I read"
                          className="flex items-center gap-1.5 font-medium text-ink transition hover:text-[var(--accent)]"
                        >
                          {att.kind === "image" ? (
                            <ImageIcon size={12} className="text-[var(--accent)]" />
                          ) : (
                            <FileText size={12} className="text-[var(--accent)]" />
                          )}
                          <span className="max-w-40 truncate">{att.name}</span>
                        </button>
                        <button
                          type="button"
                          title="Remove"
                          onClick={() =>
                            setCtx({
                              attachments: ctx.attachments.filter((a) => a.id !== att.id),
                            })
                          }
                          className="rounded p-0.5 text-muted transition hover:text-red-600"
                        >
                          <X size={11} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
                  Anything else I should know?{" "}
                  <span className="font-normal normal-case">
                    (optional — this is treated as an instruction, so
                    &ldquo;just fix the grammar and cut it down&rdquo; is enough
                    on its own)
                  </span>
                </p>
                <RichText
                  value={ctx.brief}
                  onChange={(html) => setCtx({ brief: html })}
                  // A screenshot pasted here means the same thing as one pasted
                  // into the draft box: attach it and read it.
                  onFiles={(files) => void ingestFiles(files)}
                  placeholder="Who it's for, what's at stake, what to change, anything to avoid…"
                  minHeight="min-h-20"
                />
              </div>

              {/* The dial that decides whether you get your draft back or
                  somebody else's. It lives here, in the main box, because
                  everything else on this page is optional and this isn't. */}
              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
                  How much should I change?
                </p>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                  {FIDELITY_OPTIONS.map((f) => {
                    const on = ctx.fidelity === f.key;
                    return (
                      <button
                        key={f.key}
                        type="button"
                        onClick={() => setCtx({ fidelity: f.key })}
                        className={`rounded-lg border px-2 py-1.5 text-xs font-semibold transition ${
                          on
                            ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)] shadow-sm"
                            : "border-border bg-surface text-muted hover:border-[var(--accent)]/50 hover:text-ink"
                        }`}
                      >
                        {f.label}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-1 text-[11px] leading-snug text-muted">
                  {FIDELITY_OPTIONS.find((f) => f.key === ctx.fidelity)?.blurb}
                </p>
              </div>

              {/* Look-ups. The AI has no facts of its own it's allowed to use,
                  so "find out how others do this" needs a real search. */}
              <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-border px-2.5 py-2 text-xs text-ink transition hover:border-[var(--accent)]/50">
                <input
                  type="checkbox"
                  checked={ctx.research}
                  onChange={(e) => setCtx({ research: e.target.checked })}
                  className="mt-0.5 h-3.5 w-3.5 accent-[var(--accent)]"
                />
                <span>
                  🔎 Look it up first
                  <span className="ml-1 text-muted">
                    (searches the web and uses what it finds, with sources — for
                    &ldquo;how are others doing this&rdquo; or &ldquo;what&apos;s
                    the current guidance&rdquo;)
                  </span>
                </span>
              </label>

              {canGreet && (
                <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-2.5 py-2 text-xs text-ink transition hover:border-[var(--accent)]/50">
                  <input
                    type="checkbox"
                    checked={ctx.noGreeting}
                    onChange={(e) => setCtx({ noGreeting: e.target.checked })}
                    className="h-3.5 w-3.5 accent-[var(--accent)]"
                  />
                  <span>
                    Skip the greeting
                    <span className="ml-1 text-muted">
                      (no &ldquo;Hi Sarah,&rdquo; — start on the first sentence)
                    </span>
                  </span>
                </label>
              )}

              <Button
                className="w-full !bg-gradient-to-r !from-[var(--grad-from)] !via-[var(--grad-via)] !to-[var(--grad-to)] !text-white shadow-md transition hover:opacity-90"
                disabled={busy || researching || !hasIntake}
                onClick={() => generate()}
              >
                <Sparkles size={16} />
                {researching
                  ? `Looking it up… ${researchProgress}%`
                  : busy
                    ? `Writing… ${writeProgress}%`
                    : doc.content.trim()
                      ? "Regenerate"
                      : (settings?.variant_count ?? 1) > 1
                        ? `Generate ${settings?.variant_count} variants`
                        : "Generate"}
              </Button>

              {doc.content.trim() && !busy && !researching && (
                <p className="text-[11px] leading-snug text-muted">
                  {outputEdited ? (
                    <>
                      <span className="font-medium text-amber-700">
                        You&apos;ve edited the version on the right.
                      </span>{" "}
                      Regenerate writes a new one from the draft box above, so
                      those edits won&apos;t carry over — use{" "}
                      <span className="font-medium text-ink">Refine</span> to
                      change the version you have. Either way it&apos;s saved to
                      history first.
                    </>
                  ) : (
                    <>
                      Regenerate writes a fresh version from the draft and the
                      options above. The current one is saved to history first.
                    </>
                  )}
                </p>
              )}

              {(busy || researching || uploading) && (
                <ProgressBar
                  pct={researching ? researchProgress : busy ? writeProgress : uploadProgress}
                  label={
                    researching
                      ? "Searching the web and reading what it finds"
                      : busy
                        ? "Writing your piece"
                        : "Reading what you gave me"
                  }
                />
              )}
            </div>
          </section>

          {/* What the look-up found. Visible and deletable: it goes into the
              prompt as fact, so you get to see what that fact is. */}
          {ctx.researchNotes.trim() && (
            <section className="rounded-xl border border-border bg-surface p-3.5 shadow-sm">
              <div className="mb-1.5 flex items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                  🔎 What I looked up
                </span>
                <span className="flex-1" />
                <button
                  type="button"
                  onClick={() => void runResearch()}
                  disabled={researching}
                  className="rounded px-1.5 py-0.5 text-[11px] font-medium text-[var(--accent)] transition hover:bg-[var(--accent-soft)] disabled:opacity-50"
                >
                  {researching ? "Searching…" : "Search again"}
                </button>
                <button
                  type="button"
                  onClick={() => setCtx({ researchNotes: "" })}
                  className="rounded px-1.5 py-0.5 text-[11px] font-medium text-muted transition hover:text-red-600"
                >
                  Clear
                </button>
              </div>
              <p className="whitespace-pre-wrap text-xs leading-relaxed text-ink/85">
                {ctx.researchNotes}
              </p>
            </section>
          )}

          <WriterChat
            docType={doc.doc_type}
            draft={inputPlain}
            output={htmlToPlain(doc.content)}
            notes={notesPlain}
          />

          {/* Optional dials, folded away */}
          <IntakeSection
            title="Tone & style"
            icon={Palette}
            tint="bg-violet-100 text-violet-600"
            badge={toneStyleCount ? `${toneStyleCount} picked` : undefined}
            revealWhen={toneStyleCount > 0}
          >
            <ChipGroup
              label="What matters here?"
              options={chipOptions(ACTION_CHIPS)}
              selected={ctx.actions}
              onToggle={toggle("actions")}
              hue="teal"
            />
            <ChipGroup
              label="Tone"
              options={chipOptions(TONE_CHIPS)}
              selected={ctx.tone}
              onToggle={toggle("tone")}
              hue="sky"
            />
            <ChipGroup
              label="Audience"
              options={chipOptions(AUDIENCE_CHIPS)}
              selected={ctx.audience}
              onToggle={toggle("audience")}
              hue="violet"
            />
            <ChipGroup
              label="Length"
              options={LENGTHS}
              selected={[ctx.length]}
              single
              onToggle={(key) => setCtx({ length: key })}
              hue="amber"
            />
          </IntakeSection>

          <IntakeSection
            title="Details"
            icon={ListChecks}
            tint="bg-sky-100 text-sky-600"
            badge={detailCount ? `${detailCount} filled` : undefined}
            revealWhen={detailCount > 0}
          >
            {(isEmail || doc.doc_type === "message") && (
              <Input
                label="Recipient (name / role)"
                value={ctx.recipient}
                onChange={(e) => setCtx({ recipient: e.target.value })}
                placeholder="Auto-detected from your brief when possible"
              />
            )}
            <Textarea
              label="What should happen?"
              value={ctx.ask}
              onChange={(e) => setCtx({ ask: e.target.value })}
              placeholder="e.g. She agrees to a 30-min call next week"
              className="min-h-14"
            />
            <Textarea
              label="Key points that must be included"
              value={ctx.keyPoints}
              onChange={(e) => setCtx({ keyPoints: e.target.value })}
              placeholder="One per line"
              className="min-h-14"
            />
            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
                Background the AI should know
              </p>
              <RichText
                value={ctx.background}
                onChange={(html) => setCtx({ background: html })}
                placeholder="History, sensitivities, anything relevant…"
                minHeight="min-h-16"
              />
            </div>
          </IntakeSection>

          {styles.length > 0 && (
            <IntakeSection
              title="Styles & voices"
              icon={Wand2}
              tint="bg-amber-100 text-amber-600"
              badge={selectedStyleCount ? `${selectedStyleCount} on` : undefined}
            >
              <ChipGroup
                label="Apply to this piece"
                options={styles.map((s) => ({ key: s.id, label: s.name }))}
                selected={ctx.styleIds}
                onToggle={toggle("styleIds")}
                hue="rose"
              />
            </IntakeSection>
          )}
        </div>

        {/* ---------------- Output ---------------- */}
        <div className="space-y-4">
          {variantResults.length > 1 && (
            <div className="flex gap-1.5">
              {variantResults.map((_, i) => (
                <button
                  key={i}
                  onClick={() => pickVariant(i)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                    activeVariant === i
                      ? "border-transparent bg-gradient-to-r from-[var(--grad-from)] to-[var(--grad-to)] text-white shadow-sm"
                      : "border-border text-muted hover:text-ink"
                  }`}
                >
                  Variant {["A", "B", "C", "D"][i]}
                </button>
              ))}
            </div>
          )}

          <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
            <div className="h-1 bg-gradient-to-r from-[var(--grad-from)] via-[var(--grad-via)] to-[var(--grad-to)] opacity-60" />
            <div className="space-y-3 p-4">
              {isEmail && (
                <Input
                  label="Subject"
                  value={doc.subject}
                  onChange={(e) => save({ subject: e.target.value })}
                  placeholder="Subject line"
                />
              )}

              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
                    <FileText size={13} className="text-[var(--accent)]" />
                    {doc.content.trim()
                      ? "Suggestion — edit freely, it autosaves"
                      : "Suggestion"}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      title={`Version history (${versions.length} saved)`}
                      onClick={() => setShowVersions(true)}
                      className="flex h-7 items-center gap-1 rounded px-1.5 text-muted transition hover:bg-canvas hover:text-ink"
                    >
                      <History size={14} />
                      {versions.length > 0 && (
                        <span className="text-[11px] font-semibold tabular-nums">
                          {versions.length}
                        </span>
                      )}
                    </button>
                    {(settings?.show_diff ?? true) && (
                      <button
                        title={diffOn ? "Hide changes" : "Show changes"}
                        onClick={() => setShowDiff(!diffOn)}
                        className="grid h-7 w-7 place-items-center rounded text-muted transition hover:bg-canvas hover:text-ink"
                      >
                        {diffOn ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    )}
                  </div>
                </div>
                {doc.content.trim() || busy ? (
                  <RichText
                    value={doc.content}
                    onChange={(html) => save({ content: html })}
                    minHeight="min-h-64"
                  />
                ) : (
                  <div className="grid place-items-center rounded-lg border border-dashed border-[var(--accent)]/40 bg-[var(--accent-soft)]/20 py-16 text-center">
                    <div className="max-w-sm space-y-1.5">
                      <Sparkles size={20} className="mx-auto text-[var(--accent)]" />
                      <p className="text-sm text-muted">
                        Put anything in the box on the left — a rough draft, an
                        email to answer, a screenshot, or just what you want — then
                        hit <span className="font-medium text-ink">Generate</span>.
                        Everything is editable afterwards.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Signature: set it once here, reuse it on every email. It is
                  appended at copy/send time rather than written into the body,
                  so editing the draft can never mangle it. */}
              {isEmail && (
                <div className="rounded-lg bg-canvas px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <label className="flex cursor-pointer items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
                      <input
                        type="checkbox"
                        checked={ctx.useSignature}
                        onChange={(e) => setCtx({ useSignature: e.target.checked })}
                        className="h-3.5 w-3.5 accent-[var(--accent)]"
                      />
                      Append my signature
                    </label>
                    <span className="flex-1" />
                    <button
                      type="button"
                      onClick={() => setEditingSig((v) => !v)}
                      className="rounded px-1.5 py-0.5 text-[11px] font-medium text-[var(--accent)] transition hover:bg-[var(--accent-soft)]"
                    >
                      {editingSig
                        ? "Done"
                        : settings?.signature?.trim()
                          ? "Edit"
                          : "Add one"}
                    </button>
                  </div>
                  {editingSig && settings ? (
                    <div className="mt-2">
                      <AutoRichField
                        label="Signature (saved for every email)"
                        initialHtml={settings.signature || ""}
                        canEdit
                        onSave={(html) => saveSettings({ signature: html })}
                        placeholder="Name, title, phone… (saves automatically)"
                        minHeight="min-h-16"
                      />
                    </div>
                  ) : settings?.signature?.trim() ? (
                    <div className={ctx.useSignature ? "mt-1.5" : "mt-1.5 opacity-40"}>
                      <RichTextView html={settings.signature} />
                    </div>
                  ) : (
                    <p className="mt-1 text-[11px] leading-snug text-muted">
                      No signature saved yet. Add one and it gets appended to
                      every email you copy or send from here.
                    </p>
                  )}
                </div>
              )}

              {doc.content.trim() && (
                <div className="flex flex-wrap gap-2 border-t border-border pt-3">
                  <Button size="sm" variant="secondary" onClick={copyOut}>
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                    {copied ? "Copied" : "Copy"}
                  </Button>
                  {isEmail && (
                    <Button size="sm" variant="secondary" onClick={openInEmail}>
                      <Mail size={14} /> Open in email
                    </Button>
                  )}
                </div>
              )}
            </div>
          </section>

          {/* What changed */}
          {diffOn && diffBase && doc.content.trim() && (
            <section className="rounded-xl border border-border bg-surface p-4 shadow-sm">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                What changed{" "}
                {diffBase === inputPlain ? "vs. what you wrote" : "vs. the previous version"}
              </p>
              <div
                className="text-sm leading-relaxed [&_mark.wr-ins]:rounded [&_mark.wr-ins]:bg-[var(--accent-soft)] [&_mark.wr-ins]:px-0.5 [&_mark.wr-ins]:text-[var(--accent)]"
                dangerouslySetInnerHTML={{
                  __html: diffHighlightHtml(diffBase, htmlToPlain(doc.content)),
                }}
              />
            </section>
          )}

          {/* Refine loop */}
          {doc.content.trim() && (
            <section className="rounded-xl border border-[var(--accent)]/30 bg-gradient-to-br from-[var(--accent-soft)]/40 to-transparent p-4">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--accent)]">
                <Wand2 size={13} /> Not quite right? Tell me what to change
              </p>
              <p className="mb-2 mt-1 text-[11px] leading-snug text-muted">
                This works on the version above, including any edits you&apos;ve
                made to it by hand. The one you have now is saved first, so you can
                always go back to it.
              </p>

              {/* The same dials as the intake, pointed at the output. Wanting
                  "this one shorter, and more persuasive" was previously only
                  expressible in prose. */}
              <div className="mb-2 space-y-2 rounded-lg bg-surface/70 p-2.5">
                <ChipGroup
                  label="Change about this version"
                  options={chipOptions(ACTION_CHIPS)}
                  selected={refineActions}
                  onToggle={(key) =>
                    setRefineActions((prev) =>
                      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
                    )
                  }
                  hue="teal"
                />
                <ChipGroup
                  label="Length"
                  options={LENGTHS}
                  selected={[refineLength]}
                  single
                  onToggle={setRefineLength}
                  hue="amber"
                />
                <ChipGroup
                  label="Tone"
                  options={chipOptions(TONE_CHIPS)}
                  selected={refineTone}
                  onToggle={(key) =>
                    setRefineTone((prev) =>
                      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
                    )
                  }
                  hue="sky"
                />
              </div>

              <Textarea
                value={guidance}
                onChange={(e) => setGuidance(e.target.value)}
                placeholder={'e.g. "Second paragraph is too apologetic, own the decision" or "get across that we\'re already piloting this" — I\'ll fold the idea in, not paste your words'}
                className="min-h-16 bg-surface"
              />
              {busy && (
                <ProgressBar
                  pct={writeProgress}
                  label="Reworking this version"
                  className="mt-2"
                />
              )}
              <div className="mt-2 flex items-center justify-end gap-2">
                {refineHasPicks && (
                  <button
                    type="button"
                    onClick={() => {
                      setRefineActions([]);
                      setRefineTone([]);
                      setRefineLength("as_is");
                    }}
                    className="rounded px-2 py-1 text-[11px] font-medium text-muted transition hover:text-ink"
                  >
                    Clear picks
                  </button>
                )}
                <Button
                  size="sm"
                  disabled={busy || (!guidance.trim() && !refineHasPicks)}
                  onClick={() => generate(guidance || refinePicksSummary)}
                >
                  <Sparkles size={14} /> {busy ? `Refining… ${writeProgress}%` : "Refine"}
                </Button>
              </div>
            </section>
          )}
        </div>
      </div>

      {/* An attachment, opened to check what was actually read out of it. The
          transcription is the part that reaches the AI, so that's what this
          shows; the original image comes along too while it's still in memory. */}
      <Modal
        open={!!openAttachment}
        onClose={() => setOpenAttachment(null)}
        title={openAttachment?.att.name || "Attachment"}
        size="lg"
      >
        {openAttachment && (
          <div className="space-y-3">
            {openAttachment.preview && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={openAttachment.preview}
                alt={openAttachment.att.name}
                className="max-h-72 w-auto rounded-lg border border-border"
              />
            )}
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
                What I read from it{" "}
                <span className="font-normal normal-case">
                  (this is what gets used)
                </span>
              </p>
              <p className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg bg-canvas p-3 text-xs leading-relaxed text-ink/85">
                {openAttachment.att.text || "Nothing readable came out of this one."}
              </p>
            </div>
          </div>
        )}
      </Modal>

      {/* Versions */}
      <Modal
        open={showVersions}
        onClose={() => setShowVersions(false)}
        title="Version history"
        size="lg"
      >
        {versions.length === 0 ? (
          <p className="text-sm text-muted">No versions yet — generate something first.</p>
        ) : (
          <>
            <p className="mb-3 text-xs text-muted">
              Every generate and refine is saved here, plus a copy of whatever you
              had on screen before a refine or a restore.{" "}
              {(settings?.version_retention_days ?? 10) > 0
                ? `Versions older than ${settings?.version_retention_days ?? 10} days are deleted automatically — change that in Settings.`
                : "They're kept indefinitely — change that in Settings."}
            </p>
            <ul className="space-y-3">
            {versions.map((v) => (
              <li key={v.id} className="rounded-lg border border-border p-3">
                <div className="mb-1 flex items-center gap-2 text-xs text-muted">
                  <span>
                    {new Date(v.created_at).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                  {v.variant_label && (
                    <span className="rounded-full bg-canvas px-2 py-0.5 font-semibold">
                      Variant {v.variant_label}
                    </span>
                  )}
                  <span className="flex-1 truncate italic">{v.instructions}</span>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => void restoreVersion(v)}
                  >
                    Restore
                  </Button>
                </div>
                <p className="line-clamp-3 text-xs leading-relaxed text-ink/80">
                  {htmlToPlain(v.content)}
                </p>
              </li>
            ))}
            </ul>
          </>
        )}
      </Modal>
    </>
  );
}
