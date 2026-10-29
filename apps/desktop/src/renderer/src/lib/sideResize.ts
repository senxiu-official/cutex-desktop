// The Shelves' width handles (docs/desktop-modules.md §18.3, §24.12): the seam between a Shelf and the
// conversations, and every pane's edge on that side (a 5 px hot zone). Each Shelf has its own width
// (stored in the layout, `Shelf.width`); one that never had its handle dragged follows
// appearance.sidePaneWidth (Settings). Drag live (lib/sideLayoutStore previewShelfWidth), stored on
// release; double-click = back to the default width; arrows when focused. The width counted is the
// Shelf's box without its rail (RAIL_WIDTH comes on top, so the panes keep their width).
import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { DEFAULT_APPEARANCE, getAppearance, previewWidth, RANGES, setAppearance } from "./appearance";
import { clampPaneWidth } from "./appearanceModel";
import { findShelf, RAIL_WIDTH, type ShelfSide } from "./sideLayout";
import { previewShelfWidth, useSide } from "./sideLayoutStore";
import { commitShelfWidth } from "./shelves";
import { keyResize, resizeDrag } from "./columnGlide";
import { setShelfPush, useRowDrag } from "./rowDrag";
import { hideWidthTip, showWidthTip } from "./widthTip";

const STEP = 16;
let workWidth = Number.POSITIVE_INFINITY;
/** What the other Shelf on screen takes from the work area (px), per side. */
const taken: Record<ShelfSide, number> = { left: 0, right: 0 };

/** The work area's width (conversations + Shelves), measured by the work area. */
export function setSideWorkWidth(width: number): void {
  workWidth = width > 0 ? width : Number.POSITIVE_INFINITY;
}

/** What each side's Shelf takes on screen now (the work area reports it; 0 = none). */
export function setShelvesTaken(left: number, right: number): void {
  taken.left = left;
  taken.right = right;
}

/**
 * What the row needs besides the Shelves and one conversation's minimum (two workspaces: the second column's
 * minimum, the gap between them, the other workspace's rail). A Shelf is never dragged wider than that leaves,
 * so the row never has to fold it to its rail in the middle of a drag (lib/workspaceRow).
 */
let reserve = 0;
export function setRowReserve(px: number): void {
  reserve = Math.max(0, px);
}

/**
 * 宽度规则 (owner 2026-10-21, lib/workspaceRow): the work row (components/side/SideArea) says how far a Shelf may
 * grow (only its own column gives way, down to its minimum — the edge stops there), what a double-click on its
 * edge resets besides the Shelf (its column), and how much an edge outside the row (the sidebar's, the
 * Settings Shelf's) may take from it on each side.
 */
export interface RowHooks {
  /** A Shelf's widest (its rail not counted) now, or null: no limit of the row's own. */
  shelfMax(shelfId: string): number | null;
  /** A double-click on the Shelf's edge: the column beside it back to its default too. */
  shelfReset(shelfId: string): void;
  /** Px the row can still give to an edge outside it on `side` (its column's room above the minimum, the free desktop). */
  give(side: ShelfSide): number;
  /** By content: px of free desktop beside the group on `side` (a Shelf's outer edge grows into it, #38). */
  gap?(side: ShelfSide): number;
  /**
   * The Shelf between two workspaces' columns (工作区的 Shelf Rail 永远偏右): px its far edge may grow into the next
   * column — that column's room above its minimum, then (by content) the desktop beyond it (推挤).
   */
  beyond?(): number;
}
let rowHooks: RowHooks | null = null;
export function setRowHooks(hooks: RowHooks | null): void {
  rowHooks = hooks;
}
/** What the row can give an edge outside it on `side` (Infinity: nothing measured). */
export function rowGive(side: ShelfSide): number {
  const g = rowHooks?.give(side);
  return g === undefined || !Number.isFinite(g) ? Number.POSITIVE_INFINITY : Math.max(0, g);
}

/** @deprecated v1.17 tool columns; kept for callers: the Shelves size themselves. */
export function setSideColumns(_n: number): void {}

