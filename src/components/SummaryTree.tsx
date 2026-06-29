import { buildTree, type SummaryNodeRow, type SummaryTreeNode } from "@/lib/summaryTree";

export function SummaryTree({ nodes }: { nodes: SummaryNodeRow[] }) {
  const tree = buildTree(nodes);
  if (tree.length === 0) return null;
  return <TreeList nodes={tree} depth={0} />;
}

function TreeList({ nodes, depth }: { nodes: SummaryTreeNode[]; depth: number }) {
  return (
    <ul className={depth === 0 ? "space-y-2" : "mt-1.5 space-y-1.5"}>
      {nodes.map((node) => (
        <li key={node.id}>
          <div className="flex gap-2">
            <span
              className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${
                depth === 0 ? "bg-primary" : "bg-accent"
              }`}
            />
            <div className="flex-1">
              <span
                className={
                  depth === 0
                    ? "font-medium text-ink"
                    : "text-sm text-ink/90"
                }
              >
                {node.content}
              </span>
              {node.children.length > 0 && (
                <div className="ml-1 border-l border-border pl-3">
                  <TreeList nodes={node.children} depth={depth + 1} />
                </div>
              )}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
