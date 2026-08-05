// The Microsoft side of the OneNote hand-off. SERVER ONLY — this module reads
// the client secret and the stored refresh tokens, neither of which may ever
// reach a browser.
//
// Why Graph and not a OneNote add-in: Microsoft never shipped task-pane add-ins
// for OneNote on the desktop. They exist for OneNote on the web and nowhere
// else, so a "send this to OneNote" button that works in the app people
// actually use has to come from the outside, through the API.

import { createAdminClient } from "@/lib/supabase/admin";

const GRAPH = "https://graph.microsoft.com/v1.0";

/**
 * `common` lets both work and personal accounts through. A tenant id here
 * instead would lock sign-in to one organisation — worth doing if this is ever
 * rolled out somewhere that cares, and the reason it is a variable.
 */
function tenant() {
  return process.env.MICROSOFT_TENANT || "common";
}

function authority() {
  return `https://login.microsoftonline.com/${tenant()}/oauth2/v2.0`;
}

/**
 * offline_access is what earns a refresh token; without it the connection
 * silently dies an hour after it is made. Notes.ReadWrite covers reading the
 * notebook tree and writing into a page. User.Read is only so the connection
 * can say whose account it is.
 */
export const SCOPES = "offline_access openid email profile User.Read Notes.ReadWrite";

export function microsoftConfigured(): boolean {
  return !!(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET);
}

export function redirectUri(origin: string): string {
  return `${origin}/api/integrations/microsoft/callback`;
}

export function authorizeUrl(origin: string, state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID!,
    response_type: "code",
    redirect_uri: redirectUri(origin),
    response_mode: "query",
    scope: SCOPES,
    state,
    // Always show the account picker. Without it a machine already signed into
    // a personal Microsoft account connects that one without ever asking, and
    // the notes go somewhere no colleague can see.
    prompt: "select_account",
  });
  return `${authority()}/authorize?${params}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

async function requestToken(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`${authority()}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.MICROSOFT_CLIENT_ID!,
      client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
      ...body,
    }),
  });
  const json = (await res.json()) as TokenResponse;
  if (!res.ok || json.error) {
    throw new Error(json.error_description || json.error || "Microsoft rejected the sign-in");
  }
  return json;
}

