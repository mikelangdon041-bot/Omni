import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  backend,
  baseUrl,
  getClient,
  issueCode,
  msAuthorizeUrl,
  msConfigured,
  parkRequest,
  resourceOk,
  type Client,
} from "@/lib/mcp/oauth";

export const runtime = "nodejs";

// OAuth 2.1 authorization endpoint for the Outlook connector.
//
// Graph route: park the request and send the browser to Microsoft; the
// Microsoft callback finishes it.
// PC route: the person signs in to Omni (cookie session), sees one "Allow"
// page, and the code goes straight back to the client. Their PC's Omni bridge
// does the Outlook work, so Microsoft is never asked.

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function shell(status: number, title: string, inner: string) {
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Omni Outlook connector</title>
<body style="font-family:system-ui,sans-serif;max-width:30rem;margin:3rem auto;padding:0 16px;line-height:1.5;color:#1a1a1a;background:#fff">
<h1 style="font-size:1.25rem">${esc(title)}</h1>${inner}</body>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Frame-Options": "DENY" } },
  );
}

const errorPage = (status: number, message: string) => shell(status, "Couldn't connect Outlook", `<p>${esc(message)}</p>`);

interface Checked {
  client: Client;
  redirectUri: string;
  state: string | null;
  challenge: string;
  scope: string | null;
  resource: string | null;
}

/** Validate an authorization request. Returns the request, or the response to send instead. */
async function check(p: URLSearchParams, base: string): Promise<Checked | NextResponse> {
  const client = await getClient(p.get("client_id") || "");
  if (!client) return errorPage(400, "Unknown client. Remove the connector in claude.ai and add it again.");
  const redirectUri = p.get("redirect_uri") || (client.redirect_uris.length === 1 ? client.redirect_uris[0] : "");
  if (!redirectUri || !client.redirect_uris.includes(redirectUri))
    return errorPage(400, "The redirect address does not match the one this client registered.");

  const state = p.get("state");
  const back = (error: string, description: string) => {
    const to = new URL(redirectUri);
    to.searchParams.set("error", error);
    to.searchParams.set("error_description", description);
    if (state) to.searchParams.set("state", state);
    return NextResponse.redirect(to, 303);
  };
  if (p.get("response_type") !== "code") return back("unsupported_response_type", "Only response_type=code is supported");
  const challenge = p.get("code_challenge") || "";
  if (!challenge || (p.get("code_challenge_method") || "plain") !== "S256")
    return back("invalid_request", "PKCE with code_challenge_method=S256 is required");
  const resource = p.get("resource");
  if (!resourceOk(resource, base)) return back("invalid_target", "Unknown resource");
  return { client, redirectUri, state, challenge, scope: p.get("scope"), resource };
}

const FIELDS = ["response_type", "client_id", "redirect_uri", "state", "code_challenge", "code_challenge_method", "resource", "scope"];

export async function GET(req: Request) {
  const url = new URL(req.url);
  const base = baseUrl(req);

  if (backend() === "graph") {
    const notReady = msConfigured();
    if (notReady) return errorPage(503, notReady);
    const c = await check(url.searchParams, base);
    if (c instanceof NextResponse) return c;
    const { msState, msChallenge } = await parkRequest({
      client_id: c.client.client_id,
      redirect_uri: c.redirectUri,
      state: c.state,
      code_challenge: c.challenge,
      scope: c.scope,
      resource: c.resource,
    });
    return NextResponse.redirect(msAuthorizeUrl(base, msState, msChallenge));
  }

  const c = await check(url.searchParams, base);
  if (c instanceof NextResponse) return c;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    // Sign in to Omni, then come straight back to this same request.
    const login = new URL("/login", base);
    login.searchParams.set("next", `${url.pathname}${url.search}`);
    return NextResponse.redirect(login);
  }

  const hidden = FIELDS.map((f) => {
    const v = url.searchParams.get(f);
    return v === null ? "" : `<input type="hidden" name="${f}" value="${esc(v)}">`;
  }).join("");
  const who = c.client.client_name ? esc(c.client.client_name) : "Claude";
  return shell(
    200,
    `Let ${c.client.client_name || "Claude"} use your Outlook?`,
    `<p>${who} will be able to read your mail and calendar, save drafts, send drafts, and create events, through Outlook on your PC.</p>
<p style="color:#555;font-size:.9rem">Signed in to Omni as ${esc(user.email || "you")}. Your PC needs to be on with the Omni bridge running for it to work.</p>
<form method="post" style="display:flex;gap:.75rem;margin-top:1.5rem">${hidden}
<button name="decision" value="allow" style="flex:1;padding:.7rem;border:0;border-radius:.6rem;background:#2563eb;color:#fff;font-size:1rem;font-weight:600;cursor:pointer">Allow</button>
<button name="decision" value="deny" style="flex:1;padding:.7rem;border:1px solid #ccc;border-radius:.6rem;background:#fff;color:#1a1a1a;font-size:1rem;cursor:pointer">Cancel</button>
</form>`,
  );
}

export async function POST(req: Request) {
  if (backend() !== "pc") return errorPage(405, "Not available.");
  const base = baseUrl(req);
  // The Allow button must have been pressed on this site's own page.
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(base).origin && origin !== new URL(req.url).origin)
    return errorPage(403, "That approval didn't come from this site.");

  const form = new URLSearchParams(await req.text());
  const c = await check(form, base);
  if (c instanceof NextResponse) return c;

  const back = (params: Record<string, string>) => {
    const to = new URL(c.redirectUri);
    for (const [k, v] of Object.entries(params)) to.searchParams.set(k, v);
    if (c.state) to.searchParams.set("state", c.state);
    to.searchParams.set("iss", base);
    return NextResponse.redirect(to, 303);
  };

  if (form.get("decision") !== "allow") return back({ error: "access_denied", error_description: "You chose Cancel." });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return errorPage(401, "Your Omni session ended. Start connecting again from claude.ai.");

  const code = await issueCode({
    client_id: c.client.client_id,
    redirect_uri: c.redirectUri,
    code_challenge: c.challenge,
    user_id: user.id,
    scope: c.scope,
    resource: c.resource,
  });
  return back({ code });
}
