// Server-only: fetch raw rows for a dataset (scoped per the caller's role)
// and aggregate them into chart-ready rows. Callers (the AI route, the tiles
// route) are responsible for deciding whether "team"/"org" scope is allowed
// — this module trusts the scope it's given.

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { datasetFromImport, getDataset } from "./catalog";
import type { ChartResult, ChartSpec, DashboardImport, DatasetDef, Scope } from "./types";

// The org's uploaded workbooks, shaped as datasets the AI/aggregator can
// treat exactly like a built-in module. Org-shared, so the caller's own
// RLS-scoped client already sees the right rows.
export async function fetchImportedDatasets(
  supabase: SupabaseClient,
): Promise<DatasetDef[]> {
  const { data } = await supabase
    .from("dashboard_imports")
    .select("id, org_id, created_by, title, columns, row_count, created_at");
  return ((data as DashboardImport[]) || []).map(datasetFromImport);
}

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

// The manager's own team roster (dashboard_teams is one-per-manager).
async function teamMemberIds(managerId: string): Promise<string[]> {
  const admin = createAdminClient();
  const { data: team } = await admin
    .from("dashboard_teams")
    .select("id")
    .eq("manager_id", managerId)
    .maybeSingle();
  if (!team) return [managerId];
  const { data } = await admin.from("dashboard_team_members").select("user_id").eq("team_id", team.id);
  const ids = (data || []).map((r) => r.user_id as string);
  return ids.length ? ids : [managerId];
}

// The set of user ids a given scope covers.
async function scopedUserIds(ctx: FetchCtx): Promise<string[]> {
  if (ctx.scope === "self") return [ctx.userId];
  if (ctx.scope === "team") return teamMemberIds(ctx.userId);
  return ctx.orgId ? orgMemberIds(ctx.orgId) : [ctx.userId];
}

// "rep" display names for a set of user ids — resolved once per fetch so
// multi-user scopes can label rows by who they belong to.
async function resolveDisplayNames(userIds: string[]): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();
  const admin = createAdminClient();
  const { data } = await admin.from("profiles").select("id, username, display_name").in("id", userIds);
  const map = new Map<string, string>();
  for (const p of data || []) {
    map.set(p.id as string, (p.display_name as string) || (p.username as string) || p.id);
  }
  return map;
}

// Two-step lookup: KOL id -> owning rep, for tables that only carry kol_id
// (activities, meetings) rather than user_id directly.
async function relevantKols(ctx: FetchCtx): Promise<{ id: string; user_id: string }[]> {
  if (ctx.scope === "self") {
    const { data } = await ctx.supabase.from("kols").select("id, user_id").eq("user_id", ctx.userId);
    return data || [];
  }
  const admin = createAdminClient();
  const memberIds = await scopedUserIds(ctx);
  const { data } = await admin.from("kols").select("id, user_id").in("user_id", memberIds);
  return data || [];
}

function attachRep<T extends { user_id?: string }>(
  rows: T[],
  names: Map<string, string>,
): Record<string, unknown>[] {
  return rows.map((r) => ({ ...r, rep: r.user_id ? names.get(r.user_id) || "Unknown" : "Unknown" }));
}

