// Server-only: fetch raw rows for a dataset (scoped per the caller's role)
// and aggregate them into chart-ready rows. Callers (the AI route, the tiles
// route) are responsible for deciding whether "org" scope is allowed — this
// module trusts the scope it's given.

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { getDataset } from "./catalog";
import type { ChartResult, ChartSpec, DatasetDef, Scope } from "./types";

export interface FetchCtx {
  supabase: SupabaseClient; // RLS-scoped client for the signed-in user
  orgId: string | null;
  userId: string;
  scope: Scope;
}

async function orgMemberIds(orgId: string): Promise<string[]> {
  const admin = createAdminClient();
  const { data } = await admin.from("profiles").select("id").eq("org_id", orgId);
  return (data || []).map((r) => r.id as string);
}

// Two-step lookup: KOL ids owned by the relevant rep(s), for tables that only
// carry kol_id (activities, meetings) rather than user_id directly.
async function relevantKolIds(ctx: FetchCtx): Promise<string[]> {
  if (ctx.scope === "self") {
    const { data } = await ctx.supabase.from("kols").select("id").eq("user_id", ctx.userId);
    return (data || []).map((r) => r.id as string);
  }
  const admin = createAdminClient();
  const memberIds = ctx.orgId ? await orgMemberIds(ctx.orgId) : [ctx.userId];
  const { data } = await admin.from("kols").select("id").in("user_id", memberIds);
  return (data || []).map((r) => r.id as string);
}

async function fetchRows(datasetId: string, ctx: FetchCtx): Promise<Record<string, unknown>[]> {
  switch (datasetId) {
    case "territory.kols": {
      const cols = "specialty,tier,relationship_level,institution,kol_status,how_met,engagement_score,priority";
      if (ctx.scope === "self") {
        const { data } = await ctx.supabase.from("kols").select(cols).eq("user_id", ctx.userId);
        return data || [];
      }
      const admin = createAdminClient();
      const memberIds = ctx.orgId ? await orgMemberIds(ctx.orgId) : [ctx.userId];
      const { data } = await admin.from("kols").select(cols).in("user_id", memberIds);
      return data || [];
    }

    case "territory.activities": {
      const kolIds = await relevantKolIds(ctx);
      if (!kolIds.length) return [];
      const cols = "type,status,outreach_method";
      const client = ctx.scope === "self" ? ctx.supabase : createAdminClient();
      const { data } = await client.from("activities").select(cols).in("kol_id", kolIds);
      return data || [];
    }

    case "territory.meetings": {
      const kolIds = await relevantKolIds(ctx);
      if (!kolIds.length) return [];
      const cols = "meeting_method,confirmed";
      const client = ctx.scope === "self" ? ctx.supabase : createAdminClient();
      const { data } = await client.from("meetings").select(cols).in("kol_id", kolIds);
      return data || [];
    }

    case "insights.responses": {
      const cols = "status,kol:kols(specialty,tier)";
      if (ctx.scope === "self") {
        const { data } = await ctx.supabase.from("survey_responses").select(cols).eq("user_id", ctx.userId);
        return flattenKol(data);
      }
      const admin = createAdminClient();
      const { data } = await admin.from("survey_responses").select(cols).eq("org_id", ctx.orgId || "");
      return flattenKol(data);
    }

    case "meeting_prep.meetings": {
      const cols = "meeting_type,format,duration_min";
      if (ctx.scope === "self") {
        const { data } = await ctx.supabase.from("mp_meetings").select(cols).eq("user_id", ctx.userId);
        return data || [];
      }
      const admin = createAdminClient();
      const memberIds = ctx.orgId ? await orgMemberIds(ctx.orgId) : [ctx.userId];
      const { data } = await admin.from("mp_meetings").select(cols).in("user_id", memberIds);
      return data || [];
    }

    // Conference data is already a shared, org-wide team workspace (RLS scopes
    // every conf_ table to the signed-in user's org) — no self/org split.
    case "conference.contacts": {
      const { data } = await ctx.supabase
        .from("conf_contacts")
        .select("tier,institution")
        .eq("archived", false);
      return data || [];
    }

    case "conference.events": {
      const { data } = await ctx.supabase
        .from("conf_events")
        .select("event_type,confirmed_priority")
        .eq("cancelled", false);
      return data || [];
    }

    default:
      return [];
  }
}

type KolRef = { specialty?: string; tier?: string };

function flattenKol(
  rows: Array<{ status?: string; kol?: KolRef | KolRef[] | null }> | null,
): Record<string, unknown>[] {
  return (rows || []).map((r) => {
    const kol = Array.isArray(r.kol) ? r.kol[0] : r.kol;
    return { status: r.status, specialty: kol?.specialty, tier: kol?.tier };
  });
}

function displayValue(raw: unknown): string {
  if (raw === true) return "Yes";
  if (raw === false) return "No";
  if (raw === null || raw === undefined || raw === "") return "Unknown";
  return String(raw);
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

export function aggregateRows(
  rows: Record<string, unknown>[],
  dataset: DatasetDef,
  spec: Pick<ChartSpec, "groupBy" | "measure">,
): ChartResult {
  const empty: ChartResult = { empty: true, categories: [], seriesKey: "", rows: [] };
  if (rows.length === 0) return empty;

  const measureDef = dataset.measures.find((m) => m.key === spec.measure) || dataset.measures[0];
  const groupKey = dataset.dimensions.find((d) => d.key === spec.groupBy)?.key;

  const groups = new Map<string, number[]>();
  for (const r of rows) {
    const g = groupKey ? displayValue(r[groupKey]) : "All";
    let arr = groups.get(g);
    if (!arr) {
      arr = [];
      groups.set(g, arr);
    }
    if (measureDef.key === "*") {
      arr.push(1);
    } else {
      const v = Number(r[measureDef.key]);
      if (!Number.isNaN(v)) arr.push(v);
    }
  }

  const categories = [...groups.keys()].sort();
  const outRows = categories
    .map((c) => {
      const vals = groups.get(c)!;
      let value: number;
      if (measureDef.agg === "avg") value = vals.length ? round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
      else if (measureDef.agg === "sum") value = round(vals.reduce((a, b) => a + b, 0));
      else value = vals.length;
      return { name: c, value };
    })
    .filter((r) => r.value !== 0 || measureDef.key === "*");

  if (outRows.length === 0) return empty;
  return { empty: false, categories, seriesKey: measureDef.label, rows: outRows };
}

export async function runChart(spec: ChartSpec, ctx: FetchCtx): Promise<ChartResult> {
  const dataset = getDataset(spec.datasetId);
  if (!dataset) return { empty: true, categories: [], seriesKey: "", rows: [] };
  const effectiveScope: Scope = dataset.ownerScoped ? ctx.scope : "org";
  const rows = await fetchRows(spec.datasetId, { ...ctx, scope: effectiveScope });
  return aggregateRows(rows, dataset, spec);
}
