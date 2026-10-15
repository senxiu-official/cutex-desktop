// The right side's width handles (docs/desktop-modules.md §18.3): the gap between the conversation
// and the column, and every card's left edge (a 5 px hot zone). Same state (appearance.sidePaneWidth),
// same limits; drag live, stored on release; double-click = the default width; arrows when focused.
import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { DEFAULT_APPEARANCE, getAppearance, RANGES, setAppearance } from "./appearance";
import { clampPaneWidth } from "./appearanceModel";

const STEP = 16;
let workWidth = Number.POSITIVE_INFINITY;

/** The work area's width (conversation card + right side), measured by the side's work area. */
export function setSideWorkWidth(width: number): void {
  workWidth = width > 0 ? width : Number.POSITIVE_INFINITY;
}

function set(width: number, persist: boolean): void {
  setAppearance({ sidePaneWidth: clampPaneWidth(width, RANGES.sidePaneWidth, workWidth) }, persist);
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
      drag.current = { x: e.clientX, width: current() || getAppearance().sidePaneWidth };
    },
    onPointerMove(e) {
      const d = drag.current;
      // The side grows to the left: moving the pointer left widens it.
      if (d) set(d.width - (e.clientX - d.x), false);
    },
    onPointerUp: end,
    onLostPointerCapture: end,
    onDoubleClick() {
      set(DEFAULT_APPEARANCE.sidePaneWidth, true);
    },
    onKeyDown(e) {
      const dir = e.key === "ArrowLeft" ? 1 : e.key === "ArrowRight" ? -1 : 0;
      if (!dir) return;
      e.preventDefault();
      set((current() || getAppearance().sidePaneWidth) + dir * (e.shiftKey ? STEP * 4 : STEP), true);
    },
  };
}
