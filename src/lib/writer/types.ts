// Writing Studio shared types + the guided-intake chip vocabulary.

export type DocType = "email" | "document" | "message" | "social" | "summary" | "other";
export type DocMode = "create" | "edit";
/** How much license the AI has with the user's draft. */
export type Fidelity = "light" | "polish" | "rewrite" | "draft";

/**
 * A file the user handed over: a screenshot of an email, a PDF, a Word doc.
 * `text` is what the AI reads — the transcription made at upload time — which is
 * also what you open the attachment to check. The file itself is not stored; the
 * words in it are the part that matters to the writing.
 */
export interface WriterAttachment {
  id: string;
  name: string;
  kind: "image" | "document";
  text: string;
}

export interface WriterContext {
  brief: string; // free-text brief (HTML) — "here's an email, write a reply saying…"
  fidelity: Fidelity; // how far from the draft it may stray
  actions: string[]; // what to do (edit mode mostly)
  tone: string[];
  audience: string[];
  length: string; // one of LENGTHS
  background: string;
  keyPoints: string;
  ask: string; // what you're asking the recipient for
  recipient: string; // name / role (emails, messages)
  noGreeting: boolean; // skip "Hi Sarah," and open on the first real sentence
  useSignature: boolean; // append the saved signature on copy/send (emails)
  research: boolean; // look things up on the web before writing
  researchNotes: string; // what the look-up found, with sources
  attachments: WriterAttachment[]; // files handed over, read but kept out of the box
  /**
   * Fields the AI filled in from your note that you haven't confirmed yet. They
   * apply, but they're flagged on screen until you say they're right — reading a
   * tone back off your own words is a guess, and a guess you didn't make should
   * not look identical to a choice you did.
   */
  autoFilled: string[];
  styleIds: string[];
}

export const EMPTY_CONTEXT: WriterContext = {
  brief: "",
  fidelity: "light",
  actions: [],
  tone: [],
  audience: [],
  length: "as_is",
  background: "",
  keyPoints: "",
  ask: "",
  recipient: "",
  noGreeting: false,
  useSignature: true,
  research: false,
  researchNotes: "",
  attachments: [],
  autoFilled: [],
  styleIds: [],
};

/**
 * A fresh context. Use this rather than EMPTY_CONTEXT when seeding a doc: the
 * constant's arrays are a single shared instance, so handing it out directly
 * means two pieces can end up pointing at the same one.
 */
export function emptyContext(): WriterContext {
  return {
    ...EMPTY_CONTEXT,
    actions: [],
    tone: [],
    audience: [],
    attachments: [],
    autoFilled: [],
    styleIds: [],
  };
}

export interface WriterDoc {
  id: string;
  user_id: string;
  doc_type: DocType;
  mode: DocMode;
  title: string;
  tags: string[];
  context: WriterContext;
  original: string;
  content: string;
  subject: string;
  created_at: string;
  updated_at: string;
}

export interface WriterVersion {
  id: string;
  doc_id: string;
  content: string;
  subject: string;
  instructions: string;
  variant_label: string;
  created_at: string;
}

export interface WriterStyle {
  id: string;
  user_id: string;
  name: string;
  kind: "rules" | "voice";
  rules: string;
  voice_profile: string;
  created_at: string;
  updated_at: string;
}

export interface WriterSettings {
  user_id: string;
  signature: string;
  show_diff: boolean;
  variant_count: number;
  /** Versions older than this are deleted automatically. 0 = keep forever. */
  version_retention_days: number;
}

export const RETENTION_OPTIONS = [
  { key: 0, label: "Keep forever" },
  { key: 7, label: "7 days" },
  { key: 10, label: "10 days" },
  { key: 30, label: "30 days" },
  { key: 90, label: "90 days" },
];

export const DOC_TYPES: { key: DocType; emoji: string; label: string; blurb: string }[] = [
  { key: "email", emoji: "✉️", label: "Email", blurb: "Subject line, recipient, signature — the works." },
  { key: "document", emoji: "📄", label: "Document / memo", blurb: "Longer-form writing with structure." },
  { key: "message", emoji: "💬", label: "Message", blurb: "Teams, Slack, or a text — short and sharp." },
  { key: "social", emoji: "📣", label: "LinkedIn / social", blurb: "A post people actually read." },
  { key: "summary", emoji: "📝", label: "Summary / abstract", blurb: "Distill something long into less." },
  { key: "other", emoji: "✨", label: "Anything else", blurb: "Describe it and go." },
];

