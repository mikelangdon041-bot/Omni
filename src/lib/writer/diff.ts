// Word-level diff for the "what changed" highlight: LCS over word tokens,
// capped so pathological inputs can't lock the UI. Renders the NEW text with
// insertions wrapped in <mark> spans (deletions are omitted — the reader
// cares about what the result says, with changes glowing).

const CAP = 1500; // tokens per side (~a few pages; keeps the table small)

function tokenize(text: string): string[] {
  return text.split(/(\s+)/).filter((t) => t.length > 0).slice(0, CAP);
}

export function diffHighlightHtml(oldText: string, newText: string): string {
  const a = tokenize(oldText);
  const b = tokenize(newText);
  const n = a.length;
  const m = b.length;

  // LCS table (typed array, single allocation).
  const dp = new Uint16Array((n + 1) * (m + 1));
  const idx = (i: number, j: number) => i * (m + 1) + j;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[idx(i, j)] =
        a[i] === b[j]
          ? dp[idx(i + 1, j + 1)] + 1
          : Math.max(dp[idx(i + 1, j)], dp[idx(i, j + 1)]);
    }
  }

  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  let i = 0;
  let j = 0;
  const out: string[] = [];
  let insertRun: string[] = [];
  const flush = () => {
    if (insertRun.length) {
      const chunk = insertRun.join("");
      // Whitespace-only runs aren't worth highlighting.
      if (chunk.trim()) out.push(`<mark class="wr-ins">${esc(chunk)}</mark>`);
      else out.push(esc(chunk));
      insertRun = [];
    }
  };
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      flush();
      out.push(esc(b[j]));
      i++;
      j++;
    } else if (dp[idx(i + 1, j)] >= dp[idx(i, j + 1)]) {
      i++; // deletion from old — not rendered
    } else {
      insertRun.push(b[j]);
      j++;
    }
  }
  while (j < m) insertRun.push(b[j++]);
  flush();
  return out.join("").replace(/\n/g, "<br>");
}
