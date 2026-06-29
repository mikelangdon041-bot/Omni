"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isValidUsername, normalizeUsername, usernameToEmail } from "@/lib/auth";

export interface AuthState {
  error?: string;
}

export async function login(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const username = String(formData.get("username") || "");
  const password = String(formData.get("password") || "");

  if (!username || !password) {
    return { error: "Username and password are required." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: usernameToEmail(username),
    password,
  });

  if (error) {
    return { error: "Invalid username or password." };
  }
  redirect("/");
}

export async function register(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const rawUsername = String(formData.get("username") || "");
  const password = String(formData.get("password") || "");
  const displayName = String(formData.get("displayName") || "").trim();
  const username = normalizeUsername(rawUsername);

  if (!isValidUsername(username)) {
    return {
      error: "Username must be 3–30 chars: letters, numbers, . _ - only.",
    };
  }
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }

  const admin = createAdminClient();

  // Create the auth user with a synthetic email, pre-confirmed (no email flow).
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: usernameToEmail(username),
    password,
    email_confirm: true,
    user_metadata: { username, display_name: displayName || username },
  });

  if (createErr || !created.user) {
    const msg = createErr?.message || "";
    if (/already|exists|registered/i.test(msg)) {
      return { error: "That username is already taken." };
    }
    return { error: "Could not create account. Please try again." };
  }

  const { error: profileErr } = await admin.from("profiles").insert({
    id: created.user.id,
    username,
    display_name: displayName || username,
  });

  if (profileErr) {
    // Roll back the orphaned auth user so the username can be reused.
    await admin.auth.admin.deleteUser(created.user.id);
    if (/duplicate|unique/i.test(profileErr.message)) {
      return { error: "That username is already taken." };
    }
    return { error: "Could not create account. Please try again." };
  }

  // Establish the session cookie.
  const supabase = await createClient();
  const { error: signInErr } = await supabase.auth.signInWithPassword({
    email: usernameToEmail(username),
    password,
  });
  if (signInErr) {
    redirect("/login");
  }
  redirect("/");
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
