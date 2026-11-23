import { NextResponse } from "next/server";
import { CORS_HEADERS, MCP_SCOPE, baseUrl, resourceUrl } from "@/lib/mcp/oauth";

export const runtime = "nodejs";

// OAuth discovery documents for the MCP connector. next.config.ts rewrites
//   /.well-known/oauth-protected-resource[/...]   → /api/mcp/meta/resource (RFC 9728)
//   /.well-known/oauth-authorization-server[/...] → /api/mcp/meta/server   (RFC 8414)
//   /.well-known/openid-configuration[/...]       → /api/mcp/meta/server
// here (as a path segment: a rewritten request still reports the original URL,
// so a query string added by the rewrite never arrives), because the proxy and the app router both treat /.well-known as just
// another path that would otherwise demand a signed-in session.

export async function GET(req: Request, ctx: { params: Promise<{ doc: string }> }) {
  const base = baseUrl(req);
  const { doc } = await ctx.params;
  const headers = { ...CORS_HEADERS, "Cache-Control": "public, max-age=300" };

  if (doc === "resource") {
    return NextResponse.json(
      {
        resource: resourceUrl(base),
        authorization_servers: [base],
        scopes_supported: [MCP_SCOPE],
        bearer_methods_supported: ["header"],
        resource_name: "Omni Outlook",
      },
      { headers },
    );
  }

  if (doc !== "server") return NextResponse.json({ error: "not_found" }, { status: 404, headers: CORS_HEADERS });

  return NextResponse.json(
    {
      issuer: base,
      authorization_endpoint: `${base}/api/mcp/oauth/authorize`,
      token_endpoint: `${base}/api/mcp/oauth/token`,
      registration_endpoint: `${base}/api/mcp/oauth/register`,
      response_types_supported: ["code"],
      response_modes_supported: ["query"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
      scopes_supported: [MCP_SCOPE],
      authorization_response_iss_parameter_supported: true,
    },
    { headers },
  );
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
