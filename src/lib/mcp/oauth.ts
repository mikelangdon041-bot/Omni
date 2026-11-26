// The OAuth 2.1 side of the Outlook MCP connector. SERVER ONLY.
//
// Two sign-ins are chained here:
//   claude.ai ──(OAuth 2.1 + PKCE + dynamic registration)──▶ Omni
//   Omni      ──(Entra auth code, delegated Graph scopes)──▶ Microsoft
//
// claude.ai never sees a Microsoft token. It holds Omni's tokens; Omni holds
// the Microsoft refresh token (sealed) and uses it for every Graph call, which
// is what lets the unattended 7:47 run work without anyone signing in.

import { createAdminClient } from "@/lib/supabase/admin";
import { pkceChallenge, randomToken, safeEqual, seal, sha256, unseal } from "./crypto";

export const MCP_SCOPE = "outlook";
export const ACCESS_TTL_S = 60 * 60; // one hour
export const REFRESH_TTL_S = 90 * 24 * 60 * 60; // 90 days, renewed on every refresh
const CODE_TTL_S = 10 * 60;
const REQUEST_TTL_S = 10 * 60;
/** A refresh token presented again this soon after rotating is a retry, not theft. */
const ROTATION_GRACE_MS = 2 * 60 * 1000;

export const MS_SCOPES =
  "offline_access openid profile email User.Read Mail.ReadWrite Mail.Send Calendars.ReadWrite";

// ------------------------------------------------------------------ config

/** Public origin of this deployment. Fixed by env in production so the issuer never drifts. */
export function baseUrl(req: Request): string {
  const env = process.env.MCP_PUBLIC_URL?.replace(/\/+$/, "");
  return env || new URL(req.url).origin;
}

export function resourceUrl(base: string): string {
  return `${base}/api/mcp`;
}

export function resourceMetadataUrl(base: string): string {
  return `${base}/.well-known/oauth-protected-resource/api/mcp`;
}

function msTenant(): string {
  return process.env.MICROSOFT_TENANT || "organizations";
}

function msAuthority(): string {
  return `https://login.microsoftonline.com/${msTenant()}/oauth2/v2.0`;
}

/**
 * Where tool calls go. "pc": a helper on the user's PC drives classic Outlook,
 * which is already signed in, so no Entra app or tenant consent is needed
 * (src/lib/mcp/pc.ts). "graph": Microsoft Graph through an Entra app. Default
 * is graph only once an Entra app is configured.
 */
export function backend(): "pc" | "graph" {
  const set = process.env.MCP_BACKEND;
  if (set === "pc" || set === "graph") return set;
  return process.env.MICROSOFT_CLIENT_ID ? "graph" : "pc";
}

export function msConfigured(): string | null {
  if (!process.env.MICROSOFT_CLIENT_ID || !process.env.MICROSOFT_CLIENT_SECRET)
    return "MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET are not set on this deployment.";
  if (!process.env.MCP_TOKEN_KEY) return "MCP_TOKEN_KEY is not set on this deployment.";
  return null;
}

export function msRedirectUri(base: string): string {
  return `${base}/api/mcp/oauth/callback`;
}

/**
 * Which redirect URIs a dynamically registered client may use. Without a list
 * anyone could register a client pointing at their own site and send a
 * colleague a sign-in link that hands the mailbox to them.
 */
