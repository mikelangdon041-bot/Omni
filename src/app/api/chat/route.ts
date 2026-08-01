import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { anthropic, WRITER_MODEL } from "@/lib/anthropic";
import { stripEmDashes } from "@/lib/writer/sanitize";
import { getAction, actionsFor } from "@/lib/chat/actions";
import {
  ASK_SCHEMA,
  COMPOSE_SCHEMA,
  buildAskSystem,
  buildComposeSystem,
} from "@/lib/chat/prompt";
import { crossAppLookup } from "@/lib/chat/lookup";

export const runtime = "nodejs";
export const maxDuration = 120;

// The shared chat's brain. Two actions:
//   ask     — a turn in the conversation. Sees what the page can see, answers,
//             and proposes buttons for anything it offered to do. Look-ups run
//             server-side inside this call, because a read is safe and waiting
//             for a button to find out what Omni already knows about a person
//             would make the answer useless.
//   compose — the handoff agent. Given a brief and the material it came from,
//             works out what to create in the TARGET app and with what. The
//             client then runs that action, so a cross-app create goes through
//             exactly the same handler as one typed in that app.

function firstText(res: { content: { type: string; text?: string }[] }): string {
  return (res.content.find((b) => b.type === "text")?.text || "").trim();
}

/**
 * Parameters arrive as a JSON string inside JSON, which is one nesting more
 * than the model reliably closes: a long answer occasionally comes back with a
 * tail of stray braces after the object. Rather than drop the whole action and
 * do nothing, the first balanced object is taken and the tail discarded.
 */
