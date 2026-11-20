// The people a meeting invite can be addressed to: reading a directory export
// into rows, and turning "Shane" into shane.obrien@company.com.
//
// Pure functions on purpose: the import runs in the Outlook pane, the matching
// runs in /api/outlook/meeting, and both have to agree on what a name is.

export interface DirectoryPerson {
  name: string;
  email: string;
  title?: string;
  department?: string;
  source?: "import" | "outlook";
  /** Mail you sent them in the last year, from Sent Items. */
  sent_count?: number;
  last_sent?: string | null;
  /** report | team | manager | peer | "" — see scripts/export-outlook-directory.ps1. */
  relation?: string;
  company?: string;
  is_me?: boolean;
}

/** Addresses that are machines, not people, and never belong on an invite. */
const NOT_A_PERSON =
  /^(no-?reply|do-?not-?reply|notifications?|mailer-daemon|postmaster|bounce|calendar|alerts?)\b/i;

export function cleanEmail(raw: string): string {
  const m = (raw || "").trim().toLowerCase().match(/[a-z0-9._%+'-]+@[a-z0-9.-]+\.[a-z]{2,}/);
  return m ? m[0] : "";
}

export function isPersonAddress(email: string): boolean {
  const e = cleanEmail(email);
  return !!e && !NOT_A_PERSON.test(e.split("@")[0]);
}

/**
 * "O'Brien, Shane" → "Shane O'Brien". Outlook writes people the first way in
 * headers and address books, and an invite reads better the second way. A
 * comma with more than one word after the first part is left alone — that is
 * a list, or a company name, not a surname.
 */
export function displayName(raw: string): string {
  const s = (raw || "").replace(/^["']|["']$/g, "").replace(/\s+/g, " ").trim();
  const m = s.match(/^([^,]+),\s*([^,]+)$/);
  if (m && !/@/.test(s)) return `${m[2].trim()} ${m[1].trim()}`;
  return s;
}

/** "shane.obrien@x.com" → "Shane Obrien": better than an address alone. */
function nameFromEmail(email: string): string {
  const local = email.split("@")[0].replace(/\d+/g, "");
  const parts = local.split(/[._-]+/).filter((p) => p.length > 1);
  if (parts.length < 2) return "";
  return parts.map((p) => p[0].toUpperCase() + p.slice(1)).join(" ");
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

/** A CSV row splitter that survives quoted commas and doubled quotes. */
function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

/** The first header matching a pattern and none of the exclusions. */
function column(headers: string[], match: RegExp, not?: RegExp): number {
  return headers.findIndex((h) => match.test(h) && !(not && not.test(h)));
}

/**
 * Rows out of whatever the user has. Three shapes turn up, tried in order:
 *
 * - a spreadsheet saved as CSV (or tab-separated, which is what copying cells
 *   out of Excel gives you), with an email column somewhere. Outlook's own
 *   contacts export is one of these, with "First Name", "Last Name",
 *   "E-mail Address", "Job Title" and "Department" among ninety other columns.
 * - a pasted To line: `Shane O'Brien <shane@x.com>; Glenn Ross <glenn@x.com>`.
 *   Expanding a distribution list in a new email and copying the line gives
 *   exactly this, and it is the quickest way to get a whole team.
 * - anything else with addresses in it, one person per address.
 */
export function parseDirectory(text: string): DirectoryPerson[] {
  const src = (text || "").replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] || "";
  const delimiter = (firstLine.match(/\t/g) || []).length > (firstLine.match(/,/g) || []).length
    ? "\t"
    : (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length
      ? ";"
      : ",";
  const rows = parseCsv(src, delimiter);
  const headers = (rows[0] || []).map((h) => h.trim().toLowerCase());
  const emailCol = column(headers, /e-?mail|smtp/, /display|type|2|3|emailed/);

  const people: DirectoryPerson[] = [];
  if (emailCol >= 0 && rows.length > 1 && !cleanEmail(headers[emailCol])) {
    const nameCol = column(headers, /^(display ?name|full ?name|name|e-?mail display name)$/);
    const firstCol = column(headers, /^(first ?name|given ?name|first)$/);
    const lastCol = column(headers, /^(last ?name|surname|family ?name|last)$/);
    const titleCol =
      column(headers, /job ?title|position|role|designation/) >= 0
        ? column(headers, /job ?title|position|role|designation/)
        : column(headers, /^title$/);
    const deptCol = column(headers, /department|dept|division/);
    const companyCol = column(headers, /^company( ?name)?$/);
    const relationCol = column(headers, /^relation$/);
    const sentCol = column(headers, /^emailed$|^sent ?count$/);
    const lastCol2 = column(headers, /^last emailed$|^last ?sent$/);
    for (const r of rows.slice(1)) {
      const email = cleanEmail(r[emailCol] || "");
      if (!email) continue;
      const fromParts = [r[firstCol] || "", r[lastCol] || ""]
        .map((s) => (firstCol < 0 && lastCol < 0 ? "" : s.trim()))
        .filter(Boolean)
        .join(" ");
      const named = nameCol >= 0 ? displayName(r[nameCol] || "") : "";
      const name = (fromParts || (cleanEmail(named) ? "" : named) || nameFromEmail(email)).trim();
      const title = titleCol >= 0 ? (r[titleCol] || "").trim() : "";
      people.push({
        name,
        email,
        // "Mr." is a salutation, not a job.
        title: /^(mr|mrs|ms|miss|dr|prof)\.?$/i.test(title) ? "" : title,
        department: deptCol >= 0 ? (r[deptCol] || "").trim() : "",
        company: companyCol >= 0 ? (r[companyCol] || "").trim() : "",
        relation: relationCol >= 0 ? (r[relationCol] || "").trim().toLowerCase() : "",
        sent_count: sentCol >= 0 ? Math.max(0, parseInt(r[sentCol] || "0", 10) || 0) : 0,
        last_sent:
          lastCol2 >= 0 && /^\d{4}-\d{2}-\d{2}$/.test((r[lastCol2] || "").trim())
            ? (r[lastCol2] || "").trim()
            : null,
      });
    }
  } else {
    // Not a table: pull out "Name <address>" pairs, then any bare address left.
    const seen = new Set<string>();
    const pair = /(?:"([^"]+)"|([^<>;\n\t"]+?))\s*<\s*([^<>\s]+@[^<>\s]+)\s*>/g;
    for (const m of src.matchAll(pair)) {
      const email = cleanEmail(m[3]);
      if (!email || seen.has(email)) continue;
      seen.add(email);
      const name = displayName((m[1] || m[2] || "").replace(/^[,;\s]+/, ""));
      people.push({ name: name || nameFromEmail(email), email });
    }
    for (const m of src.matchAll(/[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) {
      const email = cleanEmail(m[0]);
      if (!email || seen.has(email)) continue;
      seen.add(email);
      people.push({ name: nameFromEmail(email), email });
    }
  }

  // One row per address, keeping the fullest version of each.
  const byEmail = new Map<string, DirectoryPerson>();
  for (const p of people) {
    if (!isPersonAddress(p.email)) continue;
    const prev = byEmail.get(p.email);
    if (!prev || (p.name.length > prev.name.length && !prev.title)) byEmail.set(p.email, p);
  }
  return [...byEmail.values()];
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

const tokens = (s: string) =>
  (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’]/g, "")
    .match(/[a-z]{2,}/g) || [];

/**
 * How well a name someone used fits a person, 0 when it does not.
 *
 *   3  every word of it is one of theirs ("Shane O'Brien", "O'Brien, Shane")
 *   2  a single word that is their first or last name ("Shane")
 *   1  a short form of one of their names ("Chris" for Christopher)
 *
 * The address counts as a name too: shane.obrien@ carries both halves even
 * when the directory only had "S. O'Brien".
 */
export function nameScore(asked: string, person: DirectoryPerson): number {
  const want = tokens(displayName(asked));
  if (!want.length) return 0;
  const have = new Set([...tokens(person.name), ...tokens(person.email.split("@")[0].replace(/[._-]/g, " "))]);
  if (!have.size) return 0;
  if (want.every((t) => have.has(t))) return want.length > 1 ? 3 : 2;
  const prefix = (t: string) => t.length >= 3 && [...have].some((h) => h.startsWith(t) || t.startsWith(h) && h.length >= 3);
  if (want.length === 1) return prefix(want[0]) ? 1 : 0;
  // Two words where one matches outright and the other is a short form.
  return want.every((t) => have.has(t) || prefix(t)) ? 1 : 0;
}

export interface Resolved {
  asked: string;
  status: "found" | "choose" | "unknown";
  person?: DirectoryPerson;
  /**
   * The other people the name could mean. Kept when one was picked for you,
   * so "not them?" can offer the rest; the picked one is never among them.
   */
  options: DirectoryPerson[];
  /** Why this one, when there was more than one: "you've emailed her 14 times this year". */
  why?: string;
}

/** Where someone sits relative to you, as a number to compare and words to show. */
function closeness(p: DirectoryPerson, me: DirectoryPerson | null): { score: number; why: string } {
  const rel = (p.relation || "").toLowerCase();
  if (rel === "report") return { score: 40, why: "reports to you" };
  if (rel === "team") return { score: 30, why: "on your team" };
  if (rel === "manager") return { score: 25, why: "your manager" };
  if (rel === "peer") return { score: 20, why: "on your manager's team" };
  const same = (a?: string, b?: string) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
  let score = 0;
  let why = "";
  if (same(p.department, me?.department)) {
    score += 10;
    why = "in your department";
  }
  if (same(p.company, me?.company)) {
    score += 5;
    why = why || `at ${p.company}`;
  }
  return { score, why };
}

const sent = (p: DirectoryPerson) => p.sent_count || 0;

/**
 * Of several people a name fits equally well, the one meant — or null to ask.
 *
 * Who you actually write to comes first: the Rachel you emailed thirty times
 * this year is the Rachel, wherever she sits. Only when that does not settle
 * it (nobody written to, or two people written to about as often) does the
 * org chart decide: your reports, the rest of your line, your manager and
 * their team, your department, then your company. Anything still level is a
 * question, never a coin toss.
 */
export function pickAmong(
  candidates: DirectoryPerson[],
  me: DirectoryPerson | null,
): { person: DirectoryPerson; why: string } | null {
  const bySent = [...candidates].sort((a, b) => sent(b) - sent(a));
  const [a, b] = bySent;
  if (a && sent(a) >= 2 && sent(a) >= 3 * (b ? sent(b) : 0))
    return { person: a, why: `you've emailed them ${sent(a)} time${sent(a) === 1 ? "" : "s"} this year` };
  const ranked = candidates
    .map((p) => ({ p, ...closeness(p, me) }))
    .sort((x, y) => y.score - x.score || sent(y.p) - sent(x.p));
  if (ranked[0]?.score > 0 && (ranked.length < 2 || ranked[0].score > ranked[1].score))
    return { person: ranked[0].p, why: ranked[0].why };
  return null;
}

/** Most likely first: written to most, then nearest in the org. */
export function rankOptions(list: DirectoryPerson[], me: DirectoryPerson | null): DirectoryPerson[] {
  return [...list].sort(
    (x, y) => sent(y) - sent(x) || closeness(y, me).score - closeness(x, me).score,
  );
}

/**
 * The person a name means, looked for in order of how likely they are: the
 * people on this email first (the "Shane" on the thread is that Shane, not one
 * of the four in the directory), then everyone else. An address given outright
 * is used as it is, known or not.
 */
export function resolvePerson(
  asked: string,
  email: string,
  onThread: DirectoryPerson[],
  directory: DirectoryPerson[],
  me: DirectoryPerson | null = null,
): Resolved {
  const given = cleanEmail(email) || cleanEmail(asked);
  if (given) {
    // A header often names someone by their bare address ("scheier.c@...");
    // the directory's "Chris Scheier" is the better record of them.
    const matches = [...onThread, ...directory].filter((p) => p.email === given);
    const known =
      matches.find((p) => p.name && !p.name.includes("@")) || matches[0];
    return {
      asked,
      status: "found",
      person: known || { name: displayName(asked).includes("@") ? nameFromEmail(given) : displayName(asked), email: given },
      options: [],
    };
  }
  for (const pool of [onThread, directory]) {
    const scored = pool
      .map((p) => ({ p, s: nameScore(asked, p) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s);
    if (!scored.length) continue;
    const best = scored[0].s;
    const top = scored.filter((x) => x.s === best).map((x) => x.p);
    if (top.length === 1) return { asked, status: "found", person: top[0], options: [] };
    const options = rankOptions(top, me);
    const picked = pickAmong(top, me);
    if (picked)
      return {
        asked,
        status: "found",
        person: picked.person,
        why: picked.why,
        options: options.filter((p) => p.email !== picked.person.email).slice(0, 6),
      };
    return { asked, status: "choose", options: options.slice(0, 6) };
  }
  return { asked, status: "unknown", options: [] };
}

/** "Name <address>" pairs written into a quoted thread's headers. */
export function peopleInText(text: string): DirectoryPerson[] {
  const out: DirectoryPerson[] = [];
  const pair = /(?:"([^"]+)"|([A-Za-z][^<>;:\n\t"[\]]{1,60}?))\s*[<[]\s*(?:mailto:)?([^<>\s[\]]+@[^<>\s[\]]+?)\s*[>\]]/g;
  for (const m of (text || "").matchAll(pair)) {
    const email = cleanEmail(m[3]);
    if (!email || !isPersonAddress(email)) continue;
    const name = displayName((m[1] || m[2] || "").replace(/^(from|to|cc|sent)\s*:\s*/i, ""));
    out.push({ name, email });
  }
  return out;
}