export function redirectAllowed(uri: string): boolean {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.hash) return false;
  const exact = [
    "https://claude.ai/api/mcp/auth_callback",
    "https://claude.com/api/mcp/auth_callback",
    ...(process.env.MCP_EXTRA_REDIRECT_URIS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  ];
  const bare = `${u.origin}${u.pathname}`;
  if (exact.includes(bare)) return true;
  // Local tools (MCP Inspector, Claude Code) listen on a loopback port.
  if (u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1")) return true;
  return false;
}

/**
 * Who may connect. A single-tenant MICROSOFT_TENANT (a GUID) already limits
 * sign-in to one organisation; MCP_ALLOWED_ACCOUNTS narrows further to
 * addresses ("me@x.com") or domains ("@x.com"). With neither, nobody: an open
 * "common" app would let any Microsoft user run their mail through Omni.
 */
export function accountAllowed(email: string | null, tenantId: string): boolean {
  const list = (process.env.MCP_ALLOWED_ACCOUNTS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const tenant = msTenant();
  const singleTenant = /^[0-9a-f-]{36}$/i.test(tenant);
  if (singleTenant && tenantId.toLowerCase() !== tenant.toLowerCase()) return false;
  if (!list.length) return singleTenant;
  const e = (email || "").toLowerCase();
  return list.some((entry) => (entry.startsWith("@") ? e.endsWith(entry) : e === entry));
}

// --------------------------------------------------------------- clients

export interface Client {
  client_id: string;
  client_secret_hash: string | null;
  client_name: string | null;
  redirect_uris: string[];
  token_endpoint_auth_method: string;
}

export async function registerClient(input: {
  client_name?: string;
  redirect_uris: string[];
  token_endpoint_auth_method?: string;
}): Promise<{ client: Client; secret: string | null }> {
  const method = input.token_endpoint_auth_method || "none";
  const secret = method === "none" ? null : randomToken(32);
  const client: Client = {
    client_id: `mcp_${randomToken(18)}`,
    client_secret_hash: secret ? sha256(secret) : null,
    client_name: (input.client_name || "").slice(0, 200) || null,
    redirect_uris: input.redirect_uris,
    token_endpoint_auth_method: method,
  };
  const { error } = await createAdminClient().from("mcp_clients").insert(client);
  if (error) throw new Error(error.message);
  return { client, secret };
}

export async function getClient(clientId: string): Promise<Client | null> {
  if (!clientId) return null;
  const { data } = await createAdminClient()
    .from("mcp_clients")
    .select("client_id,client_secret_hash,client_name,redirect_uris,token_endpoint_auth_method")
    .eq("client_id", clientId)
    .maybeSingle();
  return (data as Client) || null;
}

export function clientSecretOk(client: Client, secret: string | null): boolean {
  if (client.token_endpoint_auth_method === "none" || !client.client_secret_hash) return true;
  return !!secret && safeEqual(sha256(secret), client.client_secret_hash);
}

// ------------------------------------------------------- authorize leg

export async function parkRequest(input: {
  client_id: string;
  redirect_uri: string;
  state: string | null;
  code_challenge: string;
  scope: string | null;
  resource: string | null;
}): Promise<{ msState: string; msChallenge: string }> {
  const admin = createAdminClient();
  // Housekeeping, cheap enough to do on every sign-in.
  const now = new Date().toISOString();
  await admin.from("mcp_auth_requests").delete().lt("expires_at", now);
  await admin.from("mcp_auth_codes").delete().lt("expires_at", now);

  const msState = randomToken(24);
  const verifier = randomToken(48);
  const { error } = await admin.from("mcp_auth_requests").insert({
    id: msState,
    ...input,
    ms_code_verifier: verifier,
    expires_at: new Date(Date.now() + REQUEST_TTL_S * 1000).toISOString(),
  });
  if (error) throw new Error(error.message);
  return { msState, msChallenge: pkceChallenge(verifier) };
}

export function msAuthorizeUrl(base: string, msState: string, msChallenge: string): string {
  const params = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID!,
    response_type: "code",
    redirect_uri: msRedirectUri(base),
    response_mode: "query",
    scope: MS_SCOPES,
    state: msState,
    code_challenge: msChallenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  return `${msAuthority()}/authorize?${params}`;
}

export interface ParkedRequest {
  id: string;
  client_id: string;
  redirect_uri: string;
  state: string | null;
  code_challenge: string;
  scope: string | null;
  resource: string | null;
  ms_code_verifier: string;
  expires_at: string;
}

/** Fetch and delete in one go: a parked request is good for exactly one callback. */
export async function takeRequest(msState: string): Promise<ParkedRequest | null> {
  const { data } = await createAdminClient()
    .from("mcp_auth_requests")
    .delete()
    .eq("id", msState)
    .select("*")
    .maybeSingle();
  const row = data as ParkedRequest | null;
  if (!row || new Date(row.expires_at).getTime() < Date.now()) return null;
  return row;
}

// ------------------------------------------------------------- Microsoft

interface MsTokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

export class MsAuthError extends Error {
  constructor(
    message: string,
    public code: string,
  ) {
    super(message);
  }
}

async function msToken(body: Record<string, string>): Promise<MsTokenResponse> {
  const res = await fetch(`${msAuthority()}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.MICROSOFT_CLIENT_ID!,
      client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
      ...body,
    }),
  });
  const json = (await res.json().catch(() => ({}))) as MsTokenResponse;
  if (!res.ok || json.error) {
    throw new MsAuthError(
      (json.error_description || json.error || `Microsoft returned ${res.status}`).split("\r\n")[0],
      json.error || `http_${res.status}`,
    );
  }
  return json;
}

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const part = jwt.split(".")[1] || "";
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

export interface MsAccount {
  id: string;
  tenant_id: string;
  object_id: string;
  email: string | null;
  name: string | null;
  refresh_token_enc: string;
  access_token_enc: string | null;
  access_expires_at: string | null;
}

/**
 * Finish the Microsoft leg: code → tokens → who is it → stored, sealed.
 * Returns null with a reason when the account is not one allowed to connect.
 */
export async function completeMicrosoft(
  base: string,
  code: string,
  verifier: string,
): Promise<{ account: MsAccount } | { refused: string }> {
  const token = await msToken({
    grant_type: "authorization_code",
    code,
    redirect_uri: msRedirectUri(base),
    code_verifier: verifier,
    scope: MS_SCOPES,
  });
  if (!token.refresh_token) throw new Error("Microsoft did not return a refresh token (offline_access missing?)");
  // The id_token came straight from Microsoft's token endpoint over TLS, so
  // its claims can be read without re-verifying the signature.
  const claims = token.id_token ? decodeJwtPayload(token.id_token) : {};
  const tenantId = String(claims.tid || "");
  const objectId = String(claims.oid || "");
  const email = (claims.preferred_username || claims.email || null) as string | null;
  const name = (claims.name || null) as string | null;
  if (!tenantId || !objectId) throw new Error("Microsoft did not say which account signed in");
  if (!accountAllowed(email, tenantId)) {
    return { refused: `${email || "That account"} is not allowed to connect to this server.` };
  }

  const { data, error } = await createAdminClient()
    .from("mcp_ms_accounts")
    .upsert(
      {
        tenant_id: tenantId,
        object_id: objectId,
        email,
        name,
        refresh_token_enc: seal(token.refresh_token),
        access_token_enc: seal(token.access_token),
        access_expires_at: new Date(Date.now() + token.expires_in * 1000).toISOString(),
        scope: token.scope || MS_SCOPES,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "tenant_id,object_id" },
    )
    .select("id,tenant_id,object_id,email,name,refresh_token_enc,access_token_enc,access_expires_at")
    .single();
  if (error) throw new Error(error.message);
  return { account: data as MsAccount };
}

export async function getAccount(id: string): Promise<MsAccount | null> {
  const { data } = await createAdminClient()
    .from("mcp_ms_accounts")
    .select("id,tenant_id,object_id,email,name,refresh_token_enc,access_token_enc,access_expires_at")
    .eq("id", id)
    .maybeSingle();
  return (data as MsAccount) || null;
}

/** Microsoft errors that mean the stored sign-in is dead and only a fresh one will do. */
const DEAD_GRANT = new Set(["invalid_grant", "interaction_required", "consent_required", "login_required"]);

/**
 * A Graph access token for the account, refreshed when it has under a minute
 * left (a token with four seconds left passes an expiry check and then dies
 * mid-request). `force` skips the cache after Graph has said 401.
 */
export async function msAccessToken(account: MsAccount, force = false): Promise<string> {
  if (
    !force &&
    account.access_token_enc &&
    account.access_expires_at &&
    new Date(account.access_expires_at).getTime() - Date.now() > 60_000
  ) {
    return unseal(account.access_token_enc);
  }
  let token: MsTokenResponse;
  try {
    token = await msToken({
      grant_type: "refresh_token",
      refresh_token: unseal(account.refresh_token_enc),
      scope: MS_SCOPES,
    });
  } catch (e) {
    if (e instanceof MsAuthError && DEAD_GRANT.has(e.code)) {
      // Revoke what claude.ai holds so its next call gets a 401 and it asks
      // the user to reconnect, instead of failing every tool call forever.
      await revokeAccountTokens(account.id);
      throw new ReauthRequired(e.message);
    }
    throw e;
  }
  const accessEnc = seal(token.access_token);
  // Microsoft usually rotates the refresh token. Keep the old one if not.
  const refreshEnc = token.refresh_token ? seal(token.refresh_token) : account.refresh_token_enc;
  const expires = new Date(Date.now() + token.expires_in * 1000).toISOString();
  await createAdminClient()
    .from("mcp_ms_accounts")
    .update({
      access_token_enc: accessEnc,
      refresh_token_enc: refreshEnc,
      access_expires_at: expires,
      updated_at: new Date().toISOString(),
    })
    .eq("id", account.id);
  account.access_token_enc = accessEnc;
  account.refresh_token_enc = refreshEnc;
  account.access_expires_at = expires;
  return token.access_token;
}

export class ReauthRequired extends Error {}

// ------------------------------------------------------- Omni's tokens

export async function issueCode(input: {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  account_id?: string | null;
  user_id?: string | null;
  scope: string | null;
  resource: string | null;
}): Promise<string> {
  const code = randomToken(32);
  const { error } = await createAdminClient()
    .from("mcp_auth_codes")
    .insert({
      code_hash: sha256(code),
      ...input,
      expires_at: new Date(Date.now() + CODE_TTL_S * 1000).toISOString(),
    });
  if (error) throw new Error(error.message);
  return code;
}

interface CodeRow {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  account_id: string | null;
  user_id: string | null;
  scope: string | null;
  resource: string | null;
  expires_at: string;
}

/** Atomically mark the code used; a second attempt finds nothing. */
export async function redeemCode(code: string): Promise<CodeRow | null> {
  const { data } = await createAdminClient()
    .from("mcp_auth_codes")
    .update({ used_at: new Date().toISOString() })
    .eq("code_hash", sha256(code))
    .is("used_at", null)
    .select("client_id,redirect_uri,code_challenge,account_id,user_id,scope,resource,expires_at")
    .maybeSingle();
  const row = data as CodeRow | null;
  if (!row || new Date(row.expires_at).getTime() < Date.now()) return null;
  return row;
}

export interface TokenPair {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
}

export async function issueTokens(input: {
  client_id: string;
  account_id?: string | null;
  user_id?: string | null;
  family_id?: string;
  resource: string | null;
}): Promise<TokenPair> {
  const admin = createAdminClient();
  const family = input.family_id || crypto.randomUUID();
  const access = `omni_at_${randomToken(32)}`;
  const refresh = `omni_rt_${randomToken(32)}`;
  const now = Date.now();
  const common = {
    client_id: input.client_id,
    account_id: input.account_id || null,
    user_id: input.user_id || null,
    family_id: family,
    scope: MCP_SCOPE,
    resource: input.resource,
  };
  const { error } = await admin.from("mcp_tokens").insert([
    { ...common, token_hash: sha256(access), kind: "access", expires_at: new Date(now + ACCESS_TTL_S * 1000).toISOString() },
    { ...common, token_hash: sha256(refresh), kind: "refresh", expires_at: new Date(now + REFRESH_TTL_S * 1000).toISOString() },
  ]);
  if (error) throw new Error(error.message);
  // Expired rows are dead weight; a day's slack keeps reuse detection working.
  await admin
    .from("mcp_tokens")
    .delete()
    .lt("expires_at", new Date(now - 24 * 3600 * 1000).toISOString());
  return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL_S, refresh_token: refresh, scope: MCP_SCOPE };
}

interface TokenRow {
  token_hash: string;
  client_id: string;
  account_id: string | null;
  user_id: string | null;
  family_id: string;
  resource: string | null;
  expires_at: string;
  rotated_at: string | null;
  revoked_at: string | null;
}

export async function rotateRefresh(
  refresh: string,
  clientId: string,
): Promise<TokenPair | { error: string }> {
  const admin = createAdminClient();
  const hash = sha256(refresh);
  const { data } = await admin
    .from("mcp_tokens")
    .select("token_hash,client_id,account_id,user_id,family_id,resource,expires_at,rotated_at,revoked_at")
    .eq("token_hash", hash)
    .eq("kind", "refresh")
    .maybeSingle();
  const row = data as TokenRow | null;
  if (!row || row.revoked_at || new Date(row.expires_at).getTime() < Date.now())
    return { error: "Refresh token is not valid" };
  if (row.client_id !== clientId) return { error: "Refresh token was issued to another client" };

  if (row.rotated_at) {
    if (Date.now() - new Date(row.rotated_at).getTime() < ROTATION_GRACE_MS) {
      // A retry of a refresh whose answer was lost in transit.
      return issueTokens({ client_id: row.client_id, account_id: row.account_id, user_id: row.user_id, family_id: row.family_id, resource: row.resource });
    }
    // An old refresh token came back: someone kept a copy. Kill the chain.
    await admin.from("mcp_tokens").update({ revoked_at: new Date().toISOString() }).eq("family_id", row.family_id);
    return { error: "Refresh token was already used" };
  }

  const { data: claimed } = await admin
    .from("mcp_tokens")
    .update({ rotated_at: new Date().toISOString() })
    .eq("token_hash", hash)
    .is("rotated_at", null)
    .select("token_hash")
    .maybeSingle();
  if (!claimed) {
    // Lost a race with a concurrent refresh of the same token: same as a retry.
    return issueTokens({ client_id: row.client_id, account_id: row.account_id, user_id: row.user_id, family_id: row.family_id, resource: row.resource });
  }
  if (row.account_id && !(await getAccount(row.account_id)))
    return { error: "The Microsoft account is no longer connected" };
  return issueTokens({ client_id: row.client_id, account_id: row.account_id, user_id: row.user_id, family_id: row.family_id, resource: row.resource });
}

/** Who a bearer token speaks for: a Microsoft account (Graph) or an Omni user (PC). */
export type Principal = { kind: "graph"; account: MsAccount } | { kind: "pc"; userId: string };

/** The principal behind a bearer token, or null if the token is not live. */
export async function verifyAccessToken(token: string): Promise<Principal | null> {
  if (!token.startsWith("omni_at_")) return null;
  const admin = createAdminClient();
  const { data } = await admin
    .from("mcp_tokens")
    .select("token_hash,account_id,user_id,expires_at,revoked_at")
    .eq("token_hash", sha256(token))
    .eq("kind", "access")
    .maybeSingle();
  const row = data as Pick<TokenRow, "token_hash" | "account_id" | "user_id" | "expires_at" | "revoked_at"> | null;
  if (!row || row.revoked_at || new Date(row.expires_at).getTime() < Date.now()) return null;
  if (row.user_id) return { kind: "pc", userId: row.user_id };
  const account = row.account_id ? await getAccount(row.account_id) : null;
  return account ? { kind: "graph", account } : null;
}

export async function revokeAccountTokens(accountId: string) {
  await createAdminClient()
    .from("mcp_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("account_id", accountId)
    .is("revoked_at", null);
}

export function pkceOk(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  return safeEqual(pkceChallenge(verifier), challenge);
}

/** RFC 8707: a resource indicator, if sent, must name this server. */
export function resourceOk(resource: string | null, base: string): boolean {
  if (!resource) return true;
  const r = resource.replace(/\/+$/, "");
  return r === resourceUrl(base) || r === base;
}

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Authorization, Content-Type, Accept, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID",
  "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id, Mcp-Protocol-Version",
  "Access-Control-Max-Age": "86400",
};
