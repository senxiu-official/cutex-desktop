// The right side's width handles (docs/desktop-modules.md §18.3): the gap between the conversation
// and the column, and every card's left edge (a 5 px hot zone). Same state (appearance.sidePaneWidth),
// same limits; drag live, stored on release; double-click = the default width; arrows when focused.
// v1.17 (§24): the stored width is ONE tool column's; with two columns on screen the handles move the
// whole tool area and store half of it.
import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { DEFAULT_APPEARANCE, getAppearance, RANGES, setAppearance } from "./appearance";
import { clampPaneWidth, MIN_CONVERSATION_W } from "./appearanceModel";

const STEP = 16;
let workWidth = Number.POSITIVE_INFINITY;
/** Tool columns on screen (§24): the stored width is one column's; the handles move the whole tool area. */
let columns = 1;

/** The tool columns on screen now (components/side/SideArea). */
export function setSideColumns(n: number): void {
  columns = Math.max(1, Math.floor(n) || 1);
}

/** The work area's width (conversation card + right side), measured by the side's work area. */
export function setSideWorkWidth(width: number): void {
  workWidth = width > 0 ? width : Number.POSITIVE_INFINITY;
}

/** `width` = the whole tool area; stored per column (appearance.sidePaneWidth), so 1 ↔ 2 columns keeps each column's width. */
function set(width: number, persist: boolean): void {
  // Each column may take its share of what the conversation leaves (clampPaneWidth keeps MIN_CONVERSATION_W out of `room`).
  const room = (workWidth - MIN_CONVERSATION_W) / columns + MIN_CONVERSATION_W;
  setAppearance({ sidePaneWidth: clampPaneWidth(width / columns, RANGES.sidePaneWidth, room) }, persist);
}

export interface WidthHandle {
  onPointerDown(e: PointerEvent<HTMLElement>): void;
  onPointerMove(e: PointerEvent<HTMLElement>): void;
  onPointerUp(e: PointerEvent<HTMLElement>): void;
  onLostPointerCapture(e: PointerEvent<HTMLElement>): void;
  onDoubleClick(): void;
  onKeyDown(e: KeyboardEvent<HTMLElement>): void;
}

/** Handlers for a width handle; `current` = the side's width on screen now (the drag starts from it). */
export function useSideWidthHandle(current: () => number): WidthHandle {
  const drag = useRef<{ x: number; width: number } | null>(null);
  const end = (e: PointerEvent<HTMLElement>) => {
    if (!drag.current) return;
    drag.current = null;
    e.currentTarget.removeAttribute("data-dragging");
    setAppearance({}, true);
  };
  return {
    onPointerDown(e) {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      e.currentTarget.setAttribute("data-dragging", "");
      drag.current = { x: e.clientX, width: current() || getAppearance().sidePaneWidth * columns };
    },
    onPointerMove(e) {
      const d = drag.current;
      // The side grows to the left: moving the pointer left widens it.
      if (d) set(d.width - (e.clientX - d.x), false);
    },
    onPointerUp: end,
    onLostPointerCapture: end,
    onDoubleClick() {
      set(DEFAULT_APPEARANCE.sidePaneWidth * columns, true);
    },
    onKeyDown(e) {
      const dir = e.key === "ArrowLeft" ? 1 : e.key === "ArrowRight" ? -1 : 0;
      if (!dir) return;
      e.preventDefault();
      set((current() || getAppearance().sidePaneWidth * columns) + dir * (e.shiftKey ? STEP * 4 : STEP) * columns, true);
    },
  };
}
