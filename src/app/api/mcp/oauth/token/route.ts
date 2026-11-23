import { NextResponse } from "next/server";
import {
  CORS_HEADERS,
  baseUrl,
  clientSecretOk,
  getAccount,
  getClient,
  issueTokens,
  pkceOk,
  redeemCode,
  resourceOk,
  rotateRefresh,
} from "@/lib/mcp/oauth";

export const runtime = "nodejs";

// OAuth 2.1 token endpoint: authorization_code (with PKCE) and refresh_token.

const HEADERS = { ...CORS_HEADERS, "Cache-Control": "no-store", Pragma: "no-cache" };

function fail(error: string, description: string, status = 400) {
  return NextResponse.json({ error, error_description: description }, { status, headers: HEADERS });
}

async function readForm(req: Request): Promise<URLSearchParams> {
  const type = req.headers.get("content-type") || "";
  if (type.includes("application/json")) {
    const json = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return new URLSearchParams(Object.entries(json).map(([k, v]) => [k, String(v)]));
  }
  return new URLSearchParams(await req.text());
}

/** client_secret_basic, else the form fields. */
function clientCredentials(req: Request, form: URLSearchParams): { id: string; secret: string | null } {
  const auth = req.headers.get("authorization") || "";
  if (/^Basic\s+/i.test(auth)) {
    const decoded = Buffer.from(auth.replace(/^Basic\s+/i, ""), "base64").toString("utf8");
    const i = decoded.indexOf(":");
    if (i > 0)
      return { id: decodeURIComponent(decoded.slice(0, i)), secret: decodeURIComponent(decoded.slice(i + 1)) };
  }
  return { id: form.get("client_id") || "", secret: form.get("client_secret") };
}

export async function POST(req: Request) {
  const form = await readForm(req);
  const creds = clientCredentials(req, form);
  const client = await getClient(creds.id);
  if (!client) return fail("invalid_client", "Unknown client", 401);
  if (!clientSecretOk(client, creds.secret)) return fail("invalid_client", "Client authentication failed", 401);

  const grant = form.get("grant_type");
  const base = baseUrl(req);

  if (grant === "authorization_code") {
    const code = form.get("code") || "";
    const verifier = form.get("code_verifier") || "";
    const row = await redeemCode(code);
    if (!row) return fail("invalid_grant", "Code is invalid, expired or already used");
    if (row.client_id !== client.client_id) return fail("invalid_grant", "Code was issued to another client");
    const redirect = form.get("redirect_uri");
    if (redirect && redirect !== row.redirect_uri) return fail("invalid_grant", "redirect_uri does not match");
    if (!pkceOk(verifier, row.code_challenge)) return fail("invalid_grant", "PKCE verification failed");
    const resource = form.get("resource") || row.resource;
    if (!resourceOk(resource, base)) return fail("invalid_target", "Unknown resource");
    if (!(await getAccount(row.account_id))) return fail("invalid_grant", "Account is no longer connected");
    const tokens = await issueTokens({ client_id: client.client_id, account_id: row.account_id, resource });
    return NextResponse.json(tokens, { headers: HEADERS });
  }

  if (grant === "refresh_token") {
    const refresh = form.get("refresh_token") || "";
    if (!refresh) return fail("invalid_request", "refresh_token is required");
    const result = await rotateRefresh(refresh, client.client_id);
    if ("error" in result) return fail("invalid_grant", result.error);
    return NextResponse.json(result, { headers: HEADERS });
  }

  return fail("unsupported_grant_type", `Unsupported grant_type: ${grant}`);
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
