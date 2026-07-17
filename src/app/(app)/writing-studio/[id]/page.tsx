"use client";

// The Writing Studio workspace: guided intake on the left, the living output
// on the right — generate, refine with new guidance, flip through versions,
// see what changed, copy or send.

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  History,
  Mail,
  Sparkles,
} from "lucide-react";
import { BackButton } from "@/components/BackButton";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { RichText, RichTextView } from "@/components/ui/RichText";
import { useToast } from "@/components/ui/Feedback";
import { ChipGroup } from "@/components/writer/Chips";
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
  LENGTHS,
  TONE_CHIPS,
  docTypeLabel,
  htmlToPlain,
  type WriterContext,
  type WriterVersion,
} from "@/lib/writer/types";

export default function WriterDocPage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const { userId } = useUserId();
  const { doc, versions, loading, save, flush, addVersion } = useWriterDoc(id);
  const { settings } = useWriterSettings(userId);
  const { styles } = useWriterStyles(userId);

  const [busy, setBusy] = useState(false);
  const [guidance, setGuidance] = useState("");
  const [variantResults, setVariantResults] = useState<
    { subject: string; html: string }[]
  >([]);
  const [activeVariant, setActiveVariant] = useState(0);
  const [showVersions, setShowVersions] = useState(false);
  const [showDiff, setShowDiff] = useState<boolean | null>(null);
  const [copied, setCopied] = useState(false);

  const isEmail = doc?.doc_type === "email";
  const diffOn =
    (showDiff ?? settings?.show_diff ?? true) && !!doc && !!doc.content.trim();
  // Diff baseline: the user's own draft in edit mode; otherwise the previous
  // version (so refines show what the refine changed).
  const diffBase = useMemo(() => {
    if (!doc) return "";
    if (doc.mode === "edit" && doc.original.trim()) return htmlToPlain(doc.original);
    const prev = versions.find((v) => htmlToPlain(v.content) !== htmlToPlain(doc.content));
    return prev ? htmlToPlain(prev.content) : "";
  }, [doc, versions]);

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

  async function generate(refineGuidance?: string) {
    if (!doc) return;
    setBusy(true);
    try {
      await flush();
      const styleTexts = styles
        .filter((s) => ctx.styleIds.includes(s.id))
        .map((s) => ({
          name: s.name,
          text: s.kind === "voice" ? s.voice_profile : s.rules,
        }));
      const refining = !!refineGuidance && !!doc.content.trim();
      const res = await fetch("/api/writer/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          action: "generate",
          docType: doc.doc_type,
          mode: doc.mode,
          original: doc.original ? htmlToPlain(doc.original) : "",
          previous: refining ? doc.content : "",
          guidance: refineGuidance || "",
          context: ctx,
          styles: styleTexts,
          signature: isEmail ? htmlToPlain(settings?.signature || "") : "",
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

  function restoreVersion(v: WriterVersion) {
    save({ content: v.content, subject: v.subject || doc?.subject || "" });
    setVariantResults([]);
    setShowVersions(false);
    toast("success", "Version restored");
  }

  async function copyOut() {
    if (!doc) return;
    const sigHtml = isEmail && settings?.signature ? `<br>${settings.signature}` : "";
    const html = `${doc.content}${sigHtml}`;
    const plain =
      htmlToPlain(doc.content) +
      (isEmail && settings?.signature ? `\n\n${htmlToPlain(settings.signature)}` : "");
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
      (settings?.signature ? `\n\n${htmlToPlain(settings.signature)}` : "");
    window.location.href = `mailto:?subject=${encodeURIComponent(doc.subject)}&body=${encodeURIComponent(body)}`;
  }

  return (
    <>
      <div className="mb-4 flex items-center gap-3">
        <BackButton label="Writing Studio" />
        <span className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--accent)]">
          {docTypeLabel(doc.doc_type)}
        </span>
        <span className="text-xs text-muted">
          {doc.mode === "edit" ? "Polishing your draft" : "From scratch"}
        </span>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(320px,380px)_1fr]">
        {/* ---------------- Intake ---------------- */}
        <div className="space-y-4">
          <section className="space-y-4 rounded-xl border border-border bg-surface p-4 shadow-sm">
            <Input
              label="Title"
              value={doc.title}
              onChange={(e) => save({ title: e.target.value })}
              placeholder="Name this piece (for your library)"
            />

            {doc.mode === "edit" && (
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
                  Your draft
                </p>
                <RichText
                  value={doc.original}
                  onChange={(html) => save({ original: html })}
                  placeholder="Paste the version you have…"
                  minHeight="min-h-32"
                />
              </div>
            )}

            <ChipGroup
              label={doc.mode === "edit" ? "What should I do to it?" : "What matters here?"}
              options={ACTION_CHIPS}
              selected={ctx.actions}
              onToggle={toggle("actions")}
            />
            <ChipGroup
              label="Tone"
              options={TONE_CHIPS}
              selected={ctx.tone}
              onToggle={toggle("tone")}
            />
            <ChipGroup
              label="Audience"
              options={AUDIENCE_CHIPS}
              selected={ctx.audience}
              onToggle={toggle("audience")}
            />
            <ChipGroup
              label="Length"
              options={LENGTHS}
              selected={[ctx.length]}
              single
              onToggle={(key) => setCtx({ length: key })}
            />

            {(isEmail || doc.doc_type === "message") && (
              <Input
                label="Recipient (name / role)"
                value={ctx.recipient}
                onChange={(e) => setCtx({ recipient: e.target.value })}
                placeholder="e.g. Dr. Chen, cardiology chief we met at ACC"
              />
            )}
            <Textarea
              label="What are you asking for / what should happen?"
              value={ctx.ask}
              onChange={(e) => setCtx({ ask: e.target.value })}
              placeholder="e.g. She agrees to a 30-min call next week"
              className="min-h-16"
            />
            <Textarea
              label="Key points that must be included"
              value={ctx.keyPoints}
              onChange={(e) => setCtx({ keyPoints: e.target.value })}
              placeholder="One per line"
              className="min-h-16"
            />
            <Textarea
              label="Background the AI should know"
              value={ctx.background}
              onChange={(e) => setCtx({ background: e.target.value })}
              placeholder="History, sensitivities, anything relevant…"
              className="min-h-16"
            />

            {styles.length > 0 && (
              <ChipGroup
                label="Apply styles & voices"
                options={styles.map((s) => ({ key: s.id, label: s.name }))}
                selected={ctx.styleIds}
                onToggle={toggle("styleIds")}
              />
            )}

            <Button
              className="w-full"
              disabled={busy || (doc.mode === "edit" && !htmlToPlain(doc.original).trim())}
              onClick={() => generate()}
            >
              <Sparkles size={16} />
              {busy
                ? "Writing…"
                : doc.content.trim()
                  ? "Regenerate from intake"
                  : (settings?.variant_count ?? 1) > 1
                    ? `Generate ${settings?.variant_count} variants`
                    : "Generate"}
            </Button>
          </section>
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
                      ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                      : "border-border text-muted hover:text-ink"
                  }`}
                >
                  Variant {["A", "B", "C", "D"][i]}
                </button>
              ))}
            </div>
          )}

          <section className="space-y-3 rounded-xl border border-border bg-surface p-4 shadow-sm">
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
                <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                  {doc.content.trim() ? "Result — edit freely, it autosaves" : "Result"}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    title="Version history"
                    onClick={() => setShowVersions(true)}
                    className="grid h-7 w-7 place-items-center rounded text-muted transition hover:bg-canvas hover:text-ink"
                  >
                    <History size={14} />
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
                  minHeight="min-h-48"
                />
              ) : (
                <div className="grid place-items-center rounded-lg border border-dashed border-border py-14 text-center">
                  <p className="text-sm text-muted">
                    Fill in the intake and hit{" "}
                    <span className="font-medium text-ink">Generate</span> —
                    everything is editable afterwards.
                  </p>
                </div>
              )}
            </div>

            {isEmail && settings?.signature && doc.content.trim() ? (
              <div className="rounded-lg bg-canvas px-3 py-2">
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
                  Signature (appended on copy/send)
                </p>
                <RichTextView html={settings.signature} />
              </div>
            ) : null}

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
          </section>

          {/* What changed */}
          {diffOn && diffBase && doc.content.trim() && (
            <section className="rounded-xl border border-border bg-surface p-4 shadow-sm">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                What changed{" "}
                {doc.mode === "edit" ? "vs. your draft" : "vs. the previous version"}
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
            <section className="rounded-xl border border-[var(--accent)]/30 bg-[var(--accent-soft)]/25 p-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                Not quite right? Tell me what to change
              </p>
              <Textarea
                value={guidance}
                onChange={(e) => setGuidance(e.target.value)}
                placeholder='e.g. "Second paragraph is too apologetic — own the decision" or "make the ask land earlier"'
                className="min-h-16 bg-surface"
              />
              <div className="mt-2 flex justify-end">
                <Button size="sm" disabled={busy || !guidance.trim()} onClick={() => generate(guidance)}>
                  <Sparkles size={14} /> {busy ? "Refining…" : "Refine"}
                </Button>
              </div>
            </section>
          )}
        </div>
      </div>

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
                  <Button size="sm" variant="secondary" onClick={() => restoreVersion(v)}>
                    Restore
                  </Button>
                </div>
                <p className="line-clamp-3 text-xs leading-relaxed text-ink/80">
                  {htmlToPlain(v.content)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </>
  );
}
