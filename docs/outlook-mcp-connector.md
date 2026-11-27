# Outlook MCP connector (claude.ai)

A remote MCP server that lets Claude on claude.ai read Outlook mail and calendar,
draft and send email, and create events, including in unattended scheduled runs.

- **Connector URL:** `https://omni-nine-navy.vercel.app/api/mcp`
- Code: `src/app/api/mcp/` (MCP endpoint, OAuth endpoints, discovery metadata),
  `src/lib/mcp/` (OAuth, sealing, Graph tools). Tables: migration `0041_mcp_connector.sql`.

## Two routes

**PC route (live, the default while no Entra app is configured).** No Microsoft
approval needed. claude.ai signs in with the Omni account (one Allow page). Each
tool call is queued in `mcp_pc_jobs`; the Omni bridge on the PC
(`public/outlook/omni-bridge.ps1`, scheduled task "Omni Outlook bridge") polls
through `mcp_bridge_poll` / `mcp_bridge_finish` with its own token and does the
work in classic Outlook, which is already signed in to the work mailbox.

- The PC must be on and signed in to Windows (locked is fine). The task starts
  at sign-in, restarts every 5 minutes if it stopped, and wakes the PC at 7:40.
  If it starts Outlook itself, it does so in the background.
- Queued jobs expire at 40 s, so a send can never run after Claude was told it
  failed. Job rows are deleted as soon as the answer is read.
- It uses the first Exchange account (override with `-Mailbox`) and sets it as
  the sending account before every send, so nothing goes from a personal account.
- Classic Outlook has no per-item web links: items carry their Outlook id.
  Teams links cannot be added to new events from a script.
- Pair a PC: put sha256(token) in `outlook_bridges` for the user, then
  `powershell -ExecutionPolicy Bypass -File omni-bridge.ps1 -Install -Token <token>`.
  Self-test one tool locally: `omni-bridge.ps1 -Test list_events -TestArgs @args.json`.
  Log: `%LOCALAPPDATA%\Omnibridge.log` (tool names and timings only).

**Graph route (below).** Needs an Entra app and, at Recordati, admin consent.
Switch with `MCP_BACKEND=graph` once `MICROSOFT_*` is set.

## How it works (Graph route)

```
claude.ai ──OAuth 2.1 + PKCE + dynamic registration──▶ Omni (/api/mcp/oauth/*)
Omni      ──Entra auth code, delegated Graph scopes──▶ Microsoft
claude.ai ──Bearer omni_at_…──▶ /api/mcp ──Graph as the user──▶ Outlook
```

claude.ai never holds a Microsoft token. Omni keeps the Microsoft refresh token
AES-256-GCM sealed (`MCP_TOKEN_KEY`) in `mcp_ms_accounts` and refreshes it on
use, which is what lets the 7:47 weekday run work with nobody signing in.
Omni's own tokens: access 1 hour, refresh 90 days renewed on every use, stored
as SHA-256 hashes. If Microsoft kills the sign-in (password change, consent
revoked, 90 days unused), Omni revokes its tokens and claude.ai asks to reconnect.

Tools: `list_events`, `search_mail`, `get_thread`, `create_draft`, `send_mail`
(sends an existing draft only), `create_event`. No email body, preview or
subject is ever logged.

## Environment (Vercel, production)

| Variable | Value |
| --- | --- |
| `MCP_TOKEN_KEY` | 32 random bytes, base64. **Set.** Changing it orphans every stored sign-in. |
| `MCP_PUBLIC_URL` | `https://omni-nine-navy.vercel.app`. **Set.** |
| `MICROSOFT_CLIENT_ID` | Entra app's Application (client) ID |
| `MICROSOFT_CLIENT_SECRET` | Entra app client secret **value** |
| `MICROSOFT_TENANT` | Recordati's Directory (tenant) ID (GUID). Restricts sign-in to that tenant. |
| `MCP_ALLOWED_ACCOUNTS` | Optional. Comma list of addresses or `@domain`s allowed to connect. Required if the tenant is not a GUID. |
| `MCP_DEFAULT_TIMEZONE` | `America/Los_Angeles`. **Set.** |
| `MCP_BACKEND` | Optional. `pc` or `graph`; default is `graph` only when `MICROSOFT_CLIENT_ID` is set. |

The same `MICROSOFT_*` variables are what the OneNote hand-off uses, so one
Entra app serves both.

## Entra app registration

1. Entra admin center → App registrations → New registration.
   Name `Omni`. Supported account types: **this organizational directory only**
   if registered inside the Recordati tenant; **any organizational directory**
   if registered elsewhere.
2. Redirect URI, platform **Web**: `https://omni-nine-navy.vercel.app/api/mcp/oauth/callback`
   (add `https://omni-nine-navy.vercel.app/api/integrations/microsoft/callback` too for OneNote).
3. Certificates & secrets → New client secret (24 months). Copy the **Value**.
4. API permissions → Microsoft Graph → Delegated: `User.Read`, `Mail.ReadWrite`,
   `Mail.Send`, `Calendars.ReadWrite`, `offline_access` (plus `openid`, `profile`,
   `email`, which are always granted).
5. Put the IDs and secret in Vercel (above) and redeploy.

## Admin consent

None of these permissions are admin-only in Microsoft's catalogue, but most
company tenants turn off user consent for mail access, and an app from outside
the tenant (unverified publisher) is usually blocked outright. If the sign-in
shows "Need admin approval" or `AADSTS65001` / `AADSTS90094`, IT has to grant
consent once. Their one-click link:

```
https://login.microsoftonline.com/<TENANT_ID>/adminconsent?client_id=<CLIENT_ID>&redirect_uri=https://omni-nine-navy.vercel.app/api/mcp/oauth/callback
```

The landing page after granting will say the sign-in link expired; that is
expected, consent is still recorded.

## Testing

- Discovery: `curl https://omni-nine-navy.vercel.app/.well-known/oauth-protected-resource/api/mcp`
- Unauthenticated `POST /api/mcp` must answer 401 with a `WWW-Authenticate: Bearer resource_metadata=…` header.
- Full path: add the connector in claude.ai, then ask it to list tomorrow's
  events, search unread mail, draft (not send) a reply to yourself, send that
  draft, and create a test event with no attendees.
- Inspect stored state: `sb.ps1 --project omni --sql "select email, updated_at, access_expires_at from mcp_ms_accounts"`.
