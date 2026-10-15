// Geometry of the two gutters beside the reading column (docs/desktop-modules.md §19.2; RFC §7.2).
// Pure: the conversation card's width, the reading width and the right side's frame → where the
// column sits and how wide each gutter is, where its triggers go and which bands the capsule takes.
// Mirrors the `.side-col` CSS (styles.css): margin-left = max(0, min((C + shift − R) / 2, C − R)),
// so 并排 / 让位 / 悬浮 need no mode input — 让位 is the shift, 悬浮 / the drawer the covered part.

/** The reading column's own horizontal padding (px-6): blank too, triggers and popovers may use it. */
export const COLUMN_PADDING = 24;
/** A trigger needs G + COLUMN_PADDING ≥ this; below it the triggers move into the composer's toolbar. */
export const TRIGGER_MIN = 44;
/** The reference card opens in the left gutter when G ≥ this (★ 320, §13 D49). */
export const PEEK_MIN = 320;
export const PEEK_MAX = 560;
/** A gutter popover (list) is clamp(G + 24 − 16, 240, 360) wide. */
export const POPOVER_MIN = 240;
export const POPOVER_MAX = 360;
/** The 总在左侧 overlay card: min(420, card − 48). */
export const OVERLAY_PEEK_MAX = 420;
/** A collapsed capsule at a window-edge corner (≈ 40 px + 8). */
export const CAPSULE_BAND = 48;
/** Margin attachments (turnAttachment `margin`) are at most this wide. */
export const MARGIN_MAX = 320;

export interface GutterInput {
  /** The conversation card's content width (the scroller's client width), px. */
  cardWidth: number;
  /** --side-shift (让位): the right side's in-flow width beyond its closed width. 0 otherwise. */
  shift: number;
  /** 悬浮 / narrow drawer: px of the card's right part covered by the side (0 otherwise). */
  sideCover: number;
  /** appearance.readingWidth; 0 = full width (no gutters). */
  readingWidth: number;
  columnPadding: number;
  /** A capsule (or other overlay) at a window-edge corner: OverlayLayout.side + anchor. */
  capsule: { side: "left" | "right"; anchor: "top" | "bottom" } | null;
  /** false while the right side is maximised / full screen (the conversation is covered). */
  conversationVisible: boolean;
}

export interface GutterSide {
  /** Usable px between the card edge and the column (0 when there is none or it is covered). */
  width: number;
  /** Triggers sit in the gutter when width + padding ≥ TRIGGER_MIN, else in the composer's toolbar. */
  trigger: "gutter" | "composer";
  /** A capsule at this side's top corner: gutter content starts below it. */
  topInset: number;
  /** A capsule at this side's bottom corner: stacked triggers and docked lists stay above it. */
  bottomBand: number;
}

export interface GutterGeometry {
  /** The column's left edge in the card (→ the .side-col margin), px. */
  columnLeft: number;
  columnWidth: number;
  left: GutterSide;
  right: GutterSide;
}

export function gutterLayout(i: GutterInput): GutterGeometry {
  const card = Math.max(0, i.cardWidth);
  const full = !(i.readingWidth > 0);
  const columnWidth = full ? card : Math.min(i.readingWidth, card);
  const columnLeft = full ? 0 : Math.max(0, Math.min((card + Math.max(0, i.shift) - i.readingWidth) / 2, card - i.readingWidth));
  const shown = i.conversationVisible && !full && card > 0;
  const leftWidth = shown ? Math.floor(columnLeft) : 0;
  const rightWidth = shown ? Math.max(0, Math.floor(card - columnLeft - columnWidth - Math.max(0, i.sideCover))) : 0;
  const side = (which: "left" | "right", width: number): GutterSide => ({
    width,
    trigger: width + i.columnPadding >= TRIGGER_MIN ? "gutter" : "composer",
    topInset: i.capsule && i.capsule.side === which && i.capsule.anchor === "top" ? CAPSULE_BAND : 0,
    bottomBand: i.capsule && i.capsule.side === which && i.capsule.anchor === "bottom" ? CAPSULE_BAND : 0,
  });
  return { columnLeft: Math.round(columnLeft), columnWidth: Math.round(columnWidth), left: side("left", leftWidth), right: side("right", rightWidth) };
}

/** The reference card in the gutter: both sides keep 8 px, at most 560. */
export function peekWidth(gutter: number, padding = COLUMN_PADDING): number {
  return Math.max(0, Math.min(gutter + padding - 16, PEEK_MAX));
}

/** A gutter item's popover list: may cover part of the column when the gutter is narrow. */
export function popoverWidth(gutter: number, padding = COLUMN_PADDING): number {
  return Math.max(POPOVER_MIN, Math.min(gutter + padding - 16, POPOVER_MAX));
}

/** Top entries never migrate into the composer, including full-width / narrow conversations. */
export function gutterTriggerLocation(anchor: "top" | "composer" | undefined, side: GutterSide): "top" | "gutter" | "composer" {
  return anchor === "top" ? "top" : side.trigger;
}

