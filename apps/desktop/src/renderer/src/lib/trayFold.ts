// The tray card's 「… N」 (design 038, owner 2026-10-23): the card under the conversations keeps its place, and the
// dock's trailing items that do not fit its width fold away (`data-tray-folded`, components/tray.css) behind 「… N」,
// whose popover lists them (components/ChipTray TrayOverflow). DOM-only, no feature names.
// Owner 2026-10-24: pins come first — a group marked `data-tray-yield` (the dock's 最近) gives way before anything
// folds: its trailing items go (not into 「… N」) down to none, and only then do the others fold behind 「… N」.
// 「托盘两排」 (opt-in, lib/trayPrefs twoRows): what does not fit one row lays out in two (`data-tray-rows="2"`: each
// group wraps in its own block, tray.css) before anything gives way.

/** The dock's items that fold one by one (an item with its × slot), 「… N」 itself left out. */
export function foldUnits(root: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const el of root.querySelectorAll<HTMLElement>("[data-tray-item]")) {
    if (el.closest("[data-tray-more]")) continue;
    const unit = el.closest<HTMLElement>(".tray-slot") ?? el;
    if (!out.includes(unit)) out.push(unit);
  }
  return out;
}

/** Rows the dock may use (1, or 2 with 「托盘两排」). */
export type TrayRows = 1 | 2;

export interface TrayFit {
  /** The units behind 「… N」, as indices into foldUnits (N = its length). */
  folded: number[];
  /** Items of the yielding group (最近) left out — not behind 「… N」. */
  yielded: number;
  rows: TrayRows;
}

/** Tops further apart than this are different rows (items of one row differ a little: centred, 34 vs 40 px). */
const ROW_STEP = 20;

/** How many rows the shown units of `group` take (by their tops). */
export function groupRows(group: HTMLElement): number {
  const tops = foldUnits(group)
    .filter((u) => !u.closest("[data-tray-folded]"))
    .map((u) => u.offsetTop)
    .sort((a, b) => a - b);
  let rows = 0;
  let last = -Infinity;
  for (const top of tops)
    if (top - last > ROW_STEP) {
      rows++;
      last = top;
    }
  return rows;
}

/**
 * Lays the dock out to fit its width and returns what it did. In order, until it fits: one row; labels written on the
 * items (`[data-tray-label]`, owner 2026-10-24) shortened (`data-tray-short`); with `twoRows`, two rows (full labels,
 * then short); the yielding group's trailing items left out (down to none; a group left empty loses its separator);
 * then the trailing others behind 「… N」 (`more` shown). Everything fitting: 「… N」 hidden.
 */
export function fitTray(dock: HTMLElement, more: HTMLElement | null, opts: { twoRows?: boolean } = {}): TrayFit {
  for (const el of dock.querySelectorAll("[data-tray-folded]")) el.removeAttribute("data-tray-folded");
  for (const el of dock.querySelectorAll("[data-tray-yielded]")) el.removeAttribute("data-tray-yielded");
  dock.removeAttribute("data-tray-short");
  dock.removeAttribute("data-tray-rows");
  if (more) more.hidden = true;
  let rows: TrayRows = 1;
  const groups = () => [...dock.querySelectorAll<HTMLElement>(".tray-group")];
  const fits = () => dock.scrollWidth <= dock.clientWidth + 1 && (rows === 1 || groups().every((g) => groupRows(g) <= 2));
  const done = (folded: number[] = [], yielded = 0): TrayFit => ({ folded, yielded, rows });
  const labels = !!dock.querySelector("[data-tray-label]");
  const shorten = () => {
    if (!labels) return false;
    dock.setAttribute("data-tray-short", "");
    return fits();
  };
  if (fits() || shorten()) return done();
  if (opts.twoRows) {
    rows = 2;
    dock.setAttribute("data-tray-rows", "2");
    dock.removeAttribute("data-tray-short");
    if (fits() || shorten()) return done();
  }
  const units = foldUnits(dock);
  // A group left with nothing shown loses its separator at once (its width counts for what fits next).
  const prune = (g: HTMLElement | null) => {
    if (g && ![...g.querySelectorAll<HTMLElement>("[data-tray-item]")].some((el) => !el.closest("[data-tray-folded]"))) (g.parentElement ?? g).setAttribute("data-tray-folded", "");
  };
  const fold = (u: HTMLElement) => {
    u.setAttribute("data-tray-folded", "");
    prune(u.closest<HTMLElement>(".tray-group"));
  };
  // 最近 gives way first: its trailing items go, down to none.
  let yielded = 0;
  for (let i = units.length - 1; i >= 0 && !fits(); i--) {
    if (!units[i]!.closest("[data-tray-yield]")) continue;
    fold(units[i]!);
    units[i]!.setAttribute("data-tray-yielded", "");
    yielded++;
  }
  const folded: number[] = [];
  if (!fits()) {
    if (more) more.hidden = false;
    for (let i = units.length - 1; i >= 0 && !fits(); i--) {
      if (units[i]!.hasAttribute("data-tray-folded")) continue;
      fold(units[i]!);
      folded.unshift(i);
    }
  }
  return done(folded, yielded);
}

/** fitTray on one row; returns N (0: everything fits, 「… N」 hidden). */
export function fitDock(dock: HTMLElement, more: HTMLElement | null): number {
  return fitTray(dock, more).folded.length;
}
