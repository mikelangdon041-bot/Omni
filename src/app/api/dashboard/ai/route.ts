import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSessionProfile, isAdmin } from "@/lib/authz";
import { proposeChartSpec } from "@/lib/dashboard/ai";
import { runChart } from "@/lib/dashboard/data";
import { getDataset } from "@/lib/dashboard/catalog";
import type { ChartSpec, Scope } from "@/lib/dashboard/types";

export const runtime = "nodejs";
export const maxDuration = 60;

// actions:
//   propose { prompt }            -> { spec, explanation }
//     NL request -> a validated ChartSpec + a plain-English description of
//     what it will show, so the user can confirm before anything is built.
//   run     { spec }              -> { result }
//     Execute a (possibly user-tweaked) spec and return chart-ready rows,
//     scoped to what this user is allowed to see (self, or org if a manager).
export async function POST(req: Request) {
  const supabase = await createClient();
  const { userId, profile } = await getSessionProfile();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const action: string = body?.action || "";
  const manager = isAdmin(profile);

  try {
    if (action === "propose") {
      const prompt: string = (body?.prompt || "").slice(0, 2000);
      if (!prompt.trim()) return NextResponse.json({ error: "Empty prompt" }, { status: 400 });
      const { spec, explanation } = await proposeChartSpec(prompt);
      // ICs never see the org-wide scope, even if the model defaulted to it.
      if (!manager) spec.scope = "self";
      return NextResponse.json({ spec, explanation });
    }

    if (action === "run") {
      const spec = body?.spec as ChartSpec | undefined;
      if (!spec || !getDataset(spec.datasetId)) {
        return NextResponse.json({ error: "Invalid chart spec" }, { status: 400 });
      }
      const scope: Scope = manager ? spec.scope : "self";
      const result = await runChart(
        { ...spec, scope },
        { supabase, orgId: profile?.org_id ?? null, userId, scope },
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