/** Swap the callback's code for tokens and remember them against the user. */
export async function exchangeCode(userId: string, code: string, origin: string) {
  const token = await requestToken({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(origin),
    scope: SCOPES,
  });

  // Who did they actually connect? Worth knowing at a glance in Settings.
  let email: string | null = null;
  let name: string | null = null;
  try {
    const me = await fetch(`${GRAPH}/me`, {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    if (me.ok) {
      const profile = (await me.json()) as {
        mail?: string;
        userPrincipalName?: string;
        displayName?: string;
      };
      email = profile.mail || profile.userPrincipalName || null;
      name = profile.displayName || null;
    }
  } catch {
    // A missing display name is not a reason to fail a working connection.
  }

  await createAdminClient()
    .from("microsoft_accounts")
    .upsert(
      {
        user_id: userId,
        account_email: email,
        account_name: name,
        access_token: token.access_token,
        refresh_token: token.refresh_token!,
        expires_at: new Date(Date.now() + token.expires_in * 1000).toISOString(),
        scope: token.scope || SCOPES,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
}

interface StoredAccount {
  access_token: string;
  refresh_token: string;
  expires_at: string;
  account_email: string | null;
  account_name: string | null;
  last_section_id: string | null;
  last_section_name: string | null;
}

export async function getAccount(userId: string): Promise<StoredAccount | null> {
  const { data } = await createAdminClient()
    .from("microsoft_accounts")
    .select(
      "access_token,refresh_token,expires_at,account_email,account_name,last_section_id,last_section_name",
    )
    .eq("user_id", userId)
    .maybeSingle();
  return (data as StoredAccount) || null;
}

export async function disconnect(userId: string) {
  await createAdminClient().from("microsoft_accounts").delete().eq("user_id", userId);
}

/**
 * A usable access token, refreshed if it is close to expiring. The 60-second
 * margin is for the request itself: a token with four seconds left passes any
 * "is it expired" check and then expires mid-flight.
 */
async function accessToken(userId: string): Promise<string> {
  const account = await getAccount(userId);
  if (!account) throw new Error("NOT_CONNECTED");

  if (new Date(account.expires_at).getTime() - Date.now() > 60_000) {
    return account.access_token;
  }

  let token: TokenResponse;
  try {
    token = await requestToken({
      grant_type: "refresh_token",
      refresh_token: account.refresh_token,
      scope: SCOPES,
    });
  } catch {
    // The refresh token is dead — password change, consent revoked, or it
    // simply aged out. Clearing it is what turns a permanently failing button
    // back into a "Connect OneNote" one.
    await disconnect(userId);
    throw new Error("NOT_CONNECTED");
  }

  await createAdminClient()
    .from("microsoft_accounts")
    .update({
      access_token: token.access_token,
      // Microsoft usually rotates the refresh token; keep the old one when it
      // doesn't, or the next refresh has nothing to present.
      refresh_token: token.refresh_token || account.refresh_token,
      expires_at: new Date(Date.now() + token.expires_in * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);

  return token.access_token;
}

/** A Graph call as the user, with the token handled. */
export async function graph(
  userId: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const token = await accessToken(userId);
  return fetch(`${GRAPH}${path}`, {
    ...init,
    headers: {
      ...(init.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  });
}

export interface OneNoteSection {
  id: string;
  name: string;
  notebook: string;
}

/**
 * Every section the user can write to, labelled with its notebook.
 *
 * Flat on purpose. A notebook/section-group/section tree is the shape OneNote
 * stores, but the question being answered is "where does this note go", and
 * that is one choice, not three — `/me/onenote/sections` already expands the
 * parent notebook, and section groups arrive in the same list rather than
 * nested behind another expansion.
 */
export async function listSections(userId: string): Promise<OneNoteSection[]> {
  const res = await graph(
    userId,
    "/me/onenote/sections?$select=id,displayName&$expand=parentNotebook($select=displayName)&$top=100",
  );
  if (!res.ok) throw new Error(await graphError(res));
  const json = (await res.json()) as {
    value: {
      id: string;
      displayName: string;
      parentNotebook?: { displayName?: string };
    }[];
  };
  return (json.value || []).map((s) => ({
    id: s.id,
    name: s.displayName,
    notebook: s.parentNotebook?.displayName || "",
  }));
}

export interface OneNotePage {
  id: string;
  title: string;
  updated: string;
}

export async function listPages(userId: string, sectionId: string): Promise<OneNotePage[]> {
  const res = await graph(
    userId,
    `/me/onenote/sections/${encodeURIComponent(sectionId)}/pages?$select=id,title,lastModifiedDateTime&$orderby=lastModifiedDateTime desc&$top=30`,
  );
  if (!res.ok) throw new Error(await graphError(res));
  const json = (await res.json()) as {
    value: { id: string; title: string; lastModifiedDateTime: string }[];
  };
  return (json.value || []).map((p) => ({
    id: p.id,
    title: p.title || "(untitled)",
    updated: p.lastModifiedDateTime,
  }));
}

/**
 * Put the notes at the TOP of an existing page.
 *
 * `prepend` against the body is the whole trick: OneNote's own behaviour is to
 * append, which buries today's meeting under everything that came before it on
 * a page you have been adding to all quarter. The newest thing should be the
 * thing you see.
 */
export async function prependToPage(userId: string, pageId: string, html: string) {
  const res = await graph(
    userId,
    `/me/onenote/pages/${encodeURIComponent(pageId)}/content`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([{ target: "body", action: "prepend", content: html }]),
    },
  );
  if (!res.ok) throw new Error(await graphError(res));
}

/** A brand new page in a section, titled with the meeting. */
export async function createPage(
  userId: string,
  sectionId: string,
  title: string,
  html: string,
): Promise<string | null> {
  // OneNote takes a whole HTML document here, not a fragment, and it reads the
  // <title> as the page title.
  const page = `<!DOCTYPE html><html><head><title>${escapeHtml(title)}</title></head><body>${html}</body></html>`;
  const res = await graph(
    userId,
    `/me/onenote/sections/${encodeURIComponent(sectionId)}/pages`,
    {
      method: "POST",
      headers: { "Content-Type": "text/html" },
      body: page,
    },
  );
  if (!res.ok) throw new Error(await graphError(res));
  const json = (await res.json().catch(() => null)) as { links?: { oneNoteClientUrl?: { href?: string } } } | null;
  // The onenote: link opens the desktop app on the page it just made.
  return json?.links?.oneNoteClientUrl?.href || null;
}

/** Remember where this went, so the next one can offer the same place. */
export async function rememberSection(userId: string, id: string, name: string) {
  await createAdminClient()
    .from("microsoft_accounts")
    .update({ last_section_id: id, last_section_name: name, updated_at: new Date().toISOString() })
    .eq("user_id", userId);
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Graph's errors are a nested envelope; the message inside is usually the only
 * part worth showing. Falling back to the status keeps a mystery failure from
 * surfacing as "undefined".
 */
async function graphError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as
    | { error?: { message?: string; code?: string } }
    | null;
  const message = body?.error?.message;
  if (res.status === 401 || res.status === 403) {
    return message || "Microsoft turned that down — try disconnecting and connecting again.";
  }
  return message || `OneNote returned ${res.status}.`;
}