/** Which Shelf a handle sizes. */
export interface WidthTarget {
  shelfId: string;
  side: ShelfSide;
  /**
   * The Shelf's outer edge (checklist #38, by content: it borders the desktop gap): only the Shelf and the gap
   * change — its column keeps its width, the group does not move on the other side.
   */
  outer?: boolean;
  /** The outer edge borders the next workspace's column, not the desktop (two workspaces, 永远偏右): that column gives. */
  between?: boolean;
}

/** The Shelf edge being dragged / stepped now (the work row keeps its column and the group's far side for an outer one). */
let edgeNow: { side: ShelfSide; outer: boolean; between: boolean } | null = null;
export function shelfEdgeDrag(): { side: ShelfSide; outer: boolean; between: boolean } | null {
  return edgeNow;
}

/** A Shelf's stored width (its own, else the default from Settings). */
export function shelfWidth(shelfId: string): number {
  const shelf = findShelf(useSide.getState().layout, shelfId);
  return useSide.getState().liveWidth[shelfId] ?? shelf?.width ?? getAppearance().sidePaneWidth;
}

/** `width` = the Shelf without its rail, clamped so the conversations keep their minimum beside both Shelves. */
function set(target: WidthTarget | null, width: number, persist: boolean): number {
  if (!target) {
    const px = clampPaneWidth(width, RANGES.sidePaneWidth, workWidth);
    if (persist) setAppearance({ sidePaneWidth: px }, true);
    else previewWidth("sidePaneWidth", px);
    return px;
  }
  const other = taken[target.side === "left" ? "right" : "left"];
  const own = target.outer ? outerMax : rowHooks?.shelfMax(target.shelfId);
  // A Shelf wider than the range's top (最大化 stores its width, lib/panelGrow) has no top of its own while dragged: the
  // press never shrinks it to the range, and it still grows as far as the row lets it (its column down to its minimum,
  // 推挤) — with its start as the top, a drag toward the column did nothing.
  const range: [number, number] = [RANGES.sidePaneWidth[0], (ceiling ?? 0) > RANGES.sidePaneWidth[1] ? Number.POSITIVE_INFINITY : RANGES.sidePaneWidth[1]];
  const px = Math.min(clampPaneWidth(width, range, workWidth - other - reserve - RAIL_WIDTH), own === null || own === undefined ? Number.POSITIVE_INFINITY : Math.max(RANGES.sidePaneWidth[0], Math.round(own)));
  // 推挤 (owner 2026-10-23): dragged on past its minimum, the Shelf is pushed into the free desktop — on its own side
  // from the edge toward its column, on the far side from its outer edge (the group slides away) — as far as there is.
  if (!persist) setShelfPush(width < range[0] ? Math.min(range[0] - width, pushRoom ?? 0) : 0);
  previewShelfWidth(target.shelfId, persist ? null : px);
  if (persist) commitShelfWidth(target.shelfId, px);
  return px;
}

/**
 * Widen a Shelf to `width` once (design 011: a page opened in a narrower Shelf), as one short drag of its edge
 * toward the conversations (宽度规则 3 / 5: only the Shelf and its own column change, it stops where that column
 * reaches its minimum). Never narrows. The session stays open as an arrow-key step's does (KEY_RESIZE_MS), so the row
 * lays the new width out with the other panels held, then it is stored. Returns the width it got (null: already that wide, or no such Shelf).
 */
export function widenShelf(target: WidthTarget, width: number): number | null {
  if (!findShelf(useSide.getState().layout, target.shelfId)) return null;
  if (shelfWidth(target.shelfId) >= width) return null;
  let got: number | null = null;
  // The row sees a drag of this Shelf's edge (its column gives, the rest is held) — as a key step on the handle.
  if (!edgeNow) beginEdge(target, shelfWidth(target.shelfId));
  keyResize(
    () => void (got = set(target, width, false)),
    () => {
      set(target, width, true);
      endEdge();
    },
  );
  return got;
}

/** An outer edge's widest for the drag in progress (its width when it started + the gap on its side). */
let outerMax: number | null = null;
/** The dragged Shelf's width when the drag started (past the range's top: no top while dragged). */
let ceiling: number | null = null;
/** How far the dragged Shelf may be pushed at its minimum (推挤): the free desktop it would slide into. */
let pushRoom: number | null = null;

