import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSessionProfile, isAdmin } from "@/lib/authz";
import { proposeChartSpec } from "@/lib/dashboard/ai";
import { fetchImportedDatasets, runChart } from "@/lib/dashboard/data";
import { getDataset } from "@/lib/dashboard/catalog";
import type { ChartSpec, Scope } from "@/lib/dashboard/types";

export const runtime = "nodejs";
export const maxDuration = 60;

// The highest scope this caller may use: everyone gets "self"; anyone
// managing a team (checked via their own RLS-visible dashboard_teams row)
// gets "team"; org admins/owners get "org".
async function maxAllowedScope(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  manager: boolean,
): Promise<Scope> {
  if (manager) return "org";
  const { data } = await supabase.from("dashboard_teams").select("id").eq("manager_id", userId).maybeSingle();
  return data ? "team" : "self";
}

function clampScope(requested: Scope, max: Scope): Scope {
  const order: Scope[] = ["self", "team", "org"];
  return order.indexOf(requested) <= order.indexOf(max) ? requested : max;
}

// What scope this signed-in user is allowed to pick from — the chat UI
// fetches this once so it can render the right set of scope buttons.
export async function GET() {
  const supabase = await createClient();
  const { userId, profile } = await getSessionProfile();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const maxScope = await maxAllowedScope(supabase, userId, isAdmin(profile));
  return NextResponse.json({ maxScope });
}

// actions:
//   propose { prompt }            -> { spec, explanation }
//     NL request -> a validated ChartSpec + a plain-English description of
//     what it will show, so the user can confirm before anything is built.
//   run     { spec }              -> { result }
//     Execute a (possibly user-tweaked) spec and return chart-ready rows,
//     scoped to what this user is allowed to see (self / their team / org).
export async function POST(req: Request) {
  const supabase = await createClient();
  const { userId, profile } = await getSessionProfile();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const action: string = body?.action || "";
  const manager = isAdmin(profile);
  const maxScope = await maxAllowedScope(supabase, userId, manager);

  try {
    const importedDatasets = await fetchImportedDatasets(supabase);

    if (action === "propose") {
      const prompt: string = (body?.prompt || "").slice(0, 2000);
      if (!prompt.trim()) return NextResponse.json({ error: "Empty prompt" }, { status: 400 });
      const { spec, explanation } = await proposeChartSpec(prompt, importedDatasets);
      spec.scope = clampScope(spec.scope, maxScope);
      return NextResponse.json({ spec, explanation, maxScope });
    }

    if (action === "run") {
      const spec = body?.spec as ChartSpec | undefined;
      if (!spec || !getDataset(spec.datasetId, importedDatasets)) {
        return NextResponse.json({ error: "Invalid chart spec" }, { status: 400 });
      }
      const scope = clampScope(spec.scope, maxScope);
      const result = await runChart(
        { ...spec, scope },
        { supabase, orgId: profile?.org_id ?? null, userId, scope },
        importedDatasets,
      );
      return NextResponse.json({ result, scope });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || "Dashboard AI request failed" },
      { status: 500 },
    );
  }
}