/** Viewport-bounded, non-modal list position. Top entries open down; legacy entries open up. */
export function gutterPopoverPosition(i: {
  side: "left" | "right";
  direction: "up" | "down";
  edge: number;
  minTop: number;
  width: number;
  anchorTop: number;
  anchorBottom: number;
  viewportWidth: number;
  viewportHeight: number;
}): { width: number; maxHeight: number; left?: number; right?: number; top?: number; bottom?: number } {
  const width = Math.max(0, Math.min(i.width, i.viewportWidth - 16));
  const edge = Math.max(8, Math.min(i.edge, i.viewportWidth - width - 8));
  const horizontal = i.side === "left" ? { left: edge } : { right: edge };
  const minTop = Math.min(Math.max(8, i.minTop), Math.max(8, i.viewportHeight - 8));
  if (i.direction === "down") {
    const top = Math.min(Math.max(minTop, i.anchorBottom + 6), Math.max(8, i.viewportHeight - 8));
    return { width, ...horizontal, top, maxHeight: Math.max(0, Math.min(470, i.viewportHeight - top - 8)) };
  }
  const end = Math.max(minTop, Math.min(i.anchorTop - 6, i.viewportHeight - 8));
  return { width, ...horizontal, bottom: i.viewportHeight - end, maxHeight: Math.max(0, Math.min(470, end - minTop)) };
}

/** 总在左侧 with a narrow gutter: the card floats over the column from the card's left edge. */
export function overlayPeekWidth(cardWidth: number): number {
  return Math.max(0, Math.min(OVERLAY_PEEK_MAX, cardWidth - 48));
}

/** A margin attachment's width in a gutter of `gutter` px. */
export function marginWidth(gutter: number, padding = COLUMN_PADDING): number {
  return Math.max(0, Math.min(gutter + padding - 16, MARGIN_MAX));
}

// Keeping clear of what floats over the conversation (§19.2): the overlays' drawn boxes (the status
// capsule collapsed or expanded, whatever its items) are measured by the gutter host; gutter content
// that would intersect one moves below it (or, for the reference card, beside it when that leaves more
// room). Boxes are px in the conversation card; a box only counts where it actually overlaps.

/** A drawn rectangle in the conversation card (px). */
export interface CardRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Space kept between gutter content and an overlay box. */
export const OVERLAY_GAP = 8;
/** The reference card may narrow beside an overlay down to this width (else it moves below). */
export const PEEK_BESIDE_MIN = 240;

const intersects = (o: CardRect, x0: number, x1: number, y0: number, y1: number) => o.left < x1 && o.right > x0 && o.top < y1 && o.bottom > y0;

/**
 * The top of a box of `height` spanning x0..x1, at `top` or below every overlay box it would intersect
 * (moving below one can run into the next; each is passed at most once).
 */
export function placeBelow(x0: number, x1: number, top: number, height: number, obstacles: readonly CardRect[], gap = OVERLAY_GAP): number {
  let y = top;
  for (let n = 0; n <= obstacles.length; n++) {
    const hit = obstacles.filter((o) => intersects(o, x0, x1, y, y + Math.max(1, height)));
    if (!hit.length) return y;
    y = Math.max(...hit.map((o) => o.bottom)) + gap;
  }
  return y;
}

/**
 * The free part of the vertical span top..bottom over x0..x1: an intersecting overlay box nearer the
 * span's top pushes the top below it, one nearer the bottom pulls the bottom above it. May come out
 * empty (bottom ≤ top).
 */
export function freeSpan(x0: number, x1: number, top: number, bottom: number, obstacles: readonly CardRect[], gap = OVERLAY_GAP): { top: number; bottom: number } {
  let t = top;
  let b = bottom;
  for (let n = 0; n <= obstacles.length && b > t; n++) {
    const hit = obstacles.filter((o) => intersects(o, x0, x1, t, b));
    if (!hit.length) break;
    for (const o of hit) {
      if (o.top - t <= b - o.bottom) t = Math.max(t, o.bottom + gap);
      else b = Math.min(b, o.top - gap);
    }
  }
  return { top: t, bottom: b };
}

/**
 * The reference card (left-aligned at x0, `width` wide, wanting top..bottom) next to overlay boxes:
 * either below / above them at full width, or narrowed to end before them (only while that keeps
 * `minWidth`), whichever leaves the larger area. Unchanged when nothing intersects.
 */
export function peekPlacement(i: { x0: number; width: number; top: number; bottom: number; obstacles: readonly CardRect[]; minWidth?: number; gap?: number }): { top: number; bottom: number; width: number } {
  const gap = i.gap ?? OVERLAY_GAP;
  const minWidth = i.minWidth ?? PEEK_BESIDE_MIN;
  const hit = i.obstacles.filter((o) => intersects(o, i.x0, i.x0 + i.width, i.top, i.bottom));
  if (!hit.length) return { top: i.top, bottom: i.bottom, width: i.width };
  const below = freeSpan(i.x0, i.x0 + i.width, i.top, i.bottom, i.obstacles, gap);
  const best = { ...below, width: i.width };
  const narrowed = Math.min(...hit.map((o) => o.left - gap - i.x0));
  if (narrowed >= minWidth && narrowed < i.width) {
    const beside = freeSpan(i.x0, i.x0 + narrowed, i.top, i.bottom, i.obstacles, gap);
    const area = (s: { top: number; bottom: number }, w: number) => Math.max(0, s.bottom - s.top) * w;
    if (area(beside, narrowed) > area(below, i.width)) return { ...beside, width: narrowed };
  }
  return best;
}
