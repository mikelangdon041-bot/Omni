import { NextResponse } from "next/server";
import {
  CORS_HEADERS,
  ReauthRequired,
  baseUrl,
  resourceMetadataUrl,
  verifyAccessToken,
  type MsAccount,
} from "@/lib/mcp/oauth";
import { TOOLS, callTool } from "@/lib/mcp/tools";

export const runtime = "nodejs";
export const maxDuration = 60;

// Remote MCP server for claude.ai: Streamable HTTP, stateless.
//
// Every request is one POST of JSON-RPC and gets one JSON answer back. The
// spec lets a server answer with plain application/json instead of an SSE
// stream, and with no server-initiated messages there is nothing a stream
// would carry, so there is no session, no GET stream and nothing to resume.
// That is also what makes it fit a serverless function.
//
// Auth: a bearer token Omni issued (src/app/api/mcp/oauth). Without one the
// answer is a 401 pointing at the protected-resource metadata, which is how
// claude.ai discovers where to sign in.

const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

const INSTRUCTIONS = `Outlook mail and calendar for the signed-in user.
- Read tools (list_events, search_mail, get_thread) return plain text with an Outlook web link for every item; include the links when you report items.
- Sending is two steps: create_draft saves a draft and returns draft_id; send_mail sends only that draft. Never call send_mail unless the user asked for the email to be sent (or the task you were given explicitly says to send).
- create_event sends invitations to attendees as soon as it runs.`;

interface RpcMessage {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

function unauthorized(req: Request, invalid: boolean) {
  const meta = resourceMetadataUrl(baseUrl(req));
  return new NextResponse(JSON.stringify({ error: invalid ? "invalid_token" : "unauthorized" }), {
    status: 401,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json",
      "WWW-Authenticate": invalid
        ? `Bearer error="invalid_token", error_description="The access token is expired or revoked", resource_metadata="${meta}"`
        : `Bearer resource_metadata="${meta}"`,
    },
  });
}

const rpcError = (id: RpcMessage["id"], code: number, message: string) => ({
  jsonrpc: "2.0",
  id: id ?? null,
  error: { code, message },
});

async function handle(msg: RpcMessage, account: MsAccount): Promise<object | null> {
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return rpcError(msg?.id, -32600, "Invalid request");
  }
  // Notifications (no id) get no answer.
  if (msg.id === undefined) return null;
  const { id, method, params = {} } = msg;

  switch (method) {
    case "initialize": {
      const asked = String(params.protocolVersion || "");
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[1],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "omni-outlook", title: "Omni Outlook", version: "1.0.0" },
          instructions: INSTRUCTIONS,
        },
      };
    }
    case "ping":
      return { jsonrpc: "2.0", id, result: {} };
    case "tools/list":
      return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
    case "tools/call": {
      const name = String(params.name || "");
      const args = (params.arguments as Record<string, unknown>) || {};
      const result = await callTool(account, name, args);
      return { jsonrpc: "2.0", id, result };
    }
    case "resources/list":
      return { jsonrpc: "2.0", id, result: { resources: [] } };
    case "prompts/list":
      return { jsonrpc: "2.0", id, result: { prompts: [] } };
    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

export async function POST(req: Request) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return unauthorized(req, false);
  const account = await verifyAccessToken(token);
  if (!account) return unauthorized(req, true);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(rpcError(null, -32700, "Parse error"), { status: 400, headers: CORS_HEADERS });
  }

  try {
    const batch = Array.isArray(body);
    const messages = (batch ? body : [body]) as RpcMessage[];
    const answers = (await Promise.all(messages.map((m) => handle(m, account)))).filter(Boolean);
    if (!answers.length) return new NextResponse(null, { status: 202, headers: CORS_HEADERS });
    return NextResponse.json(batch ? answers : answers[0], { headers: CORS_HEADERS });
  } catch (e) {
    if (e instanceof ReauthRequired) return unauthorized(req, true);
    console.error(`[mcp] request failed: ${(e as Error).name}`);
    return NextResponse.json(rpcError(null, -32603, "Internal error"), { status: 500, headers: CORS_HEADERS });
  }
}

// No server-to-client stream (see top); the spec's answer for that is 405.
export async function GET() {
  return new NextResponse(null, { status: 405, headers: { ...CORS_HEADERS, Allow: "POST" } });
}

export async function DELETE() {
  return new NextResponse(null, { status: 405, headers: { ...CORS_HEADERS, Allow: "POST" } });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
