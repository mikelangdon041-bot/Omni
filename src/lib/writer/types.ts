// Writing Studio shared types + the guided-intake chip vocabulary.

export type DocType = "email" | "document" | "message" | "social" | "summary" | "other";
export type DocMode = "create" | "edit";

export interface WriterContext {
  brief: string; // free-text brief (HTML) — "here's an email, write a reply saying…"
  actions: string[]; // what to do (edit mode mostly)
  tone: string[];
  audience: string[];
  length: string; // one of LENGTHS
  background: string;
  keyPoints: string;
  ask: string; // what you're asking the recipient for
  recipient: string; // name / role (emails, messages)
  styleIds: string[];
}

export const EMPTY_CONTEXT: WriterContext = {
  brief: "",
  actions: [],
  tone: [],
  audience: [],
  length: "as_is",
  background: "",
  keyPoints: "",
  ask: "",
  recipient: "",
  styleIds: [],
};

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
}

export const DOC_TYPES: { key: DocType; emoji: string; label: string; blurb: string }[] = [
  { key: "email", emoji: "✉️", label: "Email", blurb: "Subject line, recipient, signature — the works." },
  { key: "document", emoji: "📄", label: "Document / memo", blurb: "Longer-form writing with structure." },
  { key: "message", emoji: "💬", label: "Message", blurb: "Teams, Slack, or a text — short and sharp." },
  { key: "social", emoji: "📣", label: "LinkedIn / social", blurb: "A post people actually read." },
  { key: "summary", emoji: "📝", label: "Summary / abstract", blurb: "Distill something long into less." },
  { key: "other", emoji: "✨", label: "Anything else", blurb: "Describe it and go." },
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
export function htmlToPlain(html: string): string {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
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
