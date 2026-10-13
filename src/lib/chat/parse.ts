// Reading the model's answer back without ever throwing at the person.
//
// Lives here rather than inside the route so a check can run the real thing
// against the real shapes, the way the brief's prompt does.
//
// What this exists for: the chat asked for numbers across a question bank,
// the answer ran past the token cap, and the half-written JSON object went
// into `JSON.parse`. What reached the screen was "Unterminated string in JSON
// at position 834 (line 1 column 835)" — a character offset nobody can act
// on, reading as the app breaking rather than an answer running long.

/**
 * Parse the model's JSON answer, salvaging the reply when the object is
 * malformed.
 *
 * The reply is the part worth keeping. Where the object will not parse, the
 * text of "reply" is lifted out directly and the actions are dropped: half an
 * answer and no buttons beats an error and nothing. Callers should still
 * check `stop_reason` first — a truncated answer is better reported as having
 * run long than quietly served in half.
 */
export function parseReply(text: string): {
  reply?: unknown;
  actions?: unknown;
  [key: string]: unknown;
} {
  try {
    return JSON.parse(text || "{}");
  } catch {
    // The value of "reply", from a string that may simply stop partway
    // through. The alternation keeps escaped quotes from ending the match
    // early, so a reply containing \" survives.
    const m = text.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)/);
    if (!m) return {};
    try {
      // A trailing lone backslash is the half of an escape that never
      // arrived, and would make the re-quoted string invalid in its turn.
      return { reply: JSON.parse(`"${m[1].replace(/\\+$/, "")}"`) };
    } catch {
      return {};
    }
  }
}
