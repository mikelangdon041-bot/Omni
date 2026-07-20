"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { datasetFromImport } from "./catalog";
import type { DashboardImport, DashboardTeam, DatasetDef, DashboardTile, Scope, TeamMember } from "./types";

const supabase = createClient();

// Resolve the signed-in user's role, for the manager-vs-IC scope split.
export function useSessionRole() {
  const [userId, setUserId] = useState<string | null>(null);
  const [isManager, setIsManager] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    supabase.auth.getUser().then(async ({ data }) => {
      const uid = data.user?.id;
      if (!uid) {
        if (active) setLoading(false);
        return;
      }
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", uid)
        .single();
      if (!active) return;
      setUserId(uid);
      setIsManager(profile?.role === "admin" || profile?.role === "owner");
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  return { userId, isManager, loading };
}

// The highest scope this user is allowed to pick — drives which scope
// buttons the chat/tile UI shows at all.
export function useMaxScope() {
  const [maxScope, setMaxScope] = useState<Scope>("self");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetch("/api/dashboard/ai", { credentials: "same-origin" })
      .then((r) => r.json())
      .then((json) => {
        if (active) setMaxScope(json.maxScope || "self");
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  return { maxScope, loading };
}

// Uploaded workbooks, shaped as datasets so chat/tile lookups can treat them
// like any built-in module.
export function useImportedDatasets() {
  const [datasets, setDatasets] = useState<DatasetDef[]>([]);
  const [imports, setImports] = useState<DashboardImport[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/dashboard/imports", { credentials: "same-origin" });
    const json = await res.json();
    const rows: DashboardImport[] = json.imports || [];
    setImports(rows);
    setDatasets(rows.map(datasetFromImport));
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { datasets, imports, loading, refresh };
}

// The caller's own team roster (create/rename + set membership).
export function useTeam() {
  const [team, setTeam] = useState<DashboardTeam | null>(null);
  const [orgRoster, setOrgRoster] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/dashboard/team", { credentials: "same-origin" });
    const json = await res.json();
    setTeam(json.team || null);
    setOrgRoster(json.orgRoster || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createTeam = useCallback(async (name: string) => {
    const res = await fetch("/api/dashboard/team", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ name }),
    });
    const json = await res.json();
    await refresh();
    return json.team as DashboardTeam | undefined;
  }, [refresh]);

  const setMembers = useCallback(async (memberIds: string[]) => {
    await fetch("/api/dashboard/team/members", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ memberIds }),
    });
    await refresh();
  }, [refresh]);

  return { team, orgRoster, loading, refresh, createTeam, setMembers };
}

// Saved tiles visible to the signed-in user — RLS decides own-vs-org-wide.
export function useDashboardTiles() {
  const [tiles, setTiles] = useState<DashboardTile[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/dashboard/tiles", { credentials: "same-origin" });
    const json = await res.json();
    setTiles(json.tiles || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { tiles, loading, refresh };
}