/** A Shelf's edge starts to move (a press, the first key step, a widen): what the row and the limits read meanwhile. */
function beginEdge(target: WidthTarget, width: number): void {
  edgeNow = { side: target.side, outer: !!target.outer, between: !!target.between };
  ceiling = width;
  const far: ShelfSide = target.side === "left" ? "right" : "left";
  outerMax = target.outer ? width + Math.max(0, (target.between ? rowHooks?.beyond?.() : rowHooks?.gap?.(target.side)) ?? 0) : null;
  pushRoom = Math.max(0, rowHooks?.gap?.(target.outer ? far : target.side) ?? 0);
}

function endEdge(): void {
  edgeNow = null;
  outerMax = null;
  ceiling = null;
  pushRoom = null;
}

export interface WidthHandle {
  onPointerDown(e: PointerEvent<HTMLElement>): void;
  onPointerMove(e: PointerEvent<HTMLElement>): void;
  onPointerUp(e: PointerEvent<HTMLElement>): void;
  onLostPointerCapture(e: PointerEvent<HTMLElement>): void;
  onDoubleClick(): void;
  onKeyDown(e: KeyboardEvent<HTMLElement>): void;
}

/**
 * Handlers for a Shelf's width handle; `current` = the Shelf box's width on screen now, rail included (the
 * drag starts from it). A right Shelf grows to the left, a left one to the right. `target` null: the
 * default width itself (appearance.sidePaneWidth).
 */
export function useSideWidthHandle(current: () => number, target: WidthTarget | null = null): WidthHandle {
  const drag = useRef<{ x: number; width: number; last: number } | null>(null);
  const base = () => {
    const box = current();
    return box > 0 ? box - (target ? RAIL_WIDTH : 0) : target ? shelfWidth(target.shelfId) : getAppearance().sidePaneWidth;
  };
  // The outer edge grows the other way: a left Shelf's left edge to the left, a right one's right edge to the right.
  const grows = (target?.side === "left") !== !!target?.outer ? 1 : -1;
  const begin = (width: number) => target && beginEdge(target, width);
  const done = endEdge;
  const end = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    hideWidthTip();
    e.currentTarget.removeAttribute("data-dragging");
    set(target, d.last, true);
    resizeDrag(false);
    done();
  };
  return {
    onPointerDown(e) {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      e.currentTarget.setAttribute("data-dragging", "");
      const width = base();
      begin(width);
      resizeDrag(true);
      drag.current = { x: e.clientX, width, last: width };
      showWidthTip(e.currentTarget, width, { y: e.clientY });
    },
    onPointerMove(e) {
      const d = drag.current;
      if (!d) return;
      const dx = e.clientX - d.x;
      d.last = set(target, d.width + grows * dx, false);
      showWidthTip(e.currentTarget, d.last, { y: e.clientY });
    },
    onPointerUp: end,
    onLostPointerCapture: end,
    onDoubleClick() {
      if (target?.outer) {
        // The outer edge: the Shelf back to its default width; its column and the group's far side stay.
        commitShelfWidth(target.shelfId, null);
      } else if (target) {
        // 宽度规则 5: the two panels beside the edge back to their defaults (the Shelf and its column).
        rowHooks?.shelfReset(target.shelfId);
        commitShelfWidth(target.shelfId, null);
      } else set(null, DEFAULT_APPEARANCE.sidePaneWidth, true);
    },
    onKeyDown(e) {
      const grow = grows > 0 ? "ArrowRight" : "ArrowLeft";
      const shrink = grows > 0 ? "ArrowLeft" : "ArrowRight";
      const dir = e.key === grow ? 1 : e.key === shrink ? -1 : 0;
      if (!dir) return;
      e.preventDefault();
      // As a pointer drag (宽度规则 1): only the Shelf and its own column change, the rest of the row stays; at its
      // minimum the steps push it on (推挤) within the same key session.
      const width = base() - (edgeNow ? useRowDrag.getState().push : 0) + dir * (e.shiftKey ? STEP * 4 : STEP);
      const handle = e.currentTarget;
      if (!edgeNow) begin(base());
      keyResize(
        () => showWidthTip(handle, set(target, width, false), { keys: true }),
        () => {
          set(target, width, true);
          done();
        },
      );
    },
  };
}
