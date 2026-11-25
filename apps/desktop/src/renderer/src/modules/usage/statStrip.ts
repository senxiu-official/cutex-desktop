// 用量 header stat strip (owner 2026-11-24): the stats beside the Token figure wrap as a group, never leaving one
// alone on a row (4 → 2 × 2 → 1 column; 3 → one column), and a divider only separates stats on the same row. Pure:
// the page measures the widths (ResizeObserver; no CSS size containers in the renderer) and asks here.

/** Column counts a strip of `n` stats may use, widest first: rows stay full (no orphan). */
export function columnChoices(n: number): number[] {
  if (n <= 1) return [Math.max(n, 1)];
  const out = [n];
  for (let cols = n - 1; cols >= 1; cols--) if (n % cols === 0) out.push(cols);
  return out;
}

/** Width of the stats laid out in `cols` max-content columns (each as wide as its widest stat), `gap` apart. */
export function stripWidth(widths: readonly number[], cols: number, gap: number): number {
  let sum = 0;
  for (let c = 0; c < cols; c++) {
    let widest = 0;
    for (let i = c; i < widths.length; i += cols) widest = Math.max(widest, widths[i]!);
    sum += widest;
  }
  return sum + (cols - 1) * gap;
}

/** The widest choice whose columns fit in `width`; 1 when none does. */
export function statColumns(widths: readonly number[], width: number, gap: number): number {
  for (const cols of columnChoices(widths.length)) if (stripWidth(widths, cols, gap) <= width + 0.5) return cols;
  return 1;
}

/**
 * Whether stat `index` draws a divider on its left: inside a row, and on the first column only when the strip
 * shares its row with the Token figure (`besideHero`), which it then separates from.
 */
export function hasDivider(index: number, cols: number, besideHero: boolean): boolean {
  return index % cols !== 0 || (besideHero && index < cols);
}
