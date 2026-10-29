// A pane's tab row like a good browser's (owner 2026-10-23: long page titles were unreadable — tabs cut early,
// the last one clipped mid-word with no ×, the toolbar taking their room): the tabs share the row evenly between a
// minimum and a maximum width, the active one a bit more; what does not fit at the minimum goes into a 「⌄ N」 list
// at the end (the active tab always stays in the row); ＋ always shows. When even that leaves the tabs less than
// their minimum, the pane's own buttons go compact first (a module's secondary buttons into its ⋯).
// Pure; tested (test/tabFit.test.ts). components/side/SideCard draws it.

/** A tab's minimum / maximum width (px): the minimum still shows its icon and a few characters. */
export const TAB_MIN = 72;
export const TAB_ACTIVE_MIN = 120;
export const TAB_MAX = 200;
/** The active tab's full width: it shrinks from a larger base, so it keeps more of its title (equal bases shrink evenly). */
export const TAB_ACTIVE_MAX = 240;
export const TAB_GAP = 2;
/** The 「⌄ N」 button and the ＋ (px, gaps included). */
export const TAB_MORE_W = 44;
export const TAB_PLUS_W = 26;

export interface TabFitInput {
  count: number;
  /** The active tab's index (−1: none). */
  active: number;
  /** The width the tabs, 「⌄ N」 and ＋ share. */
  width: number;
  /** Whether a ＋ follows the tabs. */
  plus: boolean;
}

export interface TabFit {
  /** The indices shown in the row, in order (the active one always among them). */
  shown: number[];
  /** The indices in the 「⌄ N」 list, in order. */
  hidden: number[];
}

/** The width `n` tabs need at their minimum (the active one among them at its own). */
export function tabsNeed(n: number, withActive: boolean): number {
  if (n <= 0) return 0;
  return n * TAB_MIN + (withActive ? TAB_ACTIVE_MIN - TAB_MIN : 0) + (n - 1) * TAB_GAP;
}

/** Which tabs show and which go into the 「⌄ N」 list. Unmeasured (width 0): all of them show. */
export function fitTabs(i: TabFitInput): TabFit {
  const all = Array.from({ length: i.count }, (_, k) => k);
  if (i.width <= 0 || !i.count) return { shown: all, hidden: [] };
  const hasActive = i.active >= 0 && i.active < i.count;
  const room = (n: number) => i.width - (i.plus ? TAB_PLUS_W : 0) - (n < i.count ? TAB_MORE_W : 0);
  let n = i.count;
  while (n > 1 && tabsNeed(n, hasActive) > room(n)) n--;
  if (n >= i.count) return { shown: all, hidden: [] };
  // The first n − 1 in order, then the active one if it is further on (else the first n).
  let shown = all.slice(0, n);
  if (hasActive && i.active >= n) shown = [...all.slice(0, n - 1), i.active];
  const set = new Set(shown);
  return { shown, hidden: all.filter((k) => !set.has(k)) };
}

/**
 * Whether the pane's buttons should go compact: with them at full width, the tab row would not hold the active tab
 * plus one more at their minimum (or the only tab at the active minimum). `full`: the buttons' width at full size.
 */
export function headerCompact(i: { header: number; fixed: number; full: number; count: number; plus: boolean }): boolean {
  if (i.header <= 0 || i.count <= 0) return false;
  const want = tabsNeed(Math.min(i.count, 2), true) + (i.plus ? TAB_PLUS_W : 0) + (i.count > 2 ? TAB_MORE_W : 0);
  return i.header - i.fixed - i.full < want;
}
