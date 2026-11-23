import { NextResponse } from "next/server";
import { baseUrl, completeMicrosoft, issueCode, takeRequest } from "@/lib/mcp/oauth";

export const runtime = "nodejs";

// Microsoft sends the browser back here. Swap its code for tokens, store them
// sealed, then send the browser on to the client (claude.ai) with Omni's own
// authorization code. This URL must be registered as a Web redirect URI on the
// Entra app: <site>/api/mcp/oauth/callback.

function page(status: number, message: string) {
  const esc = message.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Omni Outlook connector</title><body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5"><h1 style="font-size:1.25rem">Couldn't connect Outlook</h1><p>${esc}</p><p>Close this tab and try connecting again from claude.ai.</p></body>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const msState = p.get("state");
  if (!msState) return page(400, "Microsoft did not send the sign-in state back.");
  const parked = await takeRequest(msState);
  if (!parked) return page(400, "This sign-in link has expired or was already used.");

  const back = (params: Record<string, string>) => {
    const to = new URL(parked.redirect_uri);
    for (const [k, v] of Object.entries(params)) to.searchParams.set(k, v);
    if (parked.state) to.searchParams.set("state", parked.state);
    to.searchParams.set("iss", baseUrl(req));
    return NextResponse.redirect(to);
  };

  const msError = p.get("error");
  if (msError) {
    // Most often: the tenant needs admin consent (AADSTS65001 / 90094).
    const description = (p.get("error_description") || msError).split("\r\n")[0].slice(0, 300);
    return back({ error: "access_denied", error_description: `Microsoft: ${description}` });
  }
  const code = p.get("code");
  if (!code) return back({ error: "server_error", error_description: "Microsoft did not return a code" });

  let result: Awaited<ReturnType<typeof completeMicrosoft>>;
  try {
    result = await completeMicrosoft(baseUrl(req), code, parked.ms_code_verifier);
  } catch (e) {
    return back({ error: "server_error", error_description: ((e as Error).message || "Sign-in failed").slice(0, 300) });
  }
  if ("refused" in result) return back({ error: "access_denied", error_description: result.refused });

  const ourCode = await issueCode({
    client_id: parked.client_id,
    redirect_uri: parked.redirect_uri,
    code_challenge: parked.code_challenge,
    account_id: result.account.id,
    scope: parked.scope,
    resource: parked.resource,
  });
  return back({ code: ourCode });
}
