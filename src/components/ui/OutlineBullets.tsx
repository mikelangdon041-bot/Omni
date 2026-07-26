// Renders the AI's indented "- " outline as a real nested bullet tree.
//
// Interview Prep stores its outline as `summary_nodes` rows and renders them
// with <SummaryTree>; Meeting Prep keeps the outline as plain text on the
// meeting row. Same shape, so this parses the text into the same tree and
// hands it to the same renderer rather than dumping it in a <pre>.

import { parseOutline, type SummaryNodeRow } from "@/lib/summaryTree";
import { SummaryTree } from "@/components/SummaryTree";

export function OutlineBullets({ text }: { text: string }) {
  const flat = parseOutline(text || "");
  if (flat.length === 0) return null;

  // parseOutline gives {content, depth} in document order; SummaryTree wants
  // adjacency-list rows, so link each bullet to the nearest ancestor one
  // level shallower (same walk the summarize route does server-side).
  const parentByDepth: string[] = [];
  const rows: SummaryNodeRow[] = flat.map((b, i) => {
    const id = `n${i}`;
    const parent_id = b.depth > 0 ? parentByDepth[b.depth - 1] || null : null;
    parentByDepth[b.depth] = id;
    parentByDepth.length = b.depth + 1;
    return { id, parent_id, content: b.content, depth: b.depth, sort_order: i };
  });

  return <SummaryTree nodes={rows} />;
}

// Convenience for exports/copy: the outline as indented plain text lines.
export function outlineToText(text: string): string {
  return parseOutline(text || "")
    .map((b) => `${"  ".repeat(b.depth)}- ${b.content}`)
    .join("\n");
}