function safeParams(raw: unknown): Record<string, unknown> {
  const text = String(raw ?? "").trim();
  if (!text) return {};
  const attempt = (s: string): Record<string, unknown> | null => {
    try {
      const parsed = JSON.parse(s);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  };
  const whole = attempt(text);
  if (whole) return whole;

  // Walk to the brace that closes the object the string opens with, ignoring
  // braces inside string literals so a value like "{ok}" can't end it early.
  const start = text.indexOf("{");
  if (start < 0) return {};
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (c === "\\") {
      escaped = true;
      continue;
    }
    if (c === '"') inString = !inString;
    else if (!inString && c === "{") depth++;
    else if (!inString && c === "}" && --depth === 0)
      return attempt(text.slice(start, i + 1)) || {};
  }
  return {};
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const action = String(body?.action || "");

  try {
    if (action === "ask") {
      const turns: { role: string; content: string }[] = Array.isArray(body?.turns)
        ? body.turns.slice(-14)
        : [];
      if (!turns.length)
        return NextResponse.json({ error: "Nothing to answer" }, { status: 400 });

      const app = String(body?.app || "home");
      const context = String(body?.context || "").slice(0, 30000);
      const subject = body?.subject
        ? {
            kind: String(body.subject.kind || ""),
            label: String(body.subject.label || ""),
          }
        : undefined;
      const canEdit = !!body?.canEdit;
      const editLabel = String(body?.editLabel || "");
      const messages = turns.map((t) => ({
        role: t.role === "assistant" ? ("assistant" as const) : ("user" as const),
        content: String(t.content || "").slice(0, 8000),
      }));

      // Up to two rounds: the first answer may ask to look something up, and
      // the second gets to use what came back. Capped because a look-up that
      // finds nothing must not turn into a loop of increasingly hopeful
      // queries while the person watches a spinner.
      const lookups: { query: string; findings: string }[] = [];
      for (let round = 0; round < 2; round++) {
        const res = await anthropic().messages.create({
          model: WRITER_MODEL,
          max_tokens: 4000,
          output_config: { format: { type: "json_schema", schema: ASK_SCHEMA } },
          system: buildAskSystem({ app, context, subject, canEdit, editLabel, lookups }),
          messages,
        });
        if (res.stop_reason === "refusal")
          return NextResponse.json(
            { error: "The model declined that one — try rephrasing." },
            { status: 502 },
          );

        const parsed = JSON.parse(firstText(res) || "{}");
        const raw: { id?: unknown; label?: unknown; paramsJson?: unknown }[] = Array.isArray(
          parsed.actions,
        )
          ? parsed.actions
          : [];

        // Anything this app was never offered is dropped rather than passed to
        // the client to fail on: the model asking for a verb it doesn't have is
        // a prompt problem, not something to make the person's problem.
        const allowed = new Set(actionsFor(app, subject?.kind).map((d) => d.id));
        const vetted = raw
          .map((a) => ({
            id: String(a?.id || ""),
            label: stripEmDashes(String(a?.label || "")),
            params: safeParams(a?.paramsJson),
          }))
          .filter((a) => allowed.has(a.id) && getAction(a.id));

        // A look-up is a read, so it runs here and the answer is written with
        // the findings in hand instead of behind a button nobody would press.
        const asked = vetted.filter((a) => getAction(a.id)?.auto);
        if (asked.length && round === 0) {
          for (const a of asked.slice(0, 3)) {
            const query = String(a.params.query || "").slice(0, 200);
            if (!query) continue;
            lookups.push({ query, findings: await crossAppLookup(supabase, query) });
          }
          if (lookups.length) continue;
        }

        return NextResponse.json({
          reply: stripEmDashes(String(parsed.reply || "")),
          actions: vetted.filter((a) => !getAction(a.id)?.auto).slice(0, 3),
          lookups,
        });
      }
      return NextResponse.json({ reply: "", actions: [], lookups });
    }

    if (action === "compose") {
      const target = String(body?.app || "");
      const brief = String(body?.brief || "").slice(0, 8000);
      const title = String(body?.title || "").slice(0, 200);
      const sourceApp = String(body?.sourceApp || "");
      const sourceContext = String(body?.sourceContext || "").slice(0, 30000);
      if (!target || !brief.trim())
        return NextResponse.json({ error: "Nothing to hand over" }, { status: 400 });

      const res = await anthropic().messages.create({
        model: WRITER_MODEL,
        max_tokens: 4000,
        output_config: { format: { type: "json_schema", schema: COMPOSE_SCHEMA } },
        system: buildComposeSystem({ app: target, title, brief, sourceApp, sourceContext }),
        messages: [
          { role: "user", content: "Create it, and tell me what you made." },
        ],
      });
      if (res.stop_reason === "refusal")
        return NextResponse.json(
          { error: "The model declined that one — try rephrasing." },
          { status: 502 },
        );

      const parsed = JSON.parse(firstText(res) || "{}");
      const id = String(parsed.id || "");
      const allowed = new Set(actionsFor(target).map((d) => d.id));
      if (!id || !allowed.has(id))
        return NextResponse.json(
          {
            error:
              stripEmDashes(String(parsed.summary || "")) ||
              "There is nothing in that app I can start for you from here.",
          },
          { status: 422 },
        );
      return NextResponse.json({
        id,
        params: safeParams(parsed.paramsJson),
        summary: stripEmDashes(String(parsed.summary || "")),
      });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: readableError(err) }, { status: 500 });
  }
}

/** The same plain-sentence errors the writer route hands back. */
function readableError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  const status = Number(raw.match(/^(\d{3})/)?.[1] ?? 0);
  if (/content filtering|blocked by/i.test(raw))
    return "That one was declined by the safety filter. Try rephrasing it.";
  if (status === 429 || /rate_limit_error/.test(raw))
    return "Too many requests at once — give it a moment and try again.";
  if (status === 529 || status >= 500 || /overloaded_error/.test(raw))
    return "The model is busy right now. Try that again in a moment.";
  if (status === 413 || /request_too_large|too many tokens|context window/i.test(raw))
    return "There's too much here to process in one go.";
  return "That didn't go through. Try again.";
}
