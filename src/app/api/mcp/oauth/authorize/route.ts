import { NextResponse } from "next/server";
import {
  baseUrl,
  getClient,
  msAuthorizeUrl,
  msConfigured,
  parkRequest,
  resourceOk,
} from "@/lib/mcp/oauth";

export const runtime = "nodejs";

// OAuth 2.1 authorization endpoint. Checks the client's request, parks it, and
// sends the browser to Microsoft. The Microsoft callback finishes the job and
// returns the browser to the client with a code.

/** Shown in the browser instead of redirecting: the redirect target itself is untrusted. */
function page(status: number, message: string) {
  const esc = message.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Omni Outlook connector</title><body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5"><h1 style="font-size:1.25rem">Couldn't connect Outlook</h1><p>${esc}</p></body>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const p = url.searchParams;
  const base = baseUrl(req);

  const notReady = msConfigured();
  if (notReady) return page(503, notReady);

  const client = await getClient(p.get("client_id") || "");
  if (!client) return page(400, "Unknown client. Remove the connector in claude.ai and add it again.");
  const redirectUri = p.get("redirect_uri") || (client.redirect_uris.length === 1 ? client.redirect_uris[0] : "");
  if (!redirectUri || !client.redirect_uris.includes(redirectUri))
    return page(400, "The redirect address does not match the one this client registered.");

  const state = p.get("state");
  const back = (error: string, description: string) => {
    const to = new URL(redirectUri);
    to.searchParams.set("error", error);
    to.searchParams.set("error_description", description);
    if (state) to.searchParams.set("state", state);
    return NextResponse.redirect(to);
  };

  if (p.get("response_type") !== "code") return back("unsupported_response_type", "Only response_type=code is supported");
  const challenge = p.get("code_challenge") || "";
  if (!challenge || (p.get("code_challenge_method") || "plain") !== "S256")
    return back("invalid_request", "PKCE with code_challenge_method=S256 is required");
  const resource = p.get("resource");
  if (!resourceOk(resource, base)) return back("invalid_target", "Unknown resource");

  const { msState, msChallenge } = await parkRequest({
    client_id: client.client_id,
    redirect_uri: redirectUri,
    state,
    code_challenge: challenge,
    scope: p.get("scope"),
    resource,
  });
  return NextResponse.redirect(msAuthorizeUrl(base, msState, msChallenge));
}
