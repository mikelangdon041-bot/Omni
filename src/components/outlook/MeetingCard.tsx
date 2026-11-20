"use client";

// "Set up a meeting" in the Outlook pane.
//
// Reads the email that is open, works out the meeting it is asking for, looks
// every attendee's address up, and opens Outlook's own new-meeting window with
// all of it filled in. The person presses Send there: nothing is sent from
// here, which is why this needs no calendar permission at all. Office.js's
// displayNewAppointmentForm is in every Outlook since Mailbox 1.1.
//
// Addresses come from three places, best first: the people on this email, the
// company directory the user imported, and everyone the pane has seen on past
// emails (learned quietly as each one is read, and kept private to the user).

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  isPersonAddress,
  parseDirectory,
  type DirectoryPerson,
  type Resolved,
} from "@/lib/directory";

const supabase = createClient();

type Attendee = Resolved & { optional: boolean };

interface Draft {
  subject: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  duration: number;
  location: string;
  agenda: string;
  attendees: Attendee[];
  note: string;
}

type AppointmentForm = {
  requiredAttendees?: (string | { emailAddress: string; displayName?: string })[];
  optionalAttendees?: (string | { emailAddress: string; displayName?: string })[];
  start?: Date;
  end?: Date;
  subject?: string;
  location?: string;
  body?: string;
};

const pad = (n: number) => String(n).padStart(2, "0");
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** The next working day at 10:00, for a thread that never said when. */
function nextWorkingMorning(): { date: string; time: string } {
  const d = new Date();
  do d.setDate(d.getDate() + 1);
  while (d.getDay() === 0 || d.getDay() === 6);
  return { date: localDate(d), time: "10:00" };
}

/** "Friday 20 November 2026, 14:05 (Europe/London)": what "Thursday" is relative to. */
function nowForModel(): string {
  const d = new Date();
  const day = d.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  return `${day}, ${pad(d.getHours())}:${pad(d.getMinutes())}${tz ? ` (${tz})` : ""} [${localDate(d)}]`;
}

const DURATIONS = [15, 30, 45, 60, 90, 120];

