// Parse an indented bullet outline (2 spaces per level, "- " markers) into a
// flat list of { content, depth } in document order. The depth is derived from
// leading whitespace so it survives models that indent inconsistently.

export interface FlatBullet {
  content: string;
  depth: number;
}

export function parseOutline(text: string): FlatBullet[] {
  const out: FlatBullet[] = [];
  // Map raw indent width -> normalized depth, so 0/2/4 or 0/4/8 both work.
  const indentStops: number[] = [];

  for (const rawLine of text.split(/\r?\n/)) {
    if (!rawLine.trim()) continue;

    const match = rawLine.match(/^(\s*)(?:[-*•]\s+|\d+[.)]\s+)?(.*)$/);
    if (!match) continue;

    const indent = match[1].replace(/\t/g, "  ").length;
    const content = match[2].trim();
    if (!content) continue;

    // Find or insert this indent level into the stack of known stops.
    let level = indentStops.findIndex((stop) => stop === indent);
    if (level === -1) {
      // Drop any deeper stops, then this becomes the next level.
      while (
        indentStops.length > 0 &&
        indentStops[indentStops.length - 1] > indent
      ) {
        indentStops.pop();
      }
      if (
        indentStops.length === 0 ||
        indentStops[indentStops.length - 1] < indent
      ) {
        indentStops.push(indent);
      }
      level = indentStops.findIndex((stop) => stop === indent);
    }

    out.push({ content, depth: level });
  }

  return out;
}

export interface SummaryNodeRow {
  id: string;
  parent_id: string | null;
  content: string;
  depth: number;
  sort_order: number;
}

export interface SummaryTreeNode {
  id: string;
  content: string;
  children: SummaryTreeNode[];
}

// Rebuild a nested tree from adjacency-list rows (ordered by sort_order).
export function buildTree(rows: SummaryNodeRow[]): SummaryTreeNode[] {
  const byId = new Map<string, SummaryTreeNode>();
  const roots: SummaryTreeNode[] = [];

  const sorted = [...rows].sort((a, b) => a.sort_order - b.sort_order);
  for (const r of sorted) {
    byId.set(r.id, { id: r.id, content: r.content, children: [] });
  }
  for (const r of sorted) {
    const node = byId.get(r.id)!;
    if (r.parent_id && byId.has(r.parent_id)) {
      byId.get(r.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}
