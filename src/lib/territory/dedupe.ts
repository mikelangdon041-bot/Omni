// Fuzzy matching used to suggest duplicate KOLs and near-identical institution
// names (e.g. "University of Arizona" vs "University of Arizona - Phoenix").

export function norm(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, " ")
    .replace(/\b(dr|md|do|rn|np|pa|phd|pharmd|prof|mr|mrs|ms)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(
        dp[j] + 1,
        dp[j - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      prev = tmp;
    }
  }
  return dp[n];
}

// 0–1 similarity of two raw strings after normalization.
export function similarity(a: string, b: string): number {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  // One clearly contains the other (campus/branch of the same place).
  if (x.includes(y) || y.includes(x)) return 0.9;
  const dist = levenshtein(x, y);
  return 1 - dist / Math.max(x.length, y.length);
}

export interface Group<T> {
  key: string;
  items: T[];
}

// Group items whose `valueOf` strings are similar above the threshold.
// Simple union-by-scan; good enough for a rep's roster (hundreds, not millions).
export function groupSimilar<T>(
  items: T[],
  valueOf: (t: T) => string,
  threshold = 0.84,
): Group<T>[] {
  const groups: { rep: string; items: T[] }[] = [];
  for (const it of items) {
    const v = valueOf(it);
    if (!norm(v)) continue;
    let placed = false;
    for (const g of groups) {
      if (similarity(v, g.rep) >= threshold) {
        g.items.push(it);
        placed = true;
        break;
      }
    }
    if (!placed) groups.push({ rep: v, items: [it] });
  }
  return groups
    .filter((g) => g.items.length > 1)
    .map((g) => ({ key: g.rep, items: g.items }));
}
