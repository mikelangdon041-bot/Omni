// Writing Studio shared types + the guided-intake chip vocabulary.

export type DocType = "email" | "document" | "message" | "social" | "summary" | "other";
export type DocMode = "create" | "edit";

export interface WriterContext {
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

export const DOC_TYPES: { key: DocType; label: string; blurb: string }[] = [
  { key: "email", label: "Email", blurb: "Subject line, recipient, signature — the works." },
  { key: "document", label: "Document / memo", blurb: "Longer-form writing with structure." },
  { key: "message", label: "Message", blurb: "Teams, Slack, or a text — short and sharp." },
  { key: "social", label: "LinkedIn / social", blurb: "A post people actually read." },
  { key: "summary", label: "Summary / abstract", blurb: "Distill something long into less." },
  { key: "other", label: "Anything else", blurb: "Describe it and go." },
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
  { key: "as_is", label: "About the same" },
  { key: "shorter", label: "Shorter" },
  { key: "much_shorter", label: "Much shorter" },
  { key: "longer", label: "Longer" },
];

export function docTypeLabel(t: DocType): string {
  return DOC_TYPES.find((d) => d.key === t)?.label || "Writing";
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
