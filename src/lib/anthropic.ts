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
