import Anthropic from "@anthropic-ai/sdk";

let _client: Anthropic | null = null;

export function anthropic() {
  if (!_client) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("ANTHROPIC_API_KEY is not set");
    _client = new Anthropic({ apiKey: key });
  }
  return _client;
}

export const WRITER_MODEL = process.env.ANTHROPIC_WRITER_MODEL || "claude-opus-4-8";

// NOTE for anyone adding a call here: this model family removed the sampling
// parameters. Passing `temperature`, `top_p`, or `top_k` is a hard 400
// ("`temperature` is deprecated for this model"), not a warning — every
// Meeting Prep AI action silently failed this way until 2026-07-26. Steer
// output with the prompt, or with `output_config: { effort }`, instead.

// Searching the web and condensing what comes back, for Meeting Prep's
// research pass. Not the writer model: the same search ran 371s on it (and
// 298s at low effort), past the 300s route ceiling, because the wait is the
// searching itself. This step judges and condenses rather than reasons, and
// the writer model still writes every word of the brief from its notes.
export const RESEARCH_MODEL = process.env.ANTHROPIC_RESEARCH_MODEL || "claude-sonnet-5";

// Cheap, fast model for the small transformations that don't need the writer
// model: condensing a bullet, a title, a quick list. Rewrites of text we
// already have, not fresh reasoning. The recap email moved to the writer
// model: it goes out under the person's name, and the quick model's version
// read like a form letter however the prompt asked.
export const QUICK_MODEL = process.env.ANTHROPIC_QUICK_MODEL || "claude-haiku-4-5";

// Judging rather than writing, where the quick model is too lenient: whether
// the meeting notes actually cover each follow-up.
export const CHECK_MODEL = process.env.ANTHROPIC_CHECK_MODEL || "claude-sonnet-5";
