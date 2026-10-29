// The Shelf card's corners (design 009, owner 2026-10-21: try 「Rail 直角」 — the rail alone with square
// corners, the expanded Shelf a rounded card — and compare). A dev flag, not a setting yet: `<html
// data-shelf-corners>` (components/side/shelfCard.css). `round` (default) = the rail alone is a rounded card too.
// Pick: `?shelfcorners=square|round` (preview) or `localStorage["cutex-desktop.shelfCorners"]` (also the app:
// devtools → `localStorage.setItem("cutex-desktop.shelfCorners", "square")`, reload).

export type ShelfCorners = "round" | "square";

export const SHELF_CORNERS_KEY = "cutex-desktop.shelfCorners";
export const DEFAULT_SHELF_CORNERS: ShelfCorners = "round";

export function parseShelfCorners(v: string | null | undefined): ShelfCorners | null {
  return v === "square" || v === "round" ? v : null;
}

/** The flag in effect: the URL's, else the stored one, else the default. */
export function readShelfCorners(search: string, stored: string | null): ShelfCorners {
  return parseShelfCorners(new URLSearchParams(search).get("shelfcorners")) ?? parseShelfCorners(stored) ?? DEFAULT_SHELF_CORNERS;
}

export function applyShelfCorners(root: HTMLElement = document.documentElement): ShelfCorners {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(SHELF_CORNERS_KEY);
  } catch {
    // no storage
  }
  const corners = readShelfCorners(typeof location === "undefined" ? "" : location.search, stored);
  root.dataset.shelfCorners = corners;
  return corners;
}

if (typeof document !== "undefined") applyShelfCorners();
