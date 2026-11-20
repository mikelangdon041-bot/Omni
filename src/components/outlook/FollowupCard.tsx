"use client";

// "Remind or follow up" in the Outlook pane.
//
// Writes a reminder to go out on a later day and a follow-up for when nobody
// answers, both shown here to edit before anything is saved. The pane cannot
// send next week or see replies, so the sending is done by a small scheduled
// task on the user's PC driving classic Outlook (public/outlook/omni-runner.ps1):
// the reminder is handed to Outlook straight away with "Do not deliver before"
// set, and the follow-up is written as a reply only if nobody has answered by
// its date, then sent or left in Drafts, as chosen here.
// See supabase/migrations/0040_email_followups.sql.

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { DirectoryPerson, Resolved } from "@/lib/directory";
import {
  aWeekFrom,
  fromInputs,
  replySubject,
  toInputs,
  whenLabel,
  workingDaysAfter,
  type FollowupRow,
} from "@/lib/followups";
import { nowForModel, PersonSearch } from "./MeetingCard";

const supabase = createClient();

interface Plan {
  to: Resolved[];
  subject: string;
  remind: boolean;
  remindDate: string;
  remindTime: string;
  reminder: string;
  why: string;
  follow: boolean;
  followDate: string;
  followTime: string;
  followup: string;
  mode: "draft" | "send";
}

interface Runner {
  last_seen: string | null;
  last_note: string;
}

const dismissKey = (subject: string, from: string) =>
  `omni.followupNudge:${from.toLowerCase()}|${subject.toLowerCase()}`;
function readFlag(key: string) {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}
function writeFlag(key: string) {
  try {
    localStorage.setItem(key, "1");
  } catch {
    // Only the nudge comes back; nothing else depends on it.
  }
}

