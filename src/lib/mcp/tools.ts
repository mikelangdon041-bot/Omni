// The Outlook tools the MCP server exposes, on Microsoft Graph. SERVER ONLY.
//
// Rules that hold across every tool:
//   * Read tools answer in plain text, with a web link on every item, so the
//     answer is usable as-is in a chat or a morning brief.
//   * Nothing here logs a message body, a preview or a subject. Failures log
//     the tool name and Graph's status/code only.
//   * Sending is two steps on purpose: create_draft makes a draft and returns
//     its id; send_mail sends an existing draft and refuses anything else.

import { ToolError } from "./errors";
import { MsAuthError, msAccessToken, type MsAccount } from "./oauth";
import {
  checkTimeZone,
  fmtDateTime,
  fmtDay,
  fmtTime,
  graphUtc,
  graphZone,
  parseWhen,
} from "./time";

const GRAPH = "https://graph.microsoft.com/v1.0";

export { ToolError };

class GraphError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

type Args = Record<string, unknown>;

// ------------------------------------------------------------------ Graph

async function graph(
  account: MsAccount,
  path: string,
  init: RequestInit = {},
  prefer: string[] = [],
): Promise<Response> {
  const url = path.startsWith("https://") ? path : `${GRAPH}${path}`;
  const call = async (force: boolean) =>
    fetch(url, {
      ...init,
      headers: {
        ...((init.headers as Record<string, string>) || {}),
        Authorization: `Bearer ${await msAccessToken(account, force)}`,
        ...(prefer.length ? { Prefer: prefer.join(", ") } : {}),
      },
    });
  let res = await call(false);
  if (res.status === 401) res = await call(true);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    throw new GraphError(res.status, body?.error?.code || "", body?.error?.message || `HTTP ${res.status}`);
  }
  return res;
}

async function graphJson<T>(account: MsAccount, path: string, init?: RequestInit, prefer?: string[]): Promise<T> {
  const res = await graph(account, path, init, prefer);
  return (await res.json()) as T;
}

/** OData query string, with the `$` names left alone and values encoded. */
function qs(params: Record<string, string | number | undefined>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join("&")}` : "";
}

const odataString = (s: string) => `'${s.replace(/'/g, "''")}'`;

// ---------------------------------------------------------------- helpers

export interface Recipient {
  emailAddress: { name?: string; address: string };
}

export function str(args: Args, key: string): string | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") throw new ToolError(`${key} must be a string`);
  return v.trim() || undefined;
}

export function bool(args: Args, key: string): boolean | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  throw new ToolError(`${key} must be true or false`);
}

const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

