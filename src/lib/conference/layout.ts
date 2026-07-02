// Calendar overlap layout (spec §7.2).
//
// Events on the same day that overlap in time are laid out side-by-side in
// columns: group mutually-overlapping events into clusters, then greedily
// pack each event into the leftmost column whose previous event has ended.
// Every block is one column wide (uniform width within its cluster).

export interface TimedItem {
  start: number; // minutes since midnight
  end: number;
  typeRank: number; // column order for simultaneous starts (lower = leftmost)
}

export interface LaidOut<T extends TimedItem> {
  item: T;
  col: number;
  cols: number; // column count of the item's cluster
}

export function layoutOverlaps<T extends TimedItem>(items: T[]): LaidOut<T>[] {
  // Order: start asc → configured type order → longer duration first.
  const sorted = [...items].sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    if (a.typeRank !== b.typeRank) return a.typeRank - b.typeRank;
    return b.end - b.start - (a.end - a.start);
  });

  const out: LaidOut<T>[] = [];
  let cluster: { item: T; col: number }[] = [];
  let clusterEnd = -1;
  let colEnds: number[] = []; // per-column latest end within the cluster

  const flush = () => {
    if (cluster.length === 0) return;
    const cols = colEnds.length || 1;
    for (const c of cluster) out.push({ item: c.item, col: c.col, cols });
    cluster = [];
    colEnds = [];
  };

  for (const item of sorted) {
    if (cluster.length > 0 && item.start >= clusterEnd) {
      flush();
      clusterEnd = -1;
    }
    // Leftmost column whose last event has already ended.
    let col = colEnds.findIndex((end) => end <= item.start);
    if (col === -1) {
      col = colEnds.length;
      colEnds.push(item.end);
    } else {
      colEnds[col] = item.end;
    }
    cluster.push({ item, col });
    clusterEnd = Math.max(clusterEnd, item.end);
  }
  flush();
  return out;
}
