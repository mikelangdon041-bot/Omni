import { NextResponse } from "next/server";
import { CORS_HEADERS, redirectAllowed, registerClient } from "@/lib/mcp/oauth";

export const runtime = "nodejs";

// RFC 7591 dynamic client registration. claude.ai registers itself here the
// first time the connector is added. Only known redirect URIs are accepted
// (see redirectAllowed): this endpoint is public, and a client that can send
// codes anywhere is a phishing kit.

function fail(error: string, description: string) {
  return NextResponse.json({ error, error_description: description }, { status: 400, headers: CORS_HEADERS });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    client_name?: string;
    redirect_uris?: unknown;
    token_endpoint_auth_method?: string;
    grant_types?: string[];
    response_types?: string[];
  } | null;
  if (!body) return fail("invalid_client_metadata", "Body must be JSON");

  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.map(String) : [];
  if (!uris.length) return fail("invalid_redirect_uri", "redirect_uris is required");
  const bad = uris.find((u) => !redirectAllowed(u));
  if (bad) return fail("invalid_redirect_uri", `Redirect URI not allowed: ${bad}`);

  const method = body.token_endpoint_auth_method || "none";
  if (!["none", "client_secret_post", "client_secret_basic"].includes(method))
    return fail("invalid_client_metadata", `Unsupported token_endpoint_auth_method: ${method}`);

  const { client, secret } = await registerClient({
    client_name: body.client_name,
    redirect_uris: uris,
    token_endpoint_auth_method: method,
  });

  return NextResponse.json(
    {
      client_id: client.client_id,
      ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: client.client_name || undefined,
      redirect_uris: client.redirect_uris,
      token_endpoint_auth_method: method,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    },
    { status: 201, headers: { ...CORS_HEADERS, "Cache-Control": "no-store" } },
  );
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