async function sha256Hex(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function FollowupCard({
  userId,
  subject,
  from,
  thread,
  people,
  me,
  messageId,
  nudge,
  voices,
  signature,
  signsOff,
  wordSwaps,
}: {
  userId: string;
  subject: string;
  from: string;
  thread: string;
  people: DirectoryPerson[];
  me: { name: string; email: string };
  /** Office's internetMessageId for the open email; "" for a draft. */
  messageId: string;
  /** Offer it without being asked: the user sent this, or just set up invites. */
  nudge: string;
  voices: { name: string; text: string; samples?: string }[];
  signature: string;
  signsOff: boolean;
  wordSwaps: { avoid: string; prefer: string }[];
}) {
  const [expanded, setExpanded] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [request, setRequest] = useState("");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<FollowupRow[]>([]);
  const [runner, setRunner] = useState<Runner | null | undefined>(undefined);
  // When the check-in time was read, so "hours ago" is judged against that.
  const [loadedAt, setLoadedAt] = useState(0);
  const [token, setToken] = useState("");
  const [dismissed, setDismissed] = useState(() => readFlag(dismissKey(subject, from)));

  const load = useCallback(async () => {
    const [{ data: rows }, { data: r }] = await Promise.all([
      supabase
        .from("email_followups")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(40),
      supabase
        .from("outlook_runners")
        .select("last_seen, last_note")
        .eq("user_id", userId)
        .maybeSingle(),
    ]);
    setSaved((rows as FollowupRow[]) || []);
    setRunner((r as Runner) || null);
    setLoadedAt(Date.now());
  }, [userId]);

  useEffect(() => {
    // Loading is what the effect is for; setState happens after the await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const forThis = saved.filter(
    (r) =>
      (messageId && r.message_id === messageId) ||
      (!!subject && r.thread_subject.toLowerCase() === subject.toLowerCase()),
  );
  const open = saved.filter(
    (r) => r.reminder_status === "pending" || r.followup_status === "waiting",
  );

  async function draft() {
    setBusy(true);
    setError("");
    setExpanded(true);
    try {
      const res = await fetch("/api/outlook/followup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          thread,
          subject,
          request,
          people,
          me,
          now: nowForModel(),
          voices,
          signature,
          signsOff,
          wordSwaps,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "That didn't go through. Try again.");
      const remindAt = data.remindAt ? fromInputs(...(data.remindAt.split("T") as [string, string])) : null;
      const r = remindAt && remindAt > new Date() ? remindAt : aWeekFrom(new Date());
      const f = workingDaysAfter(r, 3);
      setPlan({
        to: data.to || [],
        subject: replySubject(subject) || subject,
        remind: true,
        ...(() => {
          const a = toInputs(r);
          return { remindDate: a.date, remindTime: a.time };
        })(),
        reminder: data.reminder || "",
        why: data.why || "",
        follow: true,
        ...(() => {
          const b = toInputs(f);
          return { followDate: b.date, followTime: b.time };
        })(),
        followup: data.followup || "",
        mode: "draft",
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const edit = (p: Partial<Plan>) => setPlan((x) => (x ? { ...x, ...p } : x));

  async function save() {
    if (!plan) return;
    const to = plan.to.filter((t) => t.status === "found" && t.person).map((t) => t.person!);
    const remindAt = plan.remind ? fromInputs(plan.remindDate, plan.remindTime) : null;
    const followAt = plan.follow ? fromInputs(plan.followDate, plan.followTime) : null;
    const now = new Date();
    if (!plan.remind && !plan.follow) return setError("Turn on the reminder, the follow-up, or both.");
    if (!to.length) return setError("Add who it goes to.");
    if (plan.to.some((t) => t.status !== "found"))
      return setError("Pick or remove the people still without an address.");
    if (plan.remind && (!remindAt || remindAt <= now)) return setError("Pick a reminder time in the future.");
    if (plan.follow && (!followAt || followAt <= now)) return setError("Pick a follow-up time in the future.");
    if (remindAt && followAt && followAt <= remindAt)
      return setError("The follow-up has to come after the reminder.");
    if (plan.remind && !plan.reminder.trim()) return setError("The reminder is empty.");
    if (plan.follow && !plan.followup.trim()) return setError("The follow-up is empty.");
    setSaving(true);
    setError("");
    const { error: err } = await supabase.from("email_followups").insert({
      user_id: userId,
      message_id: messageId,
      thread_subject: subject,
      to_people: to.map((p) => ({ name: p.name, email: p.email })),
      subject: plan.subject.trim() || subject,
      reminder_at: remindAt?.toISOString() ?? null,
      reminder_body: plan.remind ? plan.reminder.trim() : "",
      reminder_status: plan.remind ? "pending" : "none",
      followup_at: followAt?.toISOString() ?? null,
      followup_body: plan.follow ? plan.followup.trim() : "",
      followup_mode: plan.mode,
      followup_status: plan.follow ? "waiting" : "none",
    });
    setSaving(false);
    if (err) return setError("Couldn't save it. Try again.");
    setPlan(null);
    setRequest("");
    await load();
  }

  async function cancel(row: FollowupRow) {
    const patch: Record<string, string> = {};
    if (row.reminder_status === "pending") patch.reminder_status = "cancelled";
    if (row.followup_status === "waiting") patch.followup_status = "cancelled";
    if (!Object.keys(patch).length) return;
    // Read back: an update RLS quietly skips reports success with no rows.
    const { data } = await supabase
      .from("email_followups")
      .update(patch)
      .eq("id", row.id)
      .select("id");
    if (!data?.length) setError("Couldn't cancel that one. Try again.");
    await load();
  }

  async function connect() {
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    const t = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const { data, error: err } = await supabase
      .from("outlook_runners")
      .upsert({ user_id: userId, token_hash: await sha256Hex(t), last_seen: null, last_note: "" })
      .select("user_id");
    if (err || !data?.length) return setError("Couldn't set that up. Try again.");
    setToken(t);
    setRunner({ last_seen: null, last_note: "" });
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const installLine = token
    ? `powershell -NoProfile -ExecutionPolicy Bypass -Command "iwr ${origin}/outlook/omni-runner.ps1 -UseBasicParsing -OutFile $env:TEMP\\omni-runner.ps1; & $env:TEMP\\omni-runner.ps1 -Install -Token ${token} -Site ${origin}"`
    : "";
  const stale = !!runner?.last_seen && loadedAt - new Date(runner.last_seen).getTime() > 3 * 3600 * 1000;

  const showNudge = !!nudge && !dismissed && !expanded && !forThis.length && !plan;

  return (
    <div className="space-y-2">
      {showNudge && (
        <div className="rounded-xl border border-[var(--accent)] bg-[var(--accent-soft)] p-2.5">
          <p className="text-[11px] leading-snug text-ink">{nudge}</p>
          <div className="mt-1.5 flex gap-2">
            <button
              onClick={() => void draft()}
              className="flex-1 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90"
            >
              Yes, write it
            </button>
            <button
              onClick={() => {
                writeFlag(dismissKey(subject, from));
                setDismissed(true);
              }}
              className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-muted transition hover:text-ink"
            >
              Not now
            </button>
          </div>
        </div>
      )}

      <details
        className="rounded-xl border border-border bg-surface"
        open={expanded}
        onToggle={(e) => setExpanded((e.target as HTMLDetailsElement).open)}
      >
        <summary className="cursor-pointer list-none p-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
          {`Remind or follow up ▾${open.length ? ` · ${open.length} scheduled` : ""}`}
        </summary>
        <div className="space-y-2 px-2.5 pb-2.5">
          {forThis.length > 0 && (
            <ul className="space-y-1.5">
              {forThis.map((r) => (
                <SavedRow key={r.id} row={r} onCancel={() => void cancel(r)} />
              ))}
            </ul>
          )}

          {!plan && (
            <>
              <p className="text-[11px] leading-relaxed text-muted">
                Writes a reminder to send on a later day, and a follow-up for
                if nobody answers. You check both before anything is scheduled.
              </p>
              <textarea
                value={request}
                onChange={(e) => setRequest(e.target.value)}
                rows={2}
                placeholder='Optional, e.g. "remind Rachel to send the slides" or "remind everyone the day before the 17th"'
                className="w-full resize-none rounded-lg border border-border bg-canvas p-1.5 text-[11px] leading-snug outline-none focus:border-[var(--accent)]"
              />
              <button
                onClick={() => void draft()}
                disabled={busy}
                className="w-full rounded-lg bg-[var(--accent)] px-3 py-2 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
              >
                {busy ? "Writing them…" : "Write the reminder"}
              </button>
            </>
          )}

          {error && (
            <p className="rounded-lg border border-red-300 bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700">
              {error}
            </p>
          )}

          {plan && (
            <PlanEditor
              userId={userId}
              plan={plan}
              edit={edit}
              saving={saving}
              onSave={() => void save()}
              onDiscard={() => setPlan(null)}
            />
          )}

          <RunnerStatus
            runner={runner}
            stale={stale}
            installLine={installLine}
            onConnect={() => void connect()}
          />

          {open.length > forThis.filter((r) => open.includes(r)).length && (
            <details>
              <summary className="cursor-pointer list-none text-[10px] font-medium text-muted hover:text-ink">
                {`All scheduled (${open.length}) ▾`}
              </summary>
              <ul className="mt-1 space-y-1.5">
                {open.map((r) => (
                  <SavedRow key={r.id} row={r} showThread onCancel={() => void cancel(r)} />
                ))}
              </ul>
            </details>
          )}
        </div>
      </details>
    </div>
  );
}

function PlanEditor({
  userId,
  plan,
  edit,
  saving,
  onSave,
  onDiscard,
}: {
  userId: string;
  plan: Plan;
  edit: (p: Partial<Plan>) => void;
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
}) {
  const label = "text-[10px] font-semibold uppercase tracking-wide text-muted";
  const input =
    "w-full rounded-md border border-border bg-canvas px-2 py-1 text-[11px] outline-none focus:border-[var(--accent)]";
  const setTo = (to: Resolved[]) => edit({ to });
  return (
    <div className="space-y-2 rounded-lg border border-border p-2">
      <div>
        <p className={label}>To</p>
        <ul className="mt-1 space-y-1">
          {plan.to.map((t, i) => (
            <li key={i} className="rounded-md border border-border bg-canvas px-2 py-1 text-[11px]">
              {t.status === "found" && t.person ? (
                <div className="flex items-center gap-1">
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">{t.person.name || t.person.email}</span>{" "}
                    <span className="text-muted">{t.person.email}</span>
                  </span>
                  <button
                    onClick={() => setTo(plan.to.filter((_, j) => j !== i))}
                    className="text-muted hover:text-ink"
                    aria-label="Remove"
                  >
                    ×
                  </button>
                </div>
              ) : (
                <div>
                  <div className="flex items-center gap-1">
                    <span className="flex-1 text-amber-800">
                      {t.status === "choose"
                        ? `Which ${t.asked}?`
                        : `No address for ${t.asked}.`}
                    </span>
                    <button
                      onClick={() => setTo(plan.to.filter((_, j) => j !== i))}
                      className="text-muted hover:text-ink"
                      aria-label="Remove"
                    >
                      ×
                    </button>
                  </div>
                  {t.options.map((p) => (
                    <button
                      key={p.email}
                      onClick={() =>
                        setTo(
                          plan.to.map((x, j) =>
                            j === i ? { ...x, status: "found", person: p, options: [] } : x,
                          ),
                        )
                      }
                      className="mt-0.5 block w-full truncate rounded px-1 text-left hover:bg-[var(--accent-soft)]"
                    >
                      {`${p.name} · ${p.title || p.email}`}
                    </button>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
        <PersonSearch
          userId={userId}
          onPick={(p) =>
            !plan.to.some((t) => t.person?.email === p.email) &&
            setTo([...plan.to, { asked: p.name || p.email, status: "found", person: p, options: [] }])
          }
        />
      </div>

      <div>
        <p className={label}>Subject</p>
        <input value={plan.subject} onChange={(e) => edit({ subject: e.target.value })} className={input} />
      </div>

      <div className="space-y-1 rounded-md border border-border p-1.5">
        <label className="flex items-center gap-1.5 text-[11px] font-semibold">
          <input type="checkbox" checked={plan.remind} onChange={(e) => edit({ remind: e.target.checked })} />
          Send a reminder
        </label>
        {plan.remind && (
          <>
            <div className="flex gap-1.5">
              <input
                type="date"
                value={plan.remindDate}
                onChange={(e) => edit({ remindDate: e.target.value })}
                className={input}
              />
              <input
                type="time"
                value={plan.remindTime}
                onChange={(e) => edit({ remindTime: e.target.value })}
                className={`${input} w-28`}
              />
            </div>
            {plan.why && <p className="text-[10px] text-muted">{plan.why}</p>}
            <textarea
              value={plan.reminder}
              onChange={(e) => edit({ reminder: e.target.value })}
              rows={6}
              className={`${input} resize-y leading-snug`}
            />
          </>
        )}
      </div>

      <div className="space-y-1 rounded-md border border-border p-1.5">
        <label className="flex items-center gap-1.5 text-[11px] font-semibold">
          <input type="checkbox" checked={plan.follow} onChange={(e) => edit({ follow: e.target.checked })} />
          If nobody replies, follow up
        </label>
        {plan.follow && (
          <>
            <div className="flex gap-1.5">
              <input
                type="date"
                value={plan.followDate}
                onChange={(e) => edit({ followDate: e.target.value })}
                className={input}
              />
              <input
                type="time"
                value={plan.followTime}
                onChange={(e) => edit({ followTime: e.target.value })}
                className={`${input} w-28`}
              />
            </div>
            <p className="text-[10px] text-muted">
              {plan.remind
                ? "Only if nobody has written in the thread since the reminder."
                : "Only if nobody has written in the thread since now."}
            </p>
            <textarea
              value={plan.followup}
              onChange={(e) => edit({ followup: e.target.value })}
              rows={5}
              className={`${input} resize-y leading-snug`}
            />
            <div className="space-y-0.5 text-[11px]">
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={plan.mode === "draft"} onChange={() => edit({ mode: "draft" })} />
                Leave it in Drafts with a reminder for me to send
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={plan.mode === "send"} onChange={() => edit({ mode: "send" })} />
                Send it automatically
              </label>
            </div>
          </>
        )}
      </div>

      <div className="flex gap-2">
        <button
          onClick={onSave}
          disabled={saving}
          className="flex-1 rounded-lg bg-[var(--accent)] px-3 py-2 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
        >
          {saving ? "Saving…" : "Schedule it"}
        </button>
        <button
          onClick={onDiscard}
          className="rounded-lg border border-border px-3 py-2 text-xs font-medium text-muted transition hover:text-ink"
        >
          Discard
        </button>
      </div>
    </div>
  );
}

function SavedRow({
  row,
  showThread,
  onCancel,
}: {
  row: FollowupRow;
  showThread?: boolean;
  onCancel: () => void;
}) {
  const names = row.to_people.map((p) => p.name || p.email).join(", ");
  const reminder: Record<FollowupRow["reminder_status"], string> = {
    none: "",
    pending: "waiting for your PC to hand it to Outlook",
    scheduled:
      row.reminder_at && new Date(row.reminder_at) < new Date()
        ? "sent by Outlook"
        : "in Outlook's Outbox until then",
    failed: "didn't go through",
    cancelled: "cancelled",
  };
  const follow: Record<FollowupRow["followup_status"], string> = {
    none: "",
    waiting: row.followup_mode === "send" ? "sends itself if nobody replies" : "drafts itself if nobody replies",
    replied: "someone replied, so nothing was sent",
    drafted: "in your Drafts, waiting for you",
    sent: "sent",
    failed: "didn't go through",
    cancelled: "cancelled",
  };
  const canCancel = row.reminder_status === "pending" || row.followup_status === "waiting";
  return (
    <li className="rounded-md border border-border bg-canvas px-2 py-1.5 text-[11px] leading-snug">
      {showThread && <p className="truncate font-medium">{row.thread_subject || row.subject}</p>}
      <p className="truncate text-muted">{`To ${names}`}</p>
      {row.reminder_status !== "none" && (
        <p>{`Reminder ${whenLabel(row.reminder_at)}: ${reminder[row.reminder_status]}`}</p>
      )}
      {row.followup_status !== "none" && (
        <p>{`Follow-up ${whenLabel(row.followup_at)}: ${follow[row.followup_status]}`}</p>
      )}
      {row.result && /failed|didn't|couldn't|not found/i.test(row.result) && (
        <p className="text-red-700">{row.result}</p>
      )}
      {row.reminder_status === "scheduled" && row.reminder_at && new Date(row.reminder_at) > new Date() && (
        <p className="text-[10px] text-muted">
          To stop the reminder now, delete it from Outbox in Outlook.
        </p>
      )}
      {canCancel && (
        <button onClick={onCancel} className="mt-0.5 text-[10px] font-medium text-muted underline hover:text-ink">
          {row.reminder_status === "pending" ? "Cancel" : "Cancel the follow-up"}
        </button>
      )}
    </li>
  );
}

function RunnerStatus({
  runner,
  stale,
  installLine,
  onConnect,
}: {
  runner: Runner | null | undefined;
  stale: boolean;
  installLine: string;
  onConnect: () => void;
}) {
  if (runner === undefined) return null;
  if (installLine)
    return (
      <div className="space-y-1 rounded-md border border-border bg-canvas p-2 text-[11px] leading-snug">
        <p className="font-semibold">Set up this PC</p>
        <p className="text-muted">
          Paste this into PowerShell once. It adds a small task that checks every
          15 minutes, only while you are signed in and Outlook is open. This code
          is shown once.
        </p>
        <textarea
          readOnly
          value={installLine}
          rows={4}
          onFocus={(e) => e.target.select()}
          className="w-full resize-none rounded border border-border bg-surface p-1 font-mono text-[10px]"
        />
        <button
          onClick={() => void navigator.clipboard?.writeText(installLine)}
          className="w-full rounded-lg border border-border px-3 py-1.5 text-xs font-medium transition hover:bg-[var(--accent-soft)]"
        >
          Copy
        </button>
      </div>
    );
  if (!runner)
    return (
      <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-[11px] leading-snug text-amber-900">
        <p>
          Reminders are sent by your PC&apos;s Outlook, so this needs a one-time
          setup on the computer you use Outlook on.
        </p>
        <button onClick={onConnect} className="mt-1 font-semibold underline">
          Set up this PC
        </button>
      </div>
    );
  if (!runner.last_seen)
    return (
      <p className="text-[10px] text-muted">
        Waiting for your PC to check in for the first time.{" "}
        <button onClick={onConnect} className="underline">
          Set it up again
        </button>
      </p>
    );
  return (
    <p className={`text-[10px] ${stale || runner.last_note !== "ok" ? "text-amber-800" : "text-muted"}`}>
      {`Your PC last checked ${whenLabel(runner.last_seen)}${
        runner.last_note && runner.last_note !== "ok" ? `: ${runner.last_note}` : ""
      }.${stale ? " Reminders wait until it's on with Outlook open." : ""}`}
    </p>
  );
}
