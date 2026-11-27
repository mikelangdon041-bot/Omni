// The PC route for the Outlook tools. SERVER ONLY.
//
// Each tool call becomes a row in mcp_pc_jobs. The Omni bridge on the user's
// PC (public/outlook/omni-bridge.ps1) polls for it, does the work in classic
// Outlook, and writes the answer back. This side validates the arguments,
// turns every time into UTC, waits for the answer, deletes the row, and writes
// the plain-text reply.
//
// Why: Outlook on the PC is already signed in to the work mailbox, so nothing
// here needs Microsoft Graph or an Entra app, and nothing needs tenant consent.
//
// Rules shared with the Graph route: plain text out, an id on every item, no
// message content in logs, and send_mail sends existing drafts only. One
// difference: classic Outlook has no per-item web links, so items carry their
// Outlook id instead.

import { createAdminClient } from "@/lib/supabase/admin";
import { sha256 } from "./crypto";
import { ToolError } from "./errors";
import { checkTimeZone, fmtDateTime, fmtDay, fmtTime, parseWhen } from "./time";
import { bodyHtml, bool, recipients, str, tidyText, type Recipient } from "./tools";

type Args = Record<string, unknown>;
type Result = { content: { type: "text"; text: string }[]; isError?: boolean };

/** How recent the bridge's last check-in must be to count as online. It polls every ~1.5 s. */
const ONLINE_MS = 20_000;
/** The bridge expires queued jobs at 40 s (mcp_bridge_poll), so give up a little later. */
const QUEUE_WAIT_MS = 42_000;
/** Once the PC has claimed a job, how long to wait for it to finish. */
const RUN_WAIT_MS = 52_000;

const addr = (list?: Recipient[]) => (list || []).map((r) => r.emailAddress);

// -------------------------------------------------------- argument shaping

function shape(name: string, args: Args): Args {
  switch (name) {
    case "list_events": {
      const tz = checkTimeZone(str(args, "timezone"));
      const startIn = str(args, "start");
      const endIn = str(args, "end");
      if (!startIn || !endIn) throw new ToolError("start and end are required (ISO 8601)");
      const start = parseWhen(startIn, tz);
      const end = parseWhen(endIn, tz, true);
      if (end <= start) throw new ToolError("end must be after start");
      if (end.getTime() - start.getTime() > 62 * 86400_000) throw new ToolError("Ask for at most 62 days at a time");
      return { start_utc: start.toISOString(), end_utc: end.toISOString() };
    }
    case "search_mail": {
      const tz = checkTimeZone(str(args, "timezone"));
      const since = str(args, "since");
      const limitRaw = args.limit === undefined ? 25 : Number(args.limit);
      if (!Number.isFinite(limitRaw) || limitRaw < 1) throw new ToolError("limit must be a positive number");
      return {
        query: str(args, "query") || "",
        since_utc: since ? parseWhen(since, tz).toISOString() : "",
        folder: str(args, "folder") || "",
        unread_only: bool(args, "unread_only") ?? false,
        limit: Math.min(50, Math.floor(limitRaw)),
      };
    }
    case "get_thread": {
      const id = str(args, "id");
      if (!id) throw new ToolError("id is required (a message id from search_mail)");
      return { id };
    }
    case "create_draft": {
      const replyTo = str(args, "reply_to_id") || "";
      const to = recipients(args, "to");
      if (!replyTo && !to?.length) throw new ToolError("to is required for a new email (or pass reply_to_id to reply)");
      return {
        to: addr(to),
        cc: addr(recipients(args, "cc")),
        to_set: !!to,
        cc_set: !!recipients(args, "cc"),
        subject: str(args, "subject") || "",
        html: bodyHtml(args) ?? "",
        reply_to_id: replyTo,
        reply_all: bool(args, "reply_all") ?? true,
      };
    }
    case "send_mail": {
      const id = str(args, "draft_id");
      if (!id) throw new ToolError("draft_id is required — make one with create_draft first");
      return { draft_id: id };
    }
    case "create_event": {
      const tz = checkTimeZone(str(args, "timezone"));
      const subject = str(args, "subject");
      const startIn = str(args, "start");
      const endIn = str(args, "end");
      if (!subject) throw new ToolError("subject is required");
      if (!startIn || !endIn) throw new ToolError("start and end are required (ISO 8601)");
      const start = parseWhen(startIn, tz);
      const end = parseWhen(endIn, tz);
      if (end <= start) throw new ToolError("end must be after start");
      const body = typeof args.body === "string" ? args.body : "";
      const isHtml = str(args, "body_type") === "html";
      return {
        subject,
        start_utc: start.toISOString(),
        end_utc: end.toISOString(),
        attendees: addr(recipients(args, "attendees")),
        location: str(args, "location") || "",
        // Appointment bodies are plain text in Outlook's object model.
        body: isHtml ? body.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n\n").replace(/<[^>]+>/g, "").trim() : body,
        teams_meeting: bool(args, "teams_meeting") ?? false,
      };
    }
    default:
      throw new ToolError(`Unknown tool: ${name}`);
  }
}