// The single most important dial: how much of the user's own draft survives.
// It defaults to "light" because the usual complaint about a writing AI is that
// it hands back something unrecognisable when all you wanted was a proofread.
export const FIDELITY_OPTIONS: { key: Fidelity; label: string; blurb: string }[] = [
  {
    key: "light",
    label: "🔍 Just fix it",
    blurb: "Grammar, typos and the odd clumsy phrase. Your words, your order, your length.",
  },
  {
    key: "polish",
    label: "✍️ Polish",
    blurb: "Tighten the wording and the flow. Same content, same shape, nothing new added.",
  },
  {
    key: "rewrite",
    label: "🚀 Rewrite",
    blurb: "Free rein to restructure and rework the draft you gave me.",
  },
  {
    key: "draft",
    label: "📝 Write it",
    blurb:
      "You jotted the gist and the context; I write the actual piece. Nothing of yours to preserve, but nothing invented either.",
  },
];

export const ACTION_CHIPS = [
  "Fix grammar & typos",
  "Tighten / shorten",
  "Expand with more detail",
  "More persuasive",
  "Softer / more diplomatic",
  "More direct",
  "Restructure for clarity",
  "Make it skimmable",
  "Executive-ready",
  "Simplify the language",
];

export const TONE_CHIPS = [
  "Formal",
  "Friendly",
  "Neutral",
  "Warm",
  "Urgent",
  "Apologetic",
  "Confident",
  "Enthusiastic",
];

export const AUDIENCE_CHIPS = [
  "Boss / leadership",
  "Colleague",
  "KOL / HCP",
  "External partner",
  "Customer",
  "Broad audience",
];

export const LENGTHS: { key: string; label: string }[] = [
  { key: "as_is", label: "⚖️ About the same" },
  { key: "shorter", label: "✂️ Shorter" },
  { key: "much_shorter", label: "🤏 Much shorter" },
  { key: "longer", label: "📈 Longer" },
];

// Emoji are display-only. The chip VALUES above are what the AI sees (and are
// the allowed enum for tone/audience extraction), so they must stay untouched —
// decorate the label at render time with chipOptions() instead.
const CHIP_EMOJI: Record<string, string> = {
  "Fix grammar & typos": "🔤",
  "Tighten / shorten": "✂️",
  "Expand with more detail": "➕",
  "More persuasive": "🎯",
  "Softer / more diplomatic": "🕊️",
  "More direct": "➡️",
  "Restructure for clarity": "🧱",
  "Make it skimmable": "👀",
  "Executive-ready": "👔",
  "Simplify the language": "🪶",
  Formal: "🎩",
  Friendly: "🙂",
  Neutral: "😐",
  Warm: "🤗",
  Urgent: "⏰",
  Apologetic: "🙏",
  Confident: "💪",
  Enthusiastic: "🎉",
  "Boss / leadership": "🧑‍💼",
  Colleague: "🤝",
  "KOL / HCP": "🩺",
  "External partner": "🌐",
  Customer: "🛒",
  "Broad audience": "🌍",
};

/** Chip values decorated with an emoji for display; `key` stays the raw value. */
export function chipOptions(values: string[]): { key: string; label: string }[] {
  return values.map((v) => ({
    key: v,
    label: CHIP_EMOJI[v] ? `${CHIP_EMOJI[v]} ${v}` : v,
  }));
}

export function docTypeLabel(t: DocType): string {
  return DOC_TYPES.find((d) => d.key === t)?.label || "Writing";
}

export function docTypeEmoji(t: DocType): string {
  return DOC_TYPES.find((d) => d.key === t)?.emoji || "✨";
}

// Date buckets for the library. The list only grows, so pieces are grouped by
// when they were last touched rather than shown as one endless run of cards.
export function dateGroup(iso: string): string {
  const then = new Date(iso);
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.round(
    (startOfDay(new Date()).getTime() - startOfDay(then).getTime()) / 86400000,
  );
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return "Earlier this week";
  if (days < 30) return "Earlier this month";
  if (then.getFullYear() === new Date().getFullYear())
    return then.toLocaleDateString(undefined, { month: "long" });
  return then.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

/** Normalize a typed tag: trimmed, collapsed whitespace, capped. */
export function cleanTag(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").slice(0, 30);
}

// Plain text from stored HTML (for mailto bodies, diffs, clipboard fallback).
// A closing paragraph is a blank line, not a single newline: collapsing the two
// ran every paragraph together when the text was pasted into an email as plain
// text. List items stay one line apiece.
export function htmlToPlain(html: string): string {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/(p|div|h[1-6])>/gi, "\n\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
