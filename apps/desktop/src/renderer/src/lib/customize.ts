// 在主界面调整 (docs/research/rfc-in-place-settings-20261018.md, lead decisions 2026-10-18): a small
// non-modal panel beside a region of the main window with that region's local settings, so a change is
// seen where it happens. One panel at a time, not draggable, placed against its region. No drawer
// (owner 2026-10-18, over the lead's narrow-window drawer): beside the sidebar the panel only covers the
// conversation, never the region it adjusts, so it stays there at any width and narrows instead. The
// right side's panel sits left of it, the composer's above it.

/** The regions that have a panel (phase 1: the left sidebar; the rest join with their settings pages). */
export type CustomizeRegion = "sidebar" | "sides" | "composer" | "conversation";

/** The panel's default width (px; a region may ask for more, CustomizeRegionItem.width). */
export const CUSTOMIZE_PANEL_W = 360;
/** Gap between the panel and what it sits against (px). */
export const CUSTOMIZE_GAP = 8;
/** The narrowest the panel gets in a narrow window (px; it may then cover the whole conversation). */
export const CUSTOMIZE_PANEL_MIN_W = 240;
/** Shorter than this above the composer, the panel goes down to the row's bottom instead (px). */
export const CUSTOMIZE_PANEL_MIN_H = 320;

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Where the panel goes, relative to the main row (the element the host is positioned in): from the top, or from the bottom (above the composer). */
export interface CustomizePlacement {
  left: number;
  top?: number;
  bottom?: number;
  width: number;
  maxHeight: number;
}

/** Which side of its region the panel sits on: right of the sidebar, left of the right side, above the composer. */
export type CustomizeSide = "right" | "left" | "above";

/**
 * `row`: the main row (sidebar + conversation + right side). `region`: the adjusted region (null while
 * hidden). `stage`: the conversation's timeline frame (null when another page is open). `composer`: the
 * composer block (null while hidden, e.g. an approval replaces it: then the timeline frame's end, so
 * that card is not covered either).
 * - "right" / "left": beside the region at the top, over the conversation, down to the composer's top;
 *   where that leaves less than CUSTOMIZE_PANEL_MIN_H, down to the row's bottom. Never over the region:
 *   without room for `width` it takes what there is, at least CUSTOMIZE_PANEL_MIN_W.
 * - "above": on the input card's left edge (the region), its bottom just above the composer block (status
 *   row included), up to the row's top; as
 *   wide as `width` or the composer. Without a composer: at the top of the conversation.
 */
export function placeCustomizePanel({ side = "right", row, region, stage, composer = null, width: wanted = CUSTOMIZE_PANEL_W }: { side?: CustomizeSide; row: Rect; region: Rect | null; stage: Rect | null; composer?: Rect | null; width?: number }): CustomizePlacement {
  const g = CUSTOMIZE_GAP;
  const height = row.bottom - row.top;
  const fit = (room: number) => Math.max(CUSTOMIZE_PANEL_MIN_W, Math.min(wanted, room));
  const above = (composer ? composer.top : stage ? stage.bottom : row.bottom) - row.top - 2 * g;
  const tall = Math.max(0, above >= CUSTOMIZE_PANEL_MIN_H ? above : height - 2 * g);
  // The conversation's edges in row coordinates.
  const convLeft = (stage ? stage.left : row.left) - row.left + g;
  const convRight = (stage ? stage.right : row.right) - row.left - g;
  if (side === "above" && region) {
    // Lined up with the input card, but above the whole composer block: the status row over the card is
    // part of what this panel adjusts.
    const top = Math.min(region.top, composer ? composer.top : region.top);
    return { left: region.left - row.left, bottom: row.bottom - top + g, width: fit(region.right - region.left), maxHeight: Math.max(0, top - row.top - 2 * g) };
  }
  if (side === "left") {
    const right = region ? region.left - row.left - g : convRight;
    const width = fit(right - convLeft);
    return { left: right - width, top: g, width, maxHeight: tall };
  }
  if (side === "above") return { left: Math.max(g, convLeft), top: g, width: fit(convRight - convLeft), maxHeight: Math.max(0, height - 2 * g) };
  // "right": the conversation's left edge, right of the sidebar when it is shown.
  const left = Math.max(g, (region ? region.right - row.left : 0) + g);
  return { left, top: g, width: fit(convRight - left), maxHeight: tall };
}

// ---- the entry that opened the panel (focus returns there on close) ----

let opener: HTMLElement | null = null;

/** Remembers the element that is opening the panel: a right-clicked row, the settings button. */
export function noteCustomizeOpener(el: Element | null): void {
  opener = el && "focus" in el ? (el as HTMLElement) : null;
}

/** The remembered entry once (cleared): when it is still in the document, else null. */
export function takeCustomizeOpener(): HTMLElement | null {
  const el = opener;
  opener = null;
  return el?.isConnected ? el : null;
}
