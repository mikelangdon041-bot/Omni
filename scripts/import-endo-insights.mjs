// One-off migration: copy ENDO 2026 insights (+ daily summaries) from the
// old msl-mission-control Supabase project into Omni's conf_insights.
//
//   node --experimental-websocket scripts/import-endo-insights.mjs [--dry-run]
//
// Idempotent: rows keep their source UUIDs and are upserted on id, so
// re-running updates rather than duplicates. Events/posters/KOLs are matched
// by (normalized) title/name because the earlier events+posters import
// regenerated ids. KOLs referenced by insights but missing in Omni are
// created as conference contacts.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const DRY = process.argv.includes("--dry-run");

function env(path) {
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const srcEnv = env("C:/Users/zbalm/OneDrive/Documents/my-expo-app/Recordati/msl-mission-control/.env.local");
const dstEnv = env(new URL("../.env.local", import.meta.url).pathname.replace(/^\//, ""));

const src = createClient(
  srcEnv.NEXT_PUBLIC_SUPABASE_URL || srcEnv.SUPABASE_URL,
  srcEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY || srcEnv.SUPABASE_ANON_KEY,
);
const dst = createClient(dstEnv.NEXT_PUBLIC_SUPABASE_URL, dstEnv.SUPABASE_SERVICE_ROLE_KEY);

const norm = (s) => (s || "").toLowerCase().replace(/\s+/g, " ").trim();
const decode = (s) =>
  (s || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

async function fetchAll(client, table, build) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const q = build(client.from(table).select("*").range(from, from + 999));
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

// ---- resolve conferences --------------------------------------------------
const { data: srcConfs } = await src.from("conferences").select("id,name");
const { data: dstConfs } = await dst.from("conferences").select("id,name");
const SRC = srcConfs.find((c) => /endo/i.test(c.name))?.id;
const DST = dstConfs.find((c) => /endo/i.test(c.name))?.id;
if (!SRC || !DST) throw new Error(`Conference not found (src=${SRC}, dst=${DST})`);
console.log(`Source ENDO: ${SRC}\nDest   ENDO: ${DST}${DRY ? "   [DRY RUN]" : ""}`);

// Does the dest have the created_by_name column yet (migration 0018)?
const probe = await dst.from("conf_insights").select("created_by_name").limit(1);
const hasCreatedByName = !probe.error;
if (!hasCreatedByName) {
  console.warn(
    "NOTE: conf_insights.created_by_name missing (apply migration 0018) — author names will be dropped.",
  );
}

// ---- load source ----------------------------------------------------------
// Order by id: pagination with a non-unique sort key (created_at) can repeat
// rows across pages.
const [insightsRaw, srcCats, srcEvents, srcPosters, srcKols, team, daily] = await Promise.all([
  fetchAll(src, "insights", (q) => q.eq("conference_id", SRC).order("id")),
  src.from("insight_categories").select("*").eq("conference_id", SRC).then((r) => r.data || []),
  fetchAll(src, "events", (q) => q.eq("conference_id", SRC)),
  fetchAll(src, "posters", (q) => q.eq("conference_id", SRC)),
  fetchAll(src, "kols", (q) => q.eq("conference_id", SRC)),
  src.from("team_members").select("id,name").then((r) => r.data || []),
  src.from("daily_insight_summaries").select("*").eq("conference_id", SRC).then((r) => r.data || []),
]);
const insights = [...new Map(insightsRaw.map((i) => [i.id, i])).values()];
const ids = insights.map((i) => i.id);
const assignments = [];
for (let i = 0; i < ids.length; i += 200) {
  const { data, error } = await src
    .from("insight_category_assignments")
    .select("insight_id,insight_category_id")
    .in("insight_id", ids.slice(i, i + 200));
  if (error) throw new Error(`assignments: ${error.message}`);
  assignments.push(...data);
}
console.log(
  `Loaded: ${insights.length} insights, ${assignments.length} category links, ` +
    `${srcEvents.length} events, ${srcPosters.length} posters, ${srcKols.length} kols, ${daily.length} daily summaries`,
);

// ---- load dest lookups ----------------------------------------------------
const [dstEvents, dstPosters, dstContacts, dstCatRows, attendees] = await Promise.all([
  fetchAll(dst, "conf_events", (q) => q.eq("conference_id", DST)),
  fetchAll(dst, "conf_posters", (q) => q.eq("conference_id", DST)),
  fetchAll(dst, "conf_contacts", (q) => q.eq("conference_id", DST)),
  dst.from("conf_categories").select("*").eq("conference_id", DST).then((r) => r.data || []),
  dst.from("conference_attendees").select("user_id,name").eq("conference_id", DST).then((r) => r.data || []),
]);

// ---- category name mapping ------------------------------------------------
// Source taxonomy differs slightly from Omni's seeded one; alias the known
// renames, create anything else.
const CAT_ALIASES = {
  "treatment paradigm": "Treatment approach",
  "screening, diagnosis, and monitoring": "Screening / Diagnosis / Monitoring",
  "screening/diagnosis": "Screening / Diagnosis / Monitoring",
  "education gaps and unmet data needs": "Education gaps / unmet needs",
  "kol sentiment": "Contact sentiment",
  "clinical ops / iss related": "Ops-related",
  "competitive intelligence": "Competitive intelligence",
};
const dstCatByNorm = new Map(dstCatRows.map((c) => [norm(c.name), c.name]));
const catNameById = new Map(); // source category id -> dest category name
const toCreate = [];
for (const c of srcCats) {
  const alias = CAT_ALIASES[norm(c.name)];
  const dest = (alias && dstCatByNorm.get(norm(alias))) || dstCatByNorm.get(norm(c.name));
  if (dest) {
    catNameById.set(c.id, dest);
  } else {
    catNameById.set(c.id, c.name);
    toCreate.push({ conference_id: DST, name: c.name, color: c.color || "#6c6982", sort_order: 90 });
  }
}
if (toCreate.length) {
  console.log("Creating categories:", toCreate.map((c) => c.name).join(", "));
  if (!DRY) {
    const { error } = await dst.from("conf_categories").upsert(toCreate, { onConflict: "conference_id,name" });
    if (error) throw new Error(`conf_categories: ${error.message}`);
  }
}
const catsByInsight = new Map();
for (const a of assignments) {
  const name = catNameById.get(a.insight_category_id);
  if (!name) continue;
  catsByInsight.set(a.insight_id, [...(catsByInsight.get(a.insight_id) || []), name]);
}

// ---- event / poster / kol / author mapping --------------------------------
function titleMap(dstRows) {
  const m = new Map();
  for (const r of dstRows) if (!m.has(norm(r.title))) m.set(norm(r.title), r.id);
  return m;
}
const evByTitle = titleMap(dstEvents);
const poByTitle = titleMap(dstPosters);
const evMap = new Map(srcEvents.map((e) => [e.id, evByTitle.get(norm(e.title)) || null]));
const poMap = new Map(srcPosters.map((p) => [p.id, poByTitle.get(norm(p.title)) || null]));
const evMisses = srcEvents.filter((e) => !evMap.get(e.id)).length;
const poMisses = srcPosters.filter((p) => !poMap.get(p.id)).length;
if (evMisses || poMisses) console.warn(`Unmatched by title: ${evMisses} events, ${poMisses} posters`);

const contactByName = new Map(dstContacts.map((c) => [norm(c.name), c.id]));
const kolMap = new Map(); // source kol id -> dest contact id
const usedKolIds = new Set(insights.map((i) => i.kol_id).filter(Boolean));
for (const kolId of usedKolIds) {
  const k = srcKols.find((x) => x.id === kolId);
  if (!k) continue;
  let contactId = contactByName.get(norm(k.name));
  if (!contactId && !DRY) {
    const { data, error } = await dst
      .from("conf_contacts")
      .insert({ conference_id: DST, name: k.name || "Unknown", institution: k.institution || "" })
      .select("id")
      .single();
    if (error) throw new Error(`conf_contacts: ${error.message}`);
    contactId = data.id;
    console.log(`Created contact for KOL: ${k.name}`);
  }
  if (contactId) kolMap.set(kolId, contactId);
}

const teamName = new Map(team.map((t) => [t.id, (t.name || "").trim()]));
const attendeeUser = new Map(
  attendees.filter((a) => a.user_id).map((a) => [norm(a.name), a.user_id]),
);

// ---- build rows -----------------------------------------------------------
const P_OK = new Set(["high", "medium", "low"]);
const C_OK = new Set(["high", "medium", "low", "not_relevant"]);
function row(i) {
  const author = teamName.get(i.created_by) || "";
  const r = {
    id: i.id,
    conference_id: DST,
    user_id: attendeeUser.get(norm(author)) || null,
    parent_id: i.parent_id,
    sort_order: i.sort_order || 0,
    title: decode(i.title).slice(0, 2000),
    notes: i.image_url ? `<p><a href="${i.image_url}" target="_blank" rel="noreferrer">Photo</a></p>` : "",
    transcription: i.transcription || "",
    summary: i.summary || "",
    status: "complete",
    source_type: i.source_detail || i.source_type || "",
    event_id: i.event_id ? evMap.get(i.event_id) || null : null,
    contact_id: i.kol_id ? kolMap.get(i.kol_id) || null : null,
    poster_id: i.poster_id ? poMap.get(i.poster_id) || null : null,
    categories: [...new Set(catsByInsight.get(i.id) || [])],
    focus_areas: i.disease_states || [],
    product_lines: i.products || [],
    insight_date: i.insight_date,
    suspected_priority: P_OK.has(i.suspected_priority) ? i.suspected_priority : null,
    confirmed_priority: C_OK.has(i.confirmed_priority) ? i.confirmed_priority : null,
    created_at: i.created_at,
    updated_at: i.updated_at,
  };
  if (hasCreatedByName) r.created_by_name = author;
  return r;
}

const parents = insights.filter((i) => !i.parent_id).map(row);
const children = insights.filter((i) => i.parent_id).map(row);
console.log(`Prepared ${parents.length} parents + ${children.length} children`);
console.log(
  `Linked: ${[...parents, ...children].filter((r) => r.event_id).length} to events, ` +
    `${[...parents, ...children].filter((r) => r.poster_id).length} to posters, ` +
    `${[...parents, ...children].filter((r) => r.contact_id).length} to contacts`,
);

if (!DRY) {
  for (const batchSrc of [parents, children]) {
    for (let i = 0; i < batchSrc.length; i += 400) {
      const batch = batchSrc.slice(i, i + 400);
      const { error } = await dst.from("conf_insights").upsert(batch, { onConflict: "id" });
      if (error) throw new Error(`conf_insights upsert @${i}: ${error.message}`);
      process.stdout.write(`.`);
    }
  }
  console.log("\nInsights upserted.");

  if (daily.length) {
    const rows = daily.map((d) => ({
      conference_id: DST,
      date: d.summary_date,
      content: d.summary || "",
    }));
    const { error } = await dst
      .from("conf_daily_summaries")
      .upsert(rows, { onConflict: "conference_id,date" });
    if (error) throw new Error(`conf_daily_summaries: ${error.message}`);
    console.log(`${rows.length} daily summaries upserted.`);
  }

  const { count } = await dst
    .from("conf_insights")
    .select("id", { count: "exact", head: true })
    .eq("conference_id", DST);
  console.log(`Done — dest now has ${count} insights for ENDO.`);
} else {
  console.log("Dry run only — nothing written.");
}
