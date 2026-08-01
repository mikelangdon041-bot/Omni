// The shared chat: one assistant, in every app, that can answer about what you
// are looking at, change it, and make new things — here or in another app.
//
// The contract is the one Writing Studio's chat proved out. Every message sorts
// into one of three outcomes before anything happens: answer, change the thing
// on screen, or make something new alongside it. Nothing is written without the
// person pressing the button on the answer that proposes it.

export type ChatAppId =
  | "home"
  | "territory-planning"
  | "meeting-prep"
  | "insights"
  | "conference-planning"
  | "writing-studio"
  | "slide-studio"
  | "interview-prep"
  | "dashboard";

/** The object the page is about, so actions don't need an id from the model. */
export interface ChatSubject {
  /** "kol", "meeting", "piece", "conference", "candidate", "deck", "survey" */
  kind: string;
  id: string;
  /** What to call it in a sentence: "Dr. Chen", "Q3 pilot memo". */
  label: string;
}

/**
 * What a page tells the chat about itself. Registered with useChatScope, which
 * is why the bubble can float over every app and still know what it is looking
 * at — the page owns the knowledge, the chat just reads it.
 */
export interface ChatScopeValue {
  app: ChatAppId;
  /** Plain text of what is on screen. The model reads this verbatim. */
  context: string;
  /** The thing the page is about, if it is about one thing. */
  subject?: ChatSubject;
  /** Ids the handlers need that aren't the subject (conferenceId, templateId). */
  ids?: Record<string, string>;
  /**
   * An in-place change only the page can make — Writing Studio's refine pass,
   * which snapshots the current version first. When a page offers this, the
   * chat can propose edits to what is on screen; when it doesn't, it can't.
   */
  onEdit?: (instruction: string) => Promise<void> | void;
  /** What that button says. Defaults to "Make this change". */
  editLabel?: string;
  /** True while the page is mid-edit, so the button can't be pressed twice. */
  editBusy?: boolean;
}

/** A thing the assistant offered to do, as it comes back from the model. */
export interface ProposedAction {
  id: string;
  /** The button's words, in the model's own phrasing of what it will do. */
  label: string;
  /** Arguments, already parsed out of the model's JSON string. */
  params: Record<string, unknown>;
}

/** What running an action reports back into the thread. */
export interface ActionOutcome {
  message: string;
  /** Where the new thing lives, offered as a link rather than a redirect. */
  href?: string;
  /** Anything the model should know for the rest of the conversation. */
  detail?: string;
}

export interface ChatTurn {
  role: "user" | "assistant" | "event";
  /** What goes to the model. */
  content: string;
  /** What the thread shows, when that differs (attachments spliced out). */
  display?: string;
  files?: { name: string; kind: "image" | "document" }[];
  actions?: ProposedAction[];
  /** Which of this turn's actions have been run, by index. */
  done?: Record<number, ActionOutcome>;
  /** Index of an action currently running, for the working line. */
  running?: number;
}