async function fetchRows(datasetId: string, ctx: FetchCtx, extra: DatasetDef[]): Promise<Record<string, unknown>[]> {
  if (datasetId.startsWith("import:")) {
    const importId = datasetId.slice("import:".length);
    // Org-shared, so the caller's own RLS-scoped client already sees it.
    const { data } = await ctx.supabase.from("dashboard_imports").select("rows").eq("id", importId).maybeSingle();
    return (data?.rows as Record<string, unknown>[]) || [];
  }

  switch (datasetId) {
    case "territory.kols": {
      const cols = "user_id,specialty,tier,relationship_level,institution,kol_status,how_met,engagement_score,priority";
      if (ctx.scope === "self") {
        const { data } = await ctx.supabase.from("kols").select(cols).eq("user_id", ctx.userId);
        return attachRep(data || [], new Map([[ctx.userId, "You"]]));
      }
      const admin = createAdminClient();
      const memberIds = await scopedUserIds(ctx);
      const { data } = await admin.from("kols").select(cols).in("user_id", memberIds);
      const names = await resolveDisplayNames(memberIds);
      return attachRep(data || [], names);
    }

    case "territory.activities": {
      const kols = await relevantKols(ctx);
      if (!kols.length) return [];
      const kolToUser = new Map(kols.map((k) => [k.id, k.user_id]));
      const cols = "kol_id,type,status,outreach_method";
      const client = ctx.scope === "self" ? ctx.supabase : createAdminClient();
      const { data } = await client.from("activities").select(cols).in("kol_id", [...kolToUser.keys()]);
      const names = await resolveDisplayNames([...new Set(kols.map((k) => k.user_id))]);
      return (data || []).map((r) => ({
        ...r,
        rep: names.get(kolToUser.get(r.kol_id as string) || "") || "Unknown",
      }));
    }

    case "territory.meetings": {
      const kols = await relevantKols(ctx);
      if (!kols.length) return [];
      const kolToUser = new Map(kols.map((k) => [k.id, k.user_id]));
      const cols = "kol_id,meeting_method,confirmed";
      const client = ctx.scope === "self" ? ctx.supabase : createAdminClient();
      const { data } = await client.from("meetings").select(cols).in("kol_id", [...kolToUser.keys()]);
      const names = await resolveDisplayNames([...new Set(kols.map((k) => k.user_id))]);
      return (data || []).map((r) => ({
        ...r,
        rep: names.get(kolToUser.get(r.kol_id as string) || "") || "Unknown",
      }));
    }

    case "insights.responses": {
      const cols = "user_id,status,kol:kols(specialty,tier)";
      if (ctx.scope === "self") {
        const { data } = await ctx.supabase.from("survey_responses").select(cols).eq("user_id", ctx.userId);
        return flattenKol(data, new Map([[ctx.userId, "You"]]));
      }
      const admin = createAdminClient();
      const memberIds = await scopedUserIds(ctx);
      const { data } = await admin
        .from("survey_responses")
        .select(cols)
        .eq("org_id", ctx.orgId || "")
        .in("user_id", memberIds);
      const names = await resolveDisplayNames(memberIds);
      return flattenKol(data, names);
    }

    case "meeting_prep.meetings": {
      const cols = "user_id,meeting_type,format,duration_min";
      if (ctx.scope === "self") {
        const { data } = await ctx.supabase.from("mp_meetings").select(cols).eq("user_id", ctx.userId);
        return attachRep(data || [], new Map([[ctx.userId, "You"]]));
      }
      const admin = createAdminClient();
      const memberIds = await scopedUserIds(ctx);
      const { data } = await admin.from("mp_meetings").select(cols).in("user_id", memberIds);
      const names = await resolveDisplayNames(memberIds);
      return attachRep(data || [], names);
    }

    // Conference data is already a shared, org-wide team workspace (RLS scopes
    // every conf_ table to the signed-in user's org) — no self/team/org split.
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
      void extra; // reserved for future dataset kinds that need catalog metadata to fetch
      return [];
  }
}

type KolRef = { specialty?: string; tier?: string };

function flattenKol(
  rows: Array<{ user_id?: string; status?: string; kol?: KolRef | KolRef[] | null }> | null,
  names: Map<string, string>,
): Record<string, unknown>[] {
  return (rows || []).map((r) => {
    const kol = Array.isArray(r.kol) ? r.kol[0] : r.kol;
    return {
      status: r.status,
      specialty: kol?.specialty,
      tier: kol?.tier,
      rep: r.user_id ? names.get(r.user_id) || "Unknown" : "Unknown",
    };
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

export async function runChart(
  spec: ChartSpec,
  ctx: FetchCtx,
  extraDatasets: DatasetDef[] = [],
): Promise<ChartResult> {
  const dataset = getDataset(spec.datasetId, extraDatasets);
  if (!dataset) return { empty: true, categories: [], seriesKey: "", rows: [] };
  const effectiveScope: Scope = dataset.ownerScoped ? ctx.scope : "org";
  const rows = await fetchRows(spec.datasetId, { ...ctx, scope: effectiveScope }, extraDatasets);
  return aggregateRows(rows, dataset, spec);
}