// ------------------------------------------------------------- the relay

function ago(ms: number): string {
  const m = Math.round(ms / 60000);
  if (m < 1) return "under a minute ago";
  if (m < 120) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} hours ago`;
  return `${Math.round(h / 24)} days ago`;
}

async function relay(userId: string, tool: string, args: Args): Promise<Record<string, unknown>> {
  const admin = createAdminClient();

  const { data: bridge } = await admin
    .from("outlook_bridges")
    .select("last_seen,last_note")
    .eq("user_id", userId)
    .maybeSingle();
  if (!bridge) {
    throw new ToolError("No PC is set up to answer for Outlook yet. Install the Omni bridge on the PC where Outlook runs.");
  }
  const seen = bridge.last_seen ? Date.now() - new Date(bridge.last_seen).getTime() : Infinity;
  if (seen > ONLINE_MS) {
    throw new ToolError(
      `The PC with Outlook isn't answering (last check-in ${bridge.last_seen ? ago(seen) : "never"}). It needs to be on and signed in to Windows; the Omni bridge starts on its own at sign-in.`,
    );
  }
  if (bridge.last_note && bridge.last_note !== "ok") {
    // e.g. "Outlook isn't open and couldn't be started". Still try: the job may start it.
  }

  // Sweep leftovers (a crashed wait, an answer nobody read).
  await admin.from("mcp_pc_jobs").delete().lt("created_at", new Date(Date.now() - 10 * 60_000).toISOString());

  const { data: job, error } = await admin
    .from("mcp_pc_jobs")
    .insert({ user_id: userId, tool, args })
    .select("id")
    .single();
  if (error || !job) throw new Error(`queue insert failed: ${error?.code || "unknown"}`);

  const started = Date.now();
  let claimed = false;
  try {
    for (;;) {
      await new Promise((r) => setTimeout(r, 350));
      const { data: row } = await admin
        .from("mcp_pc_jobs")
        .select("status,result")
        .eq("id", job.id)
        .maybeSingle();
      if (!row) throw new ToolError("The request disappeared before the PC answered. Try again.");
      if (row.status === "done") return (row.result as Record<string, unknown>) || {};
      if (row.status === "error") {
        const msg = (row.result as { error?: string } | null)?.error || "Outlook reported an error";
        throw new ToolError(`Outlook on the PC said: ${msg}`);
      }
      if (row.status === "expired") throw new ToolError("The PC didn't pick the request up in time. Try again.");
      if (row.status === "running") claimed = true;
      const waited = Date.now() - started;
      if (!claimed && waited > QUEUE_WAIT_MS) {
        // Only expire it if the PC still hasn't taken it, so a send can't run after we've said it failed.
        const { data: gone } = await admin
          .from("mcp_pc_jobs")
          .update({ status: "expired" })
          .eq("id", job.id)
          .eq("status", "queued")
          .select("id");
        if (gone?.length) throw new ToolError("The PC didn't pick the request up in time. Try again.");
        claimed = true;
      }
      if (claimed && waited > RUN_WAIT_MS) {
        throw new ToolError(
          tool === "send_mail"
            ? "Outlook is still working on it. It may still send: check Sent Items before trying again."
            : "Outlook on the PC is taking too long. Try again, or narrow the request.",
        );
      }
    }
  } finally {
    // The answer has been read (or abandoned); the content should not linger.
    if (!claimed || Date.now() - started <= RUN_WAIT_MS) await admin.from("mcp_pc_jobs").delete().eq("id", job.id);
  }
}

// ------------------------------------------------------------- formatting

interface PcEvent {
  id: string;
  subject?: string;
  start_utc: string;
  end_utc: string;
  all_day?: boolean;
  location?: string;
  organizer?: string;
  is_organizer?: boolean;
  attendees?: number;
  response?: string;
  busy?: string;
  cancelled?: boolean;
  teams_url?: string;
}