/** "a@x.com", "Ann Lee <a@x.com>", or a list of those (array or comma/semicolon separated). */
export function recipients(args: Args, key: string): Recipient[] | undefined {
  const v = args[key];
  if (v === undefined || v === null || v === "") return undefined;
  const items = Array.isArray(v) ? v : String(v).split(/[;,](?=(?:[^"]*"[^"]*")*[^"]*$)/);
  const out: Recipient[] = [];
  for (const raw of items) {
    const s = String(raw).trim();
    if (!s) continue;
    const m = s.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
    const address = (m ? m[2] : s).trim();
    const name = m ? m[1].trim() : undefined;
    if (!EMAIL.test(address)) throw new ToolError(`"${s}" in ${key} is not an email address`);
    out.push({ emailAddress: name ? { name, address } : { address } });
  }
  return out;
}

function person(r?: { emailAddress?: { name?: string; address?: string } } | null): string {
  const e = r?.emailAddress;
  if (!e) return "(unknown)";
  if (e.name && e.address && e.name !== e.address) return `${e.name} <${e.address}>`;
  return e.address || e.name || "(unknown)";
}

const people = (list?: Recipient[] | null) => (list || []).map(person).join(", ");

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Plain text to email HTML: blank lines are paragraphs, single newlines are breaks. */
function textToHtml(text: string): string {
  const paras = text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px 0">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
  return `<div style="font-family:Aptos,Calibri,Arial,sans-serif;font-size:11pt">${paras}</div>`;
}

export function bodyHtml(args: Args): string | undefined {
  const body = typeof args.body === "string" ? args.body : undefined;
  if (body === undefined) return undefined;
  const type = str(args, "body_type") || "text";
  if (type !== "text" && type !== "html") throw new ToolError('body_type must be "text" or "html"');
  return type === "html" ? body : textToHtml(body);
}

export function tidyText(s: string, max: number): string {
  const t = s.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return t.length > max ? `${t.slice(0, max)}\n[…truncated, ${t.length - max} more characters — open the link for the rest]` : t;
}

// ----------------------------------------------------------- list_events

interface GraphEvent {
  id: string;
  subject?: string;
  start: { dateTime: string };
  end: { dateTime: string };
  isAllDay?: boolean;
  isCancelled?: boolean;
  showAs?: string;
  location?: { displayName?: string };
  organizer?: Recipient;
  attendees?: (Recipient & { status?: { response?: string } })[];
  responseStatus?: { response?: string };
  isOnlineMeeting?: boolean;
  onlineMeeting?: { joinUrl?: string } | null;
  webLink?: string;
  isOrganizer?: boolean;
}

async function listEvents(account: MsAccount, args: Args): Promise<string> {
  const tz = checkTimeZone(str(args, "timezone"));
  const startIn = str(args, "start");
  const endIn = str(args, "end");
  if (!startIn || !endIn) throw new ToolError("start and end are required (ISO 8601)");
  const start = parseWhen(startIn, tz);
  const end = parseWhen(endIn, tz, true);
  if (end <= start) throw new ToolError("end must be after start");
  if (end.getTime() - start.getTime() > 62 * 86400_000) throw new ToolError("Ask for at most 62 days at a time");

  const select =
    "id,subject,start,end,isAllDay,isCancelled,showAs,location,organizer,attendees,responseStatus,isOnlineMeeting,onlineMeeting,webLink,isOrganizer";
  let next: string | undefined =
    `/me/calendarView${qs({
      startDateTime: start.toISOString(),
      endDateTime: end.toISOString(),
      $select: select,
      $orderby: "start/dateTime",
      $top: 100,
    })}`;
  const events: GraphEvent[] = [];
  for (let page = 0; next && page < 5; page++) {
    const json: { value: GraphEvent[]; "@odata.nextLink"?: string } = await graphJson(
      account,
      next,
      {},
      ['outlook.timezone="UTC"'],
    );
    events.push(...json.value);
    next = json["@odata.nextLink"];
  }

  const range = `${fmtDay(start, tz)} – ${fmtDay(new Date(end.getTime() - 1), tz)} (${tz})`;
  if (!events.length) return `No events ${range}.`;

  const lines = [`${events.length} event${events.length === 1 ? "" : "s"}, ${range}${next ? " — more exist beyond the first 500; narrow the range" : ""}`, ""];
  let lastDay = "";
  for (const e of events) {
    const s = graphUtc(e.start.dateTime);
    const en = graphUtc(e.end.dateTime);
    const day = fmtDay(s, tz);
    if (day !== lastDay) {
      lines.push(`## ${day}`);
      lastDay = day;
    }
    const when = e.isAllDay ? "All day" : `${fmtTime(s, tz)} – ${fmtTime(en, tz)}`;
    const flags = [e.isCancelled ? "CANCELLED" : "", e.showAs && e.showAs !== "busy" ? e.showAs : ""].filter(Boolean);
    lines.push(`${when}  ${e.subject || "(no subject)"}${flags.length ? `  [${flags.join(", ")}]` : ""}`);
    const detail: string[] = [];
    if (e.location?.displayName) detail.push(`Where: ${e.location.displayName}`);
    if (e.organizer && !e.isOrganizer) detail.push(`Organizer: ${person(e.organizer)}`);
    if (e.isOrganizer) detail.push("You organize");
    const n = e.attendees?.length || 0;
    if (n) detail.push(`${n} attendee${n === 1 ? "" : "s"}`);
    const resp = e.responseStatus?.response;
    if (resp && resp !== "none" && resp !== "organizer") detail.push(`You: ${resp}`);
    if (detail.length) lines.push(`  ${detail.join(" · ")}`);
    if (e.onlineMeeting?.joinUrl) lines.push(`  Teams: ${e.onlineMeeting.joinUrl}`);
    if (e.webLink) lines.push(`  Link: ${e.webLink}`);
    lines.push(`  id: ${e.id}`);
  }
  return lines.join("\n");
}

// ----------------------------------------------------------- search_mail

const WELL_KNOWN: Record<string, string> = {
  inbox: "inbox",
  drafts: "drafts",
  draft: "drafts",
  sent: "sentitems",
  "sent items": "sentitems",
  sentitems: "sentitems",
  deleted: "deleteditems",
  "deleted items": "deleteditems",
  deleteditems: "deleteditems",
  trash: "deleteditems",
  junk: "junkemail",
  "junk email": "junkemail",
  junkemail: "junkemail",
  archive: "archive",
  outbox: "outbox",
};

async function resolveFolder(account: MsAccount, name: string): Promise<string> {
  const known = WELL_KNOWN[name.toLowerCase()];
  if (known) return known;
  type F = { id: string; displayName: string };
  const want = name.toLowerCase();
  const top: { value: F[] } = await graphJson(account, `/me/mailFolders${qs({ $select: "id,displayName", $top: 200 })}`);
  const hit = top.value.find((f) => f.displayName.toLowerCase() === want);
  if (hit) return hit.id;
  // One level down from the Inbox, where most people file things.
  const kids: { value: F[] } = await graphJson(
    account,
    `/me/mailFolders/inbox/childFolders${qs({ $select: "id,displayName", $top: 200 })}`,
  );
  const kid = kids.value.find((f) => f.displayName.toLowerCase() === want);
  if (kid) return kid.id;
  const names = top.value.map((f) => f.displayName).slice(0, 30).join(", ");
  throw new ToolError(`No folder called "${name}". Top-level folders: ${names}`);
}

interface GraphMessage {
  id: string;
  subject?: string;
  from?: Recipient;
  toRecipients?: Recipient[];
  ccRecipients?: Recipient[];
  bccRecipients?: Recipient[];
  receivedDateTime?: string;
  sentDateTime?: string;
  isRead?: boolean;
  isDraft?: boolean;
  hasAttachments?: boolean;
  bodyPreview?: string;
  webLink?: string;
  conversationId?: string;
  importance?: string;
  uniqueBody?: { content?: string };
  body?: { content?: string; contentType?: string };
}

async function searchMail(account: MsAccount, args: Args): Promise<string> {
  const tz = checkTimeZone(str(args, "timezone"));
  const query = str(args, "query");
  const sinceIn = str(args, "since");
  const folder = str(args, "folder");
  const unreadOnly = bool(args, "unread_only") ?? false;
  const limitRaw = args.limit === undefined ? 25 : Number(args.limit);
  if (!Number.isFinite(limitRaw) || limitRaw < 1) throw new ToolError("limit must be a positive number");
  const limit = Math.min(50, Math.floor(limitRaw));
  const since = sinceIn ? parseWhen(sinceIn, tz) : undefined;

  const base = folder ? `/me/mailFolders/${encodeURIComponent(await resolveFolder(account, folder))}/messages` : "/me/messages";
  const select = "id,subject,from,toRecipients,receivedDateTime,isRead,isDraft,hasAttachments,bodyPreview,webLink,conversationId,importance";

  let messages: GraphMessage[];
  let note = "";
  if (query) {
    // $search cannot be combined with $filter or $orderby on messages, so the
    // date goes into the KQL and "unread" is filtered here.
    let kql = query;
    if (since) {
      const day = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(since);
      kql = `(${kql}) AND received>=${day}`;
    }
    const top = unreadOnly ? Math.min(250, limit * 5) : limit;
    const json: { value: GraphMessage[] } = await graphJson(
      account,
      `${base}${qs({ $search: `"${kql.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`, $select: select, $top: top })}`,
    );
    messages = json.value;
    if (since) messages = messages.filter((m) => !m.receivedDateTime || new Date(m.receivedDateTime) >= since);
    if (unreadOnly) {
      const before = messages.length;
      messages = messages.filter((m) => !m.isRead);
      if (before === top) note = ` (unread filter applied to the ${top} best matches)`;
    }
    messages.sort((a, b) => (b.receivedDateTime || "").localeCompare(a.receivedDateTime || ""));
    messages = messages.slice(0, limit);
  } else {
    // receivedDateTime leads the filter because Graph rejects an $orderby on a
    // property that is not also the first one filtered ("InefficientFilter").
    const filters = [`receivedDateTime ge ${(since || new Date("2000-01-01T00:00:00Z")).toISOString()}`];
    if (unreadOnly) filters.push("isRead eq false");
    const json: { value: GraphMessage[] } = await graphJson(
      account,
      `${base}${qs({ $filter: filters.join(" and "), $orderby: "receivedDateTime desc", $select: select, $top: limit })}`,
    );
    messages = json.value;
  }

  const what = [
    query ? `matching "${query}"` : "",
    folder ? `in ${folder}` : "",
    since ? `since ${fmtDateTime(since, tz)}` : "",
    unreadOnly ? "unread only" : "",
  ]
    .filter(Boolean)
    .join(", ");
  if (!messages.length) return `No messages${what ? ` ${what}` : ""}.`;

  const lines = [`${messages.length} message${messages.length === 1 ? "" : "s"}${what ? ` ${what}` : ""}${note} — times in ${tz}`, ""];
  messages.forEach((m, i) => {
    const flags = [
      !m.isRead ? "UNREAD" : "",
      m.isDraft ? "DRAFT" : "",
      m.hasAttachments ? "attachments" : "",
      m.importance === "high" ? "high importance" : "",
    ].filter(Boolean);
    const when = m.receivedDateTime ? fmtDateTime(new Date(m.receivedDateTime), tz) : "";
    lines.push(`${i + 1}. ${when}${flags.length ? `  [${flags.join(", ")}]` : ""}`);
    lines.push(`   From: ${person(m.from)}`);
    lines.push(`   Subject: ${m.subject || "(no subject)"}`);
    if (m.bodyPreview) lines.push(`   Preview: ${m.bodyPreview.replace(/\s+/g, " ").trim().slice(0, 240)}`);
    if (m.webLink) lines.push(`   Link: ${m.webLink}`);
    lines.push(`   id: ${m.id}`);
    lines.push("");
  });
  lines.push("Use get_thread with an id to read the whole conversation.");
  return lines.join("\n");
}

// ------------------------------------------------------------- get_thread

async function getThread(account: MsAccount, args: Args): Promise<string> {
  const tz = checkTimeZone(str(args, "timezone"));
  const id = str(args, "id");
  if (!id) throw new ToolError("id is required (a message id from search_mail, or a conversation id)");

  let conversationId = id;
  try {
    const m: GraphMessage = await graphJson(account, `/me/messages/${encodeURIComponent(id)}${qs({ $select: "conversationId" })}`);
    if (m.conversationId) conversationId = m.conversationId;
  } catch (e) {
    // Not a message id: treat it as a conversation id below.
    if (!(e instanceof GraphError) || (e.status !== 400 && e.status !== 404)) throw e;
  }

  const select =
    "id,subject,from,toRecipients,ccRecipients,receivedDateTime,sentDateTime,isDraft,hasAttachments,webLink,uniqueBody,conversationId";
  const json: { value: GraphMessage[] } = await graphJson(
    account,
    `/me/messages${qs({ $filter: `conversationId eq ${odataString(conversationId)}`, $select: select, $top: 50 })}`,
    {},
    ['outlook.body-content-type="text"'],
  );
  const msgs = json.value.sort((a, b) =>
    (a.sentDateTime || a.receivedDateTime || "").localeCompare(b.sentDateTime || b.receivedDateTime || ""),
  );
  if (!msgs.length) throw new ToolError("No message or conversation with that id");

  const perMessage = Math.max(1500, Math.floor(40000 / msgs.length));
  const lines = [
    `Thread: ${msgs[msgs.length - 1].subject || "(no subject)"}`,
    `${msgs.length} message${msgs.length === 1 ? "" : "s"}, oldest first — times in ${tz}`,
    "",
  ];
  msgs.forEach((m, i) => {
    const when = m.sentDateTime || m.receivedDateTime;
    lines.push(`--- ${i + 1}/${msgs.length}${m.isDraft ? "  [DRAFT]" : ""}`);
    lines.push(`From: ${person(m.from)}`);
    if (m.toRecipients?.length) lines.push(`To: ${people(m.toRecipients)}`);
    if (m.ccRecipients?.length) lines.push(`Cc: ${people(m.ccRecipients)}`);
    if (when) lines.push(`Date: ${fmtDateTime(new Date(when), tz)}`);
    if (m.hasAttachments) lines.push("Attachments: yes");
    if (m.webLink) lines.push(`Link: ${m.webLink}`);
    lines.push(`id: ${m.id}`);
    lines.push("");
    lines.push(tidyText(m.uniqueBody?.content || "", perMessage) || "(no text)");
    lines.push("");
  });
  lines.push("To reply, call create_draft with reply_to_id set to the id of the message you are answering.");
  return lines.join("\n");
}

// ----------------------------------------------------------- create_draft

async function createDraft(account: MsAccount, args: Args): Promise<string> {
  const to = recipients(args, "to");
  const cc = recipients(args, "cc");
  const subject = str(args, "subject");
  const html = bodyHtml(args);
  const replyTo = str(args, "reply_to_id");
  const replyAll = bool(args, "reply_all") ?? true;

  let draft: GraphMessage;
  if (replyTo) {
    // Let Outlook build the reply (recipients, "RE:", the quoted thread), then
    // put the new text on top of it.
    const action = replyAll ? "createReplyAll" : "createReply";
    const made: GraphMessage = await graphJson(account, `/me/messages/${encodeURIComponent(replyTo)}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const patch: Record<string, unknown> = {};
    if (html !== undefined) {
      const existing = made.body?.content || "";
      const content = /<body[^>]*>/i.test(existing)
        ? existing.replace(/<body[^>]*>/i, (tag) => `${tag}${html}<br>`)
        : `${html}<br>${existing}`;
      patch.body = { contentType: "HTML", content };
    }
    if (to) patch.toRecipients = to;
    if (cc) patch.ccRecipients = cc;
    if (subject) patch.subject = subject;
    draft = Object.keys(patch).length
      ? await graphJson(account, `/me/messages/${encodeURIComponent(made.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        })
      : made;
  } else {
    if (!to?.length) throw new ToolError("to is required for a new email (or pass reply_to_id to reply)");
    draft = await graphJson(account, "/me/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subject: subject || "",
        body: { contentType: "HTML", content: html || "" },
        toRecipients: to,
        ccRecipients: cc || [],
      }),
    });
  }

  return [
    `Draft saved in Outlook (NOT sent).`,
    `To: ${people(draft.toRecipients) || "(nobody yet)"}`,
    draft.ccRecipients?.length ? `Cc: ${people(draft.ccRecipients)}` : "",
    `Subject: ${draft.subject || "(no subject)"}`,
    draft.webLink ? `Link: ${draft.webLink}` : "",
    `draft_id: ${draft.id}`,
    "",
    "Your Outlook signature is not added by this tool. To send it, call send_mail with this draft_id.",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

// -------------------------------------------------------------- send_mail

async function sendMail(account: MsAccount, args: Args): Promise<string> {
  const id = str(args, "draft_id");
  if (!id) throw new ToolError("draft_id is required — make one with create_draft first");
  let m: GraphMessage;
  try {
    m = await graphJson(
      account,
      `/me/messages/${encodeURIComponent(id)}${qs({ $select: "id,isDraft,subject,toRecipients,ccRecipients,bccRecipients" })}`,
    );
  } catch (e) {
    if (e instanceof GraphError && (e.status === 404 || e.status === 400))
      throw new ToolError("No draft with that id. It may already have been sent or deleted.");
    throw e;
  }
  if (!m.isDraft) throw new ToolError("That message is not a draft. send_mail only sends drafts made with create_draft.");
  const count = (m.toRecipients?.length || 0) + (m.ccRecipients?.length || 0) + (m.bccRecipients?.length || 0);
  if (!count) throw new ToolError("The draft has no recipients. Recreate it with create_draft and a to address.");

  await graph(account, `/me/messages/${encodeURIComponent(id)}/send`, { method: "POST", body: "" });
  return [
    "Sent.",
    `To: ${people(m.toRecipients)}`,
    m.ccRecipients?.length ? `Cc: ${people(m.ccRecipients)}` : "",
    `Subject: ${m.subject || "(no subject)"}`,
    "A copy is in Sent Items.",
  ]
    .filter(Boolean)
    .join("\n");
}

// ----------------------------------------------------------- create_event

async function createEvent(account: MsAccount, args: Args): Promise<string> {
  const tz = checkTimeZone(str(args, "timezone"));
  const subject = str(args, "subject");
  const startIn = str(args, "start");
  const endIn = str(args, "end");
  if (!subject) throw new ToolError("subject is required");
  if (!startIn || !endIn) throw new ToolError("start and end are required (ISO 8601)");
  const start = parseWhen(startIn, tz);
  const end = parseWhen(endIn, tz);
  if (end <= start) throw new ToolError("end must be after start");
  const attendees = recipients(args, "attendees") || [];
  const location = str(args, "location");
  const html = bodyHtml(args);
  const teams = bool(args, "teams_meeting") ?? false;

  const ev: GraphEvent = await graphJson(account, "/me/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      subject,
      start: graphZone(start, tz),
      end: graphZone(end, tz),
      ...(location ? { location: { displayName: location } } : {}),
      ...(html !== undefined ? { body: { contentType: "HTML", content: html } } : {}),
      attendees: attendees.map((a) => ({ ...a, type: "required" })),
      ...(teams ? { isOnlineMeeting: true, onlineMeetingProvider: "teamsForBusiness" } : {}),
    }),
  });

  const lines = [
    "Event created on your calendar.",
    `${subject}`,
    `${fmtDateTime(start, tz)} – ${fmtTime(end, tz)} (${tz})`,
    location ? `Where: ${location}` : "",
    attendees.length ? `Invitations sent to: ${people(attendees)}` : "No attendees (no invitations sent).",
  ];
  if (teams) {
    lines.push(
      ev.onlineMeeting?.joinUrl
        ? `Teams: ${ev.onlineMeeting.joinUrl}`
        : "Teams meeting was requested but Outlook did not add one (this mailbox may not allow Teams meetings from the API).",
    );
  }
  if (ev.webLink) lines.push(`Link: ${ev.webLink}`);
  lines.push(`id: ${ev.id}`);
  return lines.filter(Boolean).join("\n");
}

// ------------------------------------------------------------ definitions

const TZ_PROP = {
  type: "string",
  description: "IANA time zone for reading and writing times, e.g. America/New_York. Defaults to the server's zone.",
};
const BODY_TYPE = { type: "string", enum: ["text", "html"], description: 'Format of body. Default "text".' };
const PEOPLE = {
  type: "array",
  items: { type: "string" },
  description: 'Email addresses, each "ann@x.com" or "Ann Lee <ann@x.com>".',
};

export const TOOLS = [
  {
    name: "list_events",
    title: "List calendar events",
    description:
      "List events on the user's Outlook calendar between start and end (recurring meetings expanded). Returns plain text with time, subject, location, organizer, Teams link and an Outlook web link for each event.",
    inputSchema: {
      type: "object",
      properties: {
        start: { type: "string", description: "Start, ISO 8601. A bare date (2026-11-24) means midnight in timezone." },
        end: { type: "string", description: "End, ISO 8601. A bare date includes that whole day." },
        timezone: TZ_PROP,
      },
      required: ["start", "end"],
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "search_mail",
    title: "Search mail",
    description:
      "Search the user's Outlook mailbox. With no query, lists the newest messages. query uses Outlook search syntax (words, from:, to:, subject:, hasattachments:true). Returns plain text with date, sender, subject, a short preview, an Outlook web link and the message id for each result.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Outlook search terms. Omit to list recent mail." },
        since: { type: "string", description: "Only mail received on or after this date/time (ISO 8601)." },
        folder: { type: "string", description: "Folder name: inbox, sent, drafts, archive, deleted, junk, or a folder's display name. Omit for all folders." },
        unread_only: { type: "boolean", description: "Only unread messages." },
        limit: { type: "number", description: "Maximum results, 1-50. Default 25." },
        timezone: TZ_PROP,
      },
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "get_thread",
    title: "Read a conversation",
    description:
      "Read a whole email conversation, oldest first, as plain text (new text of each message only, without repeated quotes), with an Outlook web link and id for every message. Pass a message id from search_mail (or a conversation id).",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "A message id or conversation id." }, timezone: TZ_PROP },
      required: ["id"],
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "create_draft",
    title: "Create a draft email",
    description:
      "Save an email as a draft in Outlook. Does NOT send. For a reply, pass reply_to_id (the message being answered): Outlook fills in recipients, subject and the quoted thread, and body goes on top; to/cc/subject then override. Returns draft_id for send_mail.",
    inputSchema: {
      type: "object",
      properties: {
        to: PEOPLE,
        cc: PEOPLE,
        subject: { type: "string" },
        body: { type: "string", description: "The message. Plain text unless body_type is html." },
        body_type: BODY_TYPE,
        reply_to_id: { type: "string", description: "Message id to reply to. Omit for a new email." },
        reply_all: { type: "boolean", description: "When replying, reply to everyone (default true) or only the sender." },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: "send_mail",
    title: "Send a draft",
    description:
      "Send an existing Outlook draft, by the draft_id create_draft returned. Sends nothing else: it refuses any message that is not a draft. This emails real people and cannot be undone.",
    inputSchema: {
      type: "object",
      properties: { draft_id: { type: "string", description: "The draft_id from create_draft." } },
      required: ["draft_id"],
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  },
  {
    name: "create_event",
    title: "Create a calendar event",
    description:
      "Create an event on the user's Outlook calendar. If attendees are given, Outlook sends them invitations immediately. teams_meeting adds a Teams link.",
    inputSchema: {
      type: "object",
      properties: {
        subject: { type: "string" },
        start: { type: "string", description: "Start, ISO 8601 (wall time in timezone unless it has an offset)." },
        end: { type: "string", description: "End, ISO 8601." },
        attendees: PEOPLE,
        location: { type: "string" },
        body: { type: "string", description: "Event description. Plain text unless body_type is html." },
        body_type: BODY_TYPE,
        teams_meeting: { type: "boolean", description: "Add a Microsoft Teams meeting link." },
        timezone: TZ_PROP,
      },
      required: ["subject", "start", "end"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
];

const HANDLERS: Record<string, (account: MsAccount, args: Args) => Promise<string>> = {
  list_events: listEvents,
  search_mail: searchMail,
  get_thread: getThread,
  create_draft: createDraft,
  send_mail: sendMail,
  create_event: createEvent,
};

export async function callTool(
  account: MsAccount,
  name: string,
  args: Args,
): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
  const handler = HANDLERS[name];
  if (!handler) return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  try {
    const text = await handler(account, args || {});
    return { content: [{ type: "text", text }] };
  } catch (e) {
    if (e instanceof ToolError) return { content: [{ type: "text", text: e.message }], isError: true };
    if (e instanceof GraphError) {
      // Status and code only. Never the request or response body.
      console.error(`[mcp] ${name} graph error ${e.status} ${e.code}`);
      const hint =
        e.status === 403
          ? " Outlook refused: the connector may be missing a permission. Reconnect it in claude.ai settings."
          : "";
      return { content: [{ type: "text", text: `Outlook said: ${e.message}${e.code ? ` (${e.code})` : ""}.${hint}` }], isError: true };
    }
    if (e instanceof MsAuthError) {
      console.error(`[mcp] ${name} microsoft token error ${e.code}`);
      return { content: [{ type: "text", text: `Couldn't get a Microsoft token: ${e.message}` }], isError: true };
    }
    throw e;
  }
}
