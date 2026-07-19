"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { DashboardTile } from "./types";

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