function fmtEvents(data: { events?: PcEvent[]; truncated?: boolean }, args: Args, tz: string): string {
  const start = new Date(String(args.start_utc));
  const end = new Date(String(args.end_utc));
  const events = data.events || [];
  const range = `${fmtDay(start, tz)} – ${fmtDay(new Date(end.getTime() - 1), tz)} (${tz})`;
  if (!events.length) return `No events ${range}.`;
  const lines = [`${events.length} event${events.length === 1 ? "" : "s"}, ${range}${data.truncated ? " — more exist; narrow the range" : ""}`, ""];
  let lastDay = "";
  for (const e of events) {
    const s = new Date(e.start_utc);
    const en = new Date(e.end_utc);
    const day = fmtDay(s, tz);
    if (day !== lastDay) {
      lines.push(`## ${day}`);
      lastDay = day;
    }
    const when = e.all_day ? "All day" : `${fmtTime(s, tz)} – ${fmtTime(en, tz)}`;
    const flags = [e.cancelled ? "CANCELLED" : "", e.busy && e.busy !== "busy" ? e.busy : ""].filter(Boolean);
    lines.push(`${when}  ${e.subject || "(no subject)"}${flags.length ? `  [${flags.join(", ")}]` : ""}`);
    const detail: string[] = [];
    if (e.location) detail.push(`Where: ${e.location}`);
    if (e.is_organizer) detail.push("You organize");
    else if (e.organizer) detail.push(`Organizer: ${e.organizer}`);
    if (e.attendees) detail.push(`${e.attendees} attendee${e.attendees === 1 ? "" : "s"}`);
    if (e.response && !["none", "organizer"].includes(e.response)) detail.push(`You: ${e.response}`);
    if (detail.length) lines.push(`  ${detail.join(" · ")}`);
    if (e.teams_url) lines.push(`  Teams: ${e.teams_url}`);
    lines.push(`  id: ${e.id}`);
  }
  return lines.join("\n");
}

interface PcMail {
  id: string;
  subject?: string;
  from_name?: string;
  from_email?: string;
  received_utc?: string;
  unread?: boolean;
  draft?: boolean;
  attachments?: number;
  importance?: string;
  preview?: string;
  folder?: string;
}

const who = (name?: string, email?: string) =>
  name && email && name !== email ? `${name} <${email}>` : email || name || "(unknown)";

function fmtMail(data: { messages?: PcMail[]; folders?: string[] }, args: Args, tz: string): string {
  const msgs = data.messages || [];
  const what = [
    args.query ? `matching "${args.query}"` : "",
    data.folders?.length ? `in ${data.folders.join(", ")}` : "",
    args.since_utc ? `since ${fmtDateTime(new Date(String(args.since_utc)), tz)}` : "",
    args.unread_only ? "unread only" : "",
  ]
    .filter(Boolean)
    .join(", ");
  if (!msgs.length) return `No messages${what ? ` ${what}` : ""}.`;
  const lines = [`${msgs.length} message${msgs.length === 1 ? "" : "s"}${what ? ` ${what}` : ""} — times in ${tz}`, ""];
  msgs.forEach((m, i) => {
    const flags = [
      m.unread ? "UNREAD" : "",
      m.draft ? "DRAFT" : "",
      m.attachments ? "attachments" : "",
      m.importance === "high" ? "high importance" : "",
    ].filter(Boolean);
    const when = m.received_utc ? fmtDateTime(new Date(m.received_utc), tz) : "";
    lines.push(`${i + 1}. ${when}${flags.length ? `  [${flags.join(", ")}]` : ""}${m.folder ? `  (${m.folder})` : ""}`);
    lines.push(`   From: ${who(m.from_name, m.from_email)}`);
    lines.push(`   Subject: ${m.subject || "(no subject)"}`);
    if (m.preview) lines.push(`   Preview: ${m.preview.replace(/\s+/g, " ").trim().slice(0, 240)}`);
    lines.push(`   id: ${m.id}`);
    lines.push("");
  });
  lines.push("Use get_thread with an id to read the whole conversation.");
  return lines.join("\n");
}

interface PcThreadMsg {
  id: string;
  from_name?: string;
  from_email?: string;
  to?: string;
  cc?: string;
  sent_utc?: string;
  attachments?: string[];
  draft?: boolean;
  body?: string;
}

