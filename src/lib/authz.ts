import { createClient } from "@/lib/supabase/server";

export interface SessionProfile {
  username: string;
  display_name: string | null;
  role: "member" | "admin" | "owner";
  org_id: string | null;
  is_active: boolean;
}

// Resolve the signed-in user plus their profile (role + org).
export async function getSessionProfile(): Promise<{
  userId: string | null;
  profile: SessionProfile | null;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { userId: null, profile: null };

  const { data: profile } = await supabase
    .from("profiles")
    .select("username, display_name, role, org_id, is_active")
    .eq("id", user.id)
    .single();

  return { userId: user.id, profile: (profile as SessionProfile) || null };
}

export function isAdmin(profile: SessionProfile | null): boolean {
  return !!profile && (profile.role === "admin" || profile.role === "owner");
}
