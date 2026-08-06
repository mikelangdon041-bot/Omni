import { NextResponse } from "next/server";
import { routeAuth } from "@/lib/supabase/route";
import {
  createPage,
  disconnect,
  getAccount,
  listPages,
  listSections,
  microsoftConfigured,
  prependToPage,
  rememberSection,
} from "@/lib/microsoft/graph";

export const runtime = "nodejs";
export const maxDuration = 60;

// Everything the OneNote hand-off needs, behind one route keyed on `action`.
// The alternative is five files that all begin with the same twelve lines of
// session check and connection check.
//
//   status    — is an account connected, and which one
//   sections  — every section that can be written to
//   pages     — recent pages in a section
//   send      — put the notes on a page, or on a new one
//   disconnect

export async function POST(req: Request) {
  // routeAuth, not the cookie client: the destination picker in the desktop
  // recorder calls this too, and it is not a browser — it sends a bearer token.
  const { user } = await routeAuth(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const action: string = body?.action || "";

  if (!microsoftConfigured()) {
    return NextResponse.json(
      { error: "Microsoft isn't configured on this deployment yet.", configured: false },
      { status: 501 },
    );
  }

  try {
    if (action === "status") {
      const account = await getAccount(user.id);
      return NextResponse.json({
        configured: true,
        connected: !!account,
        email: account?.account_email || null,
        name: account?.account_name || null,
        lastSectionId: account?.last_section_id || null,
        lastSectionName: account?.last_section_name || null,
      });
    }

    if (action === "disconnect") {
      await disconnect(user.id);
      return NextResponse.json({ ok: true });
    }

    if (action === "sections") {
      return NextResponse.json({ sections: await listSections(user.id) });
    }

    if (action === "pages") {
      const sectionId = String(body?.sectionId || "");
      if (!sectionId) return NextResponse.json({ error: "No section" }, { status: 400 });
      return NextResponse.json({ pages: await listPages(user.id, sectionId) });
    }

    if (action === "send") {
      const html = String(body?.html || "");
      const title = String(body?.title || "Meeting notes").slice(0, 200);
      const pageId = String(body?.pageId || "");
      const sectionId = String(body?.sectionId || "");
      const sectionName = String(body?.sectionName || "");
      if (!html.trim()) return NextResponse.json({ error: "Nothing to send" }, { status: 400 });

      if (pageId) {
        await prependToPage(user.id, pageId, html);
      } else if (sectionId) {
        await createPage(user.id, sectionId, title, html);
      } else {
        return NextResponse.json({ error: "Nowhere to send it" }, { status: 400 });
      }
      // Only remembered once the send actually worked — offering a destination
      // next time that failed this time is worse than not remembering.
      if (sectionId) await rememberSection(user.id, sectionId, sectionName);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    const message = (e as Error).message || "That didn't work";
    // The one error worth a different status: the UI turns it back into a
    // "Connect OneNote" button rather than showing a failure to retry.
    if (message === "NOT_CONNECTED") {
      return NextResponse.json({ error: "Not connected", connected: false }, { status: 409 });
    }
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