function fmtThread(data: { subject?: string; messages?: PcThreadMsg[] }, tz: string): string {
  const msgs = data.messages || [];
  if (!msgs.length) throw new ToolError("No message with that id");
  const per = Math.max(1500, Math.floor(40000 / msgs.length));
  const lines = [`Thread: ${data.subject || "(no subject)"}`, `${msgs.length} message${msgs.length === 1 ? "" : "s"}, oldest first — times in ${tz}`, ""];
  msgs.forEach((m, i) => {
    lines.push(`--- ${i + 1}/${msgs.length}${m.draft ? "  [DRAFT]" : ""}`);
    lines.push(`From: ${who(m.from_name, m.from_email)}`);
    if (m.to) lines.push(`To: ${m.to}`);
    if (m.cc) lines.push(`Cc: ${m.cc}`);
    if (m.sent_utc) lines.push(`Date: ${fmtDateTime(new Date(m.sent_utc), tz)}`);
    if (m.attachments?.length) lines.push(`Attachments: ${m.attachments.join(", ")}`);
    lines.push(`id: ${m.id}`);
    lines.push("");
    lines.push(tidyText(m.body || "", per) || "(no text)");
    lines.push("");
  });
  lines.push("To reply, call create_draft with reply_to_id set to the id of the message you are answering.");
  return lines.join("\n");
}

function format(tool: string, data: Record<string, unknown>, args: Args, tz: string): string {
  const d = data as Record<string, string & string[] & boolean>;
  switch (tool) {
    case "list_events":
      return fmtEvents(data, args, tz);
    case "search_mail":
      return fmtMail(data, args, tz);
    case "get_thread":
      return fmtThread(data, tz);
    case "create_draft":
      return [
        "Draft saved in Outlook (NOT sent).",
        `To: ${d.to || "(nobody yet)"}`,
        d.cc ? `Cc: ${d.cc}` : "",
        `Subject: ${d.subject || "(no subject)"}`,
        `draft_id: ${d.id}`,
        "",
        "Your Outlook signature is not added by this tool. To send it, call send_mail with this draft_id.",
      ]
        .filter((l, i, a) => l !== "" || (i > 0 && a[i - 1] !== ""))
        .join("\n");
    case "send_mail":
      return ["Sent.", `To: ${d.to}`, d.cc ? `Cc: ${d.cc}` : "", `Subject: ${d.subject || "(no subject)"}`, "A copy is in Sent Items."]
        .filter(Boolean)
        .join("\n");
    case "create_event": {
      const s = new Date(String(args.start_utc));
      const e = new Date(String(args.end_utc));
      const attendees = (args.attendees as { address: string }[]) || [];
      return [
        "Event created on your calendar.",
        String(args.subject),
        `${fmtDateTime(s, tz)} – ${fmtTime(e, tz)} (${tz})`,
        args.location ? `Where: ${args.location}` : "",
        attendees.length ? `Invitations sent to: ${attendees.map((a) => a.address).join(", ")}` : "No attendees (no invitations sent).",
        args.teams_meeting ? "Teams link: not added. Outlook only adds Teams links from its own button; open the event in Outlook and click Teams Meeting if you need one." : "",
        `id: ${d.id}`,
      ]
        .filter(Boolean)
        .join("\n");
    }
    default:
      return JSON.stringify(data);
  }
}

/**
 * send_mail, at most once per draft. Right after Send(), Outlook keeps listing
 * the message in Drafts as unsent for a few seconds, and a repeated call sent
 * a second copy (2026-11-27). The draft is claimed in mcp_sent_drafts first;
 * the claim is released only when the PC definitely did not send.
 */
async function sendOnce(userId: string, shaped: Args): Promise<Record<string, unknown>> {
  const admin = createAdminClient();
  const draftHash = sha256(String(shaped.draft_id));
  const { error } = await admin.from("mcp_sent_drafts").insert({ user_id: userId, draft_hash: draftHash });
  if (error) {
    if (error.code === "23505") throw new ToolError("That draft has already been sent. Check Sent Items; nothing was sent again.");
    throw new Error(`sent-draft claim failed: ${error.code}`);
  }
  try {
    return await relay(userId, "send_mail", shaped);
  } catch (e) {
    // "may still send" is the one outcome where it might have gone out: keep the claim.
    if (!(e instanceof ToolError && /may still send/.test(e.message))) {
      await admin.from("mcp_sent_drafts").delete().eq("user_id", userId).eq("draft_hash", draftHash);
    }
    throw e;
  }
}

export async function callPcTool(userId: string, name: string, args: Args): Promise<Result> {
  try {
    const tz = checkTimeZone(typeof args?.timezone === "string" ? args.timezone : undefined);
    const shaped = shape(name, args || {});
    const data = name === "send_mail" ? await sendOnce(userId, shaped) : await relay(userId, name, shaped);
    return { content: [{ type: "text", text: format(name, data, shaped, tz) }] };
  } catch (e) {
    if (e instanceof ToolError) return { content: [{ type: "text", text: e.message }], isError: true };
    console.error(`[mcp] pc ${name} failed: ${(e as Error).message?.slice(0, 120)}`);
    return { content: [{ type: "text", text: "Something went wrong reaching your PC. Try again." }], isError: true };
  }
}
