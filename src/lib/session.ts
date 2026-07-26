"use client";

// One place that answers "who is signed in?" for the whole client app.
//
// Why this exists: `supabase.auth.getUser()` is a network round trip to the
// auth server. Every module hook that needs a user id used to call it
// independently, so a single page load fired it three or four times (the
// header's task badge, the notification bell, the page's own data hook, the
// module's profile hook) — and worse, each one *serialized in front of* the
// data fetch that depended on it. Nothing could start loading until auth came
// back.
//
// Two fixes, both here:
//   1. Dedupe — one in-flight promise shared by every caller on the page.
//   2. Instant paint — the last-resolved id/profile is remembered in
//      localStorage and handed back synchronously on mount, so downstream
//      queries fire on the very first render. The network confirmation still
//      runs and corrects state (including clearing it) if the session changed.

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getCached, setCached } from "@/lib/cache";

const supabase = createClient();

const UID_CACHE_KEY = "uid";
const PROFILE_CACHE_KEY = "profile";

export interface SessionProfile {
  id: string;
  displayName: string;
  username: string;
  email: string;
  role: string;
  orgId: string | null;
}

// ------------------------------------------------------------------
// Deduped resolvers — at most one request each per page load.
// ------------------------------------------------------------------
let uidPromise: Promise<string | null> | null = null;

export function resolveUserId(): Promise<string | null> {
  if (!uidPromise) {
    uidPromise = supabase.auth
      .getUser()
      .then(({ data }) => {
        const uid = data.user?.id ?? null;
        if (uid) setCached(UID_CACHE_KEY, uid);
        return uid;
      })
      .catch(() => null);
  }
  return uidPromise;
}

let profilePromise: Promise<SessionProfile | null> | null = null;

export function resolveProfile(): Promise<SessionProfile | null> {
  if (!profilePromise) {
    profilePromise = (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return null;
      if (!uidPromise) uidPromise = Promise.resolve(user.id);
      setCached(UID_CACHE_KEY, user.id);

      const { data } = await supabase
        .from("profiles")
        .select("username, display_name, role, org_id")
        .eq("id", user.id)
        .single();

      const profile: SessionProfile = {
        id: user.id,
        displayName: data?.display_name || data?.username || "Me",
        username: data?.username || "",
        email: user.email || "",
        role: data?.role || "member",
        orgId: (data?.org_id as string) ?? null,
      };
      setCached(PROFILE_CACHE_KEY, profile);
      return profile;
    })().catch(() => null);
  }
  return profilePromise;
}

// Called on sign-out so a second person signing in on the same device never
// sees the previous session's cached id flash into a query.
export function resetSession() {
  uidPromise = null;
  profilePromise = null;
}

// ------------------------------------------------------------------
// Hooks
// ------------------------------------------------------------------
export function useUserId() {
  const [userId, setUserId] = useState<string | null>(() =>
    getCached<string>(UID_CACHE_KEY),
  );
  const [loading, setLoading] = useState(() => !getCached<string>(UID_CACHE_KEY));

  useEffect(() => {
    let active = true;
    void resolveUserId().then((uid) => {
      if (!active) return;
      setUserId(uid);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  return { userId, loading };
}

export function useSessionProfile() {
  const [profile, setProfile] = useState<SessionProfile | null>(() =>
    getCached<SessionProfile>(PROFILE_CACHE_KEY),
  );
  const [loading, setLoading] = useState(
    () => !getCached<SessionProfile>(PROFILE_CACHE_KEY),
  );

  useEffect(() => {
    let active = true;
    void resolveProfile().then((p) => {
      if (!active) return;
      setProfile(p);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  const isAdmin = profile?.role === "admin" || profile?.role === "owner";
  return { profile, isAdmin, loading };
}