export function MeetingCard({
  userId,
  subject,
  thread,
  people,
  me,
}: {
  userId: string;
  subject: string;
  thread: string;
  /** Everyone on the open email, with addresses. */
  people: DirectoryPerson[];
  me: { name: string; email: string };
}) {
  const [request, setRequest] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [opened, setOpened] = useState(false);
  const [dirCount, setDirCount] = useState<number | null>(null);

  // Learn everyone on this email, quietly, so the directory fills in on its
  // own. ignoreDuplicates: a person already imported keeps their imported
  // name and title rather than whatever this header called them.
  const learnedKey = useRef("");
  useEffect(() => {
    const rows = people
      .filter((p) => isPersonAddress(p.email) && p.email !== me.email.toLowerCase())
      .map((p) => ({ user_id: userId, name: p.name, email: p.email, source: "outlook" }));
    const key = rows.map((r) => r.email).sort().join(",");
    if (!rows.length || key === learnedKey.current) return;
    learnedKey.current = key;
    void supabase
      .from("directory_people")
      .upsert(rows, { onConflict: "user_id,email", ignoreDuplicates: true })
      // A query builder only runs when something awaits it; `void` alone
      // never sends the request.
      .then(() => undefined);
  }, [people, userId, me.email]);

  async function countDirectory() {
    const { count } = await supabase
      .from("directory_people")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("source", "import");
    setDirCount(count ?? 0);
  }

  async function build() {
    setBusy(true);
    setError("");
    setOpened(false);
    try {
      const res = await fetch("/api/outlook/meeting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ thread, subject, request, people, me, now: nowForModel() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "That didn't go through. Try again.");
      const fallback = nextWorkingMorning();
      const [date, time] = data.start ? data.start.split("T") : [fallback.date, fallback.time];
      setDraft({
        subject: data.subject || subject,
        date,
        time,
        duration: data.durationMinutes || 30,
        location: data.location || "",
        agenda: data.agenda || "",
        attendees: data.attendees || [],
        note: [data.start ? "" : "Nothing in the email says when, so this is a placeholder time.", data.note]
          .filter(Boolean)
          .join(" "),
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function setAttendees(next: (a: Attendee[]) => Attendee[]) {
    setDraft((d) => (d ? { ...d, attendees: next(d.attendees) } : d));
  }

  function choose(i: number, person: DirectoryPerson) {
    setAttendees((list) =>
      list.map((a, j) => (j === i ? { ...a, status: "found", person, options: [] } : a)),
    );
  }

  function addPerson(person: DirectoryPerson) {
    setAttendees((list) =>
      list.some((a) => a.person?.email === person.email)
        ? list
        : [...list, { asked: person.name, status: "found", person, options: [], optional: false }],
    );
  }

  const ready = draft?.attendees.filter((a) => a.status === "found" && a.person) || [];
  const unsettled = draft?.attendees.filter((a) => a.status !== "found") || [];

  function openInOutlook() {
    if (!draft) return;
    const mailbox = window.Office?.context?.mailbox;
    const show = mailbox?.displayNewAppointmentForm;
    if (typeof show !== "function") {
      setError("This Outlook won't open a meeting from the pane.");
      return;
    }
    const [y, m, d] = draft.date.split("-").map(Number);
    const [hh, mm] = draft.time.split(":").map(Number);
    const start = new Date(y, m - 1, d, hh, mm);
    if (Number.isNaN(start.getTime())) {
      setError("Pick a date and time first.");
      return;
    }
    const end = new Date(start.getTime() + draft.duration * 60000);
    const asAddress = (a: Attendee) => ({
      emailAddress: a.person!.email,
      displayName: a.person!.name || a.person!.email,
    });
    const form: AppointmentForm = {
      requiredAttendees: ready.filter((a) => !a.optional).map(asAddress),
      optionalAttendees: ready.filter((a) => a.optional).map(asAddress),
      start,
      end,
      subject: draft.subject,
      location: draft.location,
      body: draft.agenda,
    };
    try {
      show.call(mailbox, form);
      setOpened(true);
      setError("");
    } catch (e) {
      setError((e as Error).message || "Outlook wouldn't open the meeting.");
    }
  }

  const field =
    "w-full rounded-md border border-border bg-canvas px-2 py-1 text-[11px] outline-none focus:border-[var(--accent)]";
  const label = "mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-muted";

  return (
    <details
      className="rounded-xl border border-border bg-surface"
      onToggle={(e) => {
        const isOpen = (e.target as HTMLDetailsElement).open;
        if (isOpen && dirCount === null) void countDirectory();
      }}
    >
      <summary className="cursor-pointer list-none p-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted">
        Set up a meeting ▾
      </summary>
      <div className="space-y-2 px-2.5 pb-2.5">
        {!draft && (
          <>
            <p className="text-[11px] leading-relaxed text-muted">
              Reads this email and fills in a meeting invite: who, when, how
              long, and an agenda. It opens in Outlook for you to check and send.
            </p>
            <textarea
              value={request}
              onChange={(e) => setRequest(e.target.value)}
              rows={2}
              placeholder='Optional, e.g. "30 min with Shane and Glenn next Tuesday afternoon"'
              className="w-full resize-none rounded-lg border border-border bg-canvas p-1.5 text-[11px] leading-snug outline-none focus:border-[var(--accent)]"
            />
            <button
              onClick={() => void build()}
              disabled={busy}
              className="w-full rounded-lg bg-[var(--accent)] px-3 py-2 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
            >
              {busy ? "Reading the email…" : "Fill in the invite"}
            </button>
          </>
        )}

        {error && (
          <p className="rounded-lg border border-red-300 bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700">
            {error}
          </p>
        )}

        {draft && (
          <>
            {draft.note && (
              <p className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[11px] leading-snug text-amber-800">
                {draft.note}
              </p>
            )}
            <div>
              <label className={label}>Subject</label>
              <input
                value={draft.subject}
                onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
                className={field}
              />
            </div>
            <div className="grid grid-cols-[1fr_auto_auto] gap-1.5">
              <div>
                <label className={label}>Date</label>
                <input
                  type="date"
                  value={draft.date}
                  onChange={(e) => setDraft({ ...draft, date: e.target.value })}
                  className={field}
                />
              </div>
              <div>
                <label className={label}>Time</label>
                <input
                  type="time"
                  value={draft.time}
                  onChange={(e) => setDraft({ ...draft, time: e.target.value })}
                  className={field}
                />
              </div>
              <div>
                <label className={label}>Length</label>
                <select
                  value={draft.duration}
                  onChange={(e) => setDraft({ ...draft, duration: Number(e.target.value) })}
                  className={field}
                >
                  {[...new Set([...DURATIONS, draft.duration])]
                    .sort((a, b) => a - b)
                    .map((m) => (
                      <option key={m} value={m}>
                        {m < 60 ? `${m} min` : `${m / 60} h`}
                      </option>
                    ))}
                </select>
              </div>
            </div>

            <div>
              <label className={label}>Who</label>
              <ul className="space-y-1">
                {draft.attendees.map((a, i) => (
                  <li
                    key={`${a.asked}-${i}`}
                    className="rounded-lg border border-border bg-canvas px-2 py-1 text-[11px]"
                  >
                    {a.status === "found" && a.person ? (
                      <div className="flex items-center gap-1.5">
                        <span className="min-w-0 flex-1 truncate">
                          <span className="font-medium">{a.person.name || a.person.email}</span>{" "}
                          <span className="text-muted">{a.person.email}</span>
                          {a.person.title && (
                            <span className="text-muted"> · {a.person.title}</span>
                          )}
                        </span>
                        <button
                          onClick={() =>
                            setAttendees((l) =>
                              l.map((x, j) => (j === i ? { ...x, optional: !x.optional } : x)),
                            )
                          }
                          className="shrink-0 text-[10px] text-muted hover:text-ink"
                          title="Required or optional"
                        >
                          {a.optional ? "optional" : "required"}
                        </button>
                        <button
                          onClick={() => setAttendees((l) => l.filter((_, j) => j !== i))}
                          className="shrink-0 text-muted hover:text-ink"
                          aria-label={`Remove ${a.person.name}`}
                        >
                          ✕
                        </button>
                      </div>
                    ) : (
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="flex-1 text-amber-800">
                            {a.status === "choose"
                              ? `Which ${a.asked}?`
                              : `No address for ${a.asked}. Find them below, or leave them off.`}
                          </span>
                          <button
                            onClick={() => setAttendees((l) => l.filter((_, j) => j !== i))}
                            className="shrink-0 text-muted hover:text-ink"
                            aria-label={`Remove ${a.asked}`}
                          >
                            ✕
                          </button>
                        </div>
                        {a.options.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {a.options.map((p) => (
                              <button
                                key={p.email}
                                onClick={() => choose(i, p)}
                                className="rounded-md border border-border px-1.5 py-0.5 text-left text-[10px] hover:border-[var(--accent)]"
                              >
                                {p.name}{" "}
                                <span className="text-muted">
                                  {p.title || p.department || p.email}
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
              <PersonSearch userId={userId} onPick={addPerson} />
            </div>

            <div>
              <label className={label}>Where (optional)</label>
              <input
                value={draft.location}
                onChange={(e) => setDraft({ ...draft, location: e.target.value })}
                placeholder="A room or address. Turn on Teams in Outlook."
                className={field}
              />
            </div>
            <div>
              <label className={label}>Agenda</label>
              <textarea
                value={draft.agenda}
                onChange={(e) => setDraft({ ...draft, agenda: e.target.value })}
                rows={4}
                className={`${field} resize-y leading-snug`}
              />
            </div>

            <div className="flex gap-2">
              <button
                onClick={openInOutlook}
                disabled={!ready.length}
                className="flex-1 rounded-lg bg-[var(--accent)] px-3 py-2.5 text-xs font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
              >
                {opened ? "Opened in Outlook ✓" : "Open the invite in Outlook"}
              </button>
              <button
                onClick={() => {
                  setDraft(null);
                  setOpened(false);
                }}
                className="rounded-lg border border-border px-3 py-2.5 text-xs font-medium text-muted transition hover:text-ink"
              >
                Start over
              </button>
            </div>
            <p className="text-[10px] leading-snug text-muted">
              {unsettled.length
                ? `${unsettled.length} ${unsettled.length === 1 ? "person has" : "people have"} no address yet and won't be invited. `
                : ""}
              Outlook opens its own meeting window with this filled in. Switch on
              Teams there if you want a call link. Nothing is sent until you
              press Send.
            </p>
          </>
        )}

        <DirectoryImport userId={userId} count={dirCount} onChanged={() => void countDirectory()} />
      </div>
    </details>
  );
}

/** Find someone in the directory by name or address and add them. */
function PersonSearch({
  userId,
  onPick,
}: {
  userId: string;
  onPick: (p: DirectoryPerson) => void;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<DirectoryPerson[]>([]);
  const typedEmail = useMemo(() => {
    const m = q.trim().toLowerCase().match(/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/);
    return m ? m[0] : "";
  }, [q]);

  useEffect(() => {
    // Only letters, digits and what an address or a name can hold: the rest
    // would break the PostgREST filter syntax.
    const term = q.trim().replace(/[^\p{L}\p{N}@.\-' ]/gu, "");
    if (term.length < 2) return;
    const id = setTimeout(async () => {
      const words = term.split(/\s+/).filter(Boolean);
      let query = supabase
        .from("directory_people")
        .select("name, email, title, department")
        .eq("user_id", userId);
      // Every word has to appear somewhere, so "shane ob" finds Shane O'Brien.
      for (const w of words) query = query.or(`name.ilike.%${w}%,email.ilike.%${w}%`);
      const { data } = await query.limit(6);
      setHits((data as DirectoryPerson[]) || []);
    }, 200);
    return () => clearTimeout(id);
  }, [q, userId]);

  // Hits for an earlier, longer search are not hits for what is typed now.
  const shown = q.trim().length >= 2 ? hits : [];

  function pick(p: DirectoryPerson) {
    onPick(p);
    setQ("");
    setHits([]);
  }

  return (
    <div className="relative mt-1">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && typedEmail) pick({ name: "", email: typedEmail });
        }}
        placeholder="Add someone: a name or an address"
        className="w-full rounded-md border border-dashed border-border bg-canvas px-2 py-1 text-[11px] outline-none focus:border-[var(--accent)]"
      />
      {(shown.length > 0 || typedEmail) && (
        <ul className="absolute z-10 mt-0.5 w-full overflow-hidden rounded-md border border-border bg-surface shadow">
          {shown.map((p) => (
            <li key={p.email}>
              <button
                onClick={() => pick(p)}
                className="block w-full truncate px-2 py-1 text-left text-[11px] hover:bg-[var(--accent-soft)]"
              >
                <span className="font-medium">{p.name || p.email}</span>{" "}
                <span className="text-muted">{p.title || p.email}</span>
              </button>
            </li>
          ))}
          {typedEmail && !shown.some((h) => h.email === typedEmail) && (
            <li>
              <button
                onClick={() => pick({ name: "", email: typedEmail })}
                className="block w-full px-2 py-1 text-left text-[11px] hover:bg-[var(--accent-soft)]"
              >
                Add {typedEmail}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/**
 * The company directory: a spreadsheet saved as CSV, or a pasted To line.
 * Re-importing updates people in place (matched on address), so a fresh export
 * every few months keeps titles current without duplicating anyone.
 */
function DirectoryImport({
  userId,
  count,
  onChanged,
}: {
  userId: string;
  count: number | null;
  onChanged: () => void;
}) {
  const [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function importText(text: string) {
    const people = parseDirectory(text);
    if (!people.length) {
      setMessage("No email addresses in that. A CSV needs an email column.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const rows = people.map((p) => ({
        user_id: userId,
        name: p.name,
        email: p.email,
        title: p.title || "",
        department: p.department || "",
        source: "import",
      }));
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await supabase
          .from("directory_people")
          .upsert(rows.slice(i, i + 500), { onConflict: "user_id,email" });
        if (error) throw new Error(error.message);
      }
      setMessage(`Imported ${people.length} ${people.length === 1 ? "person" : "people"}.`);
      setPasted("");
      onChanged();
    } catch (e) {
      setMessage(`Import failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function clearImported() {
    setBusy(true);
    await supabase
      .from("directory_people")
      .delete()
      .eq("user_id", userId)
      .eq("source", "import");
    setBusy(false);
    setMessage("Cleared.");
    onChanged();
  }

  return (
    <details className="rounded-lg border border-border bg-canvas">
      <summary className="cursor-pointer list-none px-2 py-1.5 text-[10px] font-medium text-[var(--accent)]">
        Company directory{count !== null ? ` · ${count} imported` : ""} ▾
      </summary>
      <div className="space-y-1.5 px-2 pb-2 text-[11px] leading-snug text-muted">
        <p>
          Import it once and invites fill in everyone&apos;s address from just
          their name. It stays private to you. People on emails you open here
          are added as you go.
        </p>
        <p>
          <span className="font-medium text-ink">A spreadsheet:</span> save it
          as CSV with a name and an email column (title and department are
          used if present).
        </p>
        <p>
          <span className="font-medium text-ink">Your team:</span> put a
          distribution list in a new email&apos;s To line, click the + to
          expand it, copy the whole line and paste it below.
        </p>
        <p>
          <span className="font-medium text-ink">Classic Outlook:</span>{" "}
          Address Book, select everyone, Add to Contacts; then File, Open &amp;
          Export, Import/Export, Export to a file, CSV.
        </p>
        <input
          type="file"
          accept=".csv,.txt,.tsv,text/csv,text/plain"
          disabled={busy}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) await importText(await file.text());
          }}
          className="block w-full text-[10px]"
        />
        <textarea
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          rows={2}
          placeholder="…or paste a To line or rows here"
          className="w-full resize-none rounded-md border border-border bg-surface p-1.5 text-[11px] outline-none focus:border-[var(--accent)]"
        />
        <div className="flex items-center gap-2">
          <button
            onClick={() => void importText(pasted)}
            disabled={busy || !pasted.trim()}
            className="rounded-md border border-[var(--accent)] px-2 py-1 text-[10px] font-semibold text-[var(--accent)] disabled:opacity-50"
          >
            {busy ? "Importing…" : "Import pasted"}
          </button>
          {!!count && (
            <button
              onClick={() => void clearImported()}
              disabled={busy}
              className="text-[10px] text-muted hover:text-ink"
            >
              Clear imported
            </button>
          )}
          {message && <span className="text-[10px]">{message}</span>}
        </div>
      </div>
    </details>
  );
}
